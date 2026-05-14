import { createHmac } from "node:crypto";
import type { ValidLoggers } from "api/types.js";

const DEFAULT_TIMEOUT_MS = 5000;
const SIGNATURE_HEADER = "X-ACM-Signature";
const EVENT_ID_HEADER = "X-ACM-Event-Id";
const ERROR_BODY_LOG_LIMIT = 256;

/**
 * The hex HMAC-SHA256 a subscriber recomputes to authenticate a callback.
 *
 * The timestamp is signed alongside the body so that a subscriber can reject
 * replays of a message it has seen before.
 */
export const signCallbackBody = ({
  body,
  signingSecret,
  timestamp,
}: {
  body: string;
  signingSecret: string;
  timestamp: number;
}): string =>
  createHmac("sha256", signingSecret)
    .update(`${timestamp}.${body}`)
    .digest("hex");

export type DeliverSubscriberCallbackParams = {
  callbackUrl: string;
  signingSecret: string;
  body: object;
  eventId: string;
  logger: ValidLoggers;
  timeoutMs?: number;
};

/**
 * POSTs `body` to a subscriber's callbackUrl as signed JSON, returning once
 * the subscriber has acknowledged it with a 2xx.
 *
 * Signing, timing out and interpreting the response all happen here, so a
 * caller's whole job is to supply the event
 */
export const deliverSubscriberCallback = async ({
  callbackUrl,
  signingSecret,
  body,
  eventId,
  logger,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: DeliverSubscriberCallbackParams): Promise<void> => {
  const serialized = JSON.stringify(body);
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = signCallbackBody({
    body: serialized,
    signingSecret,
    timestamp,
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  let errorBody = "";
  try {
    response = await fetch(callbackUrl, {
      method: "POST",
      body: serialized,
      headers: {
        "Content-Type": "application/json",
        [SIGNATURE_HEADER]: `t=${timestamp},v1=${signature}`,
        [EVENT_ID_HEADER]: eventId,
      },
      signal: controller.signal,
    });
    // fetch resolves once the headers arrive
    if (!response.ok) {
      errorBody = await response
        .text()
        .then((t) => t.slice(0, ERROR_BODY_LOG_LIMIT))
        .catch(() => "");
    }
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    logger.warn(
      { status: response.status, callbackUrl, eventId, body: errorBody },
      "Subscriber callback returned non-2xx; will retry.",
    );
    throw new Error(
      `Subscriber callback returned ${response.status} from ${callbackUrl}`,
    );
  }
  logger.info(
    { status: response.status, callbackUrl, eventId },
    "Subscriber callback delivered.",
  );
};
