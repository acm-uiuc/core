import { AppRoles, RunEnvironment } from "./roles.js";
import { OriginFunction } from "@fastify/cors";

// From @fastify/cors
type ArrayOfValueOrArray<T> = Array<ValueOrArray<T>>;
type OriginType = string | boolean | RegExp;
type ValueOrArray<T> = T | ArrayOfValueOrArray<T>;

type AzureRoleMapping = Record<string, readonly AppRoles[]>;

export const GENERIC_CACHE_SECONDS = 600;

export type ConfigType = {
  UserFacingUrl: string;
  AzureRoleMapping: AzureRoleMapping;
  ValidCorsOrigins: ValueOrArray<OriginType> | OriginFunction;
  AadValidClientId: string;
  EntraServicePrincipalId: string;
  LinkryBaseUrl: string
  PasskitIdentifier: string;
  PasskitSerialNumber: string;
  MembershipApiEndpoint: string;
  EmailDomain: string;
  SqsQueueUrl: string;
  PaidMemberGroupId: string;
  PaidMemberPriceId: string;
  AadValidReadOnlyClientId: string;
  LinkryCloudfrontKvArn?: string;
  ConfigurationSecretIds: string[];
  DiscordGuildId: string;
};

export type GenericConfigType = {
  EventsDynamoTableName: string;
  CacheDynamoTableName: string;
  LinkryDynamoTableName: string;
  StripeLinksDynamoTableName: string;
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
  EntraReadOnlySecretName: string;
  AuditLogTable: string;
  ApiKeyTable: string;
  SigleadDynamoSigDetailTableName: string;
  SigleadDynamoSigMemberTableName: string;
  ConfigSecretName: string;
  TestingCredentialsSecret: string;
};

type EnvironmentConfigType = {
  [env in RunEnvironment]: ConfigType;
};

export const infraChairsGroupId = "c0702752-50da-49da-83d4-bcbe6f7a9b1b";
export const officersGroupId = "c4ddcc9f-a9c0-47e7-98c1-f1b345d53121";
export const officersGroupTestingId = "0e6e9199-506f-4ede-9d1b-e73f6811c9e5";
export const execCouncilGroupId = "ad81254b-4eeb-4c96-8191-3acdce9194b1";
export const execCouncilTestingGroupId = "dbe18eb2-9675-46c4-b1ef-749a6db4fedd";
export const commChairsTestingGroupId = "d714adb7-07bb-4d4d-a40a-b035bc2a35a3";
export const commChairsGroupId = "105e7d32-7289-435e-a67a-552c7f215507";

export const orgsGroupId = "0b3be7c2-748e-46ce-97e7-cf86f9ca7337";

const genericConfig: GenericConfigType = {
  EventsDynamoTableName: "infra-core-api-events",
  StripeLinksDynamoTableName: "infra-core-api-stripe-links",
  CacheDynamoTableName: "infra-core-api-cache",
  LinkryDynamoTableName: "infra-core-api-linkry",
  EntraSecretName: "infra-core-api-entra",
  EntraReadOnlySecretName: "infra-core-api-ro-entra",
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
  RoomRequestsStatusTableName: "infra-core-api-room-requests-status",
  AuditLogTable: "infra-core-api-audit-log",
  ApiKeyTable: "infra-core-api-keys",
  SigleadDynamoSigDetailTableName: "infra-core-api-sig-details",
  SigleadDynamoSigMemberTableName: "infra-core-api-sig-member-details",
  ConfigSecretName: "infra-core-api-config",
  TestingCredentialsSecret: "infra-core-api-testing-credentials",
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
    ConfigurationSecretIds: [genericConfig.TestingCredentialsSecret, genericConfig.ConfigSecretName],
    AadValidClientId: "39c28870-94e4-47ee-b4fb-affe0bf96c9f",
    LinkryBaseUrl: "https://core.aws.qa.acmuiuc.org",
    PasskitIdentifier: "pass.org.acmuiuc.qa.membership",
    PasskitSerialNumber: "0",
    MembershipApiEndpoint:
      "https://core.aws.qa.acmuiuc.org/api/v1/membership",
    EmailDomain: "aws.qa.acmuiuc.org",
    SqsQueueUrl:
      "https://sqs.us-east-1.amazonaws.com/427040638965/infra-core-api-sqs",
    PaidMemberGroupId: "9222451f-b354-4e64-ba28-c0f367a277c2",
    PaidMemberPriceId: "price_1R4TcTDGHrJxx3mKI6XF9cNG",
    AadValidReadOnlyClientId: "2c6a0057-5acc-496c-a4e5-4adbf88387ba",
    LinkryCloudfrontKvArn: "arn:aws:cloudfront::427040638965:key-value-store/0c2c02fd-7c47-4029-975d-bc5d0376bba1",
    DiscordGuildId: "1278798685706391664",
    EntraServicePrincipalId: "8c26ff11-fb86-42f2-858b-9011c9f0708d"
  },
  prod: {
    UserFacingUrl: "https://core.acm.illinois.edu",
    AzureRoleMapping: { AutonomousWriters: [AppRoles.EVENTS_MANAGER] },
    ConfigurationSecretIds: [genericConfig.ConfigSecretName],
    ValidCorsOrigins: [
      /^https:\/\/(?:.*\.)?acmuiuc-academic-web\.pages\.dev$/,
      /^https:\/\/(?:.*\.)?acmuiuc\.pages\.dev$/,
      /^https?:\/\/([a-zA-Z0-9-]+\.)*acm\.illinois\.edu$/,
      /http:\/\/localhost:\d+$/,
    ],
    AadValidClientId: "5e08cf0f-53bb-4e09-9df2-e9bdc3467296",
    LinkryBaseUrl: "https://go.acm.illinois.edu/",
    PasskitIdentifier: "pass.edu.illinois.acm.membership",
    PasskitSerialNumber: "0",
    MembershipApiEndpoint:
      "https://core.acm.illinois.edu/api/v1/membership",
    EmailDomain: "acm.illinois.edu",
    SqsQueueUrl:
      "https://sqs.us-east-1.amazonaws.com/298118738376/infra-core-api-sqs",
    PaidMemberGroupId: "172fd9ee-69f0-4384-9786-41ff1a43cf8e",
    PaidMemberPriceId: "price_1MUGIRDiGOXU9RuSChPYK6wZ",
    AadValidReadOnlyClientId: "2c6a0057-5acc-496c-a4e5-4adbf88387ba",
    DiscordGuildId: "718945436332720229",
    EntraServicePrincipalId: "88c76504-9856-4325-bb0a-99f977e3607f"
  },
};

export type SecretConfig = {
  discord_bot_token: string;
  entra_id_private_key?: string;
  entra_id_thumbprint?: string;
  acm_passkit_signerCert_base64: string;
  acm_passkit_signerKey_base64: string;
  apple_signing_cert_base64: string;
  stripe_secret_key: string;
  stripe_endpoint_secret: string;
  stripe_links_endpoint_secret: string;
  redis_url: string;
  encryption_key: string;
};

export type SecretTesting = {
  jwt_key: string;
}

const roleArns = {
  Entra: process.env.EntraRoleArn,
};

export const EVENT_CACHED_DURATION = 120;

type NotificationRecipientsType = {
  [env in RunEnvironment]: {
    OfficerBoard: string;
    InfraChairs: string;
    Treasurer: string;
  };
};

const notificationRecipients: NotificationRecipientsType = {
  dev: {
    OfficerBoard: 'infra@acm.illinois.edu',
    InfraChairs: 'infra@acm.illinois.edu',
    Treasurer: 'infra@acm.illinois.edu'
  },
  prod: {
    OfficerBoard: 'officers@acm.illinois.edu',
    InfraChairs: 'infra@acm.illinois.edu',
    Treasurer: 'treasurer@acm.illinois.edu'
  }
}

export const LinkryGroupUUIDToGroupNameMap = new Map([
  ['ad81254b-4eeb-4c96-8191-3acdce9194b1', 'ACM Exec'],
  ['270c2d58-11f6-4c45-a217-d46a035fe853', 'ACM Link Shortener Managers'],
  ['c4ddcc9f-a9c0-47e7-98c1-f1b345d53121', 'ACM Officers'],
  ['f8dfc4cf-456b-4da3-9053-f7fdeda5d5d6', 'ACM Infra Leads'],
  ['c0702752-50da-49da-83d4-bcbe6f7a9b1b', 'ACM Infra Chairs'],
  ['940e4f9e-6891-4e28-9e29-148798495cdb', 'ACM Infra Team']
]);

export { genericConfig, environmentConfig, roleArns, notificationRecipients };
