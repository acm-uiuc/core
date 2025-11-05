import { beforeEach, expect, test, vi } from "vitest";
import {
  DynamoDBClient,
  QueryCommand,
} from "@aws-sdk/client-dynamodb";
import { getUserMerchPurchases, getUserTicketingPurchases } from "../../../src/api/functions/tickets.js";
import { genericConfig } from "../../../src/common/config.js";
import { mockClient } from "aws-sdk-client-mock";
import { describe } from "node:test";
import { DatabaseFetchError } from "../../../src/common/errors/index.js";
import { marshall } from "@aws-sdk/util-dynamodb";

const ddbMock = mockClient(DynamoDBClient);

const mockLogger = {
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
};

beforeEach(() => {
  ddbMock.reset();
  vi.clearAllMocks();
});

describe("getUserTicketingPurchases tests", () => {
  const testEmail = "test@example.com";

  test("should return empty array when no tickets found", async () => {
    ddbMock.on(QueryCommand).resolves({
      Items: [],
    });

    const result = await getUserTicketingPurchases({
      dynamoClient: new DynamoDBClient({}),
      email: testEmail,
      logger: mockLogger,
    });

    expect(result).toEqual([]);
  });

  test("should successfully fetch and transform ticket purchases", async () => {
    const mockTickets = [
      {
        ticket_id: "ticket-123",
        event_id: "event-456",
        payment_method: "stripe",
        purchase_time: "2024-01-01T00:00:00Z",
        ticketholder_netid: testEmail,
        used: false,
      },
      {
        ticket_id: "ticket-789",
        event_id: "event-101",
        payment_method: "stripe",
        purchase_time: "2024-01-02T00:00:00Z",
        ticketholder_netid: testEmail,
        used: true,
      },
    ];

    ddbMock.on(QueryCommand).resolves({
      Items: mockTickets.map((ticket) => marshall(ticket)),
    });

    const result = await getUserTicketingPurchases({
      dynamoClient: new DynamoDBClient({}),
      email: testEmail,
      logger: mockLogger,
    });

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      valid: true,
      type: "ticket",
      ticketId: "ticket-123",
      purchaserData: {
        email: testEmail,
        productId: "event-456",
        quantity: 1,
      },
      refunded: false,
      fulfilled: false,
    });
    expect(result[1]).toEqual({
      valid: true,
      type: "ticket",
      ticketId: "ticket-789",
      purchaserData: {
        email: testEmail,
        productId: "event-101",
        quantity: 1,
      },
      refunded: false,
      fulfilled: true,
    });
  });

  test("should query with correct parameters", async () => {
    ddbMock.on(QueryCommand).resolves({
      Items: [],
    });

    await getUserTicketingPurchases({
      dynamoClient: new DynamoDBClient({}),
      email: testEmail,
      logger: mockLogger,
    });

    const calls = ddbMock.commandCalls(QueryCommand);
    expect(calls).toHaveLength(1);
    expect(calls[0].args[0].input).toEqual({
      TableName: genericConfig.TicketPurchasesTableName,
      IndexName: "UserIndex",
      KeyConditionExpression: "ticketholder_netid = :email",
      ExpressionAttributeValues: {
        ":email": { S: testEmail },
      },
    });
  });

  test("should throw DatabaseFetchError when Items is undefined", async () => {
    ddbMock.on(QueryCommand).resolves({
      Items: undefined,
    });

    await expect(
      getUserTicketingPurchases({
        dynamoClient: new DynamoDBClient({}),
        email: testEmail,
        logger: mockLogger,
      })
    ).rejects.toThrow(DatabaseFetchError);

    expect(mockLogger.error).toHaveBeenCalled();
  });

  test("should throw DatabaseFetchError when query fails", async () => {
    const error = new Error("DynamoDB error");
    ddbMock.on(QueryCommand).rejects(error);

    await expect(
      getUserTicketingPurchases({
        dynamoClient: new DynamoDBClient({}),
        email: testEmail,
        logger: mockLogger,
      })
    ).rejects.toThrow(DatabaseFetchError);

    expect(mockLogger.error).toHaveBeenCalledWith(error);
  });

  test("should rethrow BaseError without wrapping", async () => {
    const baseError = new DatabaseFetchError({ message: "Custom error" });
    ddbMock.on(QueryCommand).rejects(baseError);

    await expect(
      getUserTicketingPurchases({
        dynamoClient: new DynamoDBClient({}),
        email: testEmail,
        logger: mockLogger,
      })
    ).rejects.toThrow(baseError);

    expect(mockLogger.error).not.toHaveBeenCalled();
  });
});

describe("getUserMerchPurchases tests", () => {
  const testEmail = "test@example.com";

  test("should return empty array when no merch purchases found", async () => {
    ddbMock.on(QueryCommand).resolves({
      Items: [],
    });

    const result = await getUserMerchPurchases({
      dynamoClient: new DynamoDBClient({}),
      email: testEmail,
      logger: mockLogger,
    });

    expect(result).toEqual([]);
  });

  test("should successfully fetch and transform merch purchases", async () => {
    const mockMerch = [
      {
        stripe_pi: "pi_123",
        email: testEmail,
        fulfilled: true,
        item_id: "merch-001",
        quantity: 2,
        refunded: false,
        size: "L",
      },
      {
        stripe_pi: "pi_456",
        email: testEmail,
        fulfilled: false,
        item_id: "merch-002",
        quantity: 1,
        refunded: true,
        scanIsoTimestamp: "2024-01-01T00:00:00Z",
        scannerEmail: "scanner@example.com",
        size: "M",
      },
    ];

    ddbMock.on(QueryCommand).resolves({
      Items: mockMerch.map((merch) => marshall(merch)),
    });

    const result = await getUserMerchPurchases({
      dynamoClient: new DynamoDBClient({}),
      email: testEmail,
      logger: mockLogger,
    });

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      valid: true,
      type: "merch",
      ticketId: "pi_123",
      purchaserData: {
        email: testEmail,
        productId: "merch-001",
        quantity: 1,
      },
      refunded: false,
      fulfilled: true,
    });
    expect(result[1]).toEqual({
      valid: true,
      type: "merch",
      ticketId: "pi_456",
      purchaserData: {
        email: testEmail,
        productId: "merch-002",
        quantity: 1,
      },
      refunded: true,
      fulfilled: false,
    });
  });

  test("should query with correct parameters", async () => {
    ddbMock.on(QueryCommand).resolves({
      Items: [],
    });

    await getUserMerchPurchases({
      dynamoClient: new DynamoDBClient({}),
      email: testEmail,
      logger: mockLogger,
    });

    const calls = ddbMock.commandCalls(QueryCommand);
    expect(calls).toHaveLength(1);
    expect(calls[0].args[0].input).toEqual({
      TableName: genericConfig.MerchStorePurchasesTableName,
      IndexName: "UserIndex",
      KeyConditionExpression: "email = :email",
      ExpressionAttributeValues: {
        ":email": { S: testEmail },
      },
    });
  });

  test("should throw DatabaseFetchError when Items is undefined", async () => {
    ddbMock.on(QueryCommand).resolves({
      Items: undefined,
    });

    await expect(
      getUserMerchPurchases({
        dynamoClient: new DynamoDBClient({}),
        email: testEmail,
        logger: mockLogger,
      })
    ).rejects.toThrow(DatabaseFetchError);

    expect(mockLogger.error).toHaveBeenCalled();
  });

  test("should throw DatabaseFetchError when query fails", async () => {
    const error = new Error("DynamoDB error");
    ddbMock.on(QueryCommand).rejects(error);

    await expect(
      getUserMerchPurchases({
        dynamoClient: new DynamoDBClient({}),
        email: testEmail,
        logger: mockLogger,
      })
    ).rejects.toThrow(DatabaseFetchError);

    expect(mockLogger.error).toHaveBeenCalledWith(error);
  });

  test("should rethrow BaseError without wrapping", async () => {
    const baseError = new DatabaseFetchError({ message: "Custom error" });
    ddbMock.on(QueryCommand).rejects(baseError);

    await expect(
      getUserMerchPurchases({
        dynamoClient: new DynamoDBClient({}),
        email: testEmail,
        logger: mockLogger,
      })
    ).rejects.toThrow(baseError);

    expect(mockLogger.error).not.toHaveBeenCalled();
  });

  test("should handle optional fields in merch entries", async () => {
    const mockMerch = [
      {
        stripe_pi: "pi_789",
        email: testEmail,
        fulfilled: false,
        item_id: "merch-003",
        quantity: 1,
        refunded: false,
        size: "S",
        // scanIsoTimestamp and scannerEmail are optional and not included
      },
    ];

    ddbMock.on(QueryCommand).resolves({
      Items: mockMerch.map((merch) => marshall(merch)),
    });

    const result = await getUserMerchPurchases({
      dynamoClient: new DynamoDBClient({}),
      email: testEmail,
      logger: mockLogger,
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      valid: true,
      type: "merch",
      ticketId: "pi_789",
      purchaserData: {
        email: testEmail,
        productId: "merch-003",
        quantity: 1,
      },
      refunded: false,
      fulfilled: false,
    });
  });
});
