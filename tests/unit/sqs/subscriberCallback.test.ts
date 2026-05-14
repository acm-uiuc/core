import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const { lookupMock } = vi.hoisted(() => ({
  lookupMock: vi.fn(),
}));

vi.mock("dns/promises", () => ({
  lookup: lookupMock,
}));

import {
  assertCallbackUrlIsExternal,
  deliverSubscriberCallback,
  signCallbackBody,
  SubscriberCallbackBlockedError,
} from "../../../src/api/functions/subscriberCallback.js";

describe("subscriber callback delivery helpers", () => {
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  test("signCallbackBody signs timestamp dot raw body with HMAC-SHA256", () => {
    const body = JSON.stringify({
      type: "payment.succeeded",
      eventId: "evt_123",
    });

    expect(
      signCallbackBody({
        body,
        signingSecret: "secret_123",
        timestamp: 1700000000,
      }),
    ).toBe("2dde5702042948c1481db06d6f508e3671bb1b9519aa99baa8d174911323725e");
  });

  test("assertCallbackUrlIsExternal rejects non-HTTPS URLs", async () => {
    await expect(
      assertCallbackUrlIsExternal("http://example.com/callback"),
    ).rejects.toThrow(SubscriberCallbackBlockedError);
    expect(lookupMock).not.toHaveBeenCalled();
  });

  test("assertCallbackUrlIsExternal rejects private IP literals", async () => {
    await expect(
      assertCallbackUrlIsExternal("https://10.0.0.1/callback"),
    ).rejects.toThrow("private IPv4");
    await expect(
      assertCallbackUrlIsExternal("https://[fc00::1]/callback"),
    ).rejects.toThrow("private IPv6");
    expect(lookupMock).not.toHaveBeenCalled();
  });

  test("assertCallbackUrlIsExternal rejects hostnames that resolve privately", async () => {
    lookupMock.mockResolvedValueOnce([{ address: "192.168.1.5", family: 4 }]);

    await expect(
      assertCallbackUrlIsExternal("https://callbacks.example.com/stripe"),
    ).rejects.toThrow("private IPv4");
  });

  test("assertCallbackUrlIsExternal accepts hostnames that resolve publicly", async () => {
    lookupMock.mockResolvedValueOnce([
      { address: "93.184.216.34", family: 4 },
      { address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 },
    ]);

    await expect(
      assertCallbackUrlIsExternal("https://callbacks.example.com/stripe"),
    ).resolves.toBeUndefined();
  });

  test("deliverSubscriberCallback posts signed JSON and logs success", async () => {
    lookupMock.mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }]);
    vi.setSystemTime(new Date("2023-11-14T22:13:20.000Z"));
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await deliverSubscriberCallback({
      callbackUrl: "https://callbacks.example.com/stripe",
      signingSecret: "secret_123",
      body: { type: "payment.succeeded", eventId: "evt_123" },
      eventId: "evt_123",
      logger: logger as any,
    });

    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
      "https://callbacks.example.com/stripe",
      expect.objectContaining({
        method: "POST",
        body: '{"type":"payment.succeeded","eventId":"evt_123"}',
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          "X-ACM-Event-Id": "evt_123",
          "X-ACM-Signature":
            "t=1700000000,v1=2dde5702042948c1481db06d6f508e3671bb1b9519aa99baa8d174911323725e",
        }),
      }),
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ status: 204, eventId: "evt_123" }),
      "Subscriber callback delivered.",
    );
  });

  test("deliverSubscriberCallback throws on non-2xx so SQS can retry", async () => {
    lookupMock.mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("subscriber failed", { status: 500 })),
    );

    await expect(
      deliverSubscriberCallback({
        callbackUrl: "https://callbacks.example.com/stripe",
        signingSecret: "secret_123",
        body: { type: "payment.failed", eventId: "evt_456" },
        eventId: "evt_456",
        logger: logger as any,
      }),
    ).rejects.toThrow("Subscriber callback returned 500");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ status: 500, eventId: "evt_456" }),
      "Subscriber callback returned non-2xx; will retry.",
    );
  });
});
