import {
  commChairsGroupId,
  commChairsTestingGroupId,
  execCouncilGroupId,
  execCouncilTestingGroupId,
  miscTestingGroupId,
} from "@common/config";

export const runEnvironments = ["dev", "prod", "local-dev"] as const;
// local dev should be used when you want to test against a local instance of the API

export const services = ["core", "tickets", "merch", "msGraphApi"] as const;
export type RunEnvironment = (typeof runEnvironments)[number];
export type ValidServices = (typeof services)[number];
export type ValidService = ValidServices;

export type KnownGroups = {
  Exec: string;
  CommChairs: string;
  StripeLinkCreators: string;
};

export type ConfigType = {
  AadValidClientId: string;
  ServiceConfiguration: Record<ValidServices, ServiceConfiguration>;
  KnownGroupMappings: KnownGroups;
};

export type ServiceConfiguration = {
  friendlyName: string;
  baseEndpoint: string;
  authCheckRoute?: string;
  loginScope?: string;
  apiId?: string;
};

// type GenericConfigType = {};

type EnvironmentConfigType = {
  [env in RunEnvironment]: ConfigType;
};

const environmentConfig: EnvironmentConfigType = {
  "local-dev": {
    AadValidClientId: "d1978c23-6455-426a-be4d-528b2d2e4026",
    ServiceConfiguration: {
      core: {
        friendlyName: "Core Management Service (NonProd)",
        baseEndpoint: "http://localhost:8080",
        authCheckRoute: "/api/v1/protected",
        loginScope:
          "api://39c28870-94e4-47ee-b4fb-affe0bf96c9f/ACM.Events.Login",
        apiId: "api://39c28870-94e4-47ee-b4fb-affe0bf96c9f",
      },
      tickets: {
        friendlyName: "Ticketing Service (NonProd)",
        baseEndpoint: "https://ticketing.aws.qa.acmuiuc.org",
      },
      merch: {
        friendlyName: "Merch Sales Service (Prod)",
        baseEndpoint: "https://merchapi.acm.illinois.edu",
      },
      msGraphApi: {
        friendlyName: "Microsoft Graph API",
        baseEndpoint: "https://graph.microsoft.com",
        loginScope: "https://graph.microsoft.com/.default",
        apiId: "https://graph.microsoft.com",
      },
    },
    KnownGroupMappings: {
      Exec: execCouncilTestingGroupId,
      CommChairs: commChairsTestingGroupId,
      StripeLinkCreators: miscTestingGroupId,
    },
  },
  dev: {
    AadValidClientId: "d1978c23-6455-426a-be4d-528b2d2e4026",
    ServiceConfiguration: {
      core: {
        friendlyName: "Core Management Service (NonProd)",
        baseEndpoint: "https://core.aws.qa.acmuiuc.org",
        authCheckRoute: "/api/v1/protected",
        loginScope:
          "api://39c28870-94e4-47ee-b4fb-affe0bf96c9f/ACM.Events.Login",
        apiId: "api://39c28870-94e4-47ee-b4fb-affe0bf96c9f",
      },
      tickets: {
        friendlyName: "Ticketing Service (NonProd)",
        baseEndpoint: "https://ticketing.aws.qa.acmuiuc.org",
      },
      merch: {
        friendlyName: "Merch Sales Service (Prod)",
        baseEndpoint: "https://merchapi.acm.illinois.edu",
      },
      msGraphApi: {
        friendlyName: "Microsoft Graph API",
        baseEndpoint: "https://graph.microsoft.com",
        loginScope: "https://graph.microsoft.com/.default",
        apiId: "https://graph.microsoft.com",
      },
    },
    KnownGroupMappings: {
      Exec: execCouncilTestingGroupId,
      CommChairs: commChairsTestingGroupId,
      StripeLinkCreators: miscTestingGroupId,
    },
  },
  prod: {
    AadValidClientId: "43fee67e-e383-4071-9233-ef33110e9386",
    ServiceConfiguration: {
      core: {
        friendlyName: "Core Management Service",
        baseEndpoint: "https://core.acm.illinois.edu",
        authCheckRoute: "/api/v1/protected",
        loginScope:
          "api://5e08cf0f-53bb-4e09-9df2-e9bdc3467296/ACM.Events.Login",
        apiId: "api://5e08cf0f-53bb-4e09-9df2-e9bdc3467296",
      },
      tickets: {
        friendlyName: "Ticketing Service",
        baseEndpoint: "https://ticketing.aws.acmuiuc.org",
      },
      merch: {
        friendlyName: "Merch Sales Service",
        baseEndpoint: "https://merchapi.acm.illinois.edu",
      },
      msGraphApi: {
        friendlyName: "Microsoft Graph API",
        baseEndpoint: "https://graph.microsoft.com",
        loginScope: "https://graph.microsoft.com/.default",
        apiId: "https://graph.microsoft.com",
      },
    },
    KnownGroupMappings: {
      Exec: execCouncilGroupId,
      CommChairs: commChairsGroupId,
      StripeLinkCreators: "675203eb-fbb9-4789-af2f-e87a3243f8e6",
    },
  },
} as const;

const getRunEnvironmentConfig = () =>
  environmentConfig[
    (import.meta.env.VITE_RUN_ENVIRONMENT || "dev") as RunEnvironment
  ];

export { getRunEnvironmentConfig };
