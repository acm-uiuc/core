import {
  commChairsGroupId,
  commChairsTestingGroupId,
  execCouncilGroupId,
  execCouncilTestingGroupId,
  genericConfig,
  officersGroupId,
  officersGroupTestingId,
} from "../../common/config.js";
import {
  EntraFetchError,
  EntraGroupError,
  EntraInvitationError,
  EntraPatchError,
  InternalServerError,
} from "../../common/errors/index.js";
import { getSecretValue } from "../plugins/auth.js";
import { ConfidentialClientApplication } from "@azure/msal-node";
import { getItemFromCache, insertItemIntoCache } from "./cache.js";
import {
  EntraGroupActions,
  EntraInvitationResponse,
  ProfilePatchRequest,
} from "../../common/types/iam.js";
import { UserProfileDataBase } from "common/types/msGraphApi.js";
import { SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";

function validateGroupId(groupId: string): boolean {
  const groupIdPattern = /^[a-zA-Z0-9-]+$/; // Adjust the pattern as needed
  return groupIdPattern.test(groupId);
}

export async function getEntraIdToken(
  clients: { smClient: SecretsManagerClient; dynamoClient: DynamoDBClient },
  clientId: string,
  scopes: string[] = ["https://graph.microsoft.com/.default"],
) {
  const secretApiConfig =
    (await getSecretValue(clients.smClient, genericConfig.ConfigSecretName)) ||
    {};
  if (
    !secretApiConfig.entra_id_private_key ||
    !secretApiConfig.entra_id_thumbprint
  ) {
    throw new InternalServerError({
      message: "Could not find Entra ID credentials.",
    });
  }
  const decodedPrivateKey = Buffer.from(
    secretApiConfig.entra_id_private_key as string,
    "base64",
  ).toString("utf8");
  const cachedToken = await getItemFromCache(
    clients.dynamoClient,
    "entra_id_access_token",
  );
  if (cachedToken) {
    return cachedToken["token"] as string;
  }
  const config = {
    auth: {
      clientId: clientId,
      authority: `https://login.microsoftonline.com/${genericConfig.EntraTenantId}`,
      clientCertificate: {
        thumbprint: (secretApiConfig.entra_id_thumbprint as string) || "",
        privateKey: decodedPrivateKey,
      },
    },
  };
  const cca = new ConfidentialClientApplication(config);
  try {
    const result = await cca.acquireTokenByClientCredential({
      scopes,
    });
    const date = result?.expiresOn;
    if (!date) {
      throw new InternalServerError({
        message: `Failed to acquire token: token has no expiry field.`,
      });
    }
    date.setTime(date.getTime() - 30000);
    if (result?.accessToken) {
      await insertItemIntoCache(
        clients.dynamoClient,
        "entra_id_access_token",
        { token: result?.accessToken },
        date,
      );
    }
    return result?.accessToken ?? null;
  } catch (error) {
    throw new InternalServerError({
      message: `Failed to acquire token: ${error}`,
    });
  }
}

/**
 * Adds a user to the tenant by sending an invitation to their email
 * @param token - Entra ID token authorized to take this action.
 * @param email - The email address of the user to invite
 * @throws {InternalServerError} If the invitation fails
 * @returns {Promise<boolean>} True if the invitation was successful
 */
export async function addToTenant(token: string, email: string) {
  email = email.toLowerCase().replace(/\s/g, "");
  if (!email.endsWith("@illinois.edu")) {
    throw new EntraInvitationError({
      email,
      message: "User's domain must be illinois.edu to be invited.",
    });
  }
  try {
    const body = {
      invitedUserEmailAddress: email,
      inviteRedirectUrl: "https://acm.illinois.edu",
    };
    const url = "https://graph.microsoft.com/v1.0/invitations";
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorData = (await response.json()) as EntraInvitationResponse;
      throw new EntraInvitationError({
        message: errorData.error?.message || response.statusText,
        email,
      });
    }

    return { success: true, email };
  } catch (error) {
    if (error instanceof EntraInvitationError) {
      throw error;
    }

    throw new EntraInvitationError({
      message: error instanceof Error ? error.message : String(error),
      email,
    });
  }
}

/**
 * Resolves an email address to an OID using Microsoft Graph API.
 * @param token - Entra ID token authorized to perform this action.
 * @param email - The email address to resolve.
 * @throws {Error} If the resolution fails.
 * @returns {Promise<string>} The OID of the user.
 */
export async function resolveEmailToOid(
  token: string,
  email: string,
): Promise<string> {
  email = email.toLowerCase().replace(/\s/g, "");

  const url = `https://graph.microsoft.com/v1.0/users?$filter=mail eq '${email}'`;

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const errorData = (await response.json()) as {
      error?: { message?: string };
    };
    throw new Error(errorData?.error?.message ?? response.statusText);
  }

  const data = (await response.json()) as {
    value: { id: string }[];
  };

  if (!data.value || data.value.length === 0) {
    throw new Error(`No user found with email: ${email}`);
  }

  return data.value[0].id;
}

/**
 * Adds or removes a user from an Entra ID group.
 * @param token - Entra ID token authorized to take this action.
 * @param email - The email address of the user to add or remove.
 * @param group - The group ID to take action on.
 * @param action - Whether to add or remove the user from the group.
 * @throws {EntraGroupError} If the group action fails.
 * @returns {Promise<boolean>} True if the action was successful.
 */
export async function modifyGroup(
  token: string,
  email: string,
  group: string,
  action: EntraGroupActions,
): Promise<boolean> {
  email = email.toLowerCase().replace(/\s/g, "");
  if (!email.endsWith("@illinois.edu")) {
    throw new EntraGroupError({
      group,
      message: "User's domain must be illinois.edu to be added to the group.",
    });
  }
  // if adding to exec group, check that all exec members we want to add are paid members
  const paidMemberRequiredGroups = [
    execCouncilGroupId,
    execCouncilTestingGroupId,
    officersGroupId,
    officersGroupTestingId,
    commChairsGroupId,
    commChairsTestingGroupId,
  ];
  if (
    paidMemberRequiredGroups.includes(group) &&
    action === EntraGroupActions.ADD
  ) {
    const netId = email.split("@")[0];
    const response = await fetch(
      `https://membership.acm.illinois.edu/api/v1/checkMembership?netId=${netId}`,
    );
    const membershipStatus = (await response.json()) as {
      netId: string;
      isPaidMember: boolean;
    };
    if (!membershipStatus["isPaidMember"]) {
      throw new EntraGroupError({
        message: `${netId} is not a paid member. This group requires that all members are paid members.`,
        group,
      });
    }
  }
  try {
    const oid = await resolveEmailToOid(token, email);
    const methodMapper = {
      [EntraGroupActions.ADD]: "POST",
      [EntraGroupActions.REMOVE]: "DELETE",
    };

    const urlMapper = {
      [EntraGroupActions.ADD]: `https://graph.microsoft.com/v1.0/groups/${group}/members/$ref`,
      [EntraGroupActions.REMOVE]: `https://graph.microsoft.com/v1.0/groups/${group}/members/${oid}/$ref`,
    };
    const url = urlMapper[action];
    const body = {
      "@odata.id": `https://graph.microsoft.com/v1.0/directoryObjects/${oid}`,
    };

    const response = await fetch(url, {
      method: methodMapper[action],
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorData = (await response.json()) as {
        error?: { message?: string };
      };
      if (
        errorData?.error?.message ===
        "One or more added object references already exist for the following modified properties: 'members'."
      ) {
        return true;
      }
      throw new EntraGroupError({
        message: errorData?.error?.message ?? response.statusText,
        group,
      });
    }

    return true;
  } catch (error) {
    if (error instanceof EntraGroupError) {
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    if (message) {
      throw new EntraGroupError({
        message,
        group,
      });
    }
  }
  return false;
}

/**
 * Lists all members of an Entra ID group.
 * @param token - Entra ID token authorized to take this action.
 * @param group - The group ID to fetch members for.
 * @throws {EntraGroupError} If the group action fails.
 * @returns {Promise<Array<{ name: string; email: string }>>} List of members with name and email.
 */
export async function listGroupMembers(
  token: string,
  group: string,
): Promise<Array<{ name: string; email: string }>> {
  if (!validateGroupId(group)) {
    throw new EntraGroupError({
      message: "Invalid group ID format",
      group,
    });
  }
  try {
    const url = `https://graph.microsoft.com/v1.0/groups/${group}/members`;
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const errorData = (await response.json()) as {
        error?: { message?: string };
      };
      throw new EntraGroupError({
        message: errorData?.error?.message ?? response.statusText,
        group,
      });
    }

    const data = (await response.json()) as {
      value: Array<{
        displayName?: string;
        mail?: string;
      }>;
    };

    // Map the response to the desired format
    const members = data.value.map((member) => ({
      name: member.displayName ?? "",
      email: member.mail ?? "",
    }));

    return members;
  } catch (error) {
    if (error instanceof EntraGroupError) {
      throw error;
    }

    throw new EntraGroupError({
      message: error instanceof Error ? error.message : String(error),
      group,
    });
  }
}

/**
 * Retrieves the profile of a user from Entra ID.
 * @param token - Entra ID token authorized to perform this action.
 * @param userId - The user ID to fetch the profile for.
 * @throws {EntraUserError} If fetching the user profile fails.
 * @returns {Promise<UserProfileDataBase>} The user's profile information.
 */
export async function getUserProfile(
  token: string,
  email: string,
): Promise<UserProfileDataBase> {
  const userId = await resolveEmailToOid(token, email);
  try {
    const url = `https://graph.microsoft.com/v1.0/users/${userId}?$select=userPrincipalName,givenName,surname,displayName,otherMails,mail`;
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const errorData = (await response.json()) as {
        error?: { message?: string };
      };
      throw new EntraFetchError({
        message: errorData?.error?.message ?? response.statusText,
        email,
      });
    }
    return (await response.json()) as UserProfileDataBase;
  } catch (error) {
    if (error instanceof EntraFetchError) {
      throw error;
    }

    throw new EntraFetchError({
      message: error instanceof Error ? error.message : String(error),
      email,
    });
  }
}

/**
 * Patches the profile of a user from Entra ID.
 * @param token - Entra ID token authorized to perform this action.
 * @param userId - The user ID to patch the profile for.
 * @throws {EntraUserError} If setting the user profile fails.
 * @returns {Promise<void>} nothing
 */
export async function patchUserProfile(
  token: string,
  email: string,
  userId: string,
  data: ProfilePatchRequest,
): Promise<void> {
  try {
    const url = `https://graph.microsoft.com/v1.0/users/${userId}`;
    const response = await fetch(url, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      const errorData = (await response.json()) as {
        error?: { message?: string };
      };
      throw new EntraPatchError({
        message: errorData?.error?.message ?? response.statusText,
        email,
      });
    }
    return;
  } catch (error) {
    if (error instanceof EntraPatchError) {
      throw error;
    }

    throw new EntraPatchError({
      message: error instanceof Error ? error.message : String(error),
      email,
    });
  }
}
