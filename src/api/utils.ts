import { InternalServerError } from "common/errors/index.js";
import { ValidLoggers } from "./types.js";
import {
  SSMClient,
  GetParameterCommand,
  GetParametersCommand,
} from "@aws-sdk/client-ssm";
import { genericConfig } from "common/config.js";

const MAX_RETRIES = 3;

const BASE_RETRY_DELAY = 100;

export const sleep = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

export async function retryDynamoTransactionWithBackoff<T>(
  operation: () => Promise<T>,
  logger: ValidLoggers,
  operationName: string,
): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      return await operation();
    } catch (error: any) {
      lastError = error;
      const isRetryable =
        error.name === "TransactionCanceledException" ||
        error.name === "ConditionalCheckFailedException";

      if (!isRetryable || attempt === MAX_RETRIES - 1) {
        throw error;
      }

      const exponentialDelay = BASE_RETRY_DELAY * 2 ** attempt;
      const jitter = Math.random() * exponentialDelay;
      const delay = exponentialDelay + jitter;

      logger.info(
        `${operationName} failed (attempt ${attempt + 1}/${MAX_RETRIES}), retrying in ${Math.round(delay)}ms...`,
      );
      await sleep(delay);
    }
  }

  throw lastError;
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
