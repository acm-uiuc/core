import { AvailableSQSFunctions } from "common/types/sqsMessage.js";
import { SQSHandlerFunction } from "../index.js";

export const pingHandler: SQSHandlerFunction<
  AvailableSQSFunctions.Ping
> = async (_payload, _metadata, logger) => {
  logger.info("Pong!");
};
