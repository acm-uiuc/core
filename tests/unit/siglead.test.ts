import { test, describe, expect, vi, beforeEach, afterEach } from "vitest";
import Fastify, { FastifyInstance } from "fastify";
import sigleadRoutes from "../../src/api/routes/siglead.js";
import * as sigleadFunctions from "../../src/api/functions/siglead.js";
import {
  SigDetailRecord,
  SigMemberCount,
  SigMemberRecord,
} from "../../src/common/types/siglead.js";

// Mock the entire module of siglead functions
vi.mock("../../src/api/functions/siglead.js");

// A helper function to build our Fastify app for each test
const build = async (t: any): Promise<FastifyInstance> => {
  const app = Fastify();
  // Register the routes we are testing, with a prefix
  app.register(sigleadRoutes, { prefix: "/siglead" });

  // Add a cleanup hook
  // t.after(() => app.close());

  // Make the app available for injection-based testing
  await app.ready();
  return app;
};

describe("SIGLead Routes", () => {
  let app: FastifyInstance;

  // Before each test, build a new Fastify instance and mock the functions
  beforeEach(async (t) => {
    app = await build(t);
  });

  // After each test, close the server and restore the mocks to their original state
  // afterEach(async () => {
  //   await app.close();
  //   vi.restoreAllMocks();
  // });

  // --- Tests for GET /sigmembers/:sigid ---
  describe("GET /siglead/sigmembers/:sigid", () => {
    test("should return 200 and member records on success", async () => {
      const mockSigId = "sig-awesome";
      const mockMembers: SigMemberRecord[] = [
        {
          sigGroupId: mockSigId,
          email: "test1@example.com",
          designation: "M",
          memberName: "test1",
        },
        {
          sigGroupId: mockSigId,
          email: "test2@example.com",
          designation: "L",
          memberName: "test2",
        },
      ];

      // Control the mock: make fetchMemberRecords return our fake data
      vi.mocked(sigleadFunctions.fetchMemberRecords).mockResolvedValue(
        mockMembers,
      );

      const response = await app.inject({
        method: "GET",
        url: `/siglead/sigmembers/${mockSigId}`,
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.payload)).toEqual(mockMembers);
    });

    test("should return 500 when fetchMemberRecords fails", async () => {
      // Control the mock: make it throw an error
      vi.mocked(sigleadFunctions.fetchMemberRecords).mockRejectedValue(
        new Error("DynamoDB dyed :("),
      );

      const response = await app.inject({
        method: "GET",
        url: "/siglead/sigmembers/sig-fail",
      });

      expect(response.statusCode).toBe(500);
      const payload = JSON.parse(response.payload);
      expect(payload.message).toBe(
        "Failed to fetch member records from Dynamo table.",
      );
    });
  });

  // --- Tests for GET /sigdetail/:sigid ---
  describe("GET /siglead/sigdetail/:sigid", () => {
    test("should return 200 and sig detail on success", async () => {
      const mockSigId = "sig-details";
      const mockDetail: SigDetailRecord = {
        sigid: mockSigId,
        signame: "The Awesome SIG",
        description: "A SIG for testing.",
      };

      vi.mocked(sigleadFunctions.fetchSigDetail).mockResolvedValue(mockDetail);

      const response = await app.inject({
        method: "GET",
        url: `/siglead/sigdetail/${mockSigId}`,
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.payload)).toEqual(mockDetail);
    });

    test("should return 500 when fetchSigDetail fails", async () => {
      vi.mocked(sigleadFunctions.fetchSigDetail).mockRejectedValue(
        new Error("Database connection lost"),
      );

      const response = await app.inject({
        method: "GET",
        url: "/siglead/sigdetail/sig-fail",
      });

      expect(response.statusCode).toBe(500);
      const payload = JSON.parse(response.payload);
      expect(payload.message).toBe(
        "Failed to fetch sig detail record from Dynamo table.",
      );
    });
  });

  // --- Tests for GET /sigcount ---
  describe("GET /siglead/sigcount", () => {
    test("should return 200 and sig member counts on success", async () => {
      const mockCounts: SigMemberCount[] = [
        {
          sigid: "sig-a",
          count: 10,
          signame: "a",
        },
        {
          sigid: "sig-b",
          count: 25,
          signame: "b",
        },
      ];

      vi.mocked(sigleadFunctions.fetchSigCounts).mockResolvedValue(mockCounts);

      const response = await app.inject({
        method: "GET",
        url: "/siglead/sigcount",
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.payload)).toEqual(mockCounts);
    });

    test("should return 500 when fetchSigCounts fails", async () => {
      vi.mocked(sigleadFunctions.fetchSigCounts).mockRejectedValue(
        new Error("Could not count"),
      );

      const response = await app.inject({
        method: "GET",
        url: "/siglead/sigcount",
      });

      expect(response.statusCode).toBe(500);
      const payload = JSON.parse(response.payload);
      expect(payload.message).toBe(
        "Failed to fetch sig member counts record from Dynamo table.",
      );
    });
  });

  // --- Tests for POST /addMember ---
  describe("POST /siglead/addMemberDynamo", () => {
    test("should return 200 on successful member addition", async () => {
      const newMember = {
        sigGroupId: "sig-new",
        email: "new.member@example.com",
      };

      // For functions that don't return anything, we just resolve with void
      vi.mocked(sigleadFunctions.addMemberToSigDynamo).mockResolvedValue(
        undefined,
      );

      const response = await app.inject({
        method: "POST",
        url: "/siglead/addMemberDynamo",
        payload: newMember, // Send the data in the request body
      });

      expect(response.statusCode).toBe(200);

      // Verify that our mock was called with the correct data
      expect(sigleadFunctions.addMemberToSigDynamo).toHaveBeenCalledWith(
        "infra-core-api-sig-member-details", // We don't need to test the table name config
        newMember,
        undefined, // We don't need to test the dynamoClient instance
      );
    });

    test("should return 500 when addMemberToSigDynamo fails", async () => {
      vi.mocked(sigleadFunctions.addMemberToSigDynamo).mockRejectedValue(
        new Error("Insert failed"),
      );

      const response = await app.inject({
        method: "POST",
        url: "/siglead/addMemberDynamo",
        payload: {
          sigGroupId: "sig-fail",
          email: "fail@example.com",
        },
      });

      expect(response.statusCode).toBe(500);
      const payload = JSON.parse(response.payload);
      expect(payload.message).toBe(
        "Failed to add sig member record to Dynamo table.",
      );
    });
  });
});
