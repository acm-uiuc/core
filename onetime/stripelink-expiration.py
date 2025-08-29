import boto3
import logging
from datetime import datetime, timezone, timedelta
from decimal import Decimal
from botocore.exceptions import ClientError

# --- Configuration ---
TABLE_NAME = "infra-core-api-stripe-links"
EXPIRY_DAYS_FROM_NOW = 30
# AWS credentials and region should be configured via environment variables,
# IAM roles, or the ~/.aws/credentials file.

# --- Logging Setup ---
logging.basicConfig(
    level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s"
)


def process_inactive_records():
    """
    Scans the table for records where 'active' is false and updates their
    'expiresAt' and 'updatedAt' attributes.
    """
    try:
        dynamodb = boto3.resource("dynamodb")
        table = dynamodb.Table(TABLE_NAME)

        # Calculate the target expiration timestamp (30 days from now)
        expires_at_dt = datetime.now(timezone.utc) + timedelta(
            days=EXPIRY_DAYS_FROM_NOW
        )
        expires_at_ts = int(expires_at_dt.timestamp())

        # Get the current timestamp for the 'updatedAt' field
        new_updated_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

        logging.info(
            f"Target expiration timestamp set to: {expires_at_ts} ({expires_at_dt.isoformat()})"
        )

        # Use a paginator to handle scanning tables of any size.
        # We filter on the server-side for items where 'active' is false.
        paginator = dynamodb.meta.client.get_paginator("scan")
        page_iterator = paginator.paginate(
            TableName=TABLE_NAME,
        )

        item_count = 0
        updated_count = 0
        logging.info(f"Starting scan for inactive records in table: {TABLE_NAME}")

        for page in page_iterator:
            for item in page.get("Items", []):
                item_count += 1

                # --- MODIFIED: Extract composite primary key ---
                partition_key = item.get("userId", None)
                sort_key = item.get("linkId", None)
                active_key = item.get("active", True)
                if active_key:
                    continue

                if not partition_key or not sort_key:
                    logging.warning(
                        f"Skipping item with missing composite key parts: {item}"
                    )
                    continue
                # --- END MODIFICATION ---

                # Prepare the update expression and values
                update_expression = "SET expiresAt = :ea, updatedAt = :ua"
                expression_attribute_values = {
                    # DynamoDB requires numbers to be passed as Decimal objects
                    ":ea": Decimal(expires_at_ts),
                    ":ua": new_updated_at,
                }

                # Update the item in DynamoDB
                try:
                    # --- MODIFIED: Use composite key in the Key parameter ---
                    table.update_item(
                        Key={"userId": partition_key, "linkId": sort_key},
                        UpdateExpression=update_expression,
                        ExpressionAttributeValues=expression_attribute_values,
                    )
                    # --- END MODIFICATION ---
                    updated_count += 1
                    logging.info(f"Updated item")
                except ClientError as e:
                    logging.error(
                        f"Failed to update item ({partition_key}, {sort_key}): {e}"
                    )

        logging.info("--- Script Finished ---")
        logging.info(f"Total inactive items found: {item_count}")
        logging.info(f"Total inactive items updated: {updated_count}")

    except ClientError as e:
        logging.critical(f"A critical AWS error occurred: {e}")
    except Exception as e:
        logging.critical(f"An unexpected error occurred: {e}")


if __name__ == "__main__":
    process_inactive_records()
