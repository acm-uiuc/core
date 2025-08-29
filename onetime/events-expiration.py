import json
import boto3
import time
import logging
from datetime import datetime, timezone
from decimal import Decimal
from botocore.exceptions import ClientError

# --- Configuration ---
TABLE_NAME = "infra-core-api-events"
EVENTS_EXPIRY_AFTER_LAST_OCCURRENCE_DAYS = 365 * 4

# --- Logging Setup ---
logging.basicConfig(
    level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s"
)


def parse_date_string(date_str: str) -> datetime | None:
    """
    Parses an ISO 8601 date string into a timezone-aware datetime object.
    Returns None if the string is invalid or empty.
    """
    if not date_str:
        return None
    try:
        if date_str.endswith("Z"):
            return datetime.fromisoformat(date_str.replace("Z", "+00:00"))
        dt_obj = datetime.fromisoformat(date_str)
        if dt_obj.tzinfo is None:
            return dt_obj.replace(tzinfo=timezone.utc)
        return dt_obj
    except ValueError:
        logging.warning(f"Could not parse invalid date string: {date_str}")
        return None


def determine_expires_at(event: dict) -> int | None:
    """
    Calculates the expiration timestamp based on the provided logic.
    The event dict should contain keys like 'repeats', 'repeatEnds', and 'end'.
    """
    if event.get("repeats") and not event.get("repeatEnds"):
        return None

    now_ts = int(time.time())
    expiry_offset_seconds = 86400 * EVENTS_EXPIRY_AFTER_LAST_OCCURRENCE_DAYS
    now_expiry = now_ts + expiry_offset_seconds

    end_attr_val = event.get("repeatEnds") if event.get("repeats") else event.get("end")

    if not end_attr_val:
        return now_expiry

    ends_dt = parse_date_string(end_attr_val)
    if not ends_dt:
        return now_expiry
    end_date_expiry = round(ends_dt.timestamp()) + expiry_offset_seconds

    return end_date_expiry


def process_table():
    """
    Scans the table and updates each item.
    """
    try:
        dynamodb = boto3.resource("dynamodb")
        table = dynamodb.Table(TABLE_NAME)

        # A paginator is used to handle scanning tables of any size
        paginator = dynamodb.meta.client.get_paginator("scan")
        page_iterator = paginator.paginate(TableName=TABLE_NAME)

        item_count = 0
        updated_count = 0
        logging.info(f"Starting to process table: {TABLE_NAME}")

        for page in page_iterator:
            for item in page.get("Items", []):
                item_count += 1
                pk_id = item.get("id", {})
                if not pk_id:
                    logging.warning(f"Skipping item with missing 'id': {item}")
                    continue

                # Prepare a simple dict for the logic function
                event_data = {
                    "repeats": item.get("repeats", {}),
                    "repeatEnds": item.get("repeatEnds", {}),
                    "end": item.get("end", {}),
                }

                expires_at_ts = determine_expires_at(event_data)

                # Prepare the update expression and values
                new_updated_at = (
                    datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
                )
                update_expression = "SET updatedAt = :ua"
                expression_attribute_values = {":ua": new_updated_at}

                if expires_at_ts is not None:
                    update_expression += ", expiresAt = :ea"
                    # DynamoDB requires numbers to be passed as Decimal objects
                    expression_attribute_values[":ea"] = Decimal(expires_at_ts)

                # Update the item in DynamoDB
                try:
                    table.update_item(
                        Key={"id": pk_id},
                        UpdateExpression=update_expression,
                        ExpressionAttributeValues=expression_attribute_values,
                    )
                    updated_count += 1
                    if updated_count % 100 == 0:
                        logging.info(
                            f"Processed {item_count} items, updated {updated_count} so far..."
                        )
                except ClientError as e:
                    logging.error(f"Failed to update item {pk_id}: {e}")

        logging.info("--- Script Finished ---")
        logging.info(f"Total items scanned: {item_count}")
        logging.info(f"Total items updated: {updated_count}")

    except ClientError as e:
        logging.critical(f"A critical AWS error occurred: {e}")
    except Exception as e:
        logging.critical(f"An unexpected error occurred: {e}")


if __name__ == "__main__":
    process_table()
