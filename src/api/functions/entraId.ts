import { genericConfig } from "../../common/config.js";
import {
  EntraInvitationError,
  InternalServerError,
} from "../../common/errors/index.js";
import { getSecretValue } from "../plugins/auth.js";
import { ConfidentialClientApplication } from "@azure/msal-node";
import { getItemFromCache, insertItemIntoCache } from "./cache.js";

interface EntraInvitationResponse {
  status: number;
  data?: Record<string, string>;
  error?: {
    message: string;
    code?: string;
  };
}
export async function getEntraIdToken(
  clientId: string,
  scopes: string[] = ["https://graph.microsoft.com/.default"],
) {
  const secretApiConfig =
    (await getSecretValue(genericConfig.ConfigSecretName)) || {};
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
  const cachedToken = await getItemFromCache("entra_id_access_token");
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
