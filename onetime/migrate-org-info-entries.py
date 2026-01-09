#!/usr/bin/env python3
"""
Migrate DynamoDB primaryKey from organization names to organization IDs.
Example: LEAD#ACM -> LEAD#A01, DEFINE#SIGPwny -> DEFINE#S01
"""

import boto3
from boto3.dynamodb.types import TypeSerializer

# Organization name to ID mapping (from organizations.ts)
ORG_NAME_TO_ID = {
    "ACM": "A01",
    "SIGPwny": "S01",
    "SIGCHI": "S02",
    "GameBuilders": "S03",
    "SIGAIDA": "S04",
    "SIGGRAPH": "S05",
    "ICPC": "S06",
    "SIGMobile": "S07",
    "SIGMusic": "S08",
    "GLUG": "S09",
    "SIGNLL": "S10",
    "SIGma": "S11",
    "SIGQuantum": "S12",
    "SIGecom": "S13",
    "SIGPLAN": "S14",
    "SIGPolicy": "S15",
    "SIGARCH": "S16",
    "SIGRobotics": "S17",
    "SIGtricity": "S18",
    "Infrastructure Committee": "C01",
    "Social Committee": "C02",
    "Mentorship Committee": "C03",
    "Academic Committee": "C04",
    "Corporate Committee": "C05",
    "Marketing Committee": "C06",
    "Reflections | Projections": "C07",
    "HackIllinois": "C08",
}

TABLE_NAME = "infra-core-api-sigs"
REGION = "us-east-2"

serializer = TypeSerializer()


def serialize(item: dict) -> dict:
    return {k: serializer.serialize(v) for k, v in item.items()}


def get_all_items(table):
    items = []
    response = table.scan()
    items.extend(response.get("Items", []))
    while "LastEvaluatedKey" in response:
        response = table.scan(ExclusiveStartKey=response["LastEvaluatedKey"])
        items.extend(response.get("Items", []))
    return items


def parse_primary_key(primary_key: str) -> tuple[str, str]:
    if "#" not in primary_key:
        return None, primary_key
    parts = primary_key.split("#", 1)
    return parts[0], parts[1]


def build_new_primary_key(prefix: str, org_name: str) -> str | None:
    org_id = ORG_NAME_TO_ID.get(org_name)
    if org_id is None:
        return None
    if prefix:
        return f"{prefix}#{org_id}"
    return org_id


def migrate_items():
    dynamodb = boto3.resource("dynamodb", region_name=REGION)
    table = dynamodb.Table(TABLE_NAME)
    client = boto3.client("dynamodb", region_name=REGION)

    print(f"Scanning table: {TABLE_NAME}")
    items = get_all_items(table)
    print(f"Found {len(items)} items\n")

    migrations = []

    for item in items:
        primary_key = item.get("primaryKey")
        entry_id = item.get("entryId")

        if not primary_key:
            continue

        prefix, org_name = parse_primary_key(primary_key)
        new_primary_key = build_new_primary_key(prefix, org_name)

        if new_primary_key is None or new_primary_key == primary_key:
            continue

        migrations.append({
            "old_item": item,
            "old_primary_key": primary_key,
            "new_primary_key": new_primary_key,
            "entry_id": entry_id,
        })

    print(f"Migrating {len(migrations)} items...\n")

    # Process in batches of 12 (each migration = 2 actions, limit is 25 actions)
    batch_size = 12

    for i in range(0, len(migrations), batch_size):
        batch = migrations[i:i + batch_size]
        transact_items = []

        for m in batch:
            old_item = m["old_item"]
            new_item = old_item.copy()
            new_item["primaryKey"] = m["new_primary_key"]

            # Build key for delete
            delete_key = {"primaryKey": old_item["primaryKey"]}
            if "entryId" in old_item:
                delete_key["entryId"] = old_item["entryId"]

            transact_items.append({
                "Delete": {
                    "TableName": TABLE_NAME,
                    "Key": serialize(delete_key),
                }
            })

            transact_items.append({
                "Put": {
                    "TableName": TABLE_NAME,
                    "Item": serialize(new_item),
                }
            })

        client.transact_write_items(TransactItems=transact_items)
        print(f"Batch {i // batch_size + 1}: Migrated {len(batch)} items")

    print("\nDone!")


if __name__ == "__main__":
    migrate_items()
