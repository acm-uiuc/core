import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import { DynamoDBClient, QueryCommand } from "@aws-sdk/client-dynamodb";
import type {
  CloudFrontRequestEvent,
  CloudFrontResultResponse,
} from "aws-lambda";
import { handler } from "../../../src/linkryEdgeFunction/index.js";

const dynamoMock = mockClient(DynamoDBClient);

describe("CloudFront Lambda@Edge Handler", () => {
  beforeEach(() => {
    dynamoMock.reset();
    vi.clearAllMocks();
  });

  const createEvent = (
    uri: string,
    host: string = "acm.illinois.edu",
  ): CloudFrontRequestEvent => ({
    Records: [
      {
        cf: {
          config: {
            distributionDomainName: "d123.cloudfront.net",
            distributionId: "EXAMPLE",
            eventType: "viewer-request" as const,
            requestId: "test-request-id",
          },
          request: {
            uri,
            method: "GET",
            querystring: "",
            headers: {
              host: [{ key: "Host", value: host }],
            },
            clientIp: "192.0.2.1",
          },
        },
      },
    ],
  });

  // Helper to assert result is a response (not a request)
  function assertIsResponse(
    result: unknown,
  ): asserts result is CloudFrontResultResponse {
    if (!result || typeof result !== "object" || !("status" in result)) {
      throw new Error("Expected CloudFrontResultResponse");
    }
  };

  describe("Empty path handling", () => {
    it("should redirect to DEFAULT_URL when path is empty", async () => {
      const event = createEvent("/");

      const result = await handler(event);
      assertIsResponse(result);

      expect(result).toEqual({
        status: "301",
        statusDescription: "Moved Permanently",
        headers: {
          location: [
            { key: "Location", value: "https://www.acm.illinois.edu" },
          ],
          "cache-control": [
            { key: "Cache-Control", value: "public, max-age=30" },
          ],
        },
      });
    });

    it("should redirect to DEFAULT_URL when path is only slashes", async () => {
      const event = createEvent("///");

      const result = await handler(event);
      assertIsResponse(result);

      expect(result.status).toBe("301");
      expect(result.headers?.location?.[0].value).toBe(
        "https://www.acm.illinois.edu",
      );
    });
  });

  describe("Successful redirect from DynamoDB", () => {
    it("should return 302 redirect when link is found in DynamoDB for go.acm", async () => {
      const redirectUrl = "https://example.com/target";
      dynamoMock.on(QueryCommand).resolves({
        Items: [
          {
            slug: { S: "test-link" },
            access: { S: "OWNER#user123" },
            redirect: { S: redirectUrl },
          },
        ],
      });

      const event = createEvent("/test-link", "go.acm.illinois.edu");
      const result = await handler(event);
      assertIsResponse(result);

      expect(result).toEqual({
        status: "302",
        statusDescription: "Found",
        headers: {
          location: [{ key: "Location", value: redirectUrl }],
          "cache-control": [
            { key: "Cache-Control", value: "public, max-age=30" },
          ],
        },
      });
    });

    it("should return 302 redirect when link is found in DynamoDB for acm.gg", async () => {
      const redirectUrl = "https://example.com/target";
      dynamoMock.on(QueryCommand).resolves({
        Items: [
          {
            slug: { S: "testgg" },
            access: { S: "OWNER#user123" },
            redirect: { S: redirectUrl },
          },
        ],
      });

      const event = createEvent("/testgg", "acm.gg");
      const result = await handler(event);
      assertIsResponse(result);

      expect(result).toEqual({
        status: "302",
        statusDescription: "Found",
        headers: {
          location: [{ key: "Location", value: redirectUrl }],
          "cache-control": [
            { key: "Cache-Control", value: "public, max-age=30" },
          ],
        },
      });
    });

    it("should query DynamoDB with correct parameters", async () => {
      dynamoMock.on(QueryCommand).resolves({
        Items: [
          {
            redirect: { S: "https://example.com" },
          },
        ],
      });

      const event = createEvent("/my-link");
      await handler(event);

      const calls = dynamoMock.commandCalls(QueryCommand);
      expect(calls).toHaveLength(1);
      expect(calls[0].args[0].input).toMatchObject({
        TableName: "infra-core-api-linkry",
        KeyConditionExpression:
          "slug = :slug AND begins_with(access, :owner_prefix)",
        ExpressionAttributeValues: {
          ":slug": { S: "my-link" },
          ":owner_prefix": { S: "OWNER#" },
        },
        ProjectionExpression: "redirect",
        Limit: 1,
      });
    });
  });

  describe("Organization shortcode handling", () => {
    it("should prepend org code for SIG subdomain", async () => {
      dynamoMock.on(QueryCommand).resolves({
        Items: [
          {
            redirect: { S: "https://sig.example.com" },
          },
        ],
      });

      const event = createEvent("/test-link", "sigpwny.go.acm.illinois.edu");
      await handler(event);

      const calls = dynamoMock.commandCalls(QueryCommand);
      expect(calls[0].args[0].input.ExpressionAttributeValues).toMatchObject({
        ":slug": { S: "S01#test-link" },
      });
    });

    it("should prepend org code for INFRA subdomain", async () => {
      dynamoMock.on(QueryCommand).resolves({
        Items: [
          {
            redirect: { S: "https://infra.example.com" },
          },
        ],
      });

      const event = createEvent("/test-link", "infra.go.acm.illinois.edu");
      await handler(event);

      const calls = dynamoMock.commandCalls(QueryCommand);
      expect(calls[0].args[0].input.ExpressionAttributeValues).toMatchObject({
        ":slug": { S: "C01#test-link" },
      });
    });

    it("should NOT prepend A01# for ACM subdomain", async () => {
      dynamoMock.on(QueryCommand).resolves({
        Items: [
          {
            redirect: { S: "https://acm.example.com" },
          },
        ],
      });

      const event = createEvent("/test-link", "acm.go.acm.illinois.edu");
      await handler(event);

      const calls = dynamoMock.commandCalls(QueryCommand);
      expect(calls[0].args[0].input.ExpressionAttributeValues).toMatchObject({
        ":slug": { S: "test-link" },
      });
    });

    it("should handle .aws.qa.acmuiuc.org domain", async () => {
      dynamoMock.on(QueryCommand).resolves({
        Items: [
          {
            redirect: { S: "https://example.com" },
          },
        ],
      });

      const event = createEvent("/test-link", "icpc.go.aws.qa.acmuiuc.org");
      await handler(event);

      const calls = dynamoMock.commandCalls(QueryCommand);
      expect(calls[0].args[0].input.ExpressionAttributeValues).toMatchObject({
        ":slug": { S: "S06#test-link" },
      });
    });

    it("should handle .acm.gg domain", async () => {
      dynamoMock.on(QueryCommand).resolves({
        Items: [
          {
            redirect: { S: "https://example.com" },
          },
        ],
      });

      const event = createEvent("/test-link", "infra.acm.gg");
      await handler(event);

      const calls = dynamoMock.commandCalls(QueryCommand);
      expect(calls[0].args[0].input.ExpressionAttributeValues).toMatchObject({
        ":slug": { S: "C01#test-link" },
      });
    });

    it("should handle case-insensitive hostnames", async () => {
      dynamoMock.on(QueryCommand).resolves({
        Items: [
          {
            redirect: { S: "https://example.com" },
          },
        ],
      });

      const event = createEvent("/test-link", "INFRA.GO.ACM.ILLINOIS.EDU");
      await handler(event);

      const calls = dynamoMock.commandCalls(QueryCommand);
      expect(calls[0].args[0].input.ExpressionAttributeValues).toMatchObject({
        ":slug": { S: "C01#test-link" },
      });
    });
  });

  describe("Fallback behavior", () => {
    it("should return 307 fallback when no items found in DynamoDB", async () => {
      dynamoMock.on(QueryCommand).resolves({
        Items: [],
      });

      const event = createEvent("/nonexistent-link");
      const result = await handler(event);
      assertIsResponse(result);

      expect(result).toEqual({
        status: "307",
        statusDescription: "Temporary Redirect",
        headers: {
          location: [
            { key: "Location", value: "https://acm.illinois.edu/404" },
          ],
          "cache-control": [
            { key: "Cache-Control", value: "public, max-age=30" },
          ],
        },
      });
    });

    it("should return 307 fallback when item has no redirect attribute", async () => {
      dynamoMock.on(QueryCommand).resolves({
        Items: [
          {
            slug: { S: "test-link" },
            access: { S: "OWNER#user123" },
            // No redirect attribute
          },
        ],
      });

      const event = createEvent("/test-link");
      const result = await handler(event);
      assertIsResponse(result);

      expect(result.status).toBe("307");
      expect(result.headers?.location?.[0].value).toBe(
        "https://acm.illinois.edu/404",
      );
    });

    it("should return 307 fallback when DynamoDB query fails", async () => {
      dynamoMock.on(QueryCommand).rejects(new Error("DynamoDB error"));

      const event = createEvent("/test-link");
      const result = await handler(event);
      assertIsResponse(result);

      expect(result.status).toBe("307");
      expect(result.headers?.location?.[0].value).toBe(
        "https://acm.illinois.edu/404",
      );
    });

    it("should return 307 fallback when Items array is undefined", async () => {
      dynamoMock.on(QueryCommand).resolves({});

      const event = createEvent("/test-link");
      const result = await handler(event);
      assertIsResponse(result);

      expect(result.status).toBe("307");
    });
  });

  describe("Path handling", () => {
    it("should strip leading slashes from path", async () => {
      dynamoMock.on(QueryCommand).resolves({
        Items: [
          {
            redirect: { S: "https://example.com" },
          },
        ],
      });

      const event = createEvent("///test-link");
      await handler(event);

      const calls = dynamoMock.commandCalls(QueryCommand);
      expect(calls[0].args[0].input.ExpressionAttributeValues).toMatchObject({
        ":slug": { S: "test-link" },
      });
    });

    it("should handle paths with special characters", async () => {
      dynamoMock.on(QueryCommand).resolves({
        Items: [
          {
            redirect: { S: "https://example.com" },
          },
        ],
      });

      const event = createEvent("/test-link_123");
      await handler(event);

      const calls = dynamoMock.commandCalls(QueryCommand);
      expect(calls[0].args[0].input.ExpressionAttributeValues).toMatchObject({
        ":slug": { S: "test-link_123" },
      });
    });
  });

  describe("Edge cases", () => {
    it("should handle missing host header gracefully", async () => {
      dynamoMock.on(QueryCommand).resolves({
        Items: [
          {
            redirect: { S: "https://example.com" },
          },
        ],
      });

      const event = createEvent("/test-link");
      delete event.Records[0].cf.request.headers.host;

      const result = await handler(event);
      assertIsResponse(result);

      expect(result.status).toBe("302");
    });

    it("should handle non-Error exceptions in DynamoDB query", async () => {
      dynamoMock.on(QueryCommand).rejects("String error");

      const event = createEvent("/test-link");
      const result = await handler(event);
      assertIsResponse(result);

      expect(result.status).toBe("307");
    });

    it("should handle redirect URLs with query parameters", async () => {
      const redirectUrl = "https://example.com/page?param=value&other=123";
      dynamoMock.on(QueryCommand).resolves({
        Items: [
          {
            redirect: { S: redirectUrl },
          },
        ],
      });

      const event = createEvent("/test-link");
      const result = await handler(event);
      assertIsResponse(result);

      expect(result.headers?.location?.[0].value).toBe(redirectUrl);
    });

    it("should handle redirect URLs with fragments", async () => {
      const redirectUrl = "https://example.com/page#section";
      dynamoMock.on(QueryCommand).resolves({
        Items: [
          {
            redirect: { S: redirectUrl },
          },
        ],
      });

      const event = createEvent("/test-link");
      const result = await handler(event);
      assertIsResponse(result);

      expect(result.headers?.location?.[0].value).toBe(redirectUrl);
    });
  });

  describe("Region selection logic", () => {
    it("should log the region selection", async () => {
      const consoleLogSpy = vi.spyOn(console, "log");

      dynamoMock.on(QueryCommand).resolves({
        Items: [],
      });

      const event = createEvent("/test-link");
      await handler(event);

      // Check that region logging occurred (this happens during module initialization)
      expect(consoleLogSpy).toHaveBeenCalled();
    });
  });

  describe("Cache control", () => {
    it("should include cache-control header in all responses", async () => {
      const testCases = [
        { path: "/", expectedStatus: "301" },
        { path: "/found", expectedStatus: "302", setupMock: true },
        { path: "/notfound", expectedStatus: "307", setupMock: false },
      ];

      for (const testCase of testCases) {
        dynamoMock.reset();

        if (testCase.setupMock) {
          dynamoMock.on(QueryCommand).resolves({
            Items: [
              {
                redirect: { S: "https://example.com" },
              },
            ],
          });
        } else {
          dynamoMock.on(QueryCommand).resolves({ Items: [] });
        }

        const event = createEvent(testCase.path);
        const result = await handler(event);
        assertIsResponse(result);

        expect(result.status).toBe(testCase.expectedStatus);
        expect(result.headers?.["cache-control"]).toEqual([
          { key: "Cache-Control", value: "public, max-age=30" },
        ]);
      }
    });
  });
});
