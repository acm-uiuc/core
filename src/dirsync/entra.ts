import { Client } from "@microsoft/microsoft-graph-client";
import { ClientCertificateCredential } from "@azure/identity";
import { parseDisplayName } from "../common/utils.js";
import { logger } from "./logging.js";

export interface EntraUser {
  email: string;
  upn: string;
  givenName: string;
  familyName: string;
  displayName: string;
}

interface GraphUser {
  userPrincipalName?: string;
  mail?: string;
  givenName?: string;
  surname?: string;
  displayName?: string;
}

/**
 * Creates a Microsoft Graph client with the provided credentials
 */
export const createEntraClient = (
  tenantId: string,
  clientId: string,
  clientCertificate: string,
): Client => {
  logger.info("Creating the Entra ID client");
  const certificatePem = Buffer.from(clientCertificate, "base64").toString(
    "utf-8",
  );
  const credential = new ClientCertificateCredential(tenantId, clientId, {
    certificate: certificatePem,
  });

  return Client.initWithMiddleware({
    authProvider: {
      getAccessToken: async () => {
        const token = await credential.getToken(
          "https://graph.microsoft.com/.default",
        );
        return token?.token || "";
      },
    },
  });
};

/**
 * Fetches all enabled users from Entra ID
 */
export const getAllEntraUsers = async (
  client: Client,
): Promise<EntraUser[]> => {
  logger.info("Fetching users from Entra ID...");
  const users: EntraUser[] = [];

  try {
    let response = await client
      .api("/users")
      .select("userPrincipalName,mail,givenName,surname,displayName")
      .filter("accountEnabled eq true")
      .top(999)
      .get();

    while (response) {
      const graphUsers: GraphUser[] = response.value || [];

      for (const user of graphUsers) {
        // Require at least UPN or mail
        if (!user.userPrincipalName && !user.mail) {
          continue;
        }

        const displayName =
          user.displayName || user.mail || user.userPrincipalName || "";
        let givenName = user.givenName || "";
        let familyName = user.surname || "";

        // If we have displayName but missing first/last name, try to parse it
        if (displayName && (!givenName || !familyName)) {
          const parsed = parseDisplayName(displayName);
          if (!givenName) {
            givenName = parsed.givenName;
          }
          if (!familyName) {
            familyName = parsed.familyName;
          }
        }

        users.push({
          email: user.mail || "",
          upn: user.userPrincipalName || "",
          givenName,
          familyName,
          displayName,
        });
      }

      // Handle pagination
      if (response["@odata.nextLink"]) {
        response = await client.api(response["@odata.nextLink"]).get();
      } else {
        break;
      }
    }

    logger.info(`Fetched ${users.length} users from Entra ID`);
    return users;
  } catch (error) {
    console.error("Error fetching Entra ID users:", error);
    throw error;
  }
};

export const getPrimaryEmail = (user: EntraUser): string => {
  return (user.email || user.upn).toLowerCase();
};
