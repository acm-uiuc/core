import { afterAll, expect, test, beforeEach, vi, describe } from "vitest";
import init from "../../src/api/index.js";
import { mockClient } from "aws-sdk-client-mock";
import {
  DynamoDBClient,
  PutItemCommand,
  QueryCommand,
  ScanCommand,
  TransactWriteItemsCommand,
} from "@aws-sdk/client-dynamodb";
import supertest from "supertest";
import { createJwt } from "./auth.test.js";
import { v4 as uuidv4 } from "uuid";
import { marshall } from "@aws-sdk/util-dynamodb";
import { environmentConfig, genericConfig } from "../../src/common/config.js";
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import { AvailableSQSFunctions } from "../../src/common/types/sqsMessage.js";
import { RoomRequestStatus } from "../../src/common/types/roomRequest.js";

const ddbMock = mockClient(DynamoDBClient);
const sqsMock = mockClient(SQSClient);

const app = await init();
describe("Test Room Request Creation", async () => {
  const testRequestId = "test-request-id";
  const testSemesterId = "sp25";
  const statusBody = {
    status: RoomRequestStatus.APPROVED,
    notes: "Request approved by committee.",
  };
  const makeUrl = () =>
    `/api/v1/roomRequests/${testSemesterId}/${testRequestId}/status`;
  test("Unauthenticated access (missing token)", async () => {
    await app.ready();
    const response = await supertest(app.server)
      .post("/api/v1/roomRequests")
      .send({
        invoiceId: "ACM102",
        invoiceAmountUsd: 100,
        contactName: "John Doe",
        contactEmail: "john@example.com",
      });
    expect(response.statusCode).toBe(403);
  });
  test("Validation failure: Missing required fields", async () => {
    await app.ready();
    const testJwt = createJwt();
    const response = await supertest(app.server)
      .post("/api/v1/roomRequests")
      .set("authorization", `Bearer ${testJwt}`)
      .send({});
    expect(response.statusCode).toBe(400);
  });
  test("Virtual reservation request is accepted", async () => {
    await app.ready();
    const testJwt = createJwt();
    ddbMock.on(TransactWriteItemsCommand).resolvesOnce({}).rejects();
    const roomRequest = {
      host: "Infrastructure Committee",
      title: "Testing",
      theme: "Athletics",
      semester: "sp25",
      description: " f f f f f f  f f f f f  f f f ffffff",
      eventStart: "2025-04-24T18:00:30.679Z",
      eventEnd: "2025-04-24T19:00:30.679Z",
      isRecurring: false,
      setupNeeded: false,
      hostingMinors: false,
      locationType: "virtual",
      onCampusPartners: null,
      offCampusPartners: null,
      nonIllinoisSpeaker: null,
      nonIllinoisAttendees: null,
      foodOrDrink: false,
      crafting: false,
      comments: "",
    };
    const response = await supertest(app.server)
      .post("/api/v1/roomRequests")
      .set("authorization", `Bearer ${testJwt}`)
      .send(roomRequest);
    expect(response.statusCode).toBe(201);
    expect(ddbMock.calls().length).toEqual(1);
  });
  test("Hybrid reservation request is accepted", async () => {
    await app.ready();
    const testJwt = createJwt();
    ddbMock.on(TransactWriteItemsCommand).resolvesOnce({}).rejects();
    const roomRequest = {
      host: "Infrastructure Committee",
      title: "Testing",
      theme: "Athletics",
      semester: "sp25",
      description: " f f f f f f  f f f f f  f f f ffffff",
      eventStart: "2025-04-24T18:00:30.679Z",
      eventEnd: "2025-04-24T19:00:30.679Z",
      isRecurring: false,
      setupNeeded: false,
      hostingMinors: false,
      locationType: "both",
      spaceType: "campus_classroom",
      specificRoom: "None",
      estimatedAttendees: 10,
      seatsNeeded: 20,
      onCampusPartners: null,
      offCampusPartners: null,
      nonIllinoisSpeaker: null,
      nonIllinoisAttendees: null,
      foodOrDrink: false,
      crafting: false,
      comments: "",
    };
    const response = await supertest(app.server)
      .post("/api/v1/roomRequests")
      .set("authorization", `Bearer ${testJwt}`)
      .send(roomRequest);
    expect(response.statusCode).toBe(201);
    expect(ddbMock.calls().length).toEqual(1);
  });
  test("Validation failure: eventEnd before eventStart", async () => {
    const testJwt = createJwt();
    ddbMock.rejects();
    const response = await supertest(app.server)
      .post("/api/v1/roomRequests")
      .set("authorization", `Bearer ${testJwt}`)
      .send({
        host: "Infrastructure Committee",
        title: "Valid Title",
        semester: "sp25",
        theme: "Athletics",
        description: "This is a valid description with at least ten words.",
        eventStart: "2025-04-25T12:00:00Z",
        eventEnd: "2025-04-25T10:00:00Z",
        isRecurring: false,
        setupNeeded: false,
        hostingMinors: false,
        locationType: "virtual",
        foodOrDrink: false,
        crafting: false,
        onCampusPartners: null,
        offCampusPartners: null,
        nonIllinoisSpeaker: null,
        nonIllinoisAttendees: null,
      });
    expect(response.statusCode).toBe(400);
    expect(response.body.message).toContain(
      "End date/time must be after start date/time",
    );
    expect(ddbMock.calls.length).toEqual(0);
  });
  test("Validation failure: eventEnd equals eventStart", async () => {
    const testJwt = createJwt();
    ddbMock.rejects();
    const response = await supertest(app.server)
      .post("/api/v1/roomRequests")
      .set("authorization", `Bearer ${testJwt}`)
      .send({
        host: "Infrastructure Committee",
        title: "Valid Title",
        semester: "sp25",
        theme: "Athletics",
        description: "This is a valid description with at least ten words.",
        eventStart: "2025-04-25T10:00:00Z",
        eventEnd: "2025-04-25T10:00:00Z",
        isRecurring: false,
        setupNeeded: false,
        hostingMinors: false,
        locationType: "virtual",
        foodOrDrink: false,
        crafting: false,
        onCampusPartners: null,
        offCampusPartners: null,
        nonIllinoisSpeaker: null,
        nonIllinoisAttendees: null,
      });
    expect(response.statusCode).toBe(400);
    expect(response.body.message).toContain(
      "End date/time must be after start date/time",
    );
    expect(ddbMock.calls.length).toEqual(0);
  });
  test("Validation failure: isRecurring without recurrencePattern and endDate", async () => {
    const testJwt = createJwt();
    ddbMock.rejects();
    const response = await supertest(app.server)
      .post("/api/v1/roomRequests")
      .set("authorization", `Bearer ${testJwt}`)
      .send({
        host: "Infrastructure Committee",
        title: "Recurring Event",
        semester: "sp25",
        theme: "Athletics",
        description:
          "This description includes enough words to pass the test easily.",
        eventStart: "2025-04-25T12:00:00Z",
        eventEnd: "2025-04-25T13:00:00Z",
        isRecurring: true,
        setupNeeded: false,
        hostingMinors: false,
        locationType: "virtual",
        foodOrDrink: false,
        crafting: false,
        onCampusPartners: null,
        offCampusPartners: null,
        nonIllinoisSpeaker: null,
        nonIllinoisAttendees: null,
      });
    expect(response.statusCode).toBe(400);
    expect(response.body.message).toContain(
      "Please select a recurrence pattern",
    );
    expect(response.body.message).toContain(
      "Please select an end date for the recurring event",
    );
    expect(ddbMock.calls.length).toEqual(0);
  });
  test("Validation failure: setupNeeded is true without setupMinutesBefore", async () => {
    const testJwt = createJwt();
    ddbMock.rejects();

    const response = await supertest(app.server)
      .post("/api/v1/roomRequests")
      .set("authorization", `Bearer ${testJwt}`)
      .send({
        host: "Infrastructure Committee",
        title: "Setup Event",
        semester: "sp25",
        theme: "Athletics",
        description:
          "Wordy description that definitely contains more than ten words easily.",
        eventStart: "2025-04-25T12:00:00Z",
        eventEnd: "2025-04-25T13:00:00Z",
        isRecurring: false,
        setupNeeded: true,
        hostingMinors: false,
        locationType: "virtual",
        foodOrDrink: false,
        crafting: false,
        onCampusPartners: null,
        offCampusPartners: null,
        nonIllinoisSpeaker: null,
        nonIllinoisAttendees: null,
      });

    expect(response.statusCode).toBe(400);
    expect(response.body.message).toContain(
      "how many minutes before the event",
    );
    expect(ddbMock.calls()).toHaveLength(0);
  });
  test("Validation failure: in-person event missing spaceType, room, seats", async () => {
    const testJwt = createJwt();
    ddbMock.rejects();

    const response = await supertest(app.server)
      .post("/api/v1/roomRequests")
      .set("authorization", `Bearer ${testJwt}`)
      .send({
        host: "Infrastructure Committee",
        title: "Physical Event",
        semester: "sp25",
        theme: "Athletics",
        description:
          "This description has more than enough words to satisfy the validator.",
        eventStart: "2025-04-25T12:00:00Z",
        eventEnd: "2025-04-25T13:00:00Z",
        isRecurring: false,
        setupNeeded: false,
        hostingMinors: false,
        locationType: "in-person",
        foodOrDrink: false,
        crafting: false,
        onCampusPartners: null,
        offCampusPartners: null,
        nonIllinoisSpeaker: null,
        nonIllinoisAttendees: null,
      });

    expect(response.statusCode).toBe(400);
    expect(response.body.message).toContain("Please select a space type");
    expect(response.body.message).toContain(
      "Please provide details about the room location",
    );
    expect(response.body.message).toContain(
      "Please provide an estimated number of attendees",
    );
    expect(response.body.message).toContain(
      "Please specify how many seats you need",
    );
    expect(ddbMock.calls()).toHaveLength(0);
  });
  test("Validation failure: seatsNeeded < estimatedAttendees", async () => {
    const testJwt = createJwt();
    ddbMock.rejects();

    const response = await supertest(app.server)
      .post("/api/v1/roomRequests")
      .set("authorization", `Bearer ${testJwt}`)
      .send({
        host: "Infrastructure Committee",
        title: "Seats Mismatch",
        semester: "sp25",
        theme: "Athletics",
        description:
          "Description with lots of words to ensure it is long enough to pass validation.",
        eventStart: "2025-04-25T12:00:00Z",
        eventEnd: "2025-04-25T13:00:00Z",
        isRecurring: false,
        setupNeeded: false,
        hostingMinors: false,
        locationType: "in-person",
        spaceType: "campus_classroom",
        specificRoom: "Room 101",
        estimatedAttendees: 20,
        seatsNeeded: 10,
        foodOrDrink: false,
        crafting: false,
        onCampusPartners: null,
        offCampusPartners: null,
        nonIllinoisSpeaker: null,
        nonIllinoisAttendees: null,
      });

    expect(response.statusCode).toBe(400);
    expect(response.body.message).toContain(
      "Number of seats must be greater than or equal to number of attendees",
    );
    expect(ddbMock.calls()).toHaveLength(0);
  });
  test("Successful request writes 3 items to DynamoDB transaction", async () => {
    const testJwt = createJwt();

    ddbMock.on(TransactWriteItemsCommand).callsFake((input) => {
      expect(input.TransactItems).toHaveLength(3);

      const tableNames = input.TransactItems.map(
        (item: Record<string, any>) => Object.values(item)[0].TableName,
      );

      expect(tableNames).toEqual(
        expect.arrayContaining([
          genericConfig.RoomRequestsTableName,
          genericConfig.RoomRequestsStatusTableName,
          genericConfig.AuditLogTable,
        ]),
      );

      return { $metadata: { httpStatusCode: 200 } };
    });

    const roomRequest = {
      host: "Infrastructure Committee",
      title: "Valid Request",
      semester: "sp25",
      theme: "Athletics",
      description:
        "This is a valid request with enough words in the description field.",
      eventStart: new Date("2025-04-24T12:00:00Z"),
      eventEnd: new Date("2025-04-24T13:00:00Z"),
      isRecurring: false,
      setupNeeded: false,
      hostingMinors: false,
      locationType: "virtual",
      foodOrDrink: false,
      crafting: false,
      onCampusPartners: null,
      offCampusPartners: null,
      nonIllinoisSpeaker: null,
      nonIllinoisAttendees: null,
    };

    const response = await supertest(app.server)
      .post("/api/v1/roomRequests")
      .set("authorization", `Bearer ${testJwt}`)
      .send(roomRequest);

    expect(response.statusCode).toBe(201);
    expect(ddbMock.commandCalls(TransactWriteItemsCommand).length).toBe(1);
  });
  test("Successful request queues a message to SQS", async () => {
    const testJwt = createJwt();

    // Mock DynamoDB transaction success
    ddbMock.on(TransactWriteItemsCommand).resolves({});

    // Mock SQS response
    sqsMock.on(SendMessageCommand).resolves({ MessageId: "mocked-message-id" });

    const roomRequest = {
      host: "Infrastructure Committee",
      title: "Valid SQS Request",
      semester: "sp25",
      theme: "Athletics",
      description:
        "A well-formed description that has at least ten total words.",
      eventStart: "2025-04-24T12:00:00Z",
      eventEnd: "2025-04-24T13:00:00Z",
      isRecurring: false,
      setupNeeded: false,
      hostingMinors: false,
      locationType: "virtual",
      foodOrDrink: false,
      crafting: false,
      onCampusPartners: null,
      offCampusPartners: null,
      nonIllinoisSpeaker: null,
      nonIllinoisAttendees: null,
    };

    const response = await supertest(app.server)
      .post("/api/v1/roomRequests")
      .set("authorization", `Bearer ${testJwt}`)
      .send(roomRequest);

    expect(response.statusCode).toBe(201);
    expect(sqsMock.commandCalls(SendMessageCommand).length).toBe(1);

    const sent = sqsMock.commandCalls(SendMessageCommand)[0].args[0]
      .input as SendMessageCommand["input"];

    expect(sent.QueueUrl).toBe(environmentConfig["dev"].SqsQueueUrl);
    expect(JSON.parse(sent.MessageBody as string)).toMatchObject({
      function: AvailableSQSFunctions.EmailNotifications,
      payload: {
        subject: expect.stringContaining("New Room Reservation Request"),
      },
    });
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(() => {
    (app as any).nodeCache.flushAll();
    ddbMock.reset();
    sqsMock.reset();
    vi.clearAllMocks();
  });
  test("Unauthenticated access is rejected", async () => {
    await app.ready();
    const response = await supertest(app.server)
      .post(makeUrl())
      .send(statusBody);

    expect(response.statusCode).toBe(403);
  });

  test("Fails if request status with CREATED not found", async () => {
    const testJwt = createJwt();
    ddbMock.on(QueryCommand).resolves({ Count: 0, Items: [] });
    ddbMock.rejects(); // ensure no other writes
    await app.ready();
    const response = await supertest(app.server)
      .post(makeUrl())
      .set("authorization", `Bearer ${testJwt}`)
      .send(statusBody);

    expect(response.statusCode).toBe(500);
    expect(ddbMock.commandCalls(TransactWriteItemsCommand).length).toBe(0);
  });

  test("Fails if original request found but missing createdBy", async () => {
    const testJwt = createJwt();
    ddbMock.on(QueryCommand).resolves({
      Count: 1,
      Items: [marshall({})],
    });
    await app.ready();
    const response = await supertest(app.server)
      .post(makeUrl())
      .set("authorization", `Bearer ${testJwt}`)
      .send(statusBody);

    expect(response.statusCode).toBe(500);
    expect(response.body.message).toContain(
      "Could not find original reservation requestor",
    );
  });

  test("Creates status update with audit log in DynamoDB", async () => {
    const testJwt = createJwt();

    ddbMock.on(QueryCommand).resolves({
      Count: 1,
      Items: [marshall({ createdBy: "originalUser" })],
    });

    ddbMock.on(TransactWriteItemsCommand).callsFake((input) => {
      expect(input.TransactItems).toHaveLength(2);

      const tableNames = input.TransactItems.map(
        (item: Record<string, any>) => Object.values(item)[0].TableName,
      );

      expect(tableNames).toEqual(
        expect.arrayContaining([
          genericConfig.RoomRequestsStatusTableName,
          genericConfig.AuditLogTable,
        ]),
      );

      return { $metadata: { httpStatusCode: 200 } };
    });

    sqsMock.on(SendMessageCommand).resolves({ MessageId: "sqs-message-id" });
    await app.ready();
    const response = await supertest(app.server)
      .post(makeUrl())
      .set("authorization", `Bearer ${testJwt}`)
      .send(statusBody);

    expect(response.statusCode).toBe(201);
    expect(ddbMock.commandCalls(TransactWriteItemsCommand).length).toBe(1);
  });

  test("Queues SQS notification after status update", async () => {
    const testJwt = createJwt();

    ddbMock.on(QueryCommand).resolves({
      Count: 1,
      Items: [marshall({ createdBy: "originalUser" })],
    });

    ddbMock.on(TransactWriteItemsCommand).resolves({});

    sqsMock.on(SendMessageCommand).resolves({ MessageId: "mock-sqs-id" });
    await app.ready();
    const response = await supertest(app.server)
      .post(makeUrl())
      .set("authorization", `Bearer ${testJwt}`)
      .send(statusBody);

    expect(response.statusCode).toBe(201);
    expect(sqsMock.commandCalls(SendMessageCommand).length).toBe(1);

    const sent = sqsMock.commandCalls(SendMessageCommand)[0].args[0]
      .input as SendMessageCommand["input"];

    const body = JSON.parse(sent.MessageBody as string);
    expect(body.function).toBe(AvailableSQSFunctions.EmailNotifications);
    expect(body.payload.subject).toContain(
      "Room Reservation Request Status Change",
    );
    expect(body.payload.to).toEqual(["originalUser"]);
  });
});
