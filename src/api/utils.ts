import { InternalServerError } from "common/errors/index.js";
import { ValidLoggers } from "./types.js";
import {
  SSMClient,
  GetParameterCommand,
  GetParametersCommand,
} from "@aws-sdk/client-ssm";
import {
  type AttributeValue,
  BatchGetItemCommand,
  DynamoDBClient,
} from "@aws-sdk/client-dynamodb";
import { genericConfig } from "common/config.js";

export const sleep = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

export interface RetryOptions {
  maxRetries?: number;
  baseDelay?: number;
  maxDelay?: number;
  shouldRetry?: (error: any, attempt: number) => boolean;
  onRetry?: (error: any, attempt: number, delay: number) => void;
}

export async function retryWithBackoff<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const {
    maxRetries = 3,
    baseDelay = 100,
    maxDelay = 2000,
    shouldRetry = () => true,
    onRetry,
  } = options;

  let lastError: Error | undefined;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error: any) {
      lastError = error;

      const isLastAttempt = attempt === maxRetries - 1;
      const isRetryable = shouldRetry(error, attempt);

      if (!isRetryable || isLastAttempt) {
        throw error;
      }

      const exponentialDelay = baseDelay * 2 ** attempt;
      const jitter = Math.random() * exponentialDelay;
      const delay = Math.min(exponentialDelay + jitter, maxDelay);

      onRetry?.(error, attempt, delay);

      await sleep(delay);
    }
  }

  throw lastError;
}

export function logOnRetry(op: string, logger: ValidLoggers) {
  return (error: any, attempt: number, delay: number) => {
    logger.warn(
      `${op} failed (attempt ${attempt + 1}/${3}), retrying in ${Math.round(delay)}ms...`,
    );
    logger.error(error);
  };
}
export async function retryDynamoTransactionWithBackoff<T>(
  operation: () => Promise<T>,
  logger: ValidLoggers,
  operationName: string,
): Promise<T> {
  return retryWithBackoff(operation, {
    maxRetries: 3,
    baseDelay: 100,
    shouldRetry: (error) =>
      error.name === "TransactionCanceledException" ||
      error.name === "ConditionalCheckFailedException",
    onRetry: logOnRetry(operationName, logger),
  });
}

type GetSsmParameterInputs = {
  parameterName: string;
  logger: ValidLoggers;
  ssmClient?: SSMClient | undefined;
};

export const getSsmParameter = async ({
  parameterName,
  logger,
  ssmClient,
}: GetSsmParameterInputs) => {
  const client =
    ssmClient || new SSMClient({ region: genericConfig.AwsRegion });

  const params = {
    Name: parameterName,
    WithDecryption: true,
  };

  const command = new GetParameterCommand(params);

  try {
    const data = await client.send(command);
    if (!data.Parameter || !data.Parameter.Value) {
      logger.error(`Parameter ${parameterName} not found`);
      throw new InternalServerError({ message: "Parameter not found" });
    }
    return data.Parameter.Value;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(
      `Error retrieving parameter ${parameterName}: ${errorMessage}`,
      error,
    );
    throw new InternalServerError({ message: "Failed to retrieve parameter" });
  }
};

type GetSsmParametersInputs = {
  parameterNames: string[];
  logger: ValidLoggers;
  ssmClient?: SSMClient | undefined;
};

// AWS SSM GetParameters supports max 10 parameters per request
const SSM_BATCH_SIZE = 10;

export const getSsmParameters = async ({
  parameterNames,
  logger,
  ssmClient,
}: GetSsmParametersInputs): Promise<Record<string, string>> => {
  if (parameterNames.length === 0) {
    return {};
  }

  const client =
    ssmClient || new SSMClient({ region: genericConfig.AwsRegion });

  // Split parameter names into batches of 10
  const batches: string[][] = [];
  for (let i = 0; i < parameterNames.length; i += SSM_BATCH_SIZE) {
    batches.push(parameterNames.slice(i, i + SSM_BATCH_SIZE));
  }

  try {
    const batchResults = await Promise.all(
      batches.map(async (batch) => {
        const command = new GetParametersCommand({
          Names: batch,
          WithDecryption: true,
        });
        return client.send(command);
      }),
    );

    const results: Record<string, string> = {};
    const allInvalidParameters: string[] = [];

    for (const data of batchResults) {
      if (data.InvalidParameters && data.InvalidParameters.length > 0) {
        allInvalidParameters.push(...data.InvalidParameters);
      }

      for (const param of data.Parameters || []) {
        if (param.Name && param.Value) {
          results[param.Name] = param.Value;
        }
      }
    }

    if (allInvalidParameters.length > 0) {
      logger.error(`Invalid parameters: ${allInvalidParameters.join(", ")}`);
      throw new InternalServerError({
        message: `Invalid parameters: ${allInvalidParameters.join(", ")}`,
      });
    }

    const missingParams = parameterNames.filter((name) => !(name in results));
    if (missingParams.length > 0) {
      logger.error(`Parameters not found: ${missingParams.join(", ")}`);
      throw new InternalServerError({
        message: `Parameters not found: ${missingParams.join(", ")}`,
      });
    }

    return results;
  } catch (error) {
    if (error instanceof InternalServerError) {
      throw error;
    }
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Error retrieving parameters: ${errorMessage}`, error);
    throw new InternalServerError({
      message: "Failed to retrieve parameters",
    });
  }
};

/**
 * Runs DynamoDB BatchGetItem in chunks of 100 keys, handling unprocessed keys
 * (returned when results exceed 16MB) with retries and exponential backoff.
 *
 * @param keys - All keys to fetch
 * @param tableName - DynamoDB table name
 * @param dynamoClient - DynamoDB client
 * @param logger - Logger for retry logging
 * @param processItem - Transform each raw DynamoDB item into your desired type
 * @param requestOptions - Optional extra KeysAndAttributes fields (e.g. ProjectionExpression, ExpressionAttributeNames)
 */
export async function batchGetItemChunked<TResult>({
  keys,
  tableName,
  dynamoClient,
  logger,
  processItem,
  requestOptions,
}: {
  keys: Record<string, AttributeValue>[];
  tableName: string;
  dynamoClient: DynamoDBClient;
  logger: ValidLoggers;
  processItem: (item: Record<string, AttributeValue>) => TResult;
  requestOptions?: Omit<
    NonNullable<
      NonNullable<
        ConstructorParameters<typeof BatchGetItemCommand>[0]
      >["RequestItems"]
    >[string],
    "Keys"
  >;
}): Promise<TResult[]> {
  const BATCH_GET_LIMIT = 100;
  const chunks: Record<string, AttributeValue>[][] = [];
  for (let i = 0; i < keys.length; i += BATCH_GET_LIMIT) {
    chunks.push(keys.slice(i, i + BATCH_GET_LIMIT));
  }

  class UnprocessedKeysError extends Error {
    constructor() {
      super("BatchGetItem returned unprocessed keys");
      this.name = "UnprocessedKeysError";
    }
  }

  const chunkResults = await Promise.all(
    chunks.map(async (chunk) => {
      const results: TResult[] = [];
      let keysToFetch = chunk;

      await retryWithBackoff(
        async () => {
          const response = await dynamoClient.send(
            new BatchGetItemCommand({
              RequestItems: {
                [tableName]: {
                  ...requestOptions,
                  Keys: keysToFetch,
                },
              },
            }),
          );

          const items = response.Responses?.[tableName] || [];
          for (const item of items) {
            results.push(processItem(item));
          }

          const unprocessedKeys = response.UnprocessedKeys?.[tableName]?.Keys;

          if (unprocessedKeys && unprocessedKeys.length > 0) {
            keysToFetch = unprocessedKeys;
            throw new UnprocessedKeysError();
          }
        },
        {
          maxRetries: 5,
          shouldRetry: (error) => error instanceof UnprocessedKeysError,
          onRetry: logOnRetry("BatchGetItem", logger),
        },
      );

      return results;
    }),
  );

  return chunkResults.flat();
}

export const isProd = process.env.RunEnvironment === "prod";
