#!/usr/bin/env python3
"""
SSM Parameter Store Multi-Region Tool

Creates or updates a SecureString parameter across multiple AWS regions.
"""

import boto3
from botocore.exceptions import ClientError, NoCredentialsError
import argparse
import sys
import getpass
from concurrent.futures import ThreadPoolExecutor, as_completed

REGIONS = [
    "us-east-2",
    "us-west-2",
]


def put_parameter_in_region(region: str, name: str, value: str) -> dict:
    """Create or update an SSM SecureString parameter in a specific region."""
    try:
        ssm = boto3.client("ssm", region_name=region)

        response = ssm.put_parameter(
            Name=name,
            Value=value,
            Type="SecureString",
            Overwrite=True,
        )

        return {
            "region": region,
            "success": True,
            "version": response.get("Version"),
        }

    except ClientError as e:
        return {
            "region": region,
            "success": False,
            "error": e.response["Error"]["Message"],
        }
    except NoCredentialsError:
        return {
            "region": region,
            "success": False,
            "error": "AWS credentials not configured",
        }
    except Exception as e:
        return {
            "region": region,
            "success": False,
            "error": str(e),
        }


def put_parameter_multi_region(name: str, value: str, regions: list[str] = None) -> list[dict]:
    """Create or update an SSM SecureString parameter across multiple regions."""
    target_regions = regions or REGIONS
    results = []

    with ThreadPoolExecutor(max_workers=len(target_regions)) as executor:
        futures = {
            executor.submit(put_parameter_in_region, region, name, value): region
            for region in target_regions
        }

        for future in as_completed(futures):
            results.append(future.result())

    return sorted(results, key=lambda x: x["region"])


def main():
    parser = argparse.ArgumentParser(
        description="Create or update SSM SecureString parameter in multiple regions"
    )
    parser.add_argument("name", help="Parameter name (e.g., /app/database/password)")
    parser.add_argument(
        "--regions",
        nargs="+",
        help=f"Override default regions (default: {', '.join(REGIONS)})",
    )

    args = parser.parse_args()

    # Prompt for value securely (not shown in terminal or bash history)
    value = getpass.getpass("Enter parameter value: ")

    if not value:
        print("Error: Parameter value cannot be empty")
        sys.exit(1)

    target_regions = args.regions or REGIONS
    print(f"\nSetting parameter '{args.name}' in {len(target_regions)} region(s)...\n")

    results = put_parameter_multi_region(args.name, value, target_regions)

    successes = 0
    failures = 0

    for result in results:
        if result["success"]:
            successes += 1
            print(f"  ✓ {result['region']}: version {result['version']}")
        else:
            failures += 1
            print(f"  ✗ {result['region']}: {result['error']}")

    print(f"\nComplete: {successes} succeeded, {failures} failed")

    sys.exit(0 if failures == 0 else 1)


if __name__ == "__main__":
    main()
