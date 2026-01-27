import { InternalServerError } from "common/errors/index.js";
import { ValidLoggers } from "./types.js";
import {
  SSMClient,
  GetParameterCommand,
  GetParametersCommand,
} from "@aws-sdk/client-ssm";
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

export const isProd = process.env.RunEnvironment === "prod";
