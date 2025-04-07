import { AppRoles, RunEnvironment } from "./roles.js";
import { OriginFunction } from "@fastify/cors";

// From @fastify/cors
type ArrayOfValueOrArray<T> = Array<ValueOrArray<T>>;
type OriginType = string | boolean | RegExp;
type ValueOrArray<T> = T | ArrayOfValueOrArray<T>;

type AzureRoleMapping = Record<string, readonly AppRoles[]>;

export type ConfigType = {
  UserFacingUrl: string;
  AzureRoleMapping: AzureRoleMapping;
  ValidCorsOrigins: ValueOrArray<OriginType> | OriginFunction;
  AadValidClientId: string;
  LinkryParentGroupId: string
  LinkryBaseUrl: string
  LinkryGroupNameToGroupUUIDMap: Map<String, String>;
  LinkryGroupUUIDToGroupNameMap: Map<String, String>;
  PasskitIdentifier: string;
  PasskitSerialNumber: string;
  MembershipApiEndpoint: string;
  EmailDomain: string;
  SqsQueueUrl: string;
  PaidMemberGroupId: string;
  PaidMemberPriceId: string;
};

export type GenericConfigType = {
  RateLimiterDynamoTableName: string;
  EventsDynamoTableName: string;
  CacheDynamoTableName: string;
  LinkryDynamoTableName: string;
  StripeLinksDynamoTableName: string;
  ConfigSecretName: string;
  EntraSecretName: string;
  UpcomingEventThresholdSeconds: number;
  AwsRegion: string;
  EntraTenantId: string;
  MerchStorePurchasesTableName: string;
  TicketPurchasesTableName: string;
  TicketMetadataTableName: string;
  MembershipTableName: string;
  ExternalMembershipTableName: string;
  MerchStoreMetadataTableName: string;
  IAMTablePrefix: string;
  ProtectedEntraIDGroups: string[]; // these groups are too privileged to be modified via this portal and must be modified directly in Entra ID.
  RoomRequestsTableName: string;
  RoomRequestsStatusTableName: string;
};

type EnvironmentConfigType = {
  [env in RunEnvironment]: ConfigType;
};

export const infraChairsGroupId = "c0702752-50da-49da-83d4-bcbe6f7a9b1b";
export const officersGroupId = "ff49e948-4587-416b-8224-65147540d5fc";
export const officersGroupTestingId = "0e6e9199-506f-4ede-9d1b-e73f6811c9e5";
export const execCouncilGroupId = "ad81254b-4eeb-4c96-8191-3acdce9194b1";
export const execCouncilTestingGroupId = "dbe18eb2-9675-46c4-b1ef-749a6db4fedd";
export const commChairsTestingGroupId = "d714adb7-07bb-4d4d-a40a-b035bc2a35a3";
export const commChairsGroupId = "105e7d32-7289-435e-a67a-552c7f215507";
export const miscTestingGroupId = "ff25ec56-6a33-420d-bdb0-51d8a3920e46";

const genericConfig: GenericConfigType = {
  RateLimiterDynamoTableName: "infra-core-api-rate-limiter",
  EventsDynamoTableName: "infra-core-api-events",
  StripeLinksDynamoTableName: "infra-core-api-stripe-links",
  CacheDynamoTableName: "infra-core-api-cache",
  LinkryDynamoTableName: "infra-core-api-linkry",
  ConfigSecretName: "infra-core-api-config",
  EntraSecretName: "infra-core-api-entra",
  UpcomingEventThresholdSeconds: 1800, // 30 mins
  AwsRegion: process.env.AWS_REGION || "us-east-1",
  EntraTenantId: "c8d9148f-9a59-4db3-827d-42ea0c2b6e2e",
  MerchStorePurchasesTableName: "infra-merchstore-purchase-history",
  MerchStoreMetadataTableName: "infra-merchstore-metadata",
  TicketPurchasesTableName: "infra-events-tickets",
  TicketMetadataTableName: "infra-events-ticketing-metadata",
  IAMTablePrefix: "infra-core-api-iam",
  ProtectedEntraIDGroups: [infraChairsGroupId, officersGroupId],
  MembershipTableName: "infra-core-api-membership-provisioning",
  ExternalMembershipTableName: "infra-core-api-membership-external",
  RoomRequestsTableName: "infra-core-api-room-requests",
  RoomRequestsStatusTableName: "infra-core-api-room-requests-status"
} as const;

const environmentConfig: EnvironmentConfigType = {
  dev: {
    UserFacingUrl: "https://core.aws.qa.acmuiuc.org",
    AzureRoleMapping: { AutonomousWriters: [AppRoles.EVENTS_MANAGER] },
    ValidCorsOrigins: [
      "https://merch-pwa.pages.dev",
      "https://core.aws.qa.acmuiuc.org",
      /^https:\/\/(?:.*\.)?acmuiuc\.pages\.dev$/,
      /http:\/\/localhost:\d+$/,
    ],
    AadValidClientId: "39c28870-94e4-47ee-b4fb-affe0bf96c9f",
    LinkryParentGroupId: "Accef2ab4-532c-4989-8041-b8f3449abe0a", //TODO: use id to fetch child groups & 
    LinkryBaseUrl: "http://localhost:8080/api/v1/linkry/redir/", 
    LinkryGroupNameToGroupUUIDMap: new Map([
      ["ACM Exec Linkry Test", "6d0bf289-71e3-4b8f-929b-63d93c2e0533"],
      ["ACM Link Shortener Managers Linkry Test", "a93bc2ad-b2b4-47bf-aa32-603dda8f6fdd"], 
      ["ACM Officers Linkry Test", "99b6b87c-9550-4529-87c1-f40862ab7add"], 
      ["ACM Infra Leadership Linkry Test", "83c275f8-e533-4987-b537-a94b86c9d28e"]
    ]),
    LinkryGroupUUIDToGroupNameMap: new Map([
        ["6d0bf289-71e3-4b8f-929b-63d93c2e0533", "ACM Exec Linkry Test"],
        ["a93bc2ad-b2b4-47bf-aa32-603dda8f6fdd", "ACM Link Shortener Managers Linkry Test"], 
        ["99b6b87c-9550-4529-87c1-f40862ab7add", "ACM Officers Linkry Test"], 
        ["83c275f8-e533-4987-b537-a94b86c9d28e", "ACM Infra Leadership Linkry Test"]
    ]),
    PasskitIdentifier: "pass.org.acmuiuc.qa.membership",
    PasskitSerialNumber: "0",
    MembershipApiEndpoint:
      "https://core.aws.qa.acmuiuc.org/api/v1/membership",
    EmailDomain: "aws.qa.acmuiuc.org",
    SqsQueueUrl:
      "https://sqs.us-east-1.amazonaws.com/427040638965/infra-core-api-sqs",
    PaidMemberGroupId: "9222451f-b354-4e64-ba28-c0f367a277c2",
    PaidMemberPriceId: "price_1R4TcTDGHrJxx3mKI6XF9cNG",
  },
  prod: {
    UserFacingUrl: "https://core.acm.illinois.edu",
    AzureRoleMapping: { AutonomousWriters: [AppRoles.EVENTS_MANAGER] },
    ValidCorsOrigins: [
      /^https:\/\/(?:.*\.)?acmuiuc-academic-web\.pages\.dev$/,
      /^https:\/\/(?:.*\.)?acmuiuc\.pages\.dev$/,
      /^https?:\/\/([a-zA-Z0-9-]+\.)*acm\.illinois\.edu$/,
      /http:\/\/localhost:\d+$/,
    ],
    AadValidClientId: "5e08cf0f-53bb-4e09-9df2-e9bdc3467296",
    LinkryParentGroupId: "need-to-create-one",
    LinkryBaseUrl: "https://go.acm.illinois.edu/" , 
    LinkryGroupNameToGroupUUIDMap: new Map([
        ['ACM Exec', 'ad81254b-4eeb-4c96-8191-3acdce9194b1'],
        ['ACM Link Shortener Managers', '270c2d58-11f6-4c45-a217-d46a035fe853'],
        ['ACM Officers', 'ff49e948-4587-416b-8224-65147540d5fc'],
        ['ACM Infra Leadership', 'f8dfc4cf-456b-4da3-9053-f7fdeda5d5d6'],//TODO: is this correct?
      ]),
      LinkryGroupUUIDToGroupNameMap: new Map([
          ['ad81254b-4eeb-4c96-8191-3acdce9194b1', 'ACM Exec'],
          ['270c2d58-11f6-4c45-a217-d46a035fe853', 'ACM Link Shortener Managers'],
          ['ff49e948-4587-416b-8224-65147540d5fc', 'ACM Officers'],
          ['f8dfc4cf-456b-4da3-9053-f7fdeda5d5d6', 'ACM Infra Leadership'],//TODO: is this correct?
        ]),
    PasskitIdentifier: "pass.edu.illinois.acm.membership",
    PasskitSerialNumber: "0",
    MembershipApiEndpoint:
      "https://core.acm.illinois.edu/api/v1/membership",
    EmailDomain: "acm.illinois.edu",
    SqsQueueUrl:
      "https://sqs.us-east-1.amazonaws.com/298118738376/infra-core-api-sqs",
    PaidMemberGroupId: "172fd9ee-69f0-4384-9786-41ff1a43cf8e",
    PaidMemberPriceId: "price_1MUGIRDiGOXU9RuSChPYK6wZ",
  },
};

export type SecretConfig = {
  jwt_key?: string;
  discord_guild_id: string;
  discord_bot_token: string;
  entra_id_private_key?: string;
  entra_id_thumbprint?: string;
  acm_passkit_signerCert_base64: string;
  acm_passkit_signerKey_base64: string;
  apple_signing_cert_base64: string;
  stripe_secret_key: string;
  stripe_endpoint_secret: string;
};

const roleArns = {
  Entra: process.env.EntraRoleArn,
};

export const EVENT_CACHED_DURATION = 120;

type NotificationRecipientsType = {
  [env in RunEnvironment]: {
    OfficerBoard: string;
    InfraChairs: string;
  };
};

const notificationRecipients: NotificationRecipientsType = {
  dev: {
    OfficerBoard: 'infra@acm.illinois.edu',
    InfraChairs: 'infra@acm.illinois.edu',
  },
  prod: {
    OfficerBoard: 'officers@acm.illinois.edu',
    InfraChairs: 'infra@acm.illinois.edu',
  }
}

export { genericConfig, environmentConfig, roleArns, notificationRecipients };
