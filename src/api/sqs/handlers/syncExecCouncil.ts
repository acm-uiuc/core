import { AvailableSQSFunctions } from "common/types/sqsMessage.js";
import {
  currentEnvironmentConfig,
  runEnvironment,
  SQSHandlerFunction,
} from "../index.js";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  execCouncilGroupId,
  execCouncilTestingGroupId,
  genericConfig,
  roleArns,
} from "common/config.js";
import { getAllVotingLeads } from "api/functions/organizations.js";
import {
  getEntraIdToken,
  listGroupMembers,
  modifyGroup,
} from "api/functions/entraId.js";
import { SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { EntraGroupActions } from "common/types/iam.js";
import { getRoleCredentials } from "api/functions/sts.js";

export const syncExecCouncilHandler: SQSHandlerFunction<
  AvailableSQSFunctions.SyncExecCouncil
> = async (_payload, _metadata, logger) => {
  const getAuthorizedClients = async () => {
    if (roleArns.Entra) {
      logger.info(
        `Attempting to assume Entra role ${roleArns.Entra} to get the Entra token...`,
      );
      const credentials = await getRoleCredentials(roleArns.Entra);
      const clients = {
        smClient: new SecretsManagerClient({
          region: genericConfig.AwsRegion,
          credentials,
        }),
        dynamoClient: new DynamoDBClient({
          region: genericConfig.AwsRegion,
          credentials,
        }),
      };
      logger.info(
        `Assumed Entra role ${roleArns.Entra} to get the Entra token.`,
      );
      return clients;
    }
    logger.debug("Did not assume Entra role as no env variable was present");
    return {
      smClient: new SecretsManagerClient({
        region: genericConfig.AwsRegion,
      }),
      dynamoClient: new DynamoDBClient({
        region: genericConfig.AwsRegion,
      }),
    };
  };

  const dynamo = new DynamoDBClient({
    region: genericConfig.AwsRegion,
  });

  try {
    const clients = await getAuthorizedClients();
    const entraIdToken = await getEntraIdToken({
      clients,
      clientId: currentEnvironmentConfig.AadValidClientId,
      secretName: genericConfig.EntraSecretName,
      logger,
    });

    // Determine which exec council group to use based on environment
    const execCouncilGroup =
      runEnvironment === "prod"
        ? execCouncilGroupId
        : execCouncilTestingGroupId;

    logger.info(
      `Syncing exec council membership for group ${execCouncilGroup}...`,
    );

    // Get all voting leads from DynamoDB with consistent reads
    const votingLeads = await getAllVotingLeads({
      dynamoClient: dynamo,
      logger,
    });

    // Convert to set of usernames (without @illinois.edu)
    const votingLeadUsernames = new Set(
      votingLeads.map((lead) => lead.username),
    );

    logger.info(
      `Found ${votingLeadUsernames.size} voting leads across all organizations.`,
    );

    // Get current exec council members from Entra ID
    const currentMembers = await listGroupMembers(
      entraIdToken,
      execCouncilGroup,
    );

    // Convert to set of emails
    const currentMemberEmails = new Set(
      currentMembers
        .map((member) => member.email)
        .filter((email) => email && email.endsWith("@illinois.edu")),
    );

    logger.info(
      `Current exec council has ${currentMemberEmails.size} members from @illinois.edu domain.`,
    );

    // Determine who to add and who to remove
    const toAdd = Array.from(votingLeadUsernames).filter(
      (username) => !currentMemberEmails.has(username),
    );
    const toRemove = Array.from(currentMemberEmails).filter(
      (email) => !votingLeadUsernames.has(email),
    );

    logger.info(
      `Will add ${toAdd.length} members and remove ${toRemove.length} members.`,
    );

    // Add missing voting leads to exec council
    for (const username of toAdd) {
      try {
        logger.info(`Adding ${username} to exec council...`);
        await modifyGroup(
          entraIdToken,
          username,
          execCouncilGroup,
          EntraGroupActions.ADD,
          dynamo,
        );
        logger.info(`Successfully added ${username} to exec council.`);
      } catch (error) {
        logger.error(
          error,
          `Failed to add ${username} to exec council. Continuing with other members...`,
        );
      }
    }

    // Remove non-voting leads from exec council
    for (const email of toRemove) {
      try {
        logger.info(`Removing ${email} from exec council...`);
        await modifyGroup(
          entraIdToken,
          email,
          execCouncilGroup,
          EntraGroupActions.REMOVE,
          dynamo,
        );
        logger.info(`Successfully removed ${email} from exec council.`);
      } catch (error) {
        logger.error(
          error,
          `Failed to remove ${email} from exec council. Continuing with other members...`,
        );
      }
    }

    logger.info(
      `Exec council sync completed. Added ${toAdd.length}, removed ${toRemove.length}.`,
    );
  } catch (error) {
    logger.error(error, "Failed to sync exec council membership");
    throw error;
  }
};
