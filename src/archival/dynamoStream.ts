/* eslint-disable no-console */
import {
  FirehoseClient,
  PutRecordBatchCommand,
} from "@aws-sdk/client-firehose";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import type { DynamoDBStreamEvent, Context } from "aws-lambda";
import { AttributeValue } from "@aws-sdk/client-dynamodb";

const firehoseClient = new FirehoseClient({});

const FIREHOSE_STREAM_NAME = process.env.FIREHOSE_STREAM_NAME;

if (!FIREHOSE_STREAM_NAME) {
  console.error("The 'FIREHOSE_STREAM_NAME' environment variable is not set.");
  throw new Error("'FIREHOSE_STREAM_NAME' is not set.");
}

const toUtcIsoStringWithoutMillis = (date: Date): string => {
  return `${date.toISOString().slice(0, 19)}Z`;
};

/**
 * Defines a map where keys are DynamoDB table names and values are functions
 * that extract a meaningful timestamp from a record. The function should
 * return a value parseable by the `Date` constructor (e.g., ISO 8601 string or epoch milliseconds).
 */
const ARCHIVE_TIMESTAMP_MAPPER: Record<
  string,
  (record: Record<string, any>) => string | number
> = {
  "infra-core-api-room-requests-status": (record) =>
    record["createdAt#status"].split("#")[0],
  "infra-core-api-events": (record) => record.createdAt,
  "infra-core-api-audit-log": (record) => record.createdAt * 1000, // Convert Unix seconds to milliseconds
};

export const handler = async (
  event: DynamoDBStreamEvent,
  _context: Context,
): Promise<any> => {
  const firehoseRecordsToSend: { Data: Buffer }[] = [];

  for (const record of event.Records) {
    // 1. **Filter for TTL Deletions**: We only care about `REMOVE` events initiated by DynamoDB's TTL service.
    if (
      record.eventName === "REMOVE" &&
      record.userIdentity?.principalId === "dynamodb.amazonaws.com"
    ) {
      // 2. **Extract Table Name**: The table name is parsed from the event source ARN.
      //    ARN format: arn:aws:dynamodb:region:account-id:table/TABLE_NAME/stream/...
      const tableName = record.eventSourceARN?.split("/")[1];
      if (!tableName) {
        console.warn(
          `Could not parse table name from ARN: ${record.eventSourceARN}`,
        );
        continue; // Skip this record if the ARN is malformed
      }

      // 3. **Get and Deserialize Data**: The content of the expired record is in 'OldImage'.
      const oldImage = record.dynamodb?.OldImage;
      if (!oldImage) {
        continue; // Skip if there's no data to archive
      }

      // The `unmarshall` utility converts the DynamoDB format to a standard JavaScript object.
      const deserializedData = unmarshall(
        oldImage as { [key: string]: AttributeValue },
      );

      // 4. **Construct the Payload**: Add metadata to the original record data.
      const payload: Record<string, any> = {
        ...deserializedData,
        __infra_archive_resource: tableName,
        __infra_archive_timestamp: toUtcIsoStringWithoutMillis(new Date()), // Default timestamp is 'now'
      };

      // 5. **Apply Custom Timestamp**: If a specific timestamp extractor is defined for this table, use it.
      if (tableName in ARCHIVE_TIMESTAMP_MAPPER) {
        try {
          const timestampSource =
            ARCHIVE_TIMESTAMP_MAPPER[tableName](deserializedData);
          payload.__infra_archive_timestamp = toUtcIsoStringWithoutMillis(
            new Date(timestampSource),
          );
        } catch (e) {
          const error = e instanceof Error ? e.message : String(e);
          console.error(
            `Failed to extract timestamp for record from ${tableName}: ${error}. Using 'now' as timestamp.`,
          );
        }
      }

      firehoseRecordsToSend.push({
        Data: Buffer.from(JSON.stringify(payload)),
      });
    }
  }

  // 6. **Send Records to Firehose**: If we found any TTL-expired records, send them.
  if (firehoseRecordsToSend.length > 0) {
    console.info(
      `Found ${firehoseRecordsToSend.length} TTL-expired records to archive.`,
    );

    // The PutRecordBatch API has a limit of 500 records per call. We loop
    // in chunks of 500 to handle large events gracefully.
    for (let i = 0; i < firehoseRecordsToSend.length; i += 500) {
      const batch = firehoseRecordsToSend.slice(i, i + 500);
      try {
        const command = new PutRecordBatchCommand({
          DeliveryStreamName: FIREHOSE_STREAM_NAME,
          Records: batch,
        });
        const response = await firehoseClient.send(command);

        // Log any records that Firehose failed to ingest for monitoring purposes.
        if (response.FailedPutCount && response.FailedPutCount > 0) {
          console.error(
            `Failed to put ${response.FailedPutCount} records to Firehose.`,
          );
          // For critical apps, you could inspect `response.RequestResponses` for details.
        }
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e);
        console.error(`Error sending batch to Firehose: ${error}`);
        // Re-throwing the exception will cause Lambda to retry the entire event batch.
        throw e;
      }
    }
  } else {
    console.info("No TTL-expired records found in this event.");
  }

  return {
    statusCode: 200,
    body: JSON.stringify(
      `Successfully processed ${firehoseRecordsToSend.length} records.`,
    ),
  };
};
