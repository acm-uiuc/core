import { afterAll, expect, test, beforeEach, vi, describe } from "vitest";
import {
  AttributeValue,
  ConditionalCheckFailedException,
  DynamoDBClient,
  QueryCommand,
  ScanCommand,
  UpdateItemCommand,
} from "@aws-sdk/client-dynamodb";
import { mockClient } from "aws-sdk-client-mock";
import init from "../../src/api/server.js";
import { secretObject } from "./secret.testdata.js";
import {
  dynamoTableData,
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
import {
  merchMetadata,
  ticketsMetadata,
} from "./data/mockTIcketsMerchMetadata.testdata.js";
import { marshall } from "@aws-sdk/util-dynamodb";

const ddbMock = mockClient(DynamoDBClient);
const jwt_secret = secretObject["jwt_key"];
vi.stubEnv("JwtSigningKey", jwt_secret);

const app = await init();

describe("Test getting ticketing + merch metadata", async () => {
  test("Happy path: get items", async () => {
    ddbMock
      .on(ScanCommand)
      .resolvesOnce({
        Items: merchMetadata as Record<string, AttributeValue>[],
      })
      .resolvesOnce({
        Items: ticketsMetadata as Record<string, AttributeValue>[],
      })
      .rejects();
    const testJwt = createJwt();
    await app.ready();
    const response = await supertest(app.server)
      .get("/api/v1/tickets")
      .set("authorization", `Bearer ${testJwt}`);
    const responseDataJson = response.body;
    expect(response.statusCode).toEqual(200);
    expect(responseDataJson).toEqual({
      merch: [
        {
          itemId: "2024_spr_tshirt",
          itemName: "ACM T-Shirt: Spring 2024 Series",
          itemSalesActive: "1970-01-01T00:00:00.000Z",
          priceDollars: { member: 22, nonMember: 26 },
        },
        {
          itemId: "2024_fa_barcrawl_2",
          itemName: "ACM Bar Crawl: Fall 2024 (Nov 14)",
          itemSalesActive: false,
          priceDollars: { member: 15, nonMember: 18 },
        },
      ],
      tickets: [
        {
          itemId: "fa23_barcrawl",
          itemName: "ACM Fall 2023 Bar Crawl",
          itemSalesActive: false,
          priceDollars: { member: 15, nonMember: 18 },
          eventCapacity: 130,
          ticketsSold: 55,
        },
        {
          itemId: "fa22_barcrawl",
          itemName: "ACM Fall 2023 Bar Crawl",
          itemSalesActive: false,
          priceDollars: { member: 15, nonMember: 18 },
          eventCapacity: 130,
          ticketsSold: 55,
        },
      ],
    });
  });
  test("Ensure scanners can only see active items", async () => {
    ddbMock
      .on(ScanCommand)
      .resolvesOnce({
        Items: merchMetadata as Record<string, AttributeValue>[],
      })
      .resolvesOnce({
        Items: ticketsMetadata as Record<string, AttributeValue>[],
      })
      .rejects();
    const testJwt = createJwt(undefined, ["scanner-only"]);
    await app.ready();
    const response = await supertest(app.server)
      .get("/api/v1/tickets")
      .set("authorization", `Bearer ${testJwt}`);
    const responseDataJson = response.body;
    expect(response.statusCode).toEqual(200);
    expect(responseDataJson).toEqual({
      merch: [
        {
          itemId: "2024_spr_tshirt",
          itemName: "ACM T-Shirt: Spring 2024 Series",
          itemSalesActive: "1970-01-01T00:00:00.000Z",
          priceDollars: { member: 22, nonMember: 26 },
        },
      ],
      tickets: [],
    });
  });
});

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
    const responseDataJson = response.body;
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
    const responseDataJson = response.body;
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
    const responseDataJson = response.body;
    expect(response.statusCode).toEqual(400);
    expect(responseDataJson).toEqual({
      error: true,
      id: 104,
      message: "body/ Invalid input",
      name: "ValidationError",
    });
  });
  test("Sad path: fulfilling an already-fulfilled ticket item fails", async () => {
    const conditionalError = new ConditionalCheckFailedException({
      message: "The conditional request failed",
      $metadata: {},
    });
    (conditionalError as any).Item = {
      ticket_id: {
        S: "975b4470cf37d7cf20fd404a711513fd1d1e68259ded27f10727d1384961843d",
      },
      used: { BOOL: true },
      refunded: { BOOL: false },
    };

    ddbMock.on(UpdateItemCommand).rejects(conditionalError);

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
    const responseDataJson = response.body;
    expect(response.statusCode).toEqual(400);
    expect(responseDataJson).toEqual({
      error: true,
      id: 109,
      message: "Ticket has already been used.",
      name: "TicketNotValidError",
    });
  });

  test("Sad path: ticket was refunded", async () => {
    const conditionalError = new ConditionalCheckFailedException({
      message: "The conditional request failed",
      $metadata: {},
    });
    (conditionalError as any).Item = {
      ticket_id: {
        S: "975b4470cf37d7cf20fd404a711513fd1d1e68259ded27f10727d1384961843d",
      },
      used: { BOOL: false },
      refunded: { BOOL: true },
    };

    ddbMock.on(UpdateItemCommand).rejects(conditionalError);

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
    const responseDataJson = response.body;
    expect(response.statusCode).toEqual(400);
    expect(responseDataJson).toEqual({
      error: true,
      id: 109,
      message: "Ticket was already refunded.",
      name: "TicketNotValidError",
    });
  });

  test("Sad path: ticket does not exist", async () => {
    const conditionalError = new ConditionalCheckFailedException({
      message: "The conditional request failed",
      $metadata: {},
    });

    ddbMock.on(UpdateItemCommand).rejects(conditionalError);

    const testJwt = createJwt();
    await app.ready();
    const response = await supertest(app.server)
      .post("/api/v1/tickets/checkIn")
      .set("authorization", `Bearer ${testJwt}`)
      .send({
        type: "ticket",
        ticketId: "nonexistentticketid123456789",
      });
    const responseDataJson = response.body;
    expect(response.statusCode).toEqual(404);
    expect(responseDataJson).toEqual({
      error: true,
      id: 108,
      message: "Ticket does not exist.",
      name: "TicketNotFoundError",
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
    const responseDataJson = response.body;
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
    const responseDataJson = response.body;
    expect(response.statusCode).toEqual(400);
    expect(responseDataJson).toEqual({
      error: true,
      id: 104,
      message: `body/ Invalid input`,
      name: "ValidationError",
    });
  });
  test("Sad path: fulfilling a refunded merch item fails", async () => {
    const conditionalError = new ConditionalCheckFailedException({
      message: "The conditional request failed",
      $metadata: {},
    });
    (conditionalError as any).Item = {
      stripe_pi: { S: "pi_6T9QvUwR2IOj4CyF35DsXK7P" },
      email: { S: "testing2@illinois.edu" },
      fulfilled: { BOOL: false },
      refunded: { BOOL: true },
    };

    ddbMock.on(UpdateItemCommand).rejects(conditionalError);

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
    const responseDataJson = response.body;
    expect(response.statusCode).toEqual(400);
    expect(responseDataJson).toEqual({
      error: true,
      id: 109,
      message: "Ticket was already refunded.",
      name: "TicketNotValidError",
    });
  });
  test("Sad path: fulfilling an already-fulfilled merch item fails", async () => {
    const conditionalError = new ConditionalCheckFailedException({
      message: "The conditional request failed",
      $metadata: {},
    });
    (conditionalError as any).Item = {
      stripe_pi: { S: "pi_3Q5GewDiGOXU9RuS16txRR5D" },
      email: { S: "testing0@illinois.edu" },
      fulfilled: { BOOL: true },
      refunded: { BOOL: false },
    };

    ddbMock.on(UpdateItemCommand).rejects(conditionalError);

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
    const responseDataJson = response.body;
    expect(response.statusCode).toEqual(400);
    expect(responseDataJson).toEqual({
      error: true,
      id: 109,
      message: "Ticket has already been used.",
      name: "TicketNotValidError",
    });
  });

  test("Sad path: merch item does not exist", async () => {
    const conditionalError = new ConditionalCheckFailedException({
      message: "The conditional request failed",
      $metadata: {},
    });

    ddbMock.on(UpdateItemCommand).rejects(conditionalError);

    const testJwt = createJwt();
    await app.ready();
    const response = await supertest(app.server)
      .post("/api/v1/tickets/checkIn")
      .set("authorization", `Bearer ${testJwt}`)
      .send({
        type: "merch",
        email: "nonexistent@illinois.edu",
        stripePi: "pi_nonexistent123456",
      });
    const responseDataJson = response.body;
    expect(response.statusCode).toEqual(404);
    expect(responseDataJson).toEqual({
      error: true,
      id: 108,
      message: "Ticket does not exist.",
      name: "TicketNotFoundError",
    });
  });

  test("Sad path: wrong email for merch item", async () => {
    const conditionalError = new ConditionalCheckFailedException({
      message: "The conditional request failed",
      $metadata: {},
    });
    (conditionalError as any).Item = {
      stripe_pi: { S: "pi_8J4NrYdA3S7cW8Ty92FnGJ6L" },
      email: { S: "testing1@illinois.edu" },
      fulfilled: { BOOL: false },
      refunded: { BOOL: false },
    };

    ddbMock.on(UpdateItemCommand).rejects(conditionalError);

    const testJwt = createJwt();
    await app.ready();
    const response = await supertest(app.server)
      .post("/api/v1/tickets/checkIn")
      .set("authorization", `Bearer ${testJwt}`)
      .send({
        type: "merch",
        email: "wrong@illinois.edu",
        stripePi: "pi_8J4NrYdA3S7cW8Ty92FnGJ6L",
      });
    const responseDataJson = response.body;
    expect(response.statusCode).toEqual(404);
    expect(responseDataJson).toEqual({
      error: true,
      id: 108,
      message: "Ticket does not exist.",
      name: "TicketNotFoundError",
    });
  });
});

describe("Test getting all issued tickets", async () => {
  test("Happy path: get all tickets", async () => {
    ddbMock
      .on(QueryCommand)
      .resolvesOnce({ Items: dynamoTableData })
      .resolvesOnce({});

    const testJwt = createJwt();
    await app.ready();
    const response = await supertest(app.server)
      .get("/api/v1/tickets/event/2024_fa_barcrawl?type=merch")
      .set("authorization", `Bearer ${testJwt}`);
    const responseDataJson = response.body;
    expect(response.statusCode).toEqual(200);
    expect(responseDataJson.tickets).toHaveLength(4);
    expect(responseDataJson.tickets).toEqual([
      {
        fulfilled: true,
        purchaserData: {
          email: "testing0@illinois.edu",
          productId: "2024_fa_barcrawl",
          quantity: 1,
          size: "M",
        },
        refunded: false,
        ticketId: "pi_3Q5GewDiGOXU9RuS16txRR5D",
        type: "merch",
        valid: true,
      },
      {
        fulfilled: false,
        purchaserData: {
          email: "testing1@illinois.edu",
          productId: "2024_fa_barcrawl",
          quantity: 3,
          size: "L",
        },
        refunded: false,
        ticketId: "pi_8J4NrYdA3S7cW8Ty92FnGJ6L",
        type: "merch",
        valid: true,
      },
      {
        fulfilled: false,
        purchaserData: {
          email: "testing2@illinois.edu",
          productId: "2024_fa_barcrawl",
          quantity: 3,
          size: "L",
        },
        refunded: true,
        ticketId: "pi_6T9QvUwR2IOj4CyF35DsXK7P",
        type: "merch",
        valid: true,
      },
      {
        fulfilled: true,
        purchaserData: {
          email: "testing2@illinois.edu",
          productId: "2024_fa_barcrawl",
          quantity: 1,
          size: "XS",
        },
        refunded: false,
        ticketId: "pi_5L8SwOdN9PXu6RyV83FgQK1C",
        totalPaid: 500,
        type: "merch",
        valid: true,
      },
    ]);
  });
  test("Sad path: fail on type 'ticket'", async () => {
    ddbMock.on(QueryCommand).rejects();

    const testJwt = createJwt();
    await app.ready();
    const response = await supertest(app.server)
      .get("/api/v1/tickets/event/2024_fa_barcrawl?type=ticket")
      .set("authorization", `Bearer ${testJwt}`);
    const responseDataJson = response.body;
    expect(response.statusCode).toEqual(400);
    expect(responseDataJson.id).toEqual(110);
  });
});

describe("Test getting user purchases", () => {
  const testEmail = "test@illinois.edu";
  const testUin = "123456789";
  const testProductId = "event-456";

  beforeEach(() => {
    // Mock the getUserIdByUin function
    vi.mock("../../src/api/functions/uin.js", () => ({
      getUserIdByUin: vi.fn(),
      getUinHash: vi.fn(),
      verifyUiucAccessToken: vi.fn(),
      getHashedUserUin: vi.fn(),
      saveHashedUserUin: vi.fn(),
    }));
  });

  test("Happy path: get all purchases for a user", async () => {
    const { getUserIdByUin } = await import("../../src/api/functions/uin.js");
    vi.mocked(getUserIdByUin).mockResolvedValueOnce({ id: testEmail });

    ddbMock
      .on(QueryCommand)
      .resolvesOnce({
        Items: [
          marshall({
            ticket_id: "ticket-123",
            event_id: testProductId,
            payment_method: "stripe",
            purchase_time: "2024-01-01T00:00:00Z",
            ticketholder_netid: testEmail,
            used: false,
          }),
        ],
      })
      .resolvesOnce({
        Items: [
          marshall({
            stripe_pi: "pi_123",
            email: testEmail,
            fulfilled: true,
            item_id: "merch-001",
            quantity: 2,
            refunded: false,
            size: "L",
            total_paid: 500,
          }),
        ],
      });

    const testJwt = createJwt();
    await app.ready();
    const response = await supertest(app.server)
      .post("/api/v1/tickets/getPurchasesByUser")
      .set("authorization", `Bearer ${testJwt}`)
      .send({ uin: testUin, productId: testProductId });

    const responseDataJson = response.body;
    expect(response.statusCode).toEqual(200);
    expect(responseDataJson).toHaveProperty("merch");
    expect(responseDataJson).toHaveProperty("tickets");
    expect(responseDataJson.tickets).toHaveLength(1);
    expect(responseDataJson.merch).toHaveLength(1);
    expect(responseDataJson.tickets[0]).toEqual({
      valid: true,
      type: "ticket",
      ticketId: "ticket-123",
      purchaserData: {
        email: testEmail,
        productId: testProductId,
        quantity: 1,
      },
      refunded: false,
      fulfilled: false,
    });
    expect(responseDataJson.merch[0]).toEqual({
      valid: false,
      type: "merch",
      ticketId: "pi_123",
      purchaserData: {
        email: testEmail,
        productId: "merch-001",
        quantity: 2,
        size: "L",
      },
      refunded: false,
      fulfilled: true,
      totalPaid: 500,
    });
  });

  test("Happy path: user with no purchases", async () => {
    const { getUserIdByUin } = await import("../../src/api/functions/uin.js");
    vi.mocked(getUserIdByUin).mockResolvedValueOnce({ id: testEmail });

    ddbMock
      .on(QueryCommand)
      .resolvesOnce({ Items: [] })
      .resolvesOnce({ Items: [] });

    const testJwt = createJwt();
    await app.ready();
    const response = await supertest(app.server)
      .post("/api/v1/tickets/getPurchasesByUser")
      .set("authorization", `Bearer ${testJwt}`)
      .send({ uin: testUin, productId: testProductId });

    const responseDataJson = response.body;
    expect(response.statusCode).toEqual(200);
    expect(responseDataJson).toEqual({
      merch: [],
      tickets: [],
    });
  });

  test("Happy path: user with only tickets", async () => {
    const { getUserIdByUin } = await import("../../src/api/functions/uin.js");
    vi.mocked(getUserIdByUin).mockResolvedValueOnce({ id: testEmail });

    ddbMock
      .on(QueryCommand)
      .resolvesOnce({
        Items: [
          marshall({
            ticket_id: "ticket-789",
            event_id: "event-101",
            payment_method: "stripe",
            purchase_time: "2024-01-02T00:00:00Z",
            ticketholder_netid: testEmail,
            used: true,
          }),
        ],
      })
      .resolvesOnce({ Items: [] });

    const testJwt = createJwt();
    await app.ready();
    const response = await supertest(app.server)
      .post("/api/v1/tickets/getPurchasesByUser")
      .set("authorization", `Bearer ${testJwt}`)
      .send({ uin: testUin, productId: testProductId });

    const responseDataJson = response.body;
    expect(response.statusCode).toEqual(200);
    expect(responseDataJson.tickets).toHaveLength(1);
    expect(responseDataJson.merch).toHaveLength(0);
  });

  test("Happy path: user with only merch", async () => {
    const { getUserIdByUin } = await import("../../src/api/functions/uin.js");
    vi.mocked(getUserIdByUin).mockResolvedValueOnce({ id: testEmail });

    ddbMock
      .on(QueryCommand)
      .resolvesOnce({ Items: [] })
      .resolvesOnce({
        Items: [
          marshall({
            stripe_pi: "pi_456",
            email: testEmail,
            fulfilled: false,
            item_id: "merch-002",
            quantity: 1,
            refunded: true,
            size: "M",
          }),
        ],
      });

    const testJwt = createJwt();
    await app.ready();
    const response = await supertest(app.server)
      .post("/api/v1/tickets/getPurchasesByUser")
      .set("authorization", `Bearer ${testJwt}`)
      .send({ uin: testUin, productId: testProductId });

    const responseDataJson = response.body;
    expect(response.statusCode).toEqual(200);
    expect(responseDataJson.tickets).toHaveLength(0);
    expect(responseDataJson.merch).toHaveLength(1);
  });

  test("Happy path: user with multiple purchases of each type", async () => {
    const { getUserIdByUin } = await import("../../src/api/functions/uin.js");
    vi.mocked(getUserIdByUin).mockResolvedValueOnce({ id: testEmail });

    ddbMock
      .on(QueryCommand)
      .resolvesOnce({
        Items: [
          marshall({
            ticket_id: "ticket-1",
            event_id: "event-1",
            payment_method: "stripe",
            purchase_time: "2024-01-01T00:00:00Z",
            ticketholder_netid: testEmail,
            used: false,
          }),
          marshall({
            ticket_id: "ticket-2",
            event_id: "event-2",
            payment_method: "stripe",
            purchase_time: "2024-01-02T00:00:00Z",
            ticketholder_netid: testEmail,
            used: true,
          }),
        ],
      })
      .resolvesOnce({
        Items: [
          marshall({
            stripe_pi: "pi_1",
            email: testEmail,
            fulfilled: true,
            item_id: "merch-1",
            quantity: 1,
            refunded: false,
            size: "S",
          }),
          marshall({
            stripe_pi: "pi_2",
            email: testEmail,
            fulfilled: false,
            item_id: "merch-2",
            quantity: 3,
            refunded: false,
            size: "XL",
          }),
        ],
      });

    const testJwt = createJwt();
    await app.ready();
    const response = await supertest(app.server)
      .post("/api/v1/tickets/getPurchasesByUser")
      .set("authorization", `Bearer ${testJwt}`)
      .send({ uin: testUin, productId: testProductId });

    const responseDataJson = response.body;
    expect(response.statusCode).toEqual(200);
    expect(responseDataJson.tickets).toHaveLength(2);
    expect(responseDataJson.merch).toHaveLength(2);
  });

  test("Happy path: productId filtering returns only matching items", async () => {
    const { getUserIdByUin } = await import("../../src/api/functions/uin.js");
    vi.mocked(getUserIdByUin).mockResolvedValueOnce({ id: testEmail });

    const filterProductId = "event-specific";

    ddbMock
      .on(QueryCommand)
      .resolvesOnce({
        Items: [
          marshall({
            ticket_id: "ticket-filtered",
            event_id: filterProductId,
            payment_method: "stripe",
            purchase_time: "2024-01-01T00:00:00Z",
            ticketholder_netid: testEmail,
            used: false,
          }),
        ],
      })
      .resolvesOnce({
        Items: [
          marshall({
            stripe_pi: "pi_filtered",
            email: testEmail,
            fulfilled: false,
            item_id: filterProductId,
            quantity: 1,
            refunded: false,
            size: "M",
          }),
        ],
      });

    const testJwt = createJwt();
    await app.ready();
    const response = await supertest(app.server)
      .post("/api/v1/tickets/getPurchasesByUser")
      .set("authorization", `Bearer ${testJwt}`)
      .send({ uin: testUin, productId: filterProductId });

    const responseDataJson = response.body;
    expect(response.statusCode).toEqual(200);
    expect(responseDataJson.tickets).toHaveLength(1);
    expect(responseDataJson.merch).toHaveLength(1);
    expect(responseDataJson.tickets[0].purchaserData.productId).toEqual(
      filterProductId,
    );
    expect(responseDataJson.merch[0].purchaserData.productId).toEqual(
      filterProductId,
    );
  });

  test("Sad path: invalid UIN format", async () => {
    const invalidUin = "not-a-uin";
    const testJwt = createJwt();
    await app.ready();
    const response = await supertest(app.server)
      .post("/api/v1/tickets/getPurchasesByUser")
      .set("authorization", `Bearer ${testJwt}`)
      .send({ uin: invalidUin, productId: testProductId });

    expect(response.statusCode).toEqual(400);
    expect(response.body).toHaveProperty("error");
  });

  test("Sad path: database error on tickets query", async () => {
    const { getUserIdByUin } = await import("../../src/api/functions/uin.js");
    vi.mocked(getUserIdByUin).mockResolvedValueOnce({ id: testEmail });

    ddbMock.on(QueryCommand).rejectsOnce(new Error("Database error"));

    const testJwt = createJwt();
    await app.ready();
    const response = await supertest(app.server)
      .post("/api/v1/tickets/getPurchasesByUser")
      .set("authorization", `Bearer ${testJwt}`)
      .send({ uin: testUin, productId: testProductId });

    expect(response.statusCode).toEqual(500);
    expect(response.body).toHaveProperty("error");
  });

  test("Sad path: database error on merch query", async () => {
    const { getUserIdByUin } = await import("../../src/api/functions/uin.js");
    vi.mocked(getUserIdByUin).mockResolvedValueOnce({ id: testEmail });

    ddbMock
      .on(QueryCommand)
      .resolvesOnce({ Items: [] })
      .rejectsOnce(new Error("Database error"));

    const testJwt = createJwt();
    await app.ready();
    const response = await supertest(app.server)
      .post("/api/v1/tickets/getPurchasesByUser")
      .set("authorization", `Bearer ${testJwt}`)
      .send({ uin: testUin, productId: testProductId });

    expect(response.statusCode).toEqual(500);
    expect(response.body).toHaveProperty("error");
  });
});

afterAll(async () => {
  await app.close();
  vi.useRealTimers();
});
beforeEach(() => {
  ddbMock.reset();
  vi.useFakeTimers();

  (app as any).redisClient.flushall();
  (app as any).redisClient.flushdb();
});
