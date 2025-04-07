import {
  commChairsGroupId,
  commChairsTestingGroupId,
  execCouncilGroupId,
  execCouncilTestingGroupId,
  miscTestingGroupId,
} from '@common/config';

export const runEnvironments = ['dev', 'prod', 'local-dev'] as const;
// local dev should be used when you want to test against a local instance of the API

export const services = ['core', 'tickets', 'merch', 'msGraphApi'] as const;
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
  LinkryGroupNameToGroupUUIDMap: Map<string, string>;
  LinkryGroupUUIDToGroupNameMap: Map<string, string>;
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
  'local-dev': {
    AadValidClientId: 'd1978c23-6455-426a-be4d-528b2d2e4026',
    LinkryGroupNameToGroupUUIDMap: new Map([
      ['ACM Exec Linkry Test', '6d0bf289-71e3-4b8f-929b-63d93c2e0533'],
      ['ACM Link Shortener Managers Linkry Test', 'a93bc2ad-b2b4-47bf-aa32-603dda8f6fdd'],
      ['ACM Officers Linkry Test', '99b6b87c-9550-4529-87c1-f40862ab7add'],
      ['ACM Infra Leadership Linkry Test', '83c275f8-e533-4987-b537-a94b86c9d28e'],
    ]),
    LinkryGroupUUIDToGroupNameMap: new Map([
      ['6d0bf289-71e3-4b8f-929b-63d93c2e0533', 'ACM Exec Linkry Test'],
      ['a93bc2ad-b2b4-47bf-aa32-603dda8f6fdd', 'ACM Link Shortener Managers Linkry Test'],
      ['99b6b87c-9550-4529-87c1-f40862ab7add', 'ACM Officers Linkry Test'],
      ['83c275f8-e533-4987-b537-a94b86c9d28e', 'ACM Infra Leadership Linkry Test'],
    ]),
    ServiceConfiguration: {
      core: {
        friendlyName: 'Core Management Service (NonProd)',
        baseEndpoint: 'http://localhost:8080',
        authCheckRoute: '/api/v1/protected',
        loginScope: 'api://39c28870-94e4-47ee-b4fb-affe0bf96c9f/ACM.Events.Login',
        apiId: 'api://39c28870-94e4-47ee-b4fb-affe0bf96c9f',
      },
      tickets: {
        friendlyName: 'Ticketing Service (NonProd)',
        baseEndpoint: 'https://ticketing.aws.qa.acmuiuc.org',
      },
      merch: {
        friendlyName: 'Merch Sales Service (Prod)',
        baseEndpoint: 'https://merchapi.acm.illinois.edu',
      },
      msGraphApi: {
        friendlyName: 'Microsoft Graph API',
        baseEndpoint: 'https://graph.microsoft.com',
        loginScope: 'https://graph.microsoft.com/.default',
        apiId: 'https://graph.microsoft.com',
      },
    },
    KnownGroupMappings: {
      Exec: execCouncilTestingGroupId,
      CommChairs: commChairsTestingGroupId,
      StripeLinkCreators: miscTestingGroupId,
    },
  },
  dev: {
    AadValidClientId: 'd1978c23-6455-426a-be4d-528b2d2e4026',
    LinkryGroupNameToGroupUUIDMap: new Map([
      ['ACM Exec Linkry Test', '6d0bf289-71e3-4b8f-929b-63d93c2e0533'],
      ['ACM Link Shortener Managers Linkry Test', 'a93bc2ad-b2b4-47bf-aa32-603dda8f6fdd'],
      ['ACM Officers Linkry Test', '99b6b87c-9550-4529-87c1-f40862ab7add'],
      ['ACM Infra Leadership Linkry Test', '83c275f8-e533-4987-b537-a94b86c9d28e'],
    ]),
    LinkryGroupUUIDToGroupNameMap: new Map([
      ['6d0bf289-71e3-4b8f-929b-63d93c2e0533', 'ACM Exec Linkry Test'],
      ['a93bc2ad-b2b4-47bf-aa32-603dda8f6fdd', 'ACM Link Shortener Managers Linkry Test'],
      ['99b6b87c-9550-4529-87c1-f40862ab7add', 'ACM Officers Linkry Test'],
      ['83c275f8-e533-4987-b537-a94b86c9d28e', 'ACM Infra Leadership Linkry Test'],
    ]),
    ServiceConfiguration: {
      core: {
        friendlyName: 'Core Management Service (NonProd)',
        baseEndpoint: 'https://core.aws.qa.acmuiuc.org',
        authCheckRoute: '/api/v1/protected',
        loginScope: 'api://39c28870-94e4-47ee-b4fb-affe0bf96c9f/ACM.Events.Login',
        apiId: 'api://39c28870-94e4-47ee-b4fb-affe0bf96c9f',
      },
      tickets: {
        friendlyName: 'Ticketing Service (NonProd)',
        baseEndpoint: 'https://ticketing.aws.qa.acmuiuc.org',
      },
      merch: {
        friendlyName: 'Merch Sales Service (Prod)',
        baseEndpoint: 'https://merchapi.acm.illinois.edu',
      },
      msGraphApi: {
        friendlyName: 'Microsoft Graph API',
        baseEndpoint: 'https://graph.microsoft.com',
        loginScope: 'https://graph.microsoft.com/.default',
        apiId: 'https://graph.microsoft.com',
      },
    },
    KnownGroupMappings: {
      Exec: execCouncilTestingGroupId,
      CommChairs: commChairsTestingGroupId,
      StripeLinkCreators: miscTestingGroupId,
    },
  },
  prod: {
    AadValidClientId: '43fee67e-e383-4071-9233-ef33110e9386',
    LinkryGroupNameToGroupUUIDMap: new Map([
      ['ACM Exec', 'ad81254b-4eeb-4c96-8191-3acdce9194b1'],
      ['ACM Link Shortener Managers', '270c2d58-11f6-4c45-a217-d46a035fe853'],
      ['ACM Officers', 'ff49e948-4587-416b-8224-65147540d5fc'],
      ['ACM Infra Leadership', 'f8dfc4cf-456b-4da3-9053-f7fdeda5d5d6'], //TODO: is this correct?
    ]),
    LinkryGroupUUIDToGroupNameMap: new Map([
      ['ad81254b-4eeb-4c96-8191-3acdce9194b1', 'ACM Exec'],
      ['270c2d58-11f6-4c45-a217-d46a035fe853', 'ACM Link Shortener Managers'],
      ['ff49e948-4587-416b-8224-65147540d5fc', 'ACM Officers'],
      ['f8dfc4cf-456b-4da3-9053-f7fdeda5d5d6', 'ACM Infra Leadership'], //TODO: is this correct?
    ]),
    ServiceConfiguration: {
      core: {
        friendlyName: 'Core Management Service',
        baseEndpoint: 'https://core.acm.illinois.edu',
        authCheckRoute: '/api/v1/protected',
        loginScope: 'api://5e08cf0f-53bb-4e09-9df2-e9bdc3467296/ACM.Events.Login',
        apiId: 'api://5e08cf0f-53bb-4e09-9df2-e9bdc3467296',
      },
      tickets: {
        friendlyName: 'Ticketing Service',
        baseEndpoint: 'https://ticketing.aws.acmuiuc.org',
      },
      merch: {
        friendlyName: 'Merch Sales Service',
        baseEndpoint: 'https://merchapi.acm.illinois.edu',
      },
      msGraphApi: {
        friendlyName: 'Microsoft Graph API',
        baseEndpoint: 'https://graph.microsoft.com',
        loginScope: 'https://graph.microsoft.com/.default',
        apiId: 'https://graph.microsoft.com',
      },
    },
    KnownGroupMappings: {
      Exec: execCouncilGroupId,
      CommChairs: commChairsGroupId,
      StripeLinkCreators: '675203eb-fbb9-4789-af2f-e87a3243f8e6',
    },
  },
} as const;

const getRunEnvironmentConfig = () =>
  environmentConfig[(import.meta.env.VITE_RUN_ENVIRONMENT || 'dev') as RunEnvironment];

export { getRunEnvironmentConfig };
