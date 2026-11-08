import { AvailableSQSFunctions } from "common/types/sqsMessage.js";
import { SQSHandlerFunction } from "../index.js";

export const dispenseVendingItemHandler: SQSHandlerFunction<
  AvailableSQSFunctions.DispenseVendingItem
> = async (_payload, _metadata, _logger) => {
  // TODO: send a request to the vending machine to dispense the item over MQTT
};
