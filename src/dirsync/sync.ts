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
  const entraClient = createEntraClient(
    secretConfig.entraTenantId,
    secretConfig.entraClientId,
    secretConfig.entraClientCertificate,
  );
  const entraUsers = await getAllEntraUsers(entraClient);
  return {
    statusCode: 200,
    body: JSON.stringify("Done!"),
  };
};
