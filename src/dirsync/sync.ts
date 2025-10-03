import { type Context, type EventBridgeEvent } from "aws-lambda";
import { getConfig } from "./config";
import { logger } from "./logging";
import { createEntraClient, getAllEntraUsers } from "./entra";

const secretConfig = await getConfig();

export const handler = async (
  event: EventBridgeEvent<"Scheduled Event", string>,
  _context: Context,
): Promise<any> => {
  logger.info("Started the sync lambda handler!");
  logger.info("Creating the Entra ID client");
  const entraClient = createEntraClient(
    secretConfig.entraTenantId,
    secretConfig.entraClientId,
    secretConfig.entraClientSecret,
  );
  const entraUsers = await getAllEntraUsers(entraClient);
  logger.info(`Retrieved ${entraUsers.length} users from Entra ID.`);
  return {
    statusCode: 200,
    body: JSON.stringify("Done!"),
  };
};
