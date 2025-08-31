import boto3
import json
import logging
import os
from decimal import Decimal

# --- Configuration ---
logging.basicConfig(
    level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s"
)

AWS_REGION = os.environ.get("AWS_REGION", "us-east-1")
DYNAMODB_TABLE_NAME = "infra-core-api-audit-log"
FIREHOSE_STREAM_NAME = "infra-core-api-audit-log-stream"

# The top-level attributes to include in the JSON record for Firehose
REQUIRED_KEYS = ["module", "createdAt", "actor", "message", "requestId", "target"]

# Kinesis Data Firehose has a batch limit of 500 records per call.
FIREHOSE_BATCH_SIZE = 500

# --- CORRECTED: Primary key configuration based on your schema. ---
DYNAMODB_PRIMARY_KEY_ATTRIBUTES = ["module", "createdAt"]


class DecimalEncoder(json.JSONEncoder):
    """A helper class to convert DynamoDB's Decimal type to standard int/float for JSON."""

    def default(self, obj):
        if isinstance(obj, Decimal):
            return int(obj) if obj % 1 == 0 else float(obj)
        return super(DecimalEncoder, self).default(obj)


def _process_and_delete_batch(
    firehose_batch, dynamodb_items_batch, firehose_client, dynamodb_table
):
    """
    Sends a batch of records to Firehose and deletes the successful ones from DynamoDB.
    Returns the count of records successfully sent and deleted.
    """
    if not firehose_batch:
        return 0, 0

    sent_count = 0
    deleted_count = 0

    try:
        # 1. Send the entire batch to Firehose
        response = firehose_client.put_record_batch(
            DeliveryStreamName=FIREHOSE_STREAM_NAME, Records=firehose_batch
        )

        failed_put_count = response.get("FailedPutCount", 0)
        if failed_put_count > 0:
            logging.warning(
                f"{failed_put_count} of {len(firehose_batch)} records failed to be "
                "sent to Firehose in this batch. They will not be deleted."
            )

        # 2. Identify successful records and prepare their keys for deletion
        keys_to_delete = []
        for i, record_response in enumerate(response.get("RequestResponses", [])):
            original_item = dynamodb_items_batch[i]
            request_id = original_item.get("requestId", "N/A")

            if "ErrorCode" in record_response:
                # This record failed, log the error and skip deletion
                logging.error(
                    f"Failed to send record {request_id} to Firehose: "
                    f"{record_response.get('ErrorCode')} - {record_response.get('ErrorMessage')}"
                )
            else:
                # This record succeeded, add its primary key to the deletion list
                try:
                    primary_key = {
                        key: original_item[key]
                        for key in DYNAMODB_PRIMARY_KEY_ATTRIBUTES
                    }
                    keys_to_delete.append(primary_key)
                except KeyError as ke:
                    logging.error(
                        f"Sent record {request_id} but cannot delete. "
                        f"Missing primary key attribute in item: {ke}. "
                        "Please check DYNAMODB_PRIMARY_KEY_ATTRIBUTES configuration."
                    )

        sent_count = len(keys_to_delete)

        # 3. Use a batch_writer to efficiently delete all successful records from DynamoDB
        if keys_to_delete:
            with dynamodb_table.batch_writer() as batch:
                for key in keys_to_delete:
                    batch.delete_item(Key=key)
            deleted_count = len(keys_to_delete)
            logging.info(
                f"Successfully sent and deleted {deleted_count} records in this batch."
            )

    except Exception as e:
        logging.error(f"A fatal error occurred while processing a batch: {e}")
        # In case of a total batch failure, nothing is sent or deleted.
        return 0, 0

    return sent_count, deleted_count


def process_send_and_delete_logs():
    """
    Scans a DynamoDB table, sends items in batches to Kinesis Data Firehose,
    and deletes successfully processed items from the DynamoDB table.
    """
    if not DYNAMODB_PRIMARY_KEY_ATTRIBUTES:
        logging.error(
            "Configuration error: DYNAMODB_PRIMARY_KEY_ATTRIBUTES is not set."
        )
        return

    try:
        dynamodb = boto3.resource("dynamodb", region_name=AWS_REGION)
        table = dynamodb.Table(DYNAMODB_TABLE_NAME)
        firehose = boto3.client("firehose", region_name=AWS_REGION)

        total_sent_count = 0
        total_deleted_count = 0
        logging.info(
            f"Starting scan of '{DYNAMODB_TABLE_NAME}' to process in batches of {FIREHOSE_BATCH_SIZE}..."
        )

        firehose_batch = []
        dynamodb_items_batch = []
        scan_kwargs = {}
        done = False
        start_key = None

        while not done:
            if start_key:
                scan_kwargs["ExclusiveStartKey"] = start_key

            response = table.scan(**scan_kwargs)
            items = response.get("Items", [])

            for item in items:
                # Build the record for the Firehose batch
                output_record = {key: item.get(key) for key in REQUIRED_KEYS}
                payload = (json.dumps(output_record, cls=DecimalEncoder) + "\n").encode(
                    "utf-8"
                )
                firehose_batch.append({"Data": payload})

                # Keep the original item to get its primary key for deletion later
                dynamodb_items_batch.append(item)

                # If the batch is full, process it
                if len(firehose_batch) >= FIREHOSE_BATCH_SIZE:
                    sent, deleted = _process_and_delete_batch(
                        firehose_batch, dynamodb_items_batch, firehose, table
                    )
                    total_sent_count += sent
                    total_deleted_count += deleted
                    # Clear the batches for the next set of records
                    firehose_batch = []
                    dynamodb_items_batch = []

            start_key = response.get("LastEvaluatedKey", None)
            done = start_key is None

        # Process any remaining records that are left over after the loop finishes
        if firehose_batch:
            logging.info(
                f"Processing the final batch of {len(firehose_batch)} records..."
            )
            sent, deleted = _process_and_delete_batch(
                firehose_batch, dynamodb_items_batch, firehose, table
            )
            total_sent_count += sent
            total_deleted_count += deleted

        logging.info(
            f"Scan complete. Total records sent: {total_sent_count}. "
            f"Total records deleted: {total_deleted_count}."
        )

    except (
        boto3.client("dynamodb").exceptions.ResourceNotFoundException,
        dynamodb.meta.client.exceptions.ResourceNotFoundException,
    ):
        logging.error(f"Error: DynamoDB table '{DYNAMODB_TABLE_NAME}' not found.")
    except firehose.exceptions.ResourceNotFoundException:
        logging.error(f"Error: Firehose stream '{FIREHOSE_STREAM_NAME}' not found.")
    except Exception as e:
        logging.error(f"An unexpected error occurred: {e}")


if __name__ == "__main__":
    process_send_and_delete_logs()
