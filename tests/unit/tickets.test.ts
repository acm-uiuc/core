import { afterAll, expect, test, beforeEach, vi, describe } from "vitest";
import { DynamoDBClient, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { mockClient } from "aws-sdk-client-mock";
import init from "../../src/index.js";
import { EventGetResponse } from "../../src/routes/events.js";
import { secretObject } from "./secret.testdata.js";
import {
  fulfilledMerchItem1,
  refundedMerchItem,
  unfulfilledMerchItem1,
} from "./mockMerchPurchases.testdata.js";
import { createJwt } from "./auth.test.js";
import supertest from "supertest";
import {
  unfulfilledTicket1,
  unfulfilledTicket1WithEmail,
} from "./mockTickets.testdata.js";

const ddbMock = mockClient(DynamoDBClient);
const jwt_secret = secretObject["jwt_key"];
vi.stubEnv("JwtSigningKey", jwt_secret);

const app = await init();

describe("Test ticket purchase verification", async () => {
  test("Happy path: fulfill an unfulfilled item", async () => {
    ddbMock
      .on(UpdateItemCommand)
      .resolvesOnce({ Attributes: unfulfilledTicket1 })
      .resolvesOnce({});

    const testJwt = createJwt();
    await app.ready();
    const response = await supertest(app.server)
      .post("/api/v1/tickets/checkIn")
      .set("authorization", `Bearer ${testJwt}`)
      .send({
        type: "ticket",
        ticketId:
          "9d98e1e3c2138c93dd5a284239eddfa9c3037a0862972cd0f51ee1b54257a37e",
      });
    const responseDataJson = response.body as EventGetResponse;
    expect(response.statusCode).toEqual(200);
    expect(responseDataJson).toEqual({
      valid: true,
      type: "ticket",
      ticketId:
        "9d98e1e3c2138c93dd5a284239eddfa9c3037a0862972cd0f51ee1b54257a37e",
      purchaserData: {
        email: `${unfulfilledTicket1["ticketholder_netid"]["S"]}@illinois.edu`,
        productId: unfulfilledTicket1["event_id"]["S"],
        quantity: 1,
      },
    });
  });
  test("Happy path: fulfill an unfulfilled item parses NetId versus email correctly", async () => {
    ddbMock
      .on(UpdateItemCommand)
      .resolvesOnce({ Attributes: unfulfilledTicket1WithEmail })
      .resolvesOnce({});

    const testJwt = createJwt();
    await app.ready();
    const response = await supertest(app.server)
      .post("/api/v1/tickets/checkIn")
      .set("authorization", `Bearer ${testJwt}`)
      .send({
        type: "ticket",
        ticketId:
          "9d98e1e3c2138c93dd5a284239eddfa9c3037a0862972cd0f51ee1b54257a37e",
      });
    const responseDataJson = response.body as EventGetResponse;
    expect(response.statusCode).toEqual(200);
    expect(responseDataJson).toEqual({
      valid: true,
      type: "ticket",
      ticketId:
        "9d98e1e3c2138c93dd5a284239eddfa9c3037a0862972cd0f51ee1b54257a37e",
      purchaserData: {
        email: unfulfilledTicket1WithEmail["ticketholder_netid"]["S"],
        productId: unfulfilledTicket1WithEmail["event_id"]["S"],
        quantity: 1,
      },
    });
  });
  test("Sad path: merch info with ticket type should fail", async () => {
    ddbMock
      .on(UpdateItemCommand)
      .resolvesOnce({ Attributes: refundedMerchItem })
      .resolvesOnce({});

    const testJwt = createJwt();
    await app.ready();
    const response = await supertest(app.server)
      .post("/api/v1/tickets/checkIn")
      .set("authorization", `Bearer ${testJwt}`)
      .send({
        type: "ticket",
        email: "testing2@illinois.edu",
        stripePi: "pi_6T9QvUwR2IOj4CyF35DsXK7P",
      });
    const responseDataJson = response.body as EventGetResponse;
    expect(response.statusCode).toEqual(400);
    expect(responseDataJson).toEqual({
      error: true,
      id: 104,
      message:
        'Invalid literal value, expected "merch" at "type", or Required at "ticketId"',
      name: "ValidationError",
    });
  });
  test("Sad path: fulfilling an already-fulfilled ticket item fails", async () => {
    ddbMock
      .on(UpdateItemCommand)
      .resolvesOnce({ Attributes: fulfilledMerchItem1 })
      .resolvesOnce({});

    const testJwt = createJwt();
    await app.ready();
    const response = await supertest(app.server)
      .post("/api/v1/tickets/checkIn")
      .set("authorization", `Bearer ${testJwt}`)
      .send({
        type: "ticket",
        ticketId:
          "975b4470cf37d7cf20fd404a711513fd1d1e68259ded27f10727d1384961843d",
      });
    const responseDataJson = response.body as EventGetResponse;
    expect(response.statusCode).toEqual(400);
    expect(responseDataJson).toEqual({
      error: true,
      id: 109,
      message: "Ticket has already been used.",
      name: "TicketNotValidError",
    });
  });
});

describe("Test merch purchase verification", async () => {
  test("Happy path: fulfill an unfulfilled item", async () => {
    ddbMock
      .on(UpdateItemCommand)
      .resolvesOnce({ Attributes: unfulfilledMerchItem1 })
      .resolvesOnce({});

    const testJwt = createJwt();
    await app.ready();
    const response = await supertest(app.server)
      .post("/api/v1/tickets/checkIn")
      .set("authorization", `Bearer ${testJwt}`)
      .send({
        type: "merch",
        email: "testing1@illinois.edu",
        stripePi: "pi_8J4NrYdA3S7cW8Ty92FnGJ6L",
      });
    const responseDataJson = response.body as EventGetResponse;
    expect(response.statusCode).toEqual(200);
    expect(responseDataJson).toEqual({
      valid: true,
      type: "merch",
      ticketId: "pi_8J4NrYdA3S7cW8Ty92FnGJ6L",
      purchaserData: {
        email: unfulfilledMerchItem1["email"]["S"],
        productId: unfulfilledMerchItem1["item_id"]["S"],
        quantity: parseInt(unfulfilledMerchItem1["quantity"]["N"], 10),
        size: unfulfilledMerchItem1["size"]["S"],
      },
    });
  });
  test("Sad path: ticket info with merch type should fail", async () => {
    ddbMock
      .on(UpdateItemCommand)
      .resolvesOnce({ Attributes: refundedMerchItem })
      .resolvesOnce({});

    const testJwt = createJwt();
    await app.ready();
    const response = await supertest(app.server)
      .post("/api/v1/tickets/checkIn")
      .set("authorization", `Bearer ${testJwt}`)
      .send({
        type: "merch",
        ticketId:
          "975b4470cf37d7cf20fd404a711513fd1d1e68259ded27f10727d1384961843d",
      });
    const responseDataJson = response.body as EventGetResponse;
    expect(response.statusCode).toEqual(400);
    expect(responseDataJson).toEqual({
      error: true,
      id: 104,
      message: `Required at "email"; Required at "stripePi", or Invalid literal value, expected "ticket" at "type"`,
      name: "ValidationError",
    });
  });
  test("Sad path: fulfilling a refunded merch item fails", async () => {
    ddbMock
      .on(UpdateItemCommand)
      .resolvesOnce({ Attributes: refundedMerchItem })
      .resolvesOnce({});

    const testJwt = createJwt();
    await app.ready();
    const response = await supertest(app.server)
      .post("/api/v1/tickets/checkIn")
      .set("authorization", `Bearer ${testJwt}`)
      .send({
        type: "merch",
        email: "testing2@illinois.edu",
        stripePi: "pi_6T9QvUwR2IOj4CyF35DsXK7P",
      });
    const responseDataJson = response.body as EventGetResponse;
    expect(response.statusCode).toEqual(400);
    expect(responseDataJson).toEqual({
      error: true,
      id: 109,
      message: "Ticket was already refunded.",
      name: "TicketNotValidError",
    });
  });
  test("Sad path: fulfilling an already-fulfilled merch item fails", async () => {
    ddbMock
      .on(UpdateItemCommand)
      .resolvesOnce({ Attributes: fulfilledMerchItem1 })
      .resolvesOnce({});

    const testJwt = createJwt();
    await app.ready();
    const response = await supertest(app.server)
      .post("/api/v1/tickets/checkIn")
      .set("authorization", `Bearer ${testJwt}`)
      .send({
        type: "merch",
        email: "testing0@illinois.edu",
        stripePi: "pi_3Q5GewDiGOXU9RuS16txRR5D",
      });
    const responseDataJson = response.body as EventGetResponse;
    expect(response.statusCode).toEqual(400);
    expect(responseDataJson).toEqual({
      error: true,
      id: 109,
      message: "Ticket has already been used.",
      name: "TicketNotValidError",
    });
  });
});

afterAll(async () => {
  await app.close();
  vi.useRealTimers();
});
beforeEach(() => {
  ddbMock.reset();
  vi.useFakeTimers();
});
