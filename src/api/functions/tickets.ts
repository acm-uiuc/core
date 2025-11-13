import { QueryCommand, type DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import { TicketInfoEntry } from "api/routes/tickets.js";
import { ValidLoggers } from "api/types.js";
import { genericConfig } from "common/config.js";
import { BaseError, DatabaseFetchError } from "common/errors/index.js";

export type GetUserPurchasesInputs = {
  dynamoClient: DynamoDBClient;
  email: string;
  logger: ValidLoggers;
  productId?: string;
};

export type RawTicketEntry = {
  ticket_id: string;
  event_id: string;
  payment_method: string;
  purchase_time: string;
  ticketholder_netid: string; // Note this is actually email...
  used: boolean;
};

export type RawMerchEntry = {
  stripe_pi: string;
  email: string;
  fulfilled: boolean;
  item_id: string;
  quantity: number;
  refunded: boolean;
  scanIsoTimestamp?: string;
  scannerEmail?: string;
  size: string;
  total_paid?: number;
  purchased_at?: number;
};

export async function getUserTicketingPurchases({
  dynamoClient,
  email,
  logger,
  productId,
}: GetUserPurchasesInputs) {
  const issuedTickets: TicketInfoEntry[] = [];
  const ticketCommand = new QueryCommand({
    TableName: genericConfig.TicketPurchasesTableName,
    IndexName: "UserIndex",
    KeyConditionExpression: "ticketholder_netid = :email",
    ExpressionAttributeValues: {
      ":email": { S: email },
      ...(productId && { ":productId": { S: productId } }),
    },
    ...(productId && { FilterExpression: "event_id = :productId" }),
  });
  let ticketResults;
  try {
    ticketResults = await dynamoClient.send(ticketCommand);
    if (!ticketResults || !ticketResults.Items) {
      throw new Error("No tickets result");
    }
  } catch (e) {
    if (e instanceof BaseError) {
      throw e;
    }
    logger.error(e);
    throw new DatabaseFetchError({
      message: "Failed to get information from ticketing system.",
    });
  }
  const ticketsResultsUnmarshalled = ticketResults.Items.map(
    (x) => unmarshall(x) as RawTicketEntry,
  );
  for (const item of ticketsResultsUnmarshalled) {
    issuedTickets.push({
      valid: !item.used,
      type: "ticket",
      ticketId: item.ticket_id,
      purchaserData: {
        email: item.ticketholder_netid,
        productId: item.event_id,
        quantity: 1,
      },
      refunded: false,
      fulfilled: item.used,
    });
  }
  return issuedTickets;
}

export async function getUserMerchPurchases({
  dynamoClient,
  email,
  logger,
  productId,
}: GetUserPurchasesInputs) {
  const issuedTickets: TicketInfoEntry[] = [];
  const merchCommand = new QueryCommand({
    TableName: genericConfig.MerchStorePurchasesTableName,
    IndexName: "UserIndex",
    KeyConditionExpression: "email = :email",
    ExpressionAttributeValues: {
      ":email": { S: email },
      ...(productId && { ":productId": { S: productId } }),
    },
    ...(productId && { FilterExpression: "item_id = :productId" }),
  });
  let ticketsResult;
  try {
    ticketsResult = await dynamoClient.send(merchCommand);
    if (!ticketsResult || !ticketsResult.Items) {
      throw new Error("No merch result");
    }
  } catch (e) {
    if (e instanceof BaseError) {
      throw e;
    }
    logger.error(e);
    throw new DatabaseFetchError({
      message: "Failed to get information from merch system.",
    });
  }
  const ticketsResultsUnmarshalled = ticketsResult.Items.map(
    (x) => unmarshall(x) as RawMerchEntry,
  );
  for (const item of ticketsResultsUnmarshalled) {
    issuedTickets.push({
      valid: !item.refunded && !item.fulfilled,
      type: "merch",
      ticketId: item.stripe_pi,
      purchaserData: {
        email: item.email,
        productId: item.item_id,
        quantity: item.quantity,
        size: item.size,
      },
      refunded: item.refunded,
      fulfilled: item.fulfilled,
      totalPaid: item.total_paid,
      purchasedAt: item.purchased_at,
    });
  }
  return issuedTickets;
}
