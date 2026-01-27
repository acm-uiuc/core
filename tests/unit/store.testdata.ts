import { marshall } from "@aws-sdk/util-dynamodb";

export const paidJwt =
  "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJPbmxpbmUgSldUIEJ1aWxkZXIiLCJpYXQiOjE3Njk0NzE2ODUsImV4cCI6MTgwMTAwNzY4NSwiYXVkIjoid3d3LmV4YW1wbGUuY29tIiwic3ViIjoianJvY2tldEBleGFtcGxlLmNvbSIsInVwbiI6ImpkM0BpbGxpbm9pcy5lZHUifQ.Bb1h5mV4vcEe-iX8hhp51M4PHaNiL1aLu5Zcb0IqPJE";

export const testingProductLargeVariant = marshall({
  productId: "testing",
  variantId: "73b050da-e6f5-48bd-a389-861ef9c975f1",
  createdAt: 1769458689,
  exchangesAllowed: true,
  inventoryCount: 20,
  memberLists: [""],
  memberPriceCents: 1000,
  memberPriceId: "price_1StwEfDGHrJxx3mKqzJIRtn6",
  name: "Large",
  nonmemberPriceCents: 1500,
  nonmemberPriceId: "price_1StwEfDGHrJxx3mKsZP4qoYG",
  soldCount: 0,
});

export const testingProductSmallVariant = marshall({
  productId: "testing",
  variantId: "c4981d77-8f1b-48f1-9be9-8e69ed7bd3e2",
  createdAt: 1769458689,
  exchangesAllowed: true,
  inventoryCount: 18,
  memberLists: ["acmpaid"],
  memberPriceCents: 1000,
  memberPriceId: "price_1StwEfDGHrJxx3mKseBfRuHA",
  name: "Small",
  nonmemberPriceCents: 1500,
  nonmemberPriceId: "price_1StwEfDGHrJxx3mKxM5XROvP",
  soldCount: 2,
});

export const testingProductDefinition = marshall({
  productId: "testing",
  variantId: "DEFAULT",
  closeAt: 1895688984,
  createdAt: 1769458689,
  description: "A product used solely for testing.",
  limitConfiguration: {
    limitType: "PER_PRODUCT",
    maxQuantity: 4,
  },
  inventoryMode: "PER_VARIANT",
  name: "Testing product",
  openAt: 0,
  stripeProductId: "prod_TrfZ3GzBPdSfjY",
  verifiedIdentityRequired: true,
});
export const closedProductDefinition = marshall({
  productId: "closed",
  variantId: "DEFAULT",
  closeAt: 4073153307,
  createdAt: 1769458689,
  description: "A product used solely for testing that isn't open yet.",
  limitConfiguration: {
    limitType: "PER_PRODUCT",
    maxQuantity: 4,
  },
  name: "Testing product",
  openAt: 4073153306,
  stripeProductId: "prod_TrfZ3GzBPdSfjY",
  verifiedIdentityRequired: true,
});
export const closedProductOnlyVariant = marshall({
  productId: "closed",
  variantId: "12da5bc6-5196-4a77-a13a-878793273ac1",
  createdAt: 1769458689,
  exchangesAllowed: true,
  inventoryCount: 18,
  memberLists: [""],
  memberPriceCents: 2000000,
  memberPriceId: "price_1StwEfDGHrJxx3mKseBfRuHA",
  name: "Only",
  nonmemberPriceCents: 2000000,
  nonmemberPriceId: "price_1StwEfDGHrJxx3mKxM5XROvP",
  soldCount: 2,
});

export const inventoryTableEntries = [
  testingProductDefinition,
  testingProductLargeVariant,
  testingProductSmallVariant,
  closedProductDefinition,
  closedProductOnlyVariant,
];
