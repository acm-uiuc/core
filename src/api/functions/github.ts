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
      return existingTeam.id;
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
      // Don't throw here - team was created successfully
    }

    return newTeamId;
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
}: {
  githubToken: string;
  teamId: number;
  groupsToSync: string[];
  logger: ValidLoggers;
  orgId: string;
}) {
  try {
    const octokit = new Octokit({
      auth: githubToken,
    });

    if (!groupsToSync || groupsToSync.length === 0) {
      logger.info("No IdP groups to sync");
      return;
    }

    // Search for IdP groups with retry logic
    const idpGroups = [];
    for (const groupId of groupsToSync) {
      const idpGroup = await findIdpGroupWithRetry({
        octokit,
        orgId,
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

    // Add IdP group mappings to team
    logger.info(`Mapping ${idpGroups.length} IdP group(s) to team ${teamId}`);
    await octokit.request(
      "PATCH /orgs/{org}/teams/{team_id}/team-sync/group-mappings",
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
  } catch (e) {
    if (e instanceof BaseError) {
      throw e;
    }
    logger.error(`Failed to assign IdP groups to team ${teamId}`);
    logger.error(e);
    throw new GithubError({
      message: `Failed to assign IdP groups to team ${teamId}`,
    });
  }
}
