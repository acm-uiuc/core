/* eslint-disable no-console */

import { Organizations } from "@acm-uiuc/js-shared";
import {
  DynamoDBClient,
  QueryCommand,
  QueryCommandInput,
} from "@aws-sdk/client-dynamodb";
import type {
  CloudFrontRequestEvent,
  CloudFrontRequestResult,
} from "aws-lambda";

const DEFAULT_AWS_REGION = "us-east-2";
const AVAILABLE_REPLICAS = ["us-west-2"];
const DYNAMODB_TABLE = "infra-core-api-linkry";
const FALLBACK_URL = process.env.FALLBACK_URL || "https://acm.illinois.edu/404";
const DEFAULT_URL = process.env.DEFAULT_URL || "https://www.acm.illinois.edu";
const CACHE_TTL = "30"; // seconds to hold response in PoP
const BASE_DOMAINS = [
  ".go.acm.illinois.edu",
  ".go.aws.qa.acmuiuc.org",
  ".acm.gg",
];

const entries = Object.entries(Organizations);
const shortToOrgCodeMapper: Record<string, string> = {};
for (const item of entries) {
  shortToOrgCodeMapper[item[1].shortcode] = item[0];
}

function getSlugToQuery(path: string, host: string): string {
  let cleanedHost = host.toLowerCase();

  for (const domain of BASE_DOMAINS) {
    if (cleanedHost.endsWith(domain)) {
      cleanedHost = cleanedHost.substring(
        0,
        cleanedHost.length - domain.length,
      );
      break;
    }
  }

  const hostParts = cleanedHost.split(".");
  if (hostParts.length === 1 && host !== "acm") {
    const short = hostParts[0];
    if (shortToOrgCodeMapper[short]) {
      return `${shortToOrgCodeMapper[short]}#${path}`.replace("A01#", "");
      // A01 is ACM, so there's no prefix.
    }
  }

  return path;
}

/**
 * Determine which DynamoDB replica to use based on Lambda execution region
 */
function selectReplica(lambdaRegion: string): string {
  if (AVAILABLE_REPLICAS.includes(lambdaRegion)) {
    return lambdaRegion;
  }

  // Find nearest replica by longest prefix matching
  const parts = lambdaRegion.split("-");
  for (let i = parts.length - 1; i > 0; i--) {
    const prefix = parts.slice(0, i).join("-");
    for (const replica of AVAILABLE_REPLICAS) {
      if (replica.startsWith(prefix)) {
        return replica;
      }
    }
  }

  return DEFAULT_AWS_REGION;
}

const currentRegion = process.env.AWS_REGION || DEFAULT_AWS_REGION;
const targetRegion = selectReplica(currentRegion);
const dynamodb = new DynamoDBClient({ region: targetRegion });

console.log(`Lambda in ${currentRegion}, routing DynamoDB to ${targetRegion}`);

export const handler = async (
  event: CloudFrontRequestEvent,
): Promise<CloudFrontRequestResult> => {
  const request = event.Records[0].cf.request;
  const path = request.uri.replace(/^\/+/, "");
  const host = request.headers.host?.[0]?.value || "";
  const slugToQuery = getSlugToQuery(path, host);
  console.log(`Host: ${host}, Path: ${path}, Querying Slug: ${slugToQuery}`);

  if (!path) {
    return {
      status: "301",
      statusDescription: "Moved Permanently",
      headers: {
        location: [{ key: "Location", value: DEFAULT_URL }],
        "cache-control": [
          { key: "Cache-Control", value: `public, max-age=${CACHE_TTL}` },
        ],
      },
    };
  }

  // Query DynamoDB for records with PK=path and SK starting with "OWNER#"
  try {
    const queryParams: QueryCommandInput = {
      TableName: DYNAMODB_TABLE,
      KeyConditionExpression:
        "slug = :slug AND begins_with(access, :owner_prefix)",
      ExpressionAttributeValues: {
        ":slug": { S: slugToQuery },
        ":owner_prefix": { S: "OWNER#" },
      },
      ProjectionExpression: "redirect",
      Limit: 1, // We only need one result
    };

    const response = await dynamodb.send(new QueryCommand(queryParams));

    if (response.Items && response.Items.length > 0) {
      const item = response.Items[0];

      // Extract the redirect URL from the item
      const redirectUrl = item.redirect?.S;

      if (redirectUrl) {
        console.log(`Found redirect: ${path} -> ${redirectUrl}`);
        return {
          status: "302",
          statusDescription: "Found",
          headers: {
            location: [{ key: "Location", value: redirectUrl }],
            "cache-control": [
              { key: "Cache-Control", value: `public, max-age=${CACHE_TTL}` },
            ],
          },
        };
      }
      console.log(`Item found but no redirect attribute for path: ${path}`);
    } else {
      console.log(`No items found for path: ${path}`);
    }
  } catch (error) {
    if (error instanceof Error) {
      console.error(
        `DynamoDB query failed for ${path} in region ${targetRegion}:`,
        error.message,
      );
    } else {
      console.error(`Unexpected error:`, error);
    }
  }

  // Not found - redirect to fallback
  return {
    status: "307",
    statusDescription: "Temporary Redirect",
    headers: {
      location: [{ key: "Location", value: FALLBACK_URL }],
      "cache-control": [
        { key: "Cache-Control", value: `public, max-age=${CACHE_TTL}` },
      ],
    },
  };
};
