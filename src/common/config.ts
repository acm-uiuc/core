import { allAppRoles, AppRoles, RunEnvironment } from "./roles.js";
import { OriginFunction } from "@fastify/cors";

// From @fastify/cors
type ArrayOfValueOrArray<T> = Array<ValueOrArray<T>>;
type OriginType = string | boolean | RegExp;
type ValueOrArray<T> = T | ArrayOfValueOrArray<T>;

type AzureRoleMapping = Record<string, readonly AppRoles[]>;

export type ConfigType = {
  AzureRoleMapping: AzureRoleMapping;
  ValidCorsOrigins: ValueOrArray<OriginType> | OriginFunction;
  AadValidClientId: string;
  PasskitIdentifier: string;
  PasskitSerialNumber: string;
  MembershipApiEndpoint: string;
  EmailDomain: string;
  SqsQueueUrl: string;
};

export type GenericConfigType = {
  EventsDynamoTableName: string;
  CacheDynamoTableName: string;
  StripeLinksDynamoTableName: string;
  ConfigSecretName: string;
  UpcomingEventThresholdSeconds: number;
  AwsRegion: string;
  EntraTenantId: string;
  MerchStorePurchasesTableName: string;
  TicketPurchasesTableName: string;
  TicketMetadataTableName: string;
  MerchStoreMetadataTableName: string;
  IAMTablePrefix: string;
  ProtectedEntraIDGroups: string[]; // these groups are too privileged to be modified via this portal and must be modified directly in Entra ID.
};

type EnvironmentConfigType = {
  [env in RunEnvironment]: ConfigType;
};

export const infraChairsGroupId = "48591dbc-cdcb-4544-9f63-e6b92b067e33";
export const officersGroupId = "ff49e948-4587-416b-8224-65147540d5fc";
export const officersGroupTestingId = "0e6e9199-506f-4ede-9d1b-e73f6811c9e5";
export const execCouncilGroupId = "ad81254b-4eeb-4c96-8191-3acdce9194b1";
export const execCouncilTestingGroupId = "dbe18eb2-9675-46c4-b1ef-749a6db4fedd";

const genericConfig: GenericConfigType = {
  EventsDynamoTableName: "infra-core-api-events",
  StripeLinksDynamoTableName: "infra-core-api-stripe-links",
  CacheDynamoTableName: "infra-core-api-cache",
  ConfigSecretName: "infra-core-api-config",
  UpcomingEventThresholdSeconds: 1800, // 30 mins
  AwsRegion: process.env.AWS_REGION || "us-east-1",
  EntraTenantId: "c8d9148f-9a59-4db3-827d-42ea0c2b6e2e",
  MerchStorePurchasesTableName: "infra-merchstore-purchase-history",
  MerchStoreMetadataTableName: "infra-merchstore-metadata",
  TicketPurchasesTableName: "infra-events-tickets",
  TicketMetadataTableName: "infra-events-ticketing-metadata",
  IAMTablePrefix: "infra-core-api-iam",
  ProtectedEntraIDGroups: [infraChairsGroupId, officersGroupId],
} as const;

const environmentConfig: EnvironmentConfigType = {
  dev: {
    AzureRoleMapping: { AutonomousWriters: [AppRoles.EVENTS_MANAGER] },
    ValidCorsOrigins: [
      "http://localhost:3000",
      "http://localhost:5173",
      "http://localhost:5174",
      "https://merch-pwa.pages.dev",
      "https://manage.qa.acmuiuc.org",
      /^https:\/\/(?:.*\.)?acmuiuc\.pages\.dev$/,
    ],
    AadValidClientId: "39c28870-94e4-47ee-b4fb-affe0bf96c9f",
    PasskitIdentifier: "pass.org.acmuiuc.qa.membership",
    PasskitSerialNumber: "0",
    MembershipApiEndpoint: "https://infra-membership-api.aws.qa.acmuiuc.org/api/v1/checkMembership",
    EmailDomain: "aws.qa.acmuiuc.org",
    SqsQueueUrl: "https://sqs.us-east-1.amazonaws.com/427040638965/infra-core-api-sqs"
  },
  prod: {
    AzureRoleMapping: { AutonomousWriters: [AppRoles.EVENTS_MANAGER] },
    ValidCorsOrigins: [
      "https://acm.illinois.edu",
      "https://www.acm.illinois.edu",
      "https://manage.acm.illinois.edu",
      /^https:\/\/(?:.*\.)?acmuiuc\.pages\.dev$/,
    ],
    AadValidClientId: "5e08cf0f-53bb-4e09-9df2-e9bdc3467296",
    PasskitIdentifier: "pass.edu.illinois.acm.membership",
    PasskitSerialNumber: "0",
    MembershipApiEndpoint: "https://infra-membership-api.aws.acmuiuc.org/api/v1/checkMembership",
    EmailDomain: "acm.illinois.edu",
    SqsQueueUrl: "https://sqs.us-east-1.amazonaws.com/298118738376/infra-core-api-sqs"
  }
};

export type SecretConfig = {
  jwt_key?: string;
  discord_guild_id: string;
  discord_bot_token: string;
  entra_id_private_key: string;
  entra_id_thumbprint: string;
  acm_passkit_signerCert_base64: string;
  acm_passkit_signerKey_base64: string;
  apple_signing_cert_base64: string;
  stripe_secret_key: string;
};

export { genericConfig, environmentConfig };
