import { createHmac } from "crypto";
import { lookup } from "dns/promises";
import { isIP } from "net";
import type { ValidLoggers } from "api/types.js";

const PRIVATE_IPV4_RANGES: { cidr: string; mask: number }[] = [
  { cidr: "10.0.0.0", mask: 8 },
  { cidr: "172.16.0.0", mask: 12 },
  { cidr: "192.168.0.0", mask: 16 },
  { cidr: "127.0.0.0", mask: 8 },
  { cidr: "169.254.0.0", mask: 16 },
  { cidr: "0.0.0.0", mask: 8 },
  { cidr: "100.64.0.0", mask: 10 },
];

const ipv4ToInt = (ip: string): number =>
  ip.split(".").reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0;

const isPrivateIPv4 = (ip: string): boolean => {
  const ipInt = ipv4ToInt(ip);
  return PRIVATE_IPV4_RANGES.some(({ cidr, mask }) => {
    const cidrInt = ipv4ToInt(cidr);
    const maskBits = mask === 0 ? 0 : (~0 << (32 - mask)) >>> 0;
    return (ipInt & maskBits) === (cidrInt & maskBits);
  });
};

const isPrivateIPv6 = (ip: string): boolean => {
  const normalized = ip.toLowerCase();
  if (normalized === "::1") {
    return true;
  }
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) {
    return true; // fc00::/7
  }
  if (
    normalized.startsWith("fe8") ||
    normalized.startsWith("fe9") ||
    normalized.startsWith("fea") ||
    normalized.startsWith("feb")
  ) {
    return true; // fe80::/10
  }
  return false;
};

export class SubscriberCallbackBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SubscriberCallbackBlockedError";
  }
}

export const assertCallbackUrlIsExternal = async (
  url: string,
): Promise<void> => {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:") {
    throw new SubscriberCallbackBlockedError("callbackUrl must use https://");
  }
  const host = parsed.hostname.replace(/^\[(.*)\]$/, "$1").toLowerCase();
  if (host === "localhost") {
    throw new SubscriberCallbackBlockedError(
      "callbackUrl host is not reachable.",
    );
  }
  const ipVersion = isIP(host);
  if (ipVersion === 4 && isPrivateIPv4(host)) {
    throw new SubscriberCallbackBlockedError(
      "callbackUrl resolves to a private IPv4 range.",
    );
  }
  if (ipVersion === 6 && isPrivateIPv6(host)) {
    throw new SubscriberCallbackBlockedError(
      "callbackUrl resolves to a private IPv6 range.",
    );
  }
  if (ipVersion !== 0) {
    return;
  }
  const resolved = await lookup(host, { all: true });
  if (resolved.length === 0) {
    throw new SubscriberCallbackBlockedError(
      `callbackUrl host ${host} did not resolve.`,
    );
  }
  for (const entry of resolved) {
    if (entry.family === 4 && isPrivateIPv4(entry.address)) {
      throw new SubscriberCallbackBlockedError(
        `callbackUrl host ${host} resolves to private IPv4 ${entry.address}.`,
      );
    }
    if (entry.family === 6 && isPrivateIPv6(entry.address)) {
      throw new SubscriberCallbackBlockedError(
        `callbackUrl host ${host} resolves to private IPv6 ${entry.address}.`,
      );
    }
  }
};

export const signCallbackBody = ({
  body,
  signingSecret,
  timestamp,
}: {
  body: string;
  signingSecret: string;
  timestamp: number;
}): string => {
  const hmac = createHmac("sha256", signingSecret);
  hmac.update(`${timestamp}.${body}`);
  return hmac.digest("hex");
};

export type DeliverSubscriberCallbackParams = {
  callbackUrl: string;
  signingSecret: string;
  body: object;
  eventId: string;
  logger: ValidLoggers;
  timeoutMs?: number;
};

export const deliverSubscriberCallback = async ({
  callbackUrl,
  signingSecret,
  body,
  eventId,
  logger,
  timeoutMs = 5000,
}: DeliverSubscriberCallbackParams): Promise<void> => {
  await assertCallbackUrlIsExternal(callbackUrl);
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
  try {
    response = await fetch(callbackUrl, {
      method: "POST",
      body: serialized,
      headers: {
        "Content-Type": "application/json",
        "X-ACM-Signature": `t=${timestamp},v1=${signature}`,
        "X-ACM-Event-Id": eventId,
      },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const truncated = await response
      .text()
      .then((t) => t.slice(0, 256))
      .catch(() => "");
    logger.warn(
      { status: response.status, callbackUrl, eventId, body: truncated },
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
