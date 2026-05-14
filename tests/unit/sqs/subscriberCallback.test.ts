import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import {
  deliverSubscriberCallback,
  signCallbackBody,
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

  test("deliverSubscriberCallback posts signed JSON and logs success", async () => {
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

  test("deliverSubscriberCallback still reports a non-2xx when the body read fails", async () => {
    // What an aborted body read looks like: headers arrived, the stream did not.
    const stalled = new Response("ignored", { status: 502 });
    vi.spyOn(stalled, "text").mockRejectedValue(
      new DOMException("The operation was aborted.", "AbortError"),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => stalled),
    );

    await expect(
      deliverSubscriberCallback({
        callbackUrl: "https://callbacks.example.com/stripe",
        signingSecret: "secret_123",
        body: { type: "payment.succeeded", eventId: "evt_789" },
        eventId: "evt_789",
        logger: logger as any,
      }),
    ).rejects.toThrow("Subscriber callback returned 502");

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ status: 502, eventId: "evt_789", body: "" }),
      "Subscriber callback returned non-2xx; will retry.",
    );
  });

  test("deliverSubscriberCallback throws on non-2xx so SQS can retry", async () => {
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
