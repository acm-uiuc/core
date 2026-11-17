import {
  IoTDataPlaneClient,
  PublishCommand,
} from "@aws-sdk/client-iot-data-plane";
import { AvailableSQSFunctions } from "common/types/sqsMessage.js";
import { getRoleCredentials } from "api/functions/sts.js";
import { SQSHandlerFunction } from "../index.js";

const iotEndpoint = process.env.VENDING_IOT_ENDPOINT;
const iotRegion = process.env.VENDING_IOT_REGION;
const dispenseTopic = process.env.VENDING_DISPENSE_TOPIC;
const publishRoleArn = process.env.VENDING_IOT_PUBLISH_ROLE_ARN;
const iotClient =
  iotEndpoint && iotRegion && publishRoleArn
    ? new IoTDataPlaneClient({
        endpoint: iotEndpoint,
        region: iotRegion,
        credentials: () => getRoleCredentials(publishRoleArn),
      })
    : undefined;

export const dispenseVendingItemHandler: SQSHandlerFunction<
  AvailableSQSFunctions.DispenseVendingItem
> = async ({ vendId, slotId }, _metadata, logger) => {
  if (!iotClient || !dispenseTopic) {
    throw new Error("Vending MQTT configuration is missing");
  }

  await iotClient.send(
    new PublishCommand({
      topic: dispenseTopic,
      qos: 1,
      retain: false,
      payload: Buffer.from(JSON.stringify({ vendId, slotId })),
    }),
  );
  logger.info({ vendId, slotId }, "Published vending dispense command");
};
