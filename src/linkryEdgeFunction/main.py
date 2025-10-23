import json
import os
import boto3
from botocore.exceptions import ClientError

DEFAULT_AWS_REGION = "us-east-2"
AVAILABLE_REPLICAS = [
    "us-west-2",
]
DYNAMODB_TABLE = "infra-core-api-linkry"
FALLBACK_URL = os.environ.get("FALLBACK_URL", "https://acm.illinois.edu/404")
LINKRY_HOME_URL = os.environ.get(
    "LINKRY_HOME_URL", "https://core.acm.illinois.edu/linkry"
)
CACHE_TTL = "30"  # seconds to hold response in PoP


def select_replica(lambda_region):
    """Determine which DynamoDB replica to use based on Lambda execution region"""
    # First check if Lambda is running in a replica region
    if lambda_region in AVAILABLE_REPLICAS:
        return lambda_region

    # Otherwise, find nearest replica by region prefix matching
    region_prefix = "-".join(lambda_region.split("-")[:2])
    if region_prefix == "us":
        return DEFAULT_AWS_REGION

    for replica in AVAILABLE_REPLICAS:
        if replica.startswith(region_prefix):
            return replica

    return DEFAULT_AWS_REGION


current_region = os.environ.get("AWS_REGION", "us-east-2")
target_region = select_replica(current_region)
dynamodb = boto3.client("dynamodb", region_name=target_region)

print(f"Lambda in {current_region}, routing DynamoDB to {target_region}")


def handler(event, context):
    request = event["Records"][0]["cf"]["request"]
    path = request["uri"].lstrip("/")

    print(f"Processing path: {path}")

    if not path:
        return {
            "status": "301",
            "statusDescription": "Moved Permanently",
            "headers": {
                "location": [{"key": "Location", "value": LINKRY_HOME_URL}],
                "cache-control": [
                    {"key": "Cache-Control", "value": f"public, max-age={CACHE_TTL}"}
                ],
            },
        }

    # Query DynamoDB for records with PK=path and SK starting with "OWNER#"
    try:
        response = dynamodb.query(
            TableName=DYNAMODB_TABLE,
            KeyConditionExpression="slug = :slug AND begins_with(access, :owner_prefix)",
            ExpressionAttributeValues={
                ":slug": {"S": path},
                ":owner_prefix": {"S": "OWNER#"},
            },
            ProjectionExpression="redirect",
            Limit=1,  # We only need one result
        )

        if response.get("Items") and len(response["Items"]) > 0:
            item = response["Items"][0]

            # Extract the redirect URL from the item
            redirect_url = item.get("redirect", {}).get("S")

            if redirect_url:
                print(f"Found redirect: {path} -> {redirect_url}")
                return {
                    "status": "302",
                    "statusDescription": "Found",
                    "headers": {
                        "location": [{"key": "Location", "value": redirect_url}],
                        "cache-control": [
                            {
                                "key": "Cache-Control",
                                "value": f"public, max-age={CACHE_TTL}",
                            }
                        ],
                    },
                }
            else:
                print(f"Item found but no redirect attribute for path: {path}")
        else:
            print(f"No items found for path: {path}")

    except ClientError as e:
        print(f"DynamoDB query failed for {path} in region {target_region}: {e}")
    except Exception as e:
        print(f"Unexpected error: {e}")

    # Not found - redirect to fallback
    return {
        "status": "307",
        "statusDescription": "Temporary Redirect",
        "headers": {
            "location": [{"key": "Location", "value": FALLBACK_URL}],
            "cache-control": [
                {"key": "Cache-Control", "value": f"public, max-age={CACHE_TTL}"}
            ],
        },
    }
