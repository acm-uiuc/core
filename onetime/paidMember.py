import json
import boto3
import logging
from botocore.exceptions import ClientError

# --- Configuration ---
SOURCE_TABLE_NAME = "infra-core-api-membership-provisioning"
DESTINATION_TABLE_NAME = "infra-core-api-user-info"

# --- Logging Setup ---
logging.basicConfig(
    level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s"
)


def migrate_uin_hashes():
    """
    Scans the source table for netId and uinHash mappings and updates
    the corresponding user records in the destination table.
    """
    try:
        dynamodb = boto3.resource("dynamodb")
        destination_table = dynamodb.Table(DESTINATION_TABLE_NAME)

        # A paginator is used to handle scanning tables of any size
        paginator = dynamodb.meta.client.get_paginator("scan")
        page_iterator = paginator.paginate(TableName=SOURCE_TABLE_NAME)

        scanned_count = 0
        updated_count = 0
        logging.info(
            f"Starting migration from '{SOURCE_TABLE_NAME}' to '{DESTINATION_TABLE_NAME}'"
        )

        for page in page_iterator:
            for item in page.get("Items", []):
                scanned_count += 1
                email = item.get("email")

                if not email:
                    logging.warning(f"Skipping item with missing 'email': {item}")
                    continue

                # Construct the primary key and update parameters for the destination table
                netId = email.replace("@illinois.edu", "")
                update_expression = "SET isPaidMember = :uh, netId = :ne"
                expression_attribute_values = {":uh": True, ":ne": netId}

                # Update the item in the destination DynamoDB table
                try:
                    destination_table.update_item(
                        Key={"id": email},
                        UpdateExpression=update_expression,
                        ExpressionAttributeValues=expression_attribute_values,
                    )
                    updated_count += 1
                    if updated_count % 100 == 0:
                        logging.info(
                            f"Scanned {scanned_count} items, updated {updated_count} so far..."
                        )
                except ClientError as e:
                    logging.error(f"Failed to update item with id '{email}': {e}")

        logging.info("--- Script Finished ---")
        logging.info(f"Total items scanned from source: {scanned_count}")
        logging.info(f"Total items updated in destination: {updated_count}")

    except ClientError as e:
        # This will catch errors like table not found, or credential issues
        logging.critical(f"A critical AWS error occurred: {e}")
    except Exception as e:
        logging.critical(f"An unexpected error occurred: {e}")


if __name__ == "__main__":
    migrate_uin_hashes()
