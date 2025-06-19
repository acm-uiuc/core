import { expect, test, vi } from "vitest";
import { pingHandler } from "../../../../src/api/sqs/handlers/ping.js";

test("SQS Ping Handler test", () => {
  const pinoMock = {
    info: vi.fn(),
  }
  pingHandler({}, { reqId: "0", initiator: "1" }, pinoMock as any)
  expect(pinoMock.info).toHaveBeenCalledExactlyOnceWith("Pong!");
})
