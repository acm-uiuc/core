
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { FirehoseClient, PutRecordBatchCommand } from '@aws-sdk/client-firehose';
import { marshall } from '@aws-sdk/util-dynamodb';
import type { DynamoDBStreamEvent, Context } from 'aws-lambda';

const firehoseMock = mockClient(FirehoseClient);

describe('DynamoDB TTL Archiver Lambda Handler', () => {
  const MOCK_STREAM_NAME = 'my-test-firehose-stream';
  const MOCK_CONTEXT = {} as Context;
  let handler: (event: DynamoDBStreamEvent, context: Context) => Promise<any>;

  const createMockEvent = (records: any[]): DynamoDBStreamEvent => ({
    Records: records.map((record) => ({
      eventName: 'REMOVE',
      userIdentity: { principalId: 'dynamodb.amazonaws.com', type: 'Service' },
      eventSourceARN: `arn:aws:dynamodb:us-east-1:123456789012:table/${record.tableName}/stream/2025-01-01T00:00:00.000`,
      dynamodb: record.data ? { OldImage: marshall(record.data) } : {},
      ...record.overrides,
    })),
  });


  beforeEach(async () => {
    vi.resetModules();
    firehoseMock.reset();
    vi.stubEnv("FIREHOSE_STREAM_NAME", MOCK_STREAM_NAME);
    const module = await import('../../../src/archival/dynamoStream.js');
    handler = module.handler;
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-08-30T10:00:00.000Z'));
    vi.spyOn(console, 'info').mockImplementation(() => { });
    vi.spyOn(console, 'warn').mockImplementation(() => { });
    vi.spyOn(console, 'error').mockImplementation(() => { });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });


  it('should process a single TTL record and send it to Firehose', async () => {
    firehoseMock.on(PutRecordBatchCommand).resolves({ FailedPutCount: 0 });
    const event = createMockEvent([
      {
        tableName: 'some-generic-table',
        data: { id: '123', value: 'data' },
      },
    ]);

    await handler(event, MOCK_CONTEXT);

    const commandCalls = firehoseMock.commandCalls(PutRecordBatchCommand);
    expect(commandCalls).toHaveLength(1);
    const commandInput = commandCalls[0].args[0].input;

    expect(commandInput.DeliveryStreamName).toBe(MOCK_STREAM_NAME);
    expect(commandInput.Records).toHaveLength(1);

    const payload = JSON.parse(commandInput.Records![0].Data!.toString());
    expect(payload).toEqual({
      id: '123',
      value: 'data',
      __infra_archive_resource: 'some-generic-table',
      __infra_archive_timestamp: '2025-08-30T10:00:00Z',
    });
  });

  it('should apply custom timestamp mapping for a matching table', async () => {
    firehoseMock.on(PutRecordBatchCommand).resolves({ FailedPutCount: 0 });
    const event = createMockEvent([
      {
        tableName: 'infra-core-api-room-requests-status',
        data: { id: 'req-1', 'createdAt#status': '2025-05-20T18:30:00.123Z#PENDING' },
      },
      {
        tableName: 'infra-core-api-audit-log',
        data: { id: 'audit-1', createdAt: 1715340600 }, // Corresponds to 2024-05-10T11:30:00.000Z
      },
    ]);

    await handler(event, MOCK_CONTEXT);

    const commandCalls = firehoseMock.commandCalls(PutRecordBatchCommand);
    expect(commandCalls).toHaveLength(1);
    const records = commandCalls[0].args[0].input.Records;

    expect(records).toHaveLength(2);
    const payload1 = JSON.parse(records![0].Data!.toString());
    const payload2 = JSON.parse(records![1].Data!.toString());

    expect(payload1.__infra_archive_timestamp).toBe('2025-05-20T18:30:00Z');
    expect(payload2.__infra_archive_timestamp).toBe('2024-05-10T11:30:00Z');
  });

  it('should fall back to "now" if a custom timestamp mapper fails', async () => {
    firehoseMock.on(PutRecordBatchCommand).resolves({ FailedPutCount: 0 });
    const event = createMockEvent([
      {
        tableName: 'infra-core-api-room-requests-status',
        data: { id: 'req-1', 'invalid-field': 'some-value' },
      },
    ]);

    await handler(event, MOCK_CONTEXT);

    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("Failed to extract timestamp for record from infra-core-api-room-requests-status")
    );

    const commandCalls = firehoseMock.commandCalls(PutRecordBatchCommand);
    const payload = JSON.parse(commandCalls![0].args![0].input.Records![0].Data!.toString());
    expect(payload.__infra_archive_timestamp).toBe('2025-08-30T10:00:00Z');
  });

  it('should correctly batch records into chunks of 500 for Firehose', async () => {
    firehoseMock.on(PutRecordBatchCommand).resolves({ FailedPutCount: 0 });
    const records = Array.from({ length: 501 }, (_, i) => ({
      tableName: 'large-table',
      data: { id: `item-${i}` },
    }));
    const event = createMockEvent(records);

    await handler(event, MOCK_CONTEXT);

    const commandCalls = firehoseMock.commandCalls(PutRecordBatchCommand);
    expect(commandCalls).toHaveLength(2);
    expect(commandCalls[0].args[0].input.Records).toHaveLength(500);
    expect(commandCalls[1].args[0].input.Records).toHaveLength(1);
    expect(console.info).toHaveBeenCalledWith('Found 501 TTL-expired records to archive.');
  });

  it('should ignore non-REMOVE events and not call Firehose', async () => {
    const event = createMockEvent([
      {
        tableName: 'some-table',
        data: { id: '1' },
        overrides: { eventName: 'INSERT' },
      },
    ]);

    await handler(event, MOCK_CONTEXT);

    expect(firehoseMock.commandCalls(PutRecordBatchCommand)).toHaveLength(0);
    expect(console.info).toHaveBeenCalledWith('No TTL-expired records found in this event.');
  });

  it('should ignore REMOVE events not from the TTL service', async () => {
    const event = createMockEvent([
      {
        tableName: 'some-table',
        data: { id: '1' },
        overrides: { userIdentity: { principalId: 'some-user', type: 'IAMUser' } },
      },
    ]);

    await handler(event, MOCK_CONTEXT);

    expect(firehoseMock.commandCalls(PutRecordBatchCommand)).toHaveLength(0);
  });

  it('should log an error if Firehose reports failed records but not throw', async () => {
    firehoseMock.on(PutRecordBatchCommand).resolves({ FailedPutCount: 5 });
    const event = createMockEvent([{ tableName: 'some-table', data: { id: '1' } }]);

    await handler(event, MOCK_CONTEXT);

    expect(firehoseMock.commandCalls(PutRecordBatchCommand)).toHaveLength(1);
    expect(console.error).toHaveBeenCalledWith('Failed to put 5 records to Firehose.');
  });

  it('should throw an error if the Firehose client throws an exception', async () => {
    const firehoseError = new Error('Firehose service is unavailable');
    firehoseMock.on(PutRecordBatchCommand).rejects(firehoseError);
    const event = createMockEvent([{ tableName: 'some-table', data: { id: '1' } }]);

    await expect(handler(event, MOCK_CONTEXT)).rejects.toThrow('Firehose service is unavailable');

    expect(console.error).toHaveBeenCalledWith('Error sending batch to Firehose: Firehose service is unavailable');
  });

});
