import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  verifyTurnstileToken,
  ACCEPT_ALL_TURNSTILE_SECRET,
  type VerifyTurnstileTokenInputs,
  type CloudflareTurnstileResponse,
} from "../../../src/api/functions/turnstile.js";

// Mock logger
const createMockLogger = () => ({
  error: vi.fn(),
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
});

// Helper to create a successful Turnstile response
const createSuccessResponse = (
  overrides: Partial<CloudflareTurnstileResponse> = {}
): CloudflareTurnstileResponse => ({
  success: true,
  challenge_ts: new Date().toISOString(),
  hostname: "example.com",
  "error-codes": [],
  action: "login",
  cdata: "",
  ...overrides,
});

// Helper to create a failed Turnstile response
const createFailureResponse = (
  errorCodes: string[] = ["invalid-input-response"]
): CloudflareTurnstileResponse => ({
  success: false,
  challenge_ts: "",
  hostname: "",
  "error-codes": errorCodes,
  action: "",
  cdata: "",
});

describe("verifyTurnstileToken", () => {
  let mockLogger: ReturnType<typeof createMockLogger>;
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    mockLogger = createMockLogger();
    originalFetch = global.fetch;
    vi.useFakeTimers();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const createDefaultInputs = (
    overrides: Partial<VerifyTurnstileTokenInputs> = {}
  ): VerifyTurnstileTokenInputs => ({
    turnstileSecret: "test-secret",
    clientToken: "valid-token",
    logger: mockLogger as any,
    requestId: "test-request-id",
    ...overrides,
  });

  describe("input validation", () => {
    it("should throw ValidationError when clientToken is undefined", async () => {
      const inputs = createDefaultInputs({ clientToken: undefined });

      await expect(verifyTurnstileToken(inputs)).rejects.toThrow(
        "Invalid Turnstile token."
      );
      expect(mockLogger.error).toHaveBeenCalledWith(
        "Invalid Turnstile token format."
      );
    });

    it("should throw ValidationError when clientToken is an empty string", async () => {
      const inputs = createDefaultInputs({ clientToken: "" });

      await expect(verifyTurnstileToken(inputs)).rejects.toThrow(
        "Invalid Turnstile token."
      );
    });

    it("should throw ValidationError when clientToken is an array", async () => {
      const inputs = createDefaultInputs({
        clientToken: ["token1", "token2"] as any,
      });

      await expect(verifyTurnstileToken(inputs)).rejects.toThrow(
        "Invalid Turnstile token."
      );
      expect(mockLogger.error).toHaveBeenCalledWith(
        "Invalid Turnstile token format."
      );
    });

    it("should throw ValidationError when clientToken exceeds 2048 characters", async () => {
      const inputs = createDefaultInputs({ clientToken: "a".repeat(2049) });

      await expect(verifyTurnstileToken(inputs)).rejects.toThrow(
        "Invalid Turnstile token."
      );
      expect(mockLogger.error).toHaveBeenCalledWith("Turnstile token too long.");
    });

    it("should accept clientToken exactly 2048 characters", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        json: () => Promise.resolve(createSuccessResponse()),
      });

      const inputs = createDefaultInputs({ clientToken: "a".repeat(2048) });

      await expect(verifyTurnstileToken(inputs)).resolves.toBeUndefined();
    });
  });

  describe("test mode with ACCEPT_ALL_TURNSTILE_SECRET", () => {
    it("should throw ValidationError when using accept-all secret with 'invalid' token", async () => {
      const inputs = createDefaultInputs({
        turnstileSecret: ACCEPT_ALL_TURNSTILE_SECRET,
        clientToken: "invalid",
      });

      await expect(verifyTurnstileToken(inputs)).rejects.toThrow(
        "Invalid Turnstile token."
      );
    });

    it("should proceed to verification when using accept-all secret with valid token", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        json: () => Promise.resolve(createSuccessResponse()),
      });

      const inputs = createDefaultInputs({
        turnstileSecret: ACCEPT_ALL_TURNSTILE_SECRET,
        clientToken: "valid-token",
      });

      await expect(verifyTurnstileToken(inputs)).resolves.toBeUndefined();
      expect(global.fetch).toHaveBeenCalled();
    });
  });

  describe("successful verification", () => {
    it("should resolve successfully with valid token", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        json: () => Promise.resolve(createSuccessResponse()),
      });

      const inputs = createDefaultInputs();

      await expect(verifyTurnstileToken(inputs)).resolves.toBeUndefined();
      expect(mockLogger.debug).toHaveBeenCalledWith("Accepted turnstile token.");
    });

    it("should send correct form data to Cloudflare", async () => {
      let capturedFormData: FormData | undefined;
      global.fetch = vi.fn().mockImplementation((_url: string, options: RequestInit) => {
        capturedFormData = options.body as FormData;
        return Promise.resolve({
          json: () => Promise.resolve(createSuccessResponse()),
        });
      });

      const inputs = createDefaultInputs({
        remoteIp: "192.168.1.1",
      });

      await verifyTurnstileToken(inputs);

      expect(global.fetch).toHaveBeenCalledWith(
        "https://challenges.cloudflare.com/turnstile/v0/siteverify",
        expect.objectContaining({
          method: "POST",
        })
      );
      expect(capturedFormData).toBeDefined();
      expect(capturedFormData!.get("secret")).toBe("test-secret");
      expect(capturedFormData!.get("response")).toBe("valid-token");
      expect(capturedFormData!.get("remoteip")).toBe("192.168.1.1");
      expect(capturedFormData!.get("idempotency_key")).toBe("test-request-id");
    });

    it("should not include remoteip when not provided", async () => {
      let capturedFormData: FormData | undefined;
      global.fetch = vi.fn().mockImplementation((_url: string, options: RequestInit) => {
        capturedFormData = options.body as FormData;
        return Promise.resolve({
          json: () => Promise.resolve(createSuccessResponse()),
        });
      });

      const inputs = createDefaultInputs();

      await verifyTurnstileToken(inputs);

      expect(capturedFormData).toBeDefined();
      expect(capturedFormData!.get("remoteip")).toBeNull();
    });
  });

  describe("failed verification", () => {
    it("should throw ValidationError when Cloudflare returns success: false", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        json: () =>
          Promise.resolve(createFailureResponse(["invalid-input-response"])),
      });

      const inputs = createDefaultInputs();

      await expect(verifyTurnstileToken(inputs)).rejects.toThrow(
        "Invalid Turnstile token."
      );
      expect(mockLogger.error).toHaveBeenCalledWith(
        "Turnstile validation failed",
        ["invalid-input-response"]
      );
    });

    it("should log multiple error codes from Cloudflare", async () => {
      const errorCodes = ["invalid-input-response", "timeout-or-duplicate"];
      global.fetch = vi.fn().mockResolvedValue({
        json: () => Promise.resolve(createFailureResponse(errorCodes)),
      });

      const inputs = createDefaultInputs();

      await expect(verifyTurnstileToken(inputs)).rejects.toThrow(
        "Invalid Turnstile token."
      );
      expect(mockLogger.error).toHaveBeenCalledWith(
        "Turnstile validation failed",
        errorCodes
      );
    });
  });

  describe("action and hostname validation", () => {
    it("should throw ValidationError when action mismatches", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        json: () =>
          Promise.resolve(createSuccessResponse({ action: "signup" })),
      });

      const inputs = createDefaultInputs({ expectedAction: "login" });

      await expect(verifyTurnstileToken(inputs)).rejects.toThrow(
        "Invalid Turnstile token."
      );
      expect(mockLogger.error).toHaveBeenCalledWith(
        "Action mismatch: expected login but got signup"
      );
    });

    it("should throw ValidationError when action is empty but expected", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        json: () =>
          Promise.resolve(createSuccessResponse({ action: "" })),
      });

      const inputs = createDefaultInputs({ expectedAction: "login" });

      await expect(verifyTurnstileToken(inputs)).rejects.toThrow(
        "Invalid Turnstile token."
      );
      expect(mockLogger.error).toHaveBeenCalledWith(
        "Action mismatch: expected login but got "
      );
    });

    it("should succeed when expectedAction is not provided", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        json: () =>
          Promise.resolve(createSuccessResponse({ action: "any-action" })),
      });

      const inputs = createDefaultInputs({ expectedAction: undefined });

      await expect(verifyTurnstileToken(inputs)).resolves.toBeUndefined();
    });

    it("should throw ValidationError when hostname mismatches", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        json: () =>
          Promise.resolve(createSuccessResponse({ hostname: "malicious.com" })),
      });

      const inputs = createDefaultInputs({ expectedHostname: "example.com" });

      await expect(verifyTurnstileToken(inputs)).rejects.toThrow(
        "Invalid Turnstile token."
      );
      expect(mockLogger.error).toHaveBeenCalledWith(
        "Hostname mismatch: expected example.com but got malicious.com"
      );
    });

    it("should throw ValidationError when hostname is empty but expected", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        json: () =>
          Promise.resolve(createSuccessResponse({ hostname: "" })),
      });

      const inputs = createDefaultInputs({ expectedHostname: "example.com" });

      await expect(verifyTurnstileToken(inputs)).rejects.toThrow(
        "Invalid Turnstile token."
      );
      expect(mockLogger.error).toHaveBeenCalledWith(
        "Hostname mismatch: expected example.com but got "
      );
    });

    it("should succeed when expectedHostname is not provided", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        json: () =>
          Promise.resolve(createSuccessResponse({ hostname: "any-hostname.com" })),
      });

      const inputs = createDefaultInputs({ expectedHostname: undefined });

      await expect(verifyTurnstileToken(inputs)).resolves.toBeUndefined();
    });

    it("should succeed when action and hostname match", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        json: () =>
          Promise.resolve(
            createSuccessResponse({ action: "login", hostname: "example.com" })
          ),
      });

      const inputs = createDefaultInputs({
        expectedAction: "login",
        expectedHostname: "example.com",
      });

      await expect(verifyTurnstileToken(inputs)).resolves.toBeUndefined();
    });

    it("should check action before hostname", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        json: () =>
          Promise.resolve(
            createSuccessResponse({ action: "wrong-action", hostname: "wrong-hostname.com" })
          ),
      });

      const inputs = createDefaultInputs({
        expectedAction: "login",
        expectedHostname: "example.com",
      });

      await expect(verifyTurnstileToken(inputs)).rejects.toThrow(
        "Invalid Turnstile token."
      );
      // Should log action mismatch first (assuming action is checked before hostname)
      expect(mockLogger.error).toHaveBeenCalledWith(
        "Action mismatch: expected login but got wrong-action"
      );
    });
  });

  describe("timeout handling", () => {
    it("should use default timeout of 10000ms", async () => {
      const setTimeoutSpy = vi.spyOn(global, "setTimeout");
      global.fetch = vi.fn().mockImplementation(() => {
        return Promise.resolve({
          json: () => Promise.resolve(createSuccessResponse()),
        });
      });

      const inputs = createDefaultInputs();

      await expect(verifyTurnstileToken(inputs)).resolves.toBeUndefined();
      expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 10000);
    });
  });

  describe("error handling", () => {
    it("should rethrow BaseError instances", async () => {
      // This tests that ValidationError and InternalServerError are rethrown
      global.fetch = vi.fn().mockResolvedValue({
        json: () => Promise.resolve(createFailureResponse()),
      });

      const inputs = createDefaultInputs();

      await expect(verifyTurnstileToken(inputs)).rejects.toThrow(
        "Invalid Turnstile token."
      );
    });

    it("should wrap unknown errors in InternalServerError", async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error("Network error"));

      const inputs = createDefaultInputs();

      await expect(verifyTurnstileToken(inputs)).rejects.toThrow(
        "An error occurred validating the Turnstile token."
      );
      expect(mockLogger.error).toHaveBeenCalledWith(
        "Turnstile validation error:",
        expect.any(Error)
      );
    });

    it("should wrap non-Error throws in InternalServerError", async () => {
      global.fetch = vi.fn().mockRejectedValue("string error");

      const inputs = createDefaultInputs();

      await expect(verifyTurnstileToken(inputs)).rejects.toThrow(
        "An error occurred validating the Turnstile token."
      );
    });

    it("should handle JSON parsing errors", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        json: () => Promise.reject(new Error("Invalid JSON")),
      });

      const inputs = createDefaultInputs();

      await expect(verifyTurnstileToken(inputs)).rejects.toThrow(
        "An error occurred validating the Turnstile token."
      );
    });
  });

  describe("cleanup", () => {
    it("should clear timeout on successful verification", async () => {
      const clearTimeoutSpy = vi.spyOn(global, "clearTimeout");

      global.fetch = vi.fn().mockResolvedValue({
        json: () => Promise.resolve(createSuccessResponse()),
      });

      const inputs = createDefaultInputs();

      await verifyTurnstileToken(inputs);

      expect(clearTimeoutSpy).toHaveBeenCalled();
    });

    it("should clear timeout on failed verification", async () => {
      const clearTimeoutSpy = vi.spyOn(global, "clearTimeout");

      global.fetch = vi.fn().mockResolvedValue({
        json: () => Promise.resolve(createFailureResponse()),
      });

      const inputs = createDefaultInputs();

      await expect(verifyTurnstileToken(inputs)).rejects.toThrow();

      expect(clearTimeoutSpy).toHaveBeenCalled();
    });

    it("should clear timeout on network error", async () => {
      const clearTimeoutSpy = vi.spyOn(global, "clearTimeout");

      global.fetch = vi.fn().mockRejectedValue(new Error("Network error"));

      const inputs = createDefaultInputs();

      await expect(verifyTurnstileToken(inputs)).rejects.toThrow();

      expect(clearTimeoutSpy).toHaveBeenCalled();
    });
  });
});
