import { AvailableSQSFunctions } from "common/types/sqsMessage.js";
import { currentEnvironmentConfig, SQSHandlerFunction } from "../index.js";
import {
  DynamoDBClient,
  GetItemCommand,
  TransactWriteItemsCommand,
} from "@aws-sdk/client-dynamodb";
import { genericConfig, SecretConfig } from "common/config.js";
import { getSecretConfig } from "../utils.js";
import { createLock, IoredisAdapter } from "redlock-universal";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { InternalServerError } from "common/errors/index.js";
import {
  assignIdpGroupsToTeam,
  createGithubTeam,
} from "api/functions/github.js";
import { buildAuditLogTransactPut } from "api/functions/auditLog.js";
import { Modules } from "common/modules.js";
import { retryDynamoTransactionWithBackoff } from "api/utils.js";
import { SKIP_EXTERNAL_ORG_LEAD_UPDATE } from "common/overrides.js";
import { getOrgByName, Organizations } from "@acm-uiuc/js-shared";
import { createRedisModule } from "api/redis.js";

export const createOrgGithubTeamHandler: SQSHandlerFunction<
  AvailableSQSFunctions.CreateOrgGithubTeam
> = async (payload, metadata, logger) => {
  const secretConfig: SecretConfig = await getSecretConfig({
    logger,
    commonConfig: { region: genericConfig.AwsRegion },
  });
  const redisClient = await createRedisModule(
    secretConfig.redis_url,
    secretConfig.fallback_redis_url,
    logger,
  );
  try {
    const {
      orgId: orgImmutableId,
      githubTeamName,
      githubTeamDescription,
    } = payload;
    const orgName = Organizations[orgImmutableId].name;
    if (SKIP_EXTERNAL_ORG_LEAD_UPDATE.includes(orgImmutableId)) {
      logger.info(
        `Organization ${orgName} has external updates disabled, exiting.`,
      );
      return;
    }
    const dynamo = new DynamoDBClient({
      region: genericConfig.AwsRegion,
    });
    const lock = createLock({
      adapter: new IoredisAdapter(redisClient),
      key: `createOrgGithubTeamHandler:${orgImmutableId}`,
      retryAttempts: 5,
      retryDelay: 300,
    });
    return await lock.using(async (signal) => {
      const getMetadataCommand = new GetItemCommand({
        TableName: genericConfig.SigInfoTableName,
        Key: marshall({
          primaryKey: `DEFINE#${orgImmutableId}`,
          entryId: "0",
        }),
        ProjectionExpression: "#entra,#gh",
        ExpressionAttributeNames: {
          "#entra": "leadsEntraGroupId",
          "#gh": "leadsGithubTeamId",
        },
        ConsistentRead: true,
      });
      const existingData = await dynamo.send(getMetadataCommand);
      if (!existingData || !existingData.Item) {
        throw new InternalServerError({
          message: `Could not find org entry for ${orgName}`,
        });
      }
      const currentOrgInfo = unmarshall(existingData.Item) as {
        leadsEntraGroupId?: string;
        leadsGithubTeamId?: string;
      };
      if (!currentOrgInfo.leadsEntraGroupId) {
        logger.info(`${orgName} does not have an Entra group, skipping!`);
        return;
      }
      if (currentOrgInfo.leadsGithubTeamId) {
        logger.info("This org already has a GitHub team, skipping");
        return;
      }
      if (signal.aborted) {
        throw new InternalServerError({
          message:
            "Checked on lock before creating GitHub team, we've lost the lock!",
        });
      }
      logger.info(`Creating GitHub team for ${orgName}!`);
      const suffix = currentEnvironmentConfig.GroupEmailSuffix;
      const finalName = `${githubTeamName}${suffix === "" ? "" : `-${suffix}`}`;
      const { updated, id: teamId } = await createGithubTeam({
        orgId: currentEnvironmentConfig.GithubOrgName,
        auth: {
          appId: parseInt(secretConfig.github_app_id, 10),
          installationId: parseInt(secretConfig.github_installation_id, 10),
          privateKey: Buffer.from(
            secretConfig.github_private_key,
            "base64",
          ).toString("utf-8"),
        },
        parentTeamId: currentEnvironmentConfig.OrgAdminGithubParentTeam,
        name: finalName,
        description: githubTeamDescription,
        logger,
      });
      if (!updated) {
        logger.info(
          `Github team "${finalName}" already existed. We're assuming team sync was already set up (if not, please configure manually).`,
        );
      } else {
        logger.info(
          `Github team "${finalName}" created with team ID "${teamId}".`,
        );
        if (currentEnvironmentConfig.GithubIdpSyncEnabled) {
          logger.info(
            `Setting up IDP sync for Github team from Entra ID group ${currentOrgInfo.leadsEntraGroupId}`,
          );
          await assignIdpGroupsToTeam({
            auth: {
              appId: parseInt(secretConfig.github_app_id, 10),
              installationId: parseInt(secretConfig.github_installation_id, 10),
              privateKey: Buffer.from(
                secretConfig.github_private_key,
                "base64",
              ).toString("utf-8"),
            },
            teamId,
            logger,
            groupsToSync: [currentOrgInfo.leadsEntraGroupId],
            orgId: currentEnvironmentConfig.GithubOrgId,
            orgName: currentEnvironmentConfig.GithubOrgName,
          });
        }
      }
      logger.info("Adding updates to audit log");
      const logStatement = updated
        ? buildAuditLogTransactPut({
            entry: {
              module: Modules.ORG_INFO,
              message: `Created GitHub team "${finalName}" for organization leads.`,
              actor: metadata.initiator,
              target: orgName,
            },
          })
        : undefined;
      const storeGithubIdOperation = async () => {
        const commandTransaction = new TransactWriteItemsCommand({
          TransactItems: [
            ...(logStatement ? [logStatement] : []),
            {
              Update: {
                TableName: genericConfig.SigInfoTableName,
                Key: marshall({
                  primaryKey: `DEFINE#${orgName}`,
                  entryId: "0",
                }),
                UpdateExpression:
                  "SET leadsGithubTeamId = :githubTeamId, updatedAt = :updatedAt",
                ExpressionAttributeValues: marshall({
                  ":githubTeamId": teamId,
                  ":updatedAt": new Date().toISOString(),
                }),
              },
            },
          ],
        });
        return await dynamo.send(commandTransaction);
      };

      await retryDynamoTransactionWithBackoff(
        storeGithubIdOperation,
        logger,
        `Store GitHub team ID for ${orgName}`,
      );
    });
  } finally {
    try {
      await redisClient.quit();
    } catch {
      redisClient.disconnect();
    }
  }
};
