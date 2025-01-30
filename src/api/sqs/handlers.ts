import { AvailableSQSFunctions } from "common/types/sqsMessage.js";
import { SQSHandlerFunction } from "./index.js";

export const emailMembershipPassHandler: SQSHandlerFunction<
  AvailableSQSFunctions.EmailMembershipPass
> = async (payload, metadata, logger) => {
  logger.error("Not implemented yet!");
  return;
};

export const pingHandler: SQSHandlerFunction<
  AvailableSQSFunctions.Ping
> = async (payload, metadata, logger) => {
  logger.error("Not implemented yet!");
  return;
};
