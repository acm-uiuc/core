import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const CURRENT = "abc123";
const NEWER = "xyz789";

// Drain the async microtask queue (fetch -> json -> callback chain needs a few ticks)
const flushPromises = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

function makeResponse(
  version: string | null,
  opts: { ok?: boolean; contentType?: string } = {},
) {
  const { ok = true, contentType = "application/json" } = opts;
  return Promise.resolve({
    ok,
    headers: { get: () => contentType },
    json: () => Promise.resolve(version !== null ? { version } : {}),
  } as unknown as Response);
}

describe("versionCheck", () => {
  let startVersionPolling: (onUpdate?: () => void) => void;
  let forceRefresh: () => void;
  let reloadSpy: ReturnType<typeof vi.fn>;
  const registeredListeners: Array<
    [string, EventListenerOrEventListenerObject]
  > = [];

  beforeEach(async () => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.stubEnv("VITE_BUILD_HASH", CURRENT);
    vi.spyOn(console, "warn").mockImplementation(() => {});

    // Track visibilitychange listeners so we can remove them between tests
    const origAdd = document.addEventListener.bind(document);
    vi.spyOn(document, "addEventListener").mockImplementation(
      (event, handler, ...args) => {
        if (event === "visibilitychange") {
          registeredListeners.push([event, handler]);
        }
        return origAdd(event, handler, ...(args as []));
      },
    );

    reloadSpy = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { reload: reloadSpy },
    });
    Object.defineProperty(window, "caches", {
      configurable: true,
      value: { keys: vi.fn().mockResolvedValue([]), delete: vi.fn() },
    });

    const mod = await import("./versionCheck");
    startVersionPolling = mod.startVersionPolling;
    forceRefresh = mod.forceRefresh;
  });

  afterEach(() => {
    // Remove any listeners registered during the test to prevent cross-test bleed
    registeredListeners.forEach(([event, handler]) =>
      document.removeEventListener(event, handler),
    );
    registeredListeners.length = 0;
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  describe("startVersionPolling", () => {
    it("runs an immediate check on startup", async () => {
      global.fetch = vi.fn().mockReturnValue(makeResponse(CURRENT));
      startVersionPolling();
      await flushPromises();
      expect(global.fetch).toHaveBeenCalledOnce();
    });

    it("rechecks every 5 minutes after the initial check", async () => {
      global.fetch = vi.fn().mockReturnValue(makeResponse(CURRENT));
      startVersionPolling();
      await flushPromises();
      expect(global.fetch).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
      expect(global.fetch).toHaveBeenCalledTimes(2);

      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
      expect(global.fetch).toHaveBeenCalledTimes(3);
    });

    it("registers a visibilitychange listener", () => {
      global.fetch = vi.fn().mockReturnValue(new Promise(() => {}));
      const addSpy = vi.spyOn(document, "addEventListener");
      startVersionPolling();
      expect(addSpy).toHaveBeenCalledWith(
        "visibilitychange",
        expect.any(Function),
      );
    });
  });

  describe("checkForUpdate", () => {
    it("does nothing when version matches current", async () => {
      const onUpdate = vi.fn();
      global.fetch = vi.fn().mockReturnValue(makeResponse(CURRENT));
      startVersionPolling(onUpdate);
      await flushPromises();
      expect(onUpdate).not.toHaveBeenCalled();
      expect(reloadSpy).not.toHaveBeenCalled();
    });

    it("calls onUpdate when a newer version is detected", async () => {
      const onUpdate = vi.fn();
      global.fetch = vi.fn().mockReturnValue(makeResponse(NEWER));
      startVersionPolling(onUpdate);
      await flushPromises();
      expect(onUpdate).toHaveBeenCalledOnce();
      expect(reloadSpy).not.toHaveBeenCalled();
    });

    it("calls forceRefresh when version differs and no callback is set", async () => {
      global.fetch = vi.fn().mockReturnValue(makeResponse(NEWER));
      startVersionPolling();
      await flushPromises();
      expect(reloadSpy).toHaveBeenCalledOnce();
    });

    it("does nothing when CURRENT_VERSION is undefined (unbuilt dev asset)", async () => {
      vi.unstubAllEnvs();
      vi.resetModules();
      const mod = await import("./versionCheck");
      const onUpdate = vi.fn();
      global.fetch = vi.fn().mockReturnValue(makeResponse(NEWER));
      mod.startVersionPolling(onUpdate);
      await flushPromises();
      expect(onUpdate).not.toHaveBeenCalled();
      expect(reloadSpy).not.toHaveBeenCalled();
    });

    it("stops polling after an update is detected", async () => {
      const onUpdate = vi.fn();
      global.fetch = vi.fn().mockReturnValue(makeResponse(NEWER));
      startVersionPolling(onUpdate);
      await flushPromises();
      expect(onUpdate).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
      expect(onUpdate).toHaveBeenCalledTimes(1);
    });

    it("stops polling when response is not JSON", async () => {
      global.fetch = vi
        .fn()
        .mockReturnValue(makeResponse(null, { contentType: "text/html" }));
      startVersionPolling();
      await flushPromises();
      expect(global.fetch).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it("does nothing when response is not ok", async () => {
      const onUpdate = vi.fn();
      global.fetch = vi
        .fn()
        .mockReturnValue(makeResponse(NEWER, { ok: false }));
      startVersionPolling(onUpdate);
      await flushPromises();
      expect(onUpdate).not.toHaveBeenCalled();
      expect(reloadSpy).not.toHaveBeenCalled();
    });

    it("keeps polling after fewer than 10 fetch failures", async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error("network error"));
      startVersionPolling();

      for (let i = 0; i < 5; i++) {
        await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
      }

      // 1 immediate + 5 interval = 6 total calls, polling still active
      expect(global.fetch).toHaveBeenCalledTimes(6);
    });

    it("stops polling after 10 consecutive failures", async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error("network error"));
      startVersionPolling();

      // 1 immediate + 10 interval ticks exhausts the counter
      for (let i = 0; i < 11; i++) {
        await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
      }

      const callCount = (global.fetch as ReturnType<typeof vi.fn>).mock.calls
        .length;
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
      expect((global.fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBe(
        callCount,
      );
    });
  });

  describe("visibilitychange listener", () => {
    it("triggers a check when the tab becomes visible", async () => {
      global.fetch = vi.fn().mockReturnValue(makeResponse(CURRENT));
      startVersionPolling();
      await flushPromises();
      expect(global.fetch).toHaveBeenCalledTimes(1);

      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        value: "visible",
      });
      document.dispatchEvent(new Event("visibilitychange"));
      await flushPromises();

      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it("does not trigger a check when the tab becomes hidden", async () => {
      global.fetch = vi.fn().mockReturnValue(makeResponse(CURRENT));
      startVersionPolling();
      await flushPromises();
      expect(global.fetch).toHaveBeenCalledTimes(1);

      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        value: "hidden",
      });
      document.dispatchEvent(new Event("visibilitychange"));
      await flushPromises();

      expect(global.fetch).toHaveBeenCalledTimes(1);
    });
  });

  describe("forceRefresh", () => {
    it("reloads the page", () => {
      forceRefresh();
      expect(reloadSpy).toHaveBeenCalledOnce();
    });

    it("deletes all caches before reloading", async () => {
      const deleteSpy = vi.fn();
      Object.defineProperty(window, "caches", {
        configurable: true,
        value: {
          keys: vi.fn().mockResolvedValue(["v1", "v2"]),
          delete: deleteSpy,
        },
      });

      forceRefresh();
      await flushPromises();

      expect(deleteSpy).toHaveBeenCalledWith("v1");
      expect(deleteSpy).toHaveBeenCalledWith("v2");
      expect(reloadSpy).toHaveBeenCalledOnce();
    });
  });
});
