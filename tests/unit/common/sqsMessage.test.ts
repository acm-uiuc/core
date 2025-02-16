import { expect, test, describe } from "vitest";
import { parseSQSPayload } from "../../../src/common/types/sqsMessage.js";
import { ZodError } from "zod";

describe("SQS Message Parsing Tests", () => {
  test("Ping message parses correctly", () => {
    const payload = {
      metadata: {
        reqId: "12345",
        initiator: "unit-test",
      },
      function: "ping",
      payload: {},
    };
    const response = parseSQSPayload(payload);
    expect(response).toStrictEqual(payload);
  });
  test("Invalid function doesn't parse", () => {
    const payload = {
      metadata: {
        reqId: "12345",
        initiator: "unit-test",
      },
      function: "invalid_function",
      payload: {},
    };
    expect(parseSQSPayload(payload)).toBeInstanceOf(ZodError);
  });
});
