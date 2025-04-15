import { afterAll, expect, test, beforeEach, vi } from "vitest";
import {
  DynamoDBClient,
  PutItemCommand,
  GetItemCommand,
  ScanCommand,
  QueryCommand,
} from "@aws-sdk/client-dynamodb";
import { mockClient } from "aws-sdk-client-mock";
import init from "../../src/api/index.js";
import { createJwt } from "./auth.test.js";
import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import { CloudFrontKeyValueStoreClient } from "@aws-sdk/client-cloudfront-keyvaluestore";

import { secretJson, secretObject } from "./secret.testdata.js";
import supertest from "supertest";
import { environmentConfig } from "../../src/common/config.js";

const ddbMock = mockClient(DynamoDBClient);
const smMock = mockClient(SecretsManagerClient);
const jwt_secret = secretObject["jwt_key"];
vi.stubEnv("JwtSigningKey", jwt_secret);

// Mock the Cloudfront KV client to prevent the actual Cloudfront KV call
// aws-sdk-client-mock doesn't support Cloudfront KV Client API
vi.mock("../../src/api/functions/cloudfrontKvStore.js", async () => {
  return {
    setKey: vi.fn(),
    deleteKey: vi.fn(),
    getKey: vi.fn().mockResolvedValue("https://www.acm.illinois.edu"),
    getLinkryKvArn: vi
      .fn()
      .mockResolvedValue(environmentConfig["dev"].LinkryCloudfrontKvArn),
  };
});

const app = await init();

(app as any).nodeCache.flushAll();
ddbMock.reset();
smMock.reset();
vi.useFakeTimers();

// Mock secrets manager
smMock.on(GetSecretValueCommand).resolves({
  SecretString: secretJson,
});

const testJwt = createJwt(
  undefined, // No specific date
  undefined, // No specific group
  "test@gmail.com", // Test email
  ["AppRoles.LINKS_MANAGER", "AppRoles.LINKS_ADMIN"], // Add required roles
);

test("Happy path: Fetch all linkry redirects with proper roles", async () => {
  // Create a test JWT with roles

  // Mock successful DynamoDB operations
  ddbMock.on(QueryCommand).resolves({
    Items: [], // Simulate no existing records
  });

  // Make the request to the /api/v1/linkry/redir endpoint
  const response = await app.inject({
    method: "GET",
    url: "/api/v1/linkry/redir",
    headers: {
      Authorization: `Bearer ${testJwt}`, // Include the JWT with roles
    },
  });

  expect(response.statusCode).toBe(200);
});

//2. Create a new link using supertest
// const eventResponse = await supertest(app.server)
//   .post("/api/v1/linkry/redir/")
//   .set("Authorization", `Bearer ${testJwt}`)
//   .send({
//     description: "Test event for ETag verification",
//     host: "Social Committee",
//     location: "Siebel Center",
//     start: "2024-09-25T18:00:00",
//     title: "ETag Test Event",
//     featured: false,
//   });

// expect(eventResponse.statusCode).toBe(201);
// const eventId = eventResponse.body.id;

// test("Happy path: Create or update a linkry redirect", async () => {
//   // Mock successful DynamoDB operations
//   ddbMock.on(QueryCommand).resolves({
//     Items: [], // Simulate no existing records for the slug
//   });

//   // Define the request payload
//   const payload = {
//     access: [],
//     counter: 0,
//     isEdited: true,
//     redirect: "https://www.rainbow.com",
//     slug: "bQjryt",
//   };

//   // Make the request to the /api/v1/linkry/redir/ endpoint
//   const response = await supertest(app.server)
//     .post("/api/v1/linkry/redir/")
//     .set("Authorization", `Bearer ${testJwt}`) // Add authorization header
//     .send(payload); // Send the payload

//   // Assert the response status code
//   expect(response.statusCode).toBe(201);

//   // Assert the response body (optional, based on your API's response structure)
//   expect(response.body).toStrictEqual({
//     message: "Linkry redirect created or updated successfully",
//     slug: "bQjryt",
//   });
// });

test("Happy path: Create a new linkry redirect", async () => {
  // Mock successful DynamoDB operations
  ddbMock.on(QueryCommand).resolves({
    Items: [], // Simulate no existing records for the slug
  });

  ddbMock.on(PutItemCommand).resolves({}); // Simulate successful insertion

  // Define the request payload
  const payload = {
    access: [],
    counter: 0,
    isEdited: true,
    redirect: "https://www.acm.illinois.edu/",
    slug: "acm-test-slug",
  };

  // Make the request to the /api/v1/linkry/redir/ endpoint
  const response = await supertest(app.server)
    .post("/api/v1/linkry/redir")
    .set("Authorization", `Bearer ${testJwt}`) // Include the JWT with roles
    .send(payload); // Send the payload

  // Assert the response status code
  expect(response.statusCode).toBe(201);

  // Assert the response body
  expect(response.body).toStrictEqual({
    id: "acm-test-slug",
  });
});

// const testAdminJwt = createJwt(undefined, "LINKS_ADMIN");
// const testAccessDeniedJwt = createJwt(undefined, "1");

// const adminLinkryResponse = await app.inject({
//   method: "GET",
//   url: "/api/v1/linkry/redir",
//   headers: {
//     Authorization: `Bearer ${testAdminJwt}`,
//   },
// });

// const accessDeniedLinkryResponse = await app.inject({
//   method: "GET",
//   url: "/api/v1/linkry/redir",
//   headers: {
//     Authorization: `Bearer ${testAccessDeniedJwt}`,
//   },
// });

// expect(adminLinkryResponse.statusCode).toBe(200);
// expect(accessDeniedLinkryResponse.statusCode).toBe(401);
