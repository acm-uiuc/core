import { FastifyBaseLogger } from "fastify";
import pino from "pino";
import { ValidLoggers } from "./types.js";

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

export const isProd = process.env.RunEnvironment === "prod";
