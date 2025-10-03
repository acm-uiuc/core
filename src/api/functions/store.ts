// TODO: (store) Create a function to check if a given product and variant are sellable to a given user
// If it is sellable, return the price ID to create a stripe checkout session for

import { type DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { type Redis } from "api/types.js";

// If not, return null.
export type CheckItemSellableInputs = {
  userId: string; // This is generally their Illinois email
  productId: string;
  variantId: string;
  dynamoClient: DynamoDBClient;
  redisClient: Redis;
};

export type CheckItemSellableOutputs = null | string;

export async function checkItemSellable({
  userId,
  productId,
  variantId,
  dynamoClient,
  redisClient,
}: CheckItemSellableInputs): Promise<CheckItemSellableOutputs> {
  // In a transaction:
  // First, check if there is stock.
  // If there is stock, check that the user is still under their limit.
  // If there is, check if they are a paid member.
  // If paid member return member_price_id for the variant request, if not return the nonmember_price_id
  return null;
}

export type CreateCheckoutSessionInputs = {
  priceId: string;
  username: string;
  stripeApiKey: string;
};

export type CreateCheckoutSessionOutputs = string;

export async function createCheckoutSession({
  priceId,
}: CreateCheckoutSessionInputs): Promise<CreateCheckoutSessionOutputs> {
  // Check stripe modules createCheckoutSession function
  // initatior string should be "acm-store"
  return "";
}
