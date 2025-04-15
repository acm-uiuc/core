import {
  CloudFrontKeyValueStoreClient,
  ConflictException,
  DeleteKeyCommand,
  DescribeKeyValueStoreCommand,
  GetKeyCommand,
  PutKeyCommand,
} from "@aws-sdk/client-cloudfront-keyvaluestore";
import { environmentConfig } from "common/config.js";
import {
  DatabaseDeleteError,
  DatabaseFetchError,
  DatabaseInsertError,
  InternalServerError,
} from "common/errors/index.js";
import { RunEnvironment } from "common/roles.js";
import "@aws-sdk/signature-v4-crt";

const INITIAL_CONFLICT_WAIT_PERIOD = 150;
const CONFLICT_NUM_RETRIES = 3;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const setKey = async ({
  key,
  value,
  arn,
  kvsClient,
}: {
  key: string;
  value: string;
  arn: string;
  kvsClient: CloudFrontKeyValueStoreClient;
}) => {
  let numRetries = 0;
  let currentWaitPeriod = INITIAL_CONFLICT_WAIT_PERIOD;
  while (numRetries < CONFLICT_NUM_RETRIES) {
    const command = new DescribeKeyValueStoreCommand({ KvsARN: arn });
    const response = await kvsClient.send(command);
    const etag = response.ETag;
    const putCommand = new PutKeyCommand({
      IfMatch: etag,
      Key: key,
      Value: value,
      KvsARN: arn,
    });
    try {
      await kvsClient.send(putCommand);
      return;
    } catch (e) {
      if (e instanceof ConflictException) {
        numRetries++;
        await sleep(currentWaitPeriod);
        currentWaitPeriod *= 2;
        continue;
      } else {
        throw e;
      }
    }
  }
  throw new DatabaseInsertError({
    message: "Failed to save redirect to Cloudfront KV store.",
  });
};

export const deleteKey = async ({
  key,
  arn,
  kvsClient,
}: {
  key: string;
  arn: string;
  kvsClient: CloudFrontKeyValueStoreClient;
}) => {
  let numRetries = 0;
  let currentWaitPeriod = INITIAL_CONFLICT_WAIT_PERIOD;
  while (numRetries < CONFLICT_NUM_RETRIES) {
    const command = new DescribeKeyValueStoreCommand({ KvsARN: arn });
    const response = await kvsClient.send(command);
    const etag = response.ETag;
    const putCommand = new DeleteKeyCommand({
      IfMatch: etag,
      Key: key,
      KvsARN: arn,
    });
    try {
      await kvsClient.send(putCommand);
      return;
    } catch (e) {
      if (e instanceof ConflictException) {
        numRetries++;
        await sleep(currentWaitPeriod);
        currentWaitPeriod *= 2;
        continue;
      } else {
        throw e;
      }
    }
  }
  throw new DatabaseDeleteError({
    message: "Failed to save delete to Cloudfront KV store.",
  });
};

export const getKey = async ({
  key,
  arn,
  kvsClient,
}: {
  key: string;
  arn: string;
  kvsClient: CloudFrontKeyValueStoreClient;
}) => {
  let numRetries = 0;
  let currentWaitPeriod = INITIAL_CONFLICT_WAIT_PERIOD;
  while (numRetries < CONFLICT_NUM_RETRIES) {
    const getCommand = new GetKeyCommand({
      Key: key,
      KvsARN: arn,
    });
    try {
      const response = await kvsClient.send(getCommand);
      return response.Value;
    } catch (e) {
      if (e instanceof ConflictException) {
        numRetries++;
        await sleep(currentWaitPeriod);
        currentWaitPeriod *= 2;
        continue;
      } else {
        throw e;
      }
    }
  }
  throw new DatabaseFetchError({
    message: "Failed to retrieve value from Cloudfront KV store.",
  });
};

export const getLinkryKvArn = async (runEnvironment: RunEnvironment) => {
  if (process.env.LinkryKvArn) {
    return process.env.LinkryKvArn;
  }
  if (environmentConfig[runEnvironment].LinkryCloudfrontKvArn) {
    return environmentConfig[runEnvironment].LinkryCloudfrontKvArn;
  }
  throw new InternalServerError({
    message: "Could not find the Cloudfront Key-Value store ARN",
  });
};
