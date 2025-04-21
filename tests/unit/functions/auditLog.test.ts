import { expect, test, describe, vi } from "vitest";
import { createAuditLogEntry } from "../../../src/api/functions/auditLog";
import { mockClient } from "aws-sdk-client-mock";
import { DynamoDBClient, PutItemCommand } from "@aws-sdk/client-dynamodb";
import { afterEach, beforeEach } from "node:test";
import { genericConfig } from "../../../src/common/config";
import { Modules } from "../../../src/common/modules.js";
import { marshall } from "@aws-sdk/util-dynamodb";


const ddbMock = mockClient(DynamoDBClient);


describe("Audit Log tests", () => {
  test("Audit log entry with request ID is correctly added", async () => {
    const mockDate = new Date(2025, 3, 20, 12, 0, 0);
    const mockTimestamp = mockDate.getTime();
    vi.spyOn(Date, 'now').mockReturnValue(mockTimestamp);
    const timestamp = Math.floor(mockTimestamp / 1000);
    const expireAt = Math.floor(
      (mockTimestamp + 365 * 24 * 60 * 60 * 1000) / 1000
    );

    const payload = {
      module: Modules.IAM,
      actor: 'admin@acm.illinois.edu',
      target: 'nonadmin@acm.illinois.edu',
      requestId: 'abcdef',
      message: "Created user"
    };

    const expectedItem = {
      ...payload,
      createdAt: timestamp,
      expireAt: expireAt
    };

    ddbMock.on(PutItemCommand, {
      TableName: genericConfig.AuditLogTable,
      Item: marshall(expectedItem)
    }).resolvesOnce({ ConsumedCapacity: { WriteCapacityUnits: 1 } }).rejects({ message: "Called more than once." });

    const result = await createAuditLogEntry({ entry: payload });
    expect(result).toStrictEqual({ ConsumedCapacity: { WriteCapacityUnits: 1 } });
  });
});

beforeEach(() => {
  ddbMock.reset();
});

afterEach(() => {
  vi.useRealTimers();
});
