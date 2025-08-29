import boto3
import os
import json
import logging
from typing import Any, Callable, Dict
from datetime import datetime

logger = logging.getLogger()
logger.setLevel(logging.INFO)
firehose_client = boto3.client("firehose")
deserializer = boto3.dynamodb.types.TypeDeserializer()

try:
    FIREHOSE_STREAM_NAME = os.environ["FIREHOSE_STREAM_NAME"]
except KeyError:
    # Fail fast if essential configuration is missing
    logger.error("The 'FIREHOSE_STREAM_NAME' environment variable is not set.")
    raise

TimestampMapper = Dict[str, Callable[[Dict[str, Any]], str]]

ARCHIVE_TIMESTAMP_MAPPER: TimestampMapper = {
    "infra-core-api-room-requests-status": lambda x: x["createdAt#status"].split("#")[0]
}


def deserialize_dynamodb_item(item):
    """
    Helper function to convert a DynamoDB-formatted item into a standard Python dictionary.
    Example: {'id': {'S': '123'}} -> {'id': '123'}
    """
    return {k: deserializer.deserialize(v) for k, v in item.items()}


def lambda_handler(event, context):
    firehose_records_to_send = []

    for record in event["Records"]:
        if (
            record.get("eventName") == "REMOVE"
            and record.get("userIdentity", {}).get("principalId")
            == "dynamodb.amazonaws.com"
        ):

            # 2. **Extract Table Name**: The table name is parsed from the event source ARN.
            #    This allows the function to work with streams from multiple tables.
            #    ARN format: arn:aws:dynamodb:region:account-id:table/TABLE_NAME/stream/...
            try:
                table_name = record["eventSourceARN"].split("/")[1]
            except (IndexError, AttributeError):
                logger.warning(
                    f"Could not parse table name from ARN: {record.get('eventSourceARN')}"
                )
                continue  # Skip this record if the ARN is malformed

            # 3. **Get and Deserialize Data**: The actual content of the expired record
            #    is in the 'OldImage' field of the stream event.
            old_image = record["dynamodb"].get("OldImage")
            if not old_image:
                continue  # Skip if there's no data to archive

            deserialized_data = deserialize_dynamodb_item(old_image)

            # 4. Construct the Payload
            payload = {
                "table": table_name,
                "data": deserialized_data,
                "timestamp": datetime.now().isoformat(),
            }
            if table_name in ARCHIVE_TIMESTAMP_MAPPER:
                try:
                    payload["timestamp"] = ARCHIVE_TIMESTAMP_MAPPER[table_name](
                        deserialized_data
                    )
                except Exception as e:
                    logger.error(
                        f"Failed to extract timestamp for record from {table_name}: {str(e)}. Using now as timestamp."
                    )

            firehose_records_to_send.append(
                {"Data": json.dumps(payload).encode("utf-8")}
            )

    # 6. **Send Records to Firehose**: If we found any TTL-expired records, send them.
    if firehose_records_to_send:
        logger.info(
            f"Found {len(firehose_records_to_send)} TTL-expired records to archive."
        )

        # The PutRecordBatch API has a limit of 500 records per call. We loop
        # in chunks of 500 to handle large events gracefully.
        for i in range(0, len(firehose_records_to_send), 500):
            batch = firehose_records_to_send[i : i + 500]
            try:
                response = firehose_client.put_record_batch(
                    DeliveryStreamName=FIREHOSE_STREAM_NAME, Records=batch
                )

                # Log any records that Firehose failed to ingest for monitoring purposes.
                # For critical applications, you could add logic here to retry failed records.
                if response.get("FailedPutCount", 0) > 0:
                    logger.error(
                        f"Failed to put {response['FailedPutCount']} records to Firehose."
                    )

            except Exception as e:
                logger.error(f"Error sending batch to Firehose: {e}")
                # Re-raising the exception will cause Lambda to retry the entire event batch,
                # which is a safe default behavior for transient errors.
                raise e
    else:
        logger.info("No TTL-expired records found in this event.")

    return {
        "statusCode": 200,
        "body": json.dumps(
            f"Successfully processed {len(firehose_records_to_send)} records."
        ),
    }
