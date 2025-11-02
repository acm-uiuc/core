import json
import boto3
import urllib.parse
from typing import Dict, Any, Optional
import logging

# Configure logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

# Initialize AWS clients
dynamodb = boto3.client("dynamodb")
s3 = boto3.client("s3")


def lambda_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    Lambda function to handle S3 upload events and update DynamoDB.

    Expects S3 object metadata:
    - dynamoTable: DynamoDB table name
    - dynamoPrimaryKey: JSON string of primary key
    - dynamoAttribute: Target attribute name to set with value from pending attribute
    - dynamopendingattribute: Source pending attribute name to remove
    """
    try:
        # Process each S3 event record
        for record in event["Records"]:
            process_s3_record(record)

        return {
            "statusCode": 200,
            "body": json.dumps("Successfully processed S3 events"),
        }

    except Exception as e:
        logger.error(f"Error processing S3 event: {str(e)}", exc_info=True)
        raise


def process_s3_record(record: Dict[str, Any]) -> None:
    """Process a single S3 event record."""

    # Extract S3 event details
    bucket = record["s3"]["bucket"]["name"]
    key = urllib.parse.unquote_plus(record["s3"]["object"]["key"])

    logger.info(f"Processing upload for bucket={bucket}, key={key}")

    # Get object metadata
    metadata = get_object_metadata(bucket, key)

    if not metadata:
        logger.warning(f"No metadata found for object {key}. Skipping DynamoDB update.")
        return

    # Extract required metadata fields
    dynamo_table = metadata.get("dynamotable")
    dynamo_primary_key_json = metadata.get("dynamoprimarykey")
    dynamo_attribute = metadata.get("dynamoattribute")
    dynamo_pending_attribute = metadata.get("dynamopendingattribute")

    # Validate required metadata - exit early if any are missing
    if not dynamo_table:
        logger.warning(f"Missing dynamoTable metadata for {key}")
        return

    if not dynamo_primary_key_json:
        logger.warning(f"Missing dynamoPrimaryKey metadata for {key}")
        return

    if not dynamo_attribute:
        logger.warning(f"Missing dynamoAttribute metadata for {key}")
        return

    if not dynamo_pending_attribute:
        logger.warning(f"Missing dynamopendingattribute metadata for {key}")
        return

    # Parse primary key
    try:
        primary_key = json.loads(dynamo_primary_key_json)
    except json.JSONDecodeError as e:
        logger.error(f"Failed to parse dynamoPrimaryKey JSON: {e}")
        return

    # Update DynamoDB - all variables are guaranteed to be strings now
    update_dynamodb(
        table_name=dynamo_table,
        primary_key=primary_key,
        target_attribute=dynamo_attribute,
        pending_attribute=dynamo_pending_attribute,
    )

    logger.info(f"Successfully updated DynamoDB for {key}")


def get_object_metadata(bucket: str, key: str) -> Optional[Dict[str, str]]:
    """Retrieve metadata from S3 object."""
    try:
        response = s3.head_object(Bucket=bucket, Key=key)
        return response.get("Metadata", {})
    except Exception as e:
        logger.error(f"Error getting metadata for {bucket}/{key}: {str(e)}")
        return None


def update_dynamodb(
    table_name: str,
    primary_key: Dict[str, str],
    target_attribute: str,
    pending_attribute: str,
) -> None:
    """
    Update DynamoDB item, moving value from pending attribute to target attribute.

    Args:
        table_name: DynamoDB table name
        primary_key: Primary key as dict (e.g., {"requestId": "123", "createdAt#status": "..."})
        target_attribute: The confirmed attribute name (e.g., "attachmentS3key")
        pending_attribute: The pending attribute name (e.g., "pendingAttachmentS3key")
    """

    # Convert primary key to DynamoDB format
    dynamo_key = {k: {"S": v} for k, v in primary_key.items()}

    try:
        # Build update expression to move pending attribute value to target attribute
        # SET target = pending, REMOVE pending
        update_expression = "SET #target = #pending REMOVE #pending"

        expression_attribute_names = {
            "#target": target_attribute,
            "#pending": pending_attribute,
        }

        # Condition: pending attribute should exist and equal the uploaded s3 key
        condition_expression = (
            "attribute_exists(#pending) AND #pending = :expected_s3key"
        )

        dynamodb.update_item(
            TableName=table_name,
            Key=dynamo_key,
            UpdateExpression=update_expression,
            ExpressionAttributeNames=expression_attribute_names,
            ConditionExpression=condition_expression,
            ReturnValues="ALL_NEW",
        )

        logger.info(
            f"Updated DynamoDB table={table_name}, "
            f"key={primary_key}, "
            f"moved value from {pending_attribute} to {target_attribute}"
        )

    except dynamodb.exceptions.ConditionalCheckFailedException:
        logger.info(
            f"Skipping update for {table_name} with key {primary_key}. "
            f"This is expected if the file was already confirmed or uploaded without metadata."
        )
    except Exception as e:
        logger.error(
            f"Error updating DynamoDB table={table_name}, key={primary_key}: {str(e)}",
            exc_info=True,
        )
        raise
