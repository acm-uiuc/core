import { expect, test, describe, vi } from "vitest";
import { createAuditLogEntry, buildAuditLogTransactPut } from "../../../src/api/functions/auditLog";
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

describe("Audit Log Transaction tests", () => {
  test("Audit log transaction item is correctly created with all fields", () => {
    // Setup mock date
    const mockDate = new Date(2025, 3, 20, 12, 0, 0);
    const mockTimestamp = mockDate.getTime();
    vi.spyOn(Date, 'now').mockReturnValue(mockTimestamp);

    const timestamp = Math.floor(mockTimestamp / 1000);
    const expiresAt = timestamp + Math.floor((365 * 24 * 60 * 60 * 1000) / 1000);

    // Create test payload
    const payload = {
      module: Modules.IAM,
      actor: 'admin@acm.illinois.edu',
      target: 'nonadmin@acm.illinois.edu',
      requestId: 'abcdef',
      message: "Created user"
    };

    // Expected marshalled item
    const expectedItem = marshall({
      ...payload,
      createdAt: timestamp,
      expiresAt: expiresAt
    });

    // Call the function being tested
    const transactItem = buildAuditLogTransactPut({ entry: payload });

    // Verify the result
    expect(transactItem).toStrictEqual({
      Put: {
        TableName: genericConfig.AuditLogTable,
        Item: expectedItem
      }
    });
  });

  test("Audit log transaction item with minimal fields is correctly created", () => {
    // Setup mock date
    const mockDate = new Date(2025, 3, 20, 12, 0, 0);
    const mockTimestamp = mockDate.getTime();
    vi.spyOn(Date, 'now').mockReturnValue(mockTimestamp);

    const timestamp = Math.floor(mockTimestamp / 1000);
    const expiresAt = timestamp + Math.floor((365 * 24 * 60 * 60 * 1000) / 1000);

    // Create test payload with only required fields
    const payload = {
      module: Modules.IAM,
      actor: 'admin@acm.illinois.edu',
      message: "Deleted resource"
    };

    // Expected marshalled item
    const expectedItem = marshall({
      ...payload,
      createdAt: timestamp,
      expiresAt: expiresAt
    });

    // Call the function being tested
    const transactItem = buildAuditLogTransactPut({ entry: payload });

    // Verify the result
    expect(transactItem).toStrictEqual({
      Put: {
        TableName: genericConfig.AuditLogTable,
        Item: expectedItem
      }
    });
  });

  test("Audit log transaction item correctly calculates expiration timestamp", () => {
    // Setup mock date
    const mockDate = new Date(2025, 3, 20, 12, 0, 0);
    const mockTimestamp = mockDate.getTime();
    vi.spyOn(Date, 'now').mockReturnValue(mockTimestamp);

    const timestamp = Math.floor(mockTimestamp / 1000);
    // Manually calculate the expected expiration
    const retentionDays = 365;
    const secondsInDay = 24 * 60 * 60;
    const millisecondsInDay = secondsInDay * 1000;
    const expectedExpireAt = timestamp + Math.floor((retentionDays * millisecondsInDay) / 1000);

    // Create test payload
    const payload = {
      module: Modules.IAM,
      actor: 'admin@acm.illinois.edu',
      message: "Modified settings"
    };

    // Call the function being tested
    const transactItem = buildAuditLogTransactPut({ entry: payload });

    // Extract and verify the expiration timestamp
    const marshalledItem = transactItem.Put.Item;
    const unmarshalledItem = require('@aws-sdk/util-dynamodb').unmarshall(marshalledItem);

    expect(unmarshalledItem.expireAt).toBe(expectedExpireAt);
  });
});

beforeEach(() => {
  ddbMock.reset();
});

afterEach(() => {
  vi.useRealTimers();
});
