// Cloudflare Turnstile support

import { ValidLoggers } from "api/types.js";
import {
  BaseError,
  InternalServerError,
  ValidationError,
} from "common/errors/index.js";

export interface VerifyTurnstileTokenInputs {
  turnstileSecret: string;
  clientToken?: string | string[] | undefined;
  logger: ValidLoggers;
  requestId: string;
  remoteIp?: string;
  expectedAction?: string;
  expectedHostname?: string;
  timeoutMs?: number;
}

export interface CloudflareTurnstileResponse {
  success: boolean;
  challenge_ts: string;
  hostname: string;
  "error-codes": string[];
  action: string;
  cdata: string;
}

export const ACCEPT_ALL_TURNSTILE_SECRET =
  "1x0000000000000000000000000000000AA";

export async function verifyTurnstileToken({
  turnstileSecret,
  clientToken,
  logger,
  remoteIp,
  timeoutMs,
  requestId,
  expectedAction,
  expectedHostname,
}: VerifyTurnstileTokenInputs) {
  const timeout = timeoutMs || 10000;
  const defaultError = {
    message: "Invalid Turnstile token.",
  };

  const defaultInternalError = {
    message: "An error occurred validating the Turnstile token.",
  };

  if (!clientToken || typeof clientToken !== "string") {
    logger.error("Invalid Turnstile token format.");
    throw new ValidationError(defaultError);
  }
  if (clientToken.length > 2048) {
    logger.error("Turnstile token too long.");
    throw new ValidationError(defaultError);
  }

  // For testing
  if (
    turnstileSecret === ACCEPT_ALL_TURNSTILE_SECRET &&
    clientToken === "invalid"
  ) {
    throw new ValidationError(defaultError);
  }
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  try {
    const formData = new FormData();
    formData.append("secret", turnstileSecret);
    formData.append("response", clientToken);

    if (remoteIp) {
      formData.append("remoteip", remoteIp);
    }

    if (requestId) {
      formData.append("idempotency_key", requestId);
    }

    const response = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        body: formData,
        signal: controller.signal,
      },
    );
    if (controller.signal.aborted) {
      logger.error(`Turnstile token verification timeout after ${timeout}`);
      throw new InternalServerError(defaultInternalError);
    }
    const result = (await response.json()) as CloudflareTurnstileResponse;
    if (!result.success) {
      logger.error("Turnstile validation failed", result["error-codes"]);
      throw new ValidationError(defaultError);
    }
    if (result.success) {
      if (expectedAction && result.action !== expectedAction) {
        logger.error(
          `Action mismatch: expected ${expectedAction} but got ${result.action}`,
        );
        throw new ValidationError(defaultError);
      }

      if (expectedHostname && result.hostname !== expectedHostname) {
        logger.error(
          `Hostname mismatch: expected ${expectedHostname} but got ${result.hostname}`,
        );
        throw new ValidationError(defaultError);
      }
    }
    logger.debug("Accepted turnstile token.");
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      logger.error(`Turnstile token verification timeout after ${timeout}`);
      throw new InternalServerError(defaultInternalError);
    }
    if (e instanceof BaseError) {
      throw e;
    }
    logger.error("Turnstile validation error:", e);
    throw new InternalServerError({
      message: "An error occurred validating the Turnstile token.",
    });
  } finally {
    clearTimeout(timeoutId);
  }
}
