import { ValidLoggers } from "api/types.js";
import { sleep } from "api/utils.js";
import { BaseError, GithubError } from "common/errors/index.js";
import { Octokit } from "octokit";

export interface CreateGithubTeamInputs {
  githubToken: string;
  orgId: string;
  parentTeamId: number;
  name: string;
  description?: string;
  privacy?: "secret" | "closed";
  logger: ValidLoggers;
  groupsToSync?: string[];
}

async function findIdpGroupWithRetry({
  octokit,
  orgId,
  groupId,
  logger,
  maxRetries,
}: {
  octokit: Octokit;
  groupId: string;
  orgId: string;
  logger: ValidLoggers;
  maxRetries: number;
}): Promise<{
  group_id: string;
  group_name: string;
  group_description: string;
} | null> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      logger.info(
        `Searching for IdP group ${groupId} (attempt ${attempt + 1}/${maxRetries})`,
      );

      // List all IdP groups
      const response = await octokit.request(
        "GET /orgs/{org}/team-sync/groups",
        {
          org: orgId,
          headers: {
            "X-GitHub-Api-Version": "2022-11-28",
          },
        },
      );

      // Search for the group by ID
      const group = response.data.groups?.find(
        (g: any) => g.group_id === groupId,
      );

      if (group) {
        logger.info(`Found IdP group: ${group.group_name}`);
        return {
          group_id: group.group_id,
          group_name: group.group_name,
          group_description: group.group_description || "",
        };
      }

      if (attempt < maxRetries - 1) {
        const baseDelay = 250;
        const exponentialDelay = baseDelay * 2 ** attempt;
        const jitter = Math.random() * 250;
        const delay = exponentialDelay + jitter;

        logger.warn(
          `IdP group ${groupId} not found, retrying in ${Math.round(delay)}ms...`,
        );
        await sleep(delay);
      }
    } catch (error) {
      logger.error(
        `Error searching for IdP group (attempt ${attempt + 1}/${maxRetries}):`,
        error,
      );

      if (attempt < maxRetries - 1) {
        const baseDelay = 1000;
        const exponentialDelay = baseDelay * 2 ** attempt;
        const jitter = Math.random() * 1000;
        const delay = exponentialDelay + jitter;

        logger.warn(`Retrying in ${Math.round(delay)}ms...`);
        await sleep(delay);
      }
    }
  }

  return null;
}

async function resolveTeamIdToSlug({
  octokit,
  orgId,
  teamId,
  logger,
}: {
  octokit: Octokit;
  orgId: number;
  teamId: number;
  logger: ValidLoggers;
}): Promise<string> {
  try {
    logger.info(`Resolving team ID ${teamId} to slug`);
    const response = await octokit.request(
      "GET /organizations/{org}/team/{team_id}",
      {
        org: orgId,
        team_id: teamId,
        headers: {
          "X-GitHub-Api-Version": "2022-11-28",
        },
      },
    );
    const slug = response.data.slug;
    logger.info(`Resolved team ID ${teamId} to slug: ${slug}`);
    return slug;
  } catch (error) {
    logger.error(`Failed to resolve team ID ${teamId} to slug:`, error);
    throw new GithubError({
      message: `Failed to resolve team ID ${teamId} to slug`,
    });
  }
}

export async function createGithubTeam({
  githubToken,
  orgId,
  parentTeamId,
  description,
  name,
  privacy,
  logger,
}: Omit<CreateGithubTeamInputs, "groupsToSync">) {
  try {
    const octokit = new Octokit({
      auth: githubToken,
    });
    logger.info(`Checking if GitHub team "${name}" exists`);
    const teamsResponse = await octokit.request("GET /orgs/{org}/teams", {
      org: orgId,
    });

    const existingTeam = teamsResponse.data.find(
      (team: { name: string; id: number }) => team.name === name,
    );

    if (existingTeam) {
      logger.info(`Team "${name}" already exists with id: ${existingTeam.id}`);
      return { updated: false, id: existingTeam.id };
    }
    logger.info(`Creating GitHub team "${name}"`);
    const response = await octokit.request("POST /orgs/{org}/teams", {
      org: orgId,
      name,
      description: `[Managed by Core API]${description ? ` ${description}` : ""}`,
      privacy: privacy || "closed",
      notification_setting: "notifications_enabled",
      parent_team_id: parentTeamId,
    });
    if (response.status !== 201) {
      logger.error(response.data);
      throw new GithubError({
        message: "Failed to create Github team.",
      });
    }
    const newTeamSlug = response.data.slug;
    const newTeamId = response.data.id;
    logger.info(`Created Github Team with slug ${newTeamSlug}`);

    // Remove the authenticated user from the team
    try {
      const { data: authenticatedUser } = await octokit.request("GET /user");
      logger.info(
        `Removing user ${authenticatedUser.login} from team ${newTeamId}`,
      );

      await octokit.request(
        "DELETE /orgs/{org}/teams/{team_id}/memberships/{username}",
        {
          org: orgId,
          team_id: newTeamId,
          username: authenticatedUser.login,
        },
      );

      logger.info(
        `Successfully removed ${authenticatedUser.login} from team ${newTeamId}`,
      );
    } catch (removeError) {
      logger.warn(`Failed to remove user from team ${newTeamId}:`, removeError);
    }

    return { updated: true, id: newTeamId };
  } catch (e) {
    if (e instanceof BaseError) {
      throw e;
    }
    logger.error("Failed to create GitHub team.");
    logger.error(e);
    throw new GithubError({
      message: "Failed to create GitHub team.",
    });
  }
}

export async function assignIdpGroupsToTeam({
  githubToken,
  teamId,
  groupsToSync,
  logger,
  orgId,
  orgName,
}: {
  githubToken: string;
  teamId: number;
  groupsToSync: string[];
  logger: ValidLoggers;
  orgId: number;
  orgName: string;
}) {
  try {
    const octokit = new Octokit({
      auth: githubToken,
    });

    if (!groupsToSync || groupsToSync.length === 0) {
      logger.info("No IdP groups to sync");
      return;
    }

    try {
      logger.info(`Checking team sync availability for team ${teamId}`);
      await octokit.request(
        "GET /organizations/{org}/team/{team_id}/team-sync/group-mappings",
        {
          org: orgId,
          team_id: teamId,
          headers: {
            "X-GitHub-Api-Version": "2022-11-28",
          },
        },
      );
      logger.info("Team sync is available for this team");
    } catch (checkError: any) {
      if (checkError.status === 404) {
        logger.warn(
          `Team sync is not available for team ${teamId}. This could mean:
          1. The organization doesn't have SAML SSO properly configured
          2. Team sync feature is not enabled for this organization
          3. The team was just created and sync isn't ready yet`,
        );
        logger.warn("Skipping IdP group assignment");
        return;
      }
      throw checkError;
    }

    const idpGroups = [];
    for (const groupId of groupsToSync) {
      const idpGroup = await findIdpGroupWithRetry({
        octokit,
        orgId: orgName,
        groupId,
        logger,
        maxRetries: 5,
      });

      if (!idpGroup) {
        logger.error(
          `Failed to find IdP group with ID ${groupId} after 5 retries`,
        );
        throw new GithubError({
          message: `IdP group with ID ${groupId} not found`,
        });
      }
      idpGroups.push(idpGroup);
    }

    logger.info(`Mapping ${idpGroups.length} IdP group(s) to team ${teamId}`);
    await octokit.request(
      "PATCH /organizations/{org}/team/{team_id}/team-sync/group-mappings",
      {
        org: orgId,
        team_id: teamId,
        groups: idpGroups,
        headers: {
          "X-GitHub-Api-Version": "2022-11-28",
        },
      },
    );

    logger.info(`Successfully mapped IdP groups to team ${teamId}`);
  } catch (e: any) {
    if (e instanceof BaseError) {
      throw e;
    }

    if (e.status === 404) {
      logger.warn(
        `Team sync endpoint not available for team ${teamId}. IdP groups were not assigned.`,
      );
      return;
    }

    logger.error(`Failed to assign IdP groups to team ${teamId}`);
    logger.error(e);
    throw new GithubError({
      message: `Failed to assign IdP groups to team ${teamId}`,
    });
  }
}
