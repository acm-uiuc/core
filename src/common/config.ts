import { allAppRoles, AppRoles, RunEnvironment } from "./roles.js";
import { OriginFunction } from "@fastify/cors";

// From @fastify/cors
type ArrayOfValueOrArray<T> = Array<ValueOrArray<T>>;
type OriginType = string | boolean | RegExp;
type ValueOrArray<T> = T | ArrayOfValueOrArray<T>;

type GroupRoleMapping = Record<string, readonly AppRoles[]>;
type AzureRoleMapping = Record<string, readonly AppRoles[]>;
type UserRoleMapping = Record<string, readonly AppRoles[]>;

export type ConfigType = {
  GroupRoleMapping: GroupRoleMapping;
  AzureRoleMapping: AzureRoleMapping;
  UserRoleMapping: UserRoleMapping;
  ValidCorsOrigins: ValueOrArray<OriginType> | OriginFunction;
  AadValidClientId: string;
  LinkryGroupList: string[];
  LinkryGroupUUIDList: string[];
};

type GenericConfigType = {
  EventsDynamoTableName: string;
  CacheDynamoTableName: string;
  LinkryDynamoTableName: string;
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
  CacheDynamoTableName: "infra-core-api-cache",
  LinkryDynamoTableName: "infra-core-api-linkry",
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
    GroupRoleMapping: {
      [infraChairsGroupId]: allAppRoles, // Infra Chairs
      "940e4f9e-6891-4e28-9e29-148798495cdb": allAppRoles, // ACM Infra Team
      "f8dfc4cf-456b-4da3-9053-f7fdeda5d5d6": allAppRoles, // Infra Leads
      "0": allAppRoles, // Dummy Group for development only
      "1": [], // Dummy Group for development only
      "scanner-only": [AppRoles.TICKETS_SCANNER],
    },
    UserRoleMapping: {
      "infra-unit-test-nogrp@acm.illinois.edu": [AppRoles.TICKETS_SCANNER],
      "kLkvWTYwNnJfBkIK7mBi4niXXHYNR7ygbV8utlvFxjw": allAppRoles
    },
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
    LinkryGroupList: [
      "ACM Exec Linkry Test", 
      "ACM Link Shortener Managers Linkry Test", 
      "ACM Officers Linkry Test", 
      "ACM Infra Leadership Linkry Test"
    ],
    LinkryGroupUUIDList: [
        "6d0bf289-71e3-4b8f-929b-63d93c2e0533",
        "a93bc2ad-b2b4-47bf-aa32-603dda8f6fdd",
        "99b6b87c-9550-4529-87c1-f40862ab7add",
        "83c275f8-e533-4987-b537-a94b86c9d28e"
    ]
  },
  prod: {
    GroupRoleMapping: {
      [infraChairsGroupId]: allAppRoles, // Infra Chairs
      [officersGroupId]: allAppRoles, // Officers
      [execCouncilGroupId]: [AppRoles.EVENTS_MANAGER, AppRoles.IAM_INVITE_ONLY], // Exec
    },
    UserRoleMapping: {
      "jlevine4@illinois.edu": allAppRoles,
      "kaavyam2@illinois.edu": [AppRoles.TICKETS_SCANNER],
      "hazellu2@illinois.edu": [AppRoles.TICKETS_SCANNER],
      "cnwos@illinois.edu": [AppRoles.TICKETS_SCANNER],
      "alfan2@illinois.edu": [AppRoles.TICKETS_SCANNER],
      "naomil4@illinois.edu": [
        AppRoles.TICKETS_SCANNER,
        AppRoles.TICKETS_MANAGER,
      ],
      "akori3@illinois.edu": [
        AppRoles.TICKETS_SCANNER,
        AppRoles.TICKETS_MANAGER,
      ],
    },
    AzureRoleMapping: { AutonomousWriters: [AppRoles.EVENTS_MANAGER] },
    ValidCorsOrigins: [
      "https://acm.illinois.edu",
      "https://www.acm.illinois.edu",
      "https://manage.acm.illinois.edu",
      /^https:\/\/(?:.*\.)?acmuiuc\.pages\.dev$/,
    ],
    AadValidClientId: "5e08cf0f-53bb-4e09-9df2-e9bdc3467296",
    LinkryGroupList: [
      "ACM Exec", 
      "ACM Link Shortener Managers", 
      "ACM Officers", 
      "ACM Infra Leadership"
    ],
    LinkryGroupUUIDList: [
        "ad81254b-4eeb-4c96-8191-3acdce9194b1",
        "270c2d58-11f6-4c45-a217-d46a035fe853",
        "ff49e948-4587-416b-8224-65147540d5fc",
        "f8dfc4cf-456b-4da3-9053-f7fdeda5d5d6" //TODO: is this correct?
    ]
  }
};

export type SecretConfig = {
  jwt_key?: string;
  discord_guild_id: string;
  discord_bot_token: string;
  entra_id_private_key: string;
  entra_id_thumbprint: string;
};

export { genericConfig, environmentConfig };
