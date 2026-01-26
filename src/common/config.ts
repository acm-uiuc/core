import { MembershipPriceIdStripe } from "@acm-uiuc/js-shared";
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
  LinkryBaseUrl: string;
  PasskitIdentifier: string;
  PasskitSerialNumber: string;
  EmailDomain: string;
  SqsQueueUrl: string;
  PaidMemberGroupId: string;
  PaidMemberPriceId: string;
  AadValidReadOnlyClientId: string;
  ConfigurationSecretIds: string[];
  ConfigurationParameterIds: string[];
  DiscordGuildId: string;
  GroupSuffix: string;
  GroupEmailSuffix: string;
  GithubOrgName: string;
  OrgAdminGithubParentTeam: number;
  GithubIdpSyncEnabled: boolean;
  GithubOrgId: number;
  AssetsBucketId: string;
  ListmonkBaseUrl: string;
  ListmonkUsername: string;
  PaidMemberListmonkLists: number[];
};

export type GenericConfigType = {
  EventsDynamoTableName: string;
  RSVPDynamoTableName: string;
  CacheDynamoTableName: string;
  LinkryDynamoTableName: string;
  StripeLinksDynamoTableName: string;
  StripePaymentsDynamoTableName: string;
  UpcomingEventThresholdSeconds: number;
  AwsRegion: string;
  SesRegion: string; // TODO: we're only verified for SES in us-east-1, get verified in us-east-2
  EntraTenantId: string;
  MerchStorePurchasesTableName: string;
  TicketPurchasesTableName: string;
  TicketMetadataTableName: string;
  ExternalMembershipTableName: string;
  MerchStoreMetadataTableName: string;
  IAMTablePrefix: string;
  ProtectedEntraIDGroups: string[]; // these groups are too privileged to be modified via this portal and must be modified directly in Entra ID.
  RoomRequestsTableName: string;
  RoomRequestsStatusTableName: string;
  AuditLogTable: string;
  ApiKeyTable: string;
  ConfigSecretName: string;
  UinExtendedAttributeName: string;
  UserInfoTable: string;
  SigInfoTableName: string;
  EntraHostedDomainName: string;
  StoreInventoryTableName: string;
  StoreCartsOrdersTableName: string;
  StoreLimitsTableName: string;
};

type EnvironmentConfigType = {
  [env in RunEnvironment]: ConfigType;
};

export const infraChairsGroupId = "c0702752-50da-49da-83d4-bcbe6f7a9b1b";
export const officersGroupId = "c4ddcc9f-a9c0-47e7-98c1-f1b345d53121";
export const officersGroupTestingId = "0e6e9199-506f-4ede-9d1b-e73f6811c9e5";
export const execCouncilGroupId = "0bd64864-266e-48c7-82f6-63156eed1897";
export const execCouncilTestingGroupId = "dbe18eb2-9675-46c4-b1ef-749a6db4fedd";
export const commChairsTestingGroupId = "d714adb7-07bb-4d4d-a40a-b035bc2a35a3";
export const commChairsGroupId = "105e7d32-7289-435e-a67a-552c7f215507";

const genericConfig: GenericConfigType = {
  EventsDynamoTableName: "infra-core-api-events",
  RSVPDynamoTableName: "infra-core-api-events-rsvp",
  StripeLinksDynamoTableName: "infra-core-api-stripe-links",
  StripePaymentsDynamoTableName: "infra-core-api-stripe-payments",
  CacheDynamoTableName: "infra-core-api-cache",
  LinkryDynamoTableName: "infra-core-api-linkry",
  UpcomingEventThresholdSeconds: 1800, // 30 mins
  AwsRegion: process.env.AWS_REGION ?? "us-east-2",
  SesRegion: "us-east-1",
  EntraTenantId: "c8d9148f-9a59-4db3-827d-42ea0c2b6e2e",
  MerchStorePurchasesTableName: "infra-merchstore-purchase-history",
  MerchStoreMetadataTableName: "infra-merchstore-metadata",
  TicketPurchasesTableName: "infra-events-tickets",
  TicketMetadataTableName: "infra-events-ticketing-metadata",
  IAMTablePrefix: "infra-core-api-iam",
  ProtectedEntraIDGroups: [infraChairsGroupId, officersGroupId],
  ExternalMembershipTableName: "infra-core-api-membership-external-v3",
  RoomRequestsTableName: "infra-core-api-room-requests",
  RoomRequestsStatusTableName: "infra-core-api-room-requests-status",
  AuditLogTable: "infra-core-api-audit-log",
  ApiKeyTable: "infra-core-api-keys",
  ConfigSecretName: "infra-core-api-config",
  UinExtendedAttributeName:
    "extension_a70c2e1556954056a6a8edfb1f42f556_uiucEduUIN",
  UserInfoTable: "infra-core-api-user-info",
  SigInfoTableName: "infra-core-api-sigs",
  EntraHostedDomainName: "acmillinois.onmicrosoft.com",
  StoreInventoryTableName: "infra-core-api-store-inventory",
  StoreCartsOrdersTableName: "infra-core-api-store-carts",
  StoreLimitsTableName: "infra-core-api-store-limits",
} as const;

const environmentConfig: EnvironmentConfigType = {
  dev: {
    UserFacingUrl: "https://core.aws.qa.acmuiuc.org",
    AzureRoleMapping: {},
    ValidCorsOrigins: [
      "https://merch-pwa.pages.dev",
      "https://core.aws.qa.acmuiuc.org",
      /^https:\/\/(?:.*\.)?acmuiuc\.pages\.dev$/,
      /^https:\/\/(?:.*\.)?acmuiuc-digital-signage\.pages\.dev$/,
      /^https:\/\/(?:.*\.)?acm-uiuc-rsvp\.pages\.dev$/,
      /^https?:\/\/([a-zA-Z0-9-]+\.)*acmuiuc\.workers\.dev$/,
      /http:\/\/localhost:\d+$/,
    ],
    ConfigurationSecretIds: [genericConfig.ConfigSecretName],
    ConfigurationParameterIds: [
      "/infra-core-api/jwt_key",
      "/infra-core-api/github_installation_id",
      "/infra-core-api/github_app_id",
      "/infra-core-api/github_private_key",
      "/infra-core-api/turnstile_secret_key",
      "/infra-core-api/listmonk_api_token",
      "/infra-core-api/store_stripe_endpoint_secret",
    ],
    AadValidClientId: "39c28870-94e4-47ee-b4fb-affe0bf96c9f",
    LinkryBaseUrl: "https://core.aws.qa.acmuiuc.org",
    PasskitIdentifier: "pass.org.acmuiuc.qa.membership",
    PasskitSerialNumber: "0",
    EmailDomain: "aws.qa.acmuiuc.org",
    SqsQueueUrl: `https://sqs.${genericConfig.AwsRegion}.amazonaws.com/427040638965/infra-core-api-sqs`,
    PaidMemberGroupId: "9222451f-b354-4e64-ba28-c0f367a277c2",
    PaidMemberPriceId: "price_1S5eAqDGHrJxx3mKZYGoulj3",
    AadValidReadOnlyClientId: "2c6a0057-5acc-496c-a4e5-4adbf88387ba",
    DiscordGuildId: "1278798685706391664",
    EntraServicePrincipalId: "8c26ff11-fb86-42f2-858b-9011c9f0708d",
    GroupSuffix: "[NonProd]",
    GroupEmailSuffix: "nonprod",
    GithubOrgName: "acm-uiuc-testing",
    GithubOrgId: 235748315,
    OrgAdminGithubParentTeam: 14420860,
    GithubIdpSyncEnabled: false,
    AssetsBucketId: `427040638965-infra-core-api-assets-${genericConfig.AwsRegion}`,
    ListmonkBaseUrl: "https://listmonk.acm.illinois.edu",
    ListmonkUsername: "coreapiqa",
    PaidMemberListmonkLists: [16],
  },
  prod: {
    UserFacingUrl: "https://core.acm.illinois.edu",
    AzureRoleMapping: {},
    ConfigurationSecretIds: [genericConfig.ConfigSecretName],
    ConfigurationParameterIds: [
      "/infra-core-api/github_installation_id",
      "/infra-core-api/github_app_id",
      "/infra-core-api/github_private_key",
      "/infra-core-api/turnstile_secret_key",
      "/infra-core-api/listmonk_api_token",
    ],
    ValidCorsOrigins: [
      /^https:\/\/(?:.*\.)?acmuiuc-academic-web\.pages\.dev$/,
      /^https:\/\/(?:.*\.)?acmuiuc-digital-signage\.pages\.dev$/,
      /^https:\/\/(?:.*\.)?acmuiuc\.pages\.dev$/,
      /^https?:\/\/([a-zA-Z0-9-]+\.)*acm\.illinois\.edu$/,
      /^https?:\/\/([a-zA-Z0-9-]+\.)*acmuiuc\.org$/,
      /^https?:\/\/([a-zA-Z0-9-]+\.)*acmuiuc\.workers\.dev$/,
      /http:\/\/localhost:\d+$/,
    ],
    AadValidClientId: "5e08cf0f-53bb-4e09-9df2-e9bdc3467296",
    LinkryBaseUrl: "https://acm.gg/",
    PasskitIdentifier: "pass.edu.illinois.acm.membership",
    PasskitSerialNumber: "0",
    EmailDomain: "acm.illinois.edu",
    SqsQueueUrl: `https://sqs.${genericConfig.AwsRegion}.amazonaws.com/298118738376/infra-core-api-sqs`,
    PaidMemberGroupId: "172fd9ee-69f0-4384-9786-41ff1a43cf8e",
    PaidMemberPriceId: MembershipPriceIdStripe,
    AadValidReadOnlyClientId: "2c6a0057-5acc-496c-a4e5-4adbf88387ba",
    DiscordGuildId: "718945436332720229",
    EntraServicePrincipalId: "88c76504-9856-4325-bb0a-99f977e3607f",
    GroupSuffix: "",
    GroupEmailSuffix: "",
    GithubOrgName: "acm-uiuc",
    GithubOrgId: 425738,
    OrgAdminGithubParentTeam: 12025214,
    GithubIdpSyncEnabled: true,
    AssetsBucketId: `298118738376-infra-core-api-assets-${genericConfig.AwsRegion}`,
    ListmonkBaseUrl: "https://listmonk.acm.illinois.edu",
    ListmonkUsername: "coreapiprod",
    PaidMemberListmonkLists: [4, 17],
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
  fallback_redis_url: string;
  github_installation_id: string;
  github_private_key: string;
  github_app_id: string;
  jwt_key?: string;
  turnstile_secret_key: string;
  listmonk_api_token: string;
  store_stripe_endpoint_secret: string;
};

const roleArns = {
  Entra: process.env.EntraRoleArn,
};

export const EVENT_CACHED_DURATION = 120;
export const STORE_CACHED_DURATION = 30;
export const STALE_IF_ERROR_CACHED_TIME = 86400; // 1 day

type NotificationRecipientsType = {
  [env in RunEnvironment]: {
    OfficerBoard: string;
    InfraChairs: string;
    Treasurer: string;
  };
};

const notificationRecipients: NotificationRecipientsType = {
  dev: {
    OfficerBoard: "infrasharedservices-l@acm.illinois.edu",
    InfraChairs: "infrasharedservices-l@acm.illinois.edu",
    Treasurer: "infrasharedservices-l@acm.illinois.edu",
  },
  prod: {
    OfficerBoard: "officers@acm.illinois.edu",
    InfraChairs: "infra@acm.illinois.edu",
    Treasurer: "treasurer@acm.illinois.edu",
  },
};

export const LinkryGroupUUIDToGroupNameMap = new Map([
  ["ad81254b-4eeb-4c96-8191-3acdce9194b1", "ACM Exec"],
  ["270c2d58-11f6-4c45-a217-d46a035fe853", "ACM Link Shortener Managers"],
  ["c4ddcc9f-a9c0-47e7-98c1-f1b345d53121", "ACM Officers"],
  ["f8dfc4cf-456b-4da3-9053-f7fdeda5d5d6", "ACM Infra Leads"],
  ["c0702752-50da-49da-83d4-bcbe6f7a9b1b", "ACM Infra Chairs"],
  ["940e4f9e-6891-4e28-9e29-148798495cdb", "ACM Infra Team"],
]);

export { genericConfig, environmentConfig, roleArns, notificationRecipients };
