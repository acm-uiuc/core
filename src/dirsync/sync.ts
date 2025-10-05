import { EventBridgeEvent, Context } from "aws-lambda";
import { logger } from "./logging.js";
import { getConfig } from "./config.js";
import {
  createEntraClient,
  getAllEntraUsers,
  getPrimaryEmail,
} from "./entra.js";
import {
  createGoogleClient,
  getAllDomainContacts,
  createDomainContact,
  updateDomainContact,
  deleteDomainContact,
  GoogleContact,
} from "./gsuite.js";

interface SyncStats {
  totalEntraUsers: number;
  totalGoogleContacts: number;
  created: number;
  updated: number;
  deleted: number;
  errors: number;
}

/**
 * Extracts domain from email address
 */
const extractDomain = (email: string): string => {
  const match = email.match(/@(.+)$/);
  return match ? match[1] : "";
};

/**
 * Checks if two contacts differ
 */
const contactsDiffer = (
  entra: GoogleContact,
  google: GoogleContact,
): boolean => {
  return (
    entra.givenName !== google.givenName ||
    entra.familyName !== google.familyName ||
    entra.displayName !== google.displayName ||
    entra.email !== google.email ||
    entra.upn !== google.upn
  );
};

/**
 * Syncs contacts from Entra ID to Google Workspace Domain Shared Contacts
 */
const syncContacts = async (
  entraUsers: any[],
  googleAuth: any,
  domain: string,
  deleteRemoved: boolean,
): Promise<SyncStats> => {
  logger.info("Starting contact sync");

  const stats: SyncStats = {
    totalEntraUsers: entraUsers.length,
    totalGoogleContacts: 0,
    created: 0,
    updated: 0,
    deleted: 0,
    errors: 0,
  };

  // Fetch existing Google contacts
  const googleContacts = await getAllDomainContacts(googleAuth, domain);
  stats.totalGoogleContacts = googleContacts.size;

  // Build lookup map for Entra users
  const entraMap = new Map<string, GoogleContact>();
  for (const user of entraUsers) {
    const contact: GoogleContact = {
      email: user.email,
      upn: user.upn,
      givenName: user.givenName,
      familyName: user.familyName,
      displayName: user.displayName,
    };
    entraMap.set(getPrimaryEmail(user), contact);
  }

  // Determine what operations to perform
  const toCreate: GoogleContact[] = [];
  const toUpdate: Array<{ id: string; contact: GoogleContact }> = [];
  const toDelete: Array<{ id: string; email: string }> = [];

  // Find contacts to create or update
  for (const [email, entraContact] of entraMap) {
    const existing = googleContacts.get(email);
    if (existing) {
      if (contactsDiffer(entraContact, existing.contact)) {
        toUpdate.push({ id: existing.id, contact: entraContact });
      }
    } else {
      toCreate.push(entraContact);
    }
  }

  // Find contacts to delete
  if (deleteRemoved) {
    for (const [email, googleContact] of googleContacts) {
      if (!entraMap.has(email)) {
        toDelete.push({ id: googleContact.id, email });
      }
    }
  }

  logger.info(
    {
      toCreate: toCreate.length,
      toUpdate: toUpdate.length,
      toDelete: toDelete.length,
    },
    "Sync plan calculated",
  );

  // Execute create operations
  for (const contact of toCreate) {
    const success = await createDomainContact(googleAuth, domain, contact);
    if (success) {
      stats.created++;
    } else {
      stats.errors++;
    }
  }

  // Execute update operations
  for (const { id, contact } of toUpdate) {
    const success = await updateDomainContact(googleAuth, domain, id, contact);
    if (success) {
      stats.updated++;
    } else {
      stats.errors++;
    }
  }

  // Execute delete operations
  for (const { id, email } of toDelete) {
    const success = await deleteDomainContact(googleAuth, domain, id, email);
    if (success) {
      stats.deleted++;
    } else {
      stats.errors++;
    }
  }

  return stats;
};

/**
 * Lambda handler for EventBridge scheduled sync
 */
export const handler = async (
  event: EventBridgeEvent<"Scheduled Event", any>,
  _context: Context,
): Promise<any> => {
  logger.info({ event }, "Started sync lambda handler");

  try {
    // Load configuration
    const config = await getConfig();
    logger.info({ environment: config.environment }, "Configuration loaded");

    // Extract domain from delegated user email
    const domain = extractDomain(config.googleDelegatedUser);
    if (!domain) {
      throw new Error(
        `Invalid googleDelegatedUser email: ${config.googleDelegatedUser}`,
      );
    }

    // Create Entra ID client and fetch users
    const entraClient = createEntraClient(
      config.entraTenantId,
      config.entraClientId,
      config.entraClientCertificate,
    );
    const entraUsers = await getAllEntraUsers(entraClient);

    // Create Google client
    const googleAuth = createGoogleClient(
      config.googleServiceAccountJson,
      config.googleDelegatedUser,
    );

    // Perform sync
    const stats = await syncContacts(
      entraUsers,
      googleAuth,
      domain,
      config.deleteRemovedContacts,
    );

    logger.info({ stats }, "Sync completed successfully");

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: "Sync completed successfully",
        environment: config.environment,
        stats,
      }),
    };
  } catch (error) {
    logger.error({ error }, "Sync failed");

    return {
      statusCode: 500,
      body: JSON.stringify({
        message: "Sync failed",
        error: error instanceof Error ? error.message : "Unknown error",
      }),
    };
  }
};
