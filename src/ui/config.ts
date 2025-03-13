import { execCouncilGroupId, execCouncilTestingGroupId } from '@common/config';

export const runEnvironments = ['dev', 'prod', 'local-dev'] as const;
// local dev should be used when you want to test against a local instance of the API

export const services = ['core', 'tickets', 'merch'] as const;
export type RunEnvironment = (typeof runEnvironments)[number];
export type ValidServices = (typeof services)[number];
export type ValidService = ValidServices;

export type ConfigType = {
  AadValidClientId: string;
  ServiceConfiguration: Record<ValidServices, ServiceConfiguration>;
  LinkryGroupList?: string[];
  LinkryGroupUUIDList?: string[];
  KnownGroupMappings: {
    Exec: string;
  };
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
    LinkryGroupList: [
      'ACM Exec Linkry Test',
      'ACM Link Shortener Managers Linkry Test',
      'ACM Officers Linkry Test',
      'ACM Infra Leadership Linkry Test',
    ],
    LinkryGroupUUIDList: [
      '6d0bf289-71e3-4b8f-929b-63d93c2e0533',
      'a93bc2ad-b2b4-47bf-aa32-603dda8f6fdd',
      '99b6b87c-9550-4529-87c1-f40862ab7add',
      '83c275f8-e533-4987-b537-a94b86c9d28e',
    ],
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
    },
    KnownGroupMappings: {
      Exec: execCouncilTestingGroupId,
    },
  },
  dev: {
    AadValidClientId: 'd1978c23-6455-426a-be4d-528b2d2e4026',
    LinkryGroupList: [
      'ACM Exec Linkry Test',
      'ACM Link Shortener Managers Linkry Test',
      'ACM Officers Linkry Test',
      'ACM Infra Leadership Linkry Test',
    ],
    LinkryGroupUUIDList: [
      '6d0bf289-71e3-4b8f-929b-63d93c2e0533',
      'a93bc2ad-b2b4-47bf-aa32-603dda8f6fdd',
      '99b6b87c-9550-4529-87c1-f40862ab7add',
      '83c275f8-e533-4987-b537-a94b86c9d28e',
    ],
    ServiceConfiguration: {
      core: {
        friendlyName: 'Core Management Service (NonProd)',
        baseEndpoint: 'https://infra-core-api.aws.qa.acmuiuc.org',
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
    },
    KnownGroupMappings: {
      Exec: execCouncilTestingGroupId,
    },
  },
  prod: {
    AadValidClientId: '43fee67e-e383-4071-9233-ef33110e9386',
    LinkryGroupList: [
      'ACM Exec',
      'ACM Link Shortener Managers',
      'ACM Officers',
      'ACM Infra Leadership',
    ],
    LinkryGroupUUIDList: [
      'ad81254b-4eeb-4c96-8191-3acdce9194b1',
      '270c2d58-11f6-4c45-a217-d46a035fe853',
      'ff49e948-4587-416b-8224-65147540d5fc',
      'f8dfc4cf-456b-4da3-9053-f7fdeda5d5d6', //TODO: is this correct?
    ],
    ServiceConfiguration: {
      core: {
        friendlyName: 'Core Management Service',
        baseEndpoint: 'https://infra-core-api.aws.acmuiuc.org',
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
    },
    KnownGroupMappings: {
      Exec: execCouncilGroupId,
    },
  },
} as const;

const getRunEnvironmentConfig = () =>
  environmentConfig[(import.meta.env.VITE_RUN_ENVIRONMENT || 'dev') as RunEnvironment];

export { getRunEnvironmentConfig };
