import { InternalServerError } from "common/errors/index.js";
import { ValidLoggers } from "./types.js";
import { SSMClient, GetParameterCommand } from "@aws-sdk/client-ssm";
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

export const isProd = process.env.RunEnvironment === "prod";
