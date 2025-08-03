import { DynamoDBClient, PutItemCommand } from "@aws-sdk/client-dynamodb";
import { marshall } from "@aws-sdk/util-dynamodb";
import { hash } from "argon2";
import { genericConfig } from "common/config.js";
import {
  BaseError,
  EntraFetchError,
  InternalServerError,
  UnauthenticatedError,
  ValidationError,
} from "common/errors/index.js";
import { type FastifyBaseLogger } from "fastify";

export type HashUinInputs = {
  pepper: string;
  uin: string;
};

export type GetUserUinInputs = {
  uiucAccessToken: string;
  pepper: string;
};

export const verifyUiucAccessToken = async ({
  accessToken,
  logger,
}: {
  accessToken: string | string[] | undefined;
  logger: FastifyBaseLogger;
}) => {
  if (!accessToken) {
    throw new UnauthenticatedError({
      message: "Access token not found.",
    });
  }
  if (Array.isArray(accessToken)) {
    throw new ValidationError({
      message: "Multiple tokens cannot be specified!",
    });
  }
  const url =
    "https://graph.microsoft.com/v1.0/me?$select=userPrincipalName,givenName,surname,mail";

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    });

    if (response.status === 401) {
      const errorText = await response.text();
      logger.warn(`Microsoft Graph API unauthenticated response: ${errorText}`);
      throw new UnauthenticatedError({
        message: "Invalid or expired access token.",
      });
    }

    if (!response.ok) {
      const errorText = await response.text();
      logger.error(
        `Microsoft Graph API error: ${response.status} - ${errorText}`,
      );
      throw new InternalServerError({
        message: "Failed to contact Microsoft Graph API.",
      });
    }

    const data = (await response.json()) as {
      userPrincipalName: string;
      givenName: string;
      surname: string;
      mail: string;
    };
    logger.info("Access token successfully verified with Microsoft Graph API.");
    return data;
  } catch (error) {
    if (error instanceof BaseError) {
      throw error;
    } else {
      logger.error(error);
      throw new InternalServerError({
        message:
          "An unexpected error occurred during access token verification.",
      });
    }
  }
};

export async function getUinHash({
  pepper,
  uin,
}: HashUinInputs): Promise<string> {
  return hash(uin, { salt: Buffer.from(pepper) });
}

export async function getHashedUserUin({
  uiucAccessToken,
  pepper,
}: GetUserUinInputs): Promise<string> {
  const url = `https://graph.microsoft.com/v1.0/me?$select=${genericConfig.UinExtendedAttributeName}`;
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${uiucAccessToken}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      throw new EntraFetchError({
        message: "Failed to get user's UIN.",
        email: "",
      });
    }

    const data = (await response.json()) as {
      [genericConfig.UinExtendedAttributeName]: string;
    };

    return await getUinHash({
      pepper,
      uin: data[genericConfig.UinExtendedAttributeName],
    });
  } catch (error) {
    if (error instanceof EntraFetchError) {
      throw error;
    }

    throw new EntraFetchError({
      message: "Failed to fetch user UIN.",
      email: "",
    });
  }
}

type SaveHashedUserUin = GetUserUinInputs & {
  dynamoClient: DynamoDBClient;
  netId: string;
};

export async function saveHashedUserUin({
  uiucAccessToken,
  pepper,
  dynamoClient,
  netId,
}: SaveHashedUserUin) {
  const uinHash = await getHashedUserUin({ uiucAccessToken, pepper });
  await dynamoClient.send(
    new PutItemCommand({
      TableName: genericConfig.UinHashTable,
      Item: marshall({
        uinHash,
        netId,
      }),
    }),
  );
}
