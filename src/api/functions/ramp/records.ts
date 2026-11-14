import {
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  TransactWriteItem,
  TransactWriteItemsCommand,
  UpdateItemCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import { ConfigType, genericConfig, SecretConfig } from "common/config.js";
import { ResourceConflictError, ValidationError } from "common/errors/index.js";
import {
  proceedsSchema,
  rampTargetSchema,
  RampCreditOutcome,
  rampCreditOutcomeSchema,
} from "common/types/stripe.js";
import {
  AvailableSQSFunctions,
  SQSMessageMetadata,
  SQSPayload,
} from "common/types/sqsMessage.js";
import { isConditionalCheckFailed } from "api/utils.js";
import {
  awsOptions,
  getPaymentMethodDescriptionString,
  getPaymentMethodForPaymentIntent,
  getStripePaymentIntentData,
  stripeRequestOptions,
  SupportedStripePaymentMethod,
  supportedStripePaymentMethods,
} from "../stripe.js";
import Stripe from "stripe";
import * as z from "zod/v4";

const cents = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const timestamp = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const stripeId = z.string().min(1);
const tableName = genericConfig.StripePaymentsDynamoTableName;
export const NOTICE_DELAY_MS = 600_000;
export const APPLY_GRACE_MS = 90_000;

export const stripeLinkRouteSchema = z
  .object({
    primaryKey: z.literal("STRIPE_LINK_ROUTE"),
    sortKey: stripeId,
    linkId: stripeId,
    userId: z.string().min(1),
    invoiceId: z.string().min(1),
    amount: cents,
    priceId: stripeId.optional(),
    productId: stripeId.optional(),
    url: z.url(),
    createdAt: z.iso.datetime(),
    callbackUrl: z.url().optional(),
    signingSecret: z.string().min(1).optional(),
    target: rampTargetSchema,
    stripeAccountId: stripeId,
    livemode: z.boolean(),
  })
  .refine((route) => route.sortKey === route.linkId);
export type StripeLinkRoute = z.infer<typeof stripeLinkRouteSchema>;

export type StripeLinkSettlementKey = {
  stripeAccountId: string;
  livemode: boolean;
  paymentIntentId: string;
};

const plannedNoticeSchema = z.object({
  status: z.literal("planned"),
  announcedNotBefore: timestamp,
});
export const queuedNoticeSchema = z
  .object({
    status: z.literal("queued"),
    announcedNotBefore: timestamp,
    queuedAt: timestamp,
    notBefore: timestamp,
  })
  .refine(
    (notice) =>
      notice.notBefore ===
      Math.max(notice.announcedNotBefore, notice.queuedAt + NOTICE_DELAY_MS),
  );
const advanceNoticeSchema = z.discriminatedUnion("status", [
  plannedNoticeSchema,
  queuedNoticeSchema,
]);
export type AdvanceNotice = z.infer<typeof advanceNoticeSchema>;

const settlementBaseSchema = z.object({
  primaryKey: stripeId,
  sortKey: stripeId,
  stripeAccountId: stripeId,
  livemode: z.boolean(),
  paymentIntentId: stripeId,
  linkId: stripeId,
  sessionId: stripeId,
  eventId: stripeId,
  occurredAt: z.iso.datetime(),
  grossCents: cents,
  currency: z.literal("usd"),
  payerName: z.string().nullable(),
  payerEmail: z.string().nullable(),
  paymentMethod: z.string().nullable(),
  waitDeadline: timestamp,
  advanceNotice: advanceNoticeSchema.optional(),
  callbackQueued: z.literal(true).optional(),
  deactivated: z.literal(true).optional(),
  ownerEmailQueuedVersion: z.number().int().positive().optional(),
});
const pendingSchema = settlementBaseSchema.extend({
  state: z.literal("pending"),
  proceeds: proceedsSchema.optional(),
  waitReason: z
    .enum([
      "fees_unavailable",
      "provider_unavailable",
      "fund_paused",
      "fund_busy",
      "coordination_window_expired",
    ])
    .optional(),
});
const applyingSchema = settlementBaseSchema.extend({
  state: z.literal("applying"),
  proceeds: proceedsSchema,
  previousLimitCents: cents,
  newLimitCents: cents,
  operationToken: z.uuid(),
  idempotencyKey: z.string().min(1).max(255),
  writeStartedAt: timestamp,
});
const resolvedSchema = settlementBaseSchema.extend({
  state: z.literal("resolved"),
  proceeds: proceedsSchema.optional(),
  outcome: rampCreditOutcomeSchema,
  outcomeVersion: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  outcomeRecordedAt: z.iso.datetime(),
  operationToken: z.uuid().optional(),
  previousLimitCents: cents.optional(),
  newLimitCents: cents.optional(),
  idempotencyKey: z.string().optional(),
  writeStartedAt: timestamp.optional(),
  providerEvidence: z.string().optional(),
});
export const stripeLinkSettlementSchema = z
  .discriminatedUnion("state", [pendingSchema, applyingSchema, resolvedSchema])
  .superRefine((record, ctx) => {
    const key = settlementKey(record);
    if (
      record.primaryKey !== key.primaryKey ||
      record.sortKey !== key.sortKey ||
      (record.proceeds && record.proceeds.grossCents !== record.grossCents)
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Conflicting settlement identity or proceeds.",
      });
    }
    if (
      record.advanceNotice &&
      (!record.proceeds ||
        record.proceeds.netCents <= 0 ||
        record.advanceNotice.announcedNotBefore >= record.waitDeadline)
    ) {
      ctx.addIssue({ code: "custom", message: "Invalid advance notice." });
    }
    if (
      record.state === "applying" &&
      (record.proceeds.netCents <= 0 ||
        record.newLimitCents - record.previousLimitCents !==
          record.proceeds.netCents ||
        record.advanceNotice?.status !== "queued" ||
        record.writeStartedAt < record.advanceNotice.notBefore ||
        record.writeStartedAt >= record.waitDeadline)
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Applying requires a due, verified positive credit.",
      });
    }
    if (record.state === "resolved") {
      const proceeds = record.outcome.proceeds;
      if (
        (record.proceeds === undefined) !== (proceeds === undefined) ||
        (record.proceeds &&
          proceeds &&
          (proceeds.grossCents !== record.proceeds.grossCents ||
            proceeds.feeCents !== record.proceeds.feeCents ||
            proceeds.netCents !== record.proceeds.netCents ||
            proceeds.chargeId !== record.proceeds.chargeId ||
            proceeds.balanceTransactionId !==
              record.proceeds.balanceTransactionId)) ||
        (record.outcome.status === "unavailable" &&
          record.outcome.grossCents !== record.grossCents) ||
        (record.ownerEmailQueuedVersion !== undefined &&
          record.ownerEmailQueuedVersion > record.outcomeVersion)
      ) {
        ctx.addIssue({
          code: "custom",
          message:
            "Resolved outcome conflicts with canonical payment or delivery progress.",
        });
      }
      if (
        record.operationToken &&
        (record.previousLimitCents === undefined ||
          record.newLimitCents === undefined ||
          record.idempotencyKey === undefined ||
          record.writeStartedAt === undefined ||
          !record.proceeds ||
          record.proceeds.netCents <= 0 ||
          record.newLimitCents - record.previousLimitCents !==
            record.proceeds.netCents ||
          ((record.outcome.status === "credited" ||
            record.outcome.status === "unconfirmed") &&
            (record.outcome.previousLimitCents !== record.previousLimitCents ||
              record.outcome.newLimitCents !== record.newLimitCents)))
      ) {
        ctx.addIssue({
          code: "custom",
          message:
            "Resolved write must retain its immutable attempted limits and proceeds.",
        });
      }
    }
  });
export type Settlement = z.infer<typeof stripeLinkSettlementSchema>;
export type PendingSettlement = z.infer<typeof pendingSchema>;
type ApplyingSettlement = z.infer<typeof applyingSchema>;
export type ResolvedSettlement = z.infer<typeof resolvedSchema>;
const fundControlSchema = z.object({
  activeSettlementKey: z.string().min(1).optional(),
  pauseToken: z.string().min(1).optional(),
  lastConfirmedLimitCents: cents.optional(),
});
type FundControl = z.infer<typeof fundControlSchema>;

// Include account AND mode everywhere; a bare PaymentIntent ID is not an owner.
function settlementKey(key: StripeLinkSettlementKey) {
  return {
    primaryKey: `STRIPE_LINK_SETTLEMENT#${key.livemode ? "LIVE" : "TEST"}#${key.stripeAccountId}`,
    sortKey: key.paymentIntentId,
  };
}
export function settlementOwner(key: StripeLinkSettlementKey) {
  const { primaryKey, sortKey } = settlementKey(key);
  return `${primaryKey}#${sortKey}`;
}
function fundKey(route: StripeLinkRoute) {
  const { namespace, businessId, fundId } = route.target;
  return {
    primaryKey: `RAMP_FUND#${namespace}#${businessId}#${fundId}`,
    sortKey: "CONTROL",
  };
}
function idOf(value: string | { id: string } | null | undefined) {
  return typeof value === "string" ? value : value?.id;
}
export function conditionFailure(error: unknown) {
  return (
    isConditionalCheckFailed(error) ||
    (error instanceof Error && error.name === "TransactionCanceledException")
  );
}

type AttributeNames = Record<string, string>;
type AttributeValues = Record<string, unknown>;

function conditionItem(
  key: Record<string, unknown>,
  condition: string,
  values: AttributeValues,
  names?: AttributeNames,
): TransactWriteItem {
  return {
    ConditionCheck: {
      TableName: tableName,
      Key: marshall(key),
      ConditionExpression: condition,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: marshall(values),
    },
  };
}

function updateItem(
  key: Record<string, unknown>,
  update: string,
  condition: string,
  values: AttributeValues,
  names?: AttributeNames,
): TransactWriteItem {
  return {
    Update: {
      TableName: tableName,
      Key: marshall(key),
      UpdateExpression: update,
      ConditionExpression: condition,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: marshall(values),
    },
  };
}

async function transactWrite(
  dynamoClient: DynamoDBClient,
  items: TransactWriteItem[],
  deadline: number,
) {
  await dynamoClient.send(
    new TransactWriteItemsCommand({ TransactItems: items }),
    awsOptions(deadline),
  );
}

export async function updateSettlementRecord(
  dynamoClient: DynamoDBClient,
  record: Settlement,
  update: string,
  condition: string,
  values: AttributeValues,
  names: AttributeNames | undefined,
  deadline: number,
) {
  await dynamoClient.send(
    new UpdateItemCommand({
      TableName: tableName,
      Key: marshall(settlementKey(record)),
      UpdateExpression: update,
      ConditionExpression: condition,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: marshall(values),
    }),
    awsOptions(deadline),
  );
}

async function readStrong(
  dynamoClient: DynamoDBClient,
  key: Record<string, unknown>,
  deadline?: number,
): Promise<Record<string, unknown> | null> {
  const result = await dynamoClient.send(
    new GetItemCommand({
      TableName: tableName,
      Key: marshall(key),
      ConsistentRead: true,
    }),
    awsOptions(deadline),
  );
  return result.Item ? unmarshall(result.Item) : null;
}

export async function getStripeLinkRoute({
  dynamoClient,
  linkId,
  deadline,
}: {
  dynamoClient: DynamoDBClient;
  linkId: string;
  deadline?: number;
}): Promise<StripeLinkRoute | null> {
  const item = await readStrong(
    dynamoClient,
    { primaryKey: "STRIPE_LINK_ROUTE", sortKey: linkId },
    deadline,
  );
  return item ? stripeLinkRouteSchema.parse(item) : null;
}
export async function readSettlement(
  dynamoClient: DynamoDBClient,
  key: StripeLinkSettlementKey,
  deadline: number,
) {
  const item = await readStrong(dynamoClient, settlementKey(key), deadline);
  return item ? stripeLinkSettlementSchema.parse(item) : null;
}
export async function readControl(
  dynamoClient: DynamoDBClient,
  route: StripeLinkRoute,
  deadline: number,
): Promise<FundControl> {
  const item = await readStrong(dynamoClient, fundKey(route), deadline);
  return fundControlSchema.parse(item ?? {});
}
function assertAssociation(
  record: Settlement,
  session: Stripe.Checkout.Session,
  key: StripeLinkSettlementKey,
) {
  if (
    record.linkId !== idOf(session.payment_link) ||
    record.sessionId !== session.id ||
    record.paymentIntentId !== idOf(session.payment_intent) ||
    record.grossCents !== session.amount_total ||
    record.currency !== session.currency ||
    record.livemode !== session.livemode ||
    record.stripeAccountId !== key.stripeAccountId
  ) {
    throw new ResourceConflictError({
      message: "Payment association conflicts with the immutable settlement.",
    });
  }
}

export async function recordStripeLinkPayment({
  dynamoClient,
  stripeClient,
  secretConfig,
  session,
  eventId,
  occurredAt,
  stripeAccountId,
  livemode,
  deadline,
}: {
  dynamoClient: DynamoDBClient;
  stripeClient: Stripe;
  secretConfig: SecretConfig;
  session: Stripe.Checkout.Session;
  eventId: string;
  occurredAt: string;
  stripeAccountId: string;
  livemode: boolean;
  deadline: number;
}): Promise<StripeLinkSettlementKey | null> {
  const paymentIntentId = idOf(session.payment_intent);
  const linkId = idOf(session.payment_link);
  if (
    !paymentIntentId ||
    !linkId ||
    session.payment_status !== "paid" ||
    session.livemode !== livemode
  ) {
    throw new ValidationError({
      message:
        "Targeted settlement requires an associated paid Checkout session.",
    });
  }
  const key = { stripeAccountId, livemode, paymentIntentId };
  const existing = await readSettlement(dynamoClient, key, deadline);
  if (existing) {
    assertAssociation(existing, session, key);
    return key;
  }
  const route = await getStripeLinkRoute({ dynamoClient, linkId, deadline });
  if (!route) {
    return null;
  }
  if (
    route.stripeAccountId !== stripeAccountId ||
    route.livemode !== livemode
  ) {
    throw new ResourceConflictError({
      message: "Stripe integration does not match this payment link.",
    });
  }
  const providerSession = await stripeClient.checkout.sessions.retrieve(
    session.id,
    {},
    stripeRequestOptions(deadline),
  );
  const intent = await getStripePaymentIntentData({
    stripeClient,
    stripeApiKey: secretConfig.stripe_secret_key,
    paymentIntentId,
    expand: ["latest_charge.balance_transaction", "payment_method"],
    requestOptions: stripeRequestOptions(deadline),
  });
  if (
    providerSession.id !== session.id ||
    idOf(providerSession.payment_link) !== linkId ||
    idOf(providerSession.payment_intent) !== paymentIntentId ||
    providerSession.payment_status !== "paid" ||
    providerSession.livemode !== livemode ||
    providerSession.amount_total !== session.amount_total ||
    providerSession.currency !== "usd" ||
    session.currency !== "usd" ||
    intent.id !== paymentIntentId ||
    intent.status !== "succeeded" ||
    intent.livemode !== livemode ||
    intent.currency !== "usd" ||
    intent.amount !== session.amount_total ||
    intent.amount_received !== session.amount_total ||
    !cents.safeParse(session.amount_total).success
  ) {
    throw new ResourceConflictError({
      message:
        "Stripe payment data does not match the successful Checkout snapshot.",
    });
  }
  const method = await getPaymentMethodForPaymentIntent({
    stripeClient,
    stripeApiKey: secretConfig.stripe_secret_key,
    paymentIntentId,
    paymentIntentData: intent,
    requestOptions: stripeRequestOptions(deadline),
  });
  const methodType = method.type as SupportedStripePaymentMethod;
  if (!supportedStripePaymentMethods.includes(methodType)) {
    throw new ValidationError({
      message: "Unsupported Stripe payment method.",
    });
  }
  const record = pendingSchema.parse({
    ...settlementKey(key),
    ...key,
    linkId,
    sessionId: session.id,
    eventId,
    occurredAt,
    grossCents: session.amount_total,
    currency: "usd",
    payerName: providerSession.customer_details?.name ?? null,
    payerEmail: providerSession.customer_details?.email ?? null,
    paymentMethod:
      getPaymentMethodDescriptionString({
        paymentMethod: method,
        paymentMethodType: methodType,
      }) ?? null,
    waitDeadline: Date.now() + 3_600_000,
    state: "pending",
  });
  try {
    await dynamoClient.send(
      new PutItemCommand({
        TableName: tableName,
        Item: marshall(record, { removeUndefinedValues: true }),
        ConditionExpression:
          "attribute_not_exists(primaryKey) AND attribute_not_exists(sortKey)",
      }),
      awsOptions(deadline),
    );
  } catch (error) {
    // A lost insert response and a duplicate both require the same strong proof.
    const committed = await readSettlement(dynamoClient, key, deadline);
    if (!committed) {
      throw error;
    }
    assertAssociation(committed, session, key);
  }
  return key;
}

export async function enqueueStripeLinkSettlement({
  sqsClient,
  environmentConfig,
  key,
  metadata,
  delaySeconds = 0,
  deadline,
}: {
  sqsClient: SQSClient;
  environmentConfig: ConfigType;
  key: StripeLinkSettlementKey;
  metadata: SQSMessageMetadata;
  delaySeconds?: number;
  deadline?: number;
}) {
  const message: SQSPayload<AvailableSQSFunctions.ProcessStripeLinkSettlement> =
    {
      function: AvailableSQSFunctions.ProcessStripeLinkSettlement,
      metadata,
      payload: key,
    };
  await sqsClient.send(
    new SendMessageCommand({
      QueueUrl: environmentConfig.SqsQueueUrl,
      MessageBody: JSON.stringify(message),
      DelaySeconds: Math.max(0, Math.min(900, Math.ceil(delaySeconds))),
    }),
    awsOptions(deadline),
  );
}

// These are concrete financial operations, not retries of a stale transaction.
export async function claimFund(
  dynamoClient: DynamoDBClient,
  route: StripeLinkRoute,
  record: PendingSettlement,
  deadline: number,
) {
  const now = Date.now();
  await transactWrite(
    dynamoClient,
    [
      conditionItem(
        settlementKey(record),
        "#state = :pending AND waitDeadline > :now AND (proceeds.netCents = :zero OR (proceeds.netCents > :zero AND advanceNotice.#status = :queued AND advanceNotice.notBefore <= :now))",
        { ":pending": "pending", ":now": now, ":zero": 0, ":queued": "queued" },
        { "#state": "state", "#status": "status" },
      ),
      updateItem(
        fundKey(route),
        "SET activeSettlementKey = if_not_exists(activeSettlementKey, :owner)",
        "(attribute_not_exists(activeSettlementKey) AND attribute_not_exists(pauseToken)) OR activeSettlementKey = :owner",
        { ":owner": settlementOwner(record) },
      ),
    ],
    deadline,
  );
}
export async function beginUpdate(
  dynamoClient: DynamoDBClient,
  route: StripeLinkRoute,
  record: PendingSettlement,
  operation: {
    operationToken: string;
    idempotencyKey: string;
    previousLimitCents: number;
    newLimitCents: number;
    writeStartedAt: number;
  },
  deadline: number,
) {
  await transactWrite(
    dynamoClient,
    [
      updateItem(
        settlementKey(record),
        "SET #state = :applying, operationToken = :token, idempotencyKey = :idempotency, previousLimitCents = :old, newLimitCents = :new, writeStartedAt = :now",
        "#state = :pending AND proceeds = :proceeds AND proceeds.netCents > :zero AND advanceNotice.#status = :queued AND advanceNotice.notBefore <= :now AND waitDeadline > :now",
        {
          ":applying": "applying",
          ":pending": "pending",
          ":token": operation.operationToken,
          ":idempotency": operation.idempotencyKey,
          ":old": operation.previousLimitCents,
          ":new": operation.newLimitCents,
          ":now": operation.writeStartedAt,
          ":proceeds": record.proceeds,
          ":zero": 0,
          ":queued": "queued",
        },
        { "#state": "state", "#status": "status" },
      ),
      conditionItem(fundKey(route), "activeSettlementKey = :owner", {
        ":owner": settlementOwner(record),
      }),
    ],
    deadline,
  );
}
export async function resolvePending(
  dynamoClient: DynamoDBClient,
  route: StripeLinkRoute,
  record: PendingSettlement,
  outcome: RampCreditOutcome,
  claimed: boolean,
  deadline: number,
) {
  const values: AttributeValues = {
    ":pending": "pending",
    ":resolved": "resolved",
    ":outcome": outcome,
    ":version": 1,
    ":recordedAt": new Date().toISOString(),
  };
  let condition = "#state = :pending";
  if (record.proceeds) {
    condition += " AND proceeds = :proceeds";
    values[":proceeds"] = record.proceeds;
  } else {
    // A stale fee loader cannot resolve over another worker's verified snapshot.
    condition += " AND attribute_not_exists(proceeds)";
  }
  if (record.advanceNotice) {
    condition += " AND advanceNotice = :notice";
    values[":notice"] = record.advanceNotice;
  } else {
    condition += " AND attribute_not_exists(advanceNotice)";
  }
  const owner = settlementOwner(record);
  const zeroNet =
    claimed && outcome.status === "credited" && outcome.proceeds.netCents === 0;
  await transactWrite(
    dynamoClient,
    [
      updateItem(
        settlementKey(record),
        "SET #state = :resolved, outcome = :outcome, outcomeVersion = :version, outcomeRecordedAt = :recordedAt",
        condition,
        values,
        { "#state": "state" },
      ),
      claimed
        ? updateItem(
            fundKey(route),
            zeroNet
              ? "SET lastConfirmedLimitCents = :baseline REMOVE activeSettlementKey"
              : "REMOVE activeSettlementKey",
            "activeSettlementKey = :owner",
            zeroNet
              ? { ":owner": owner, ":baseline": outcome.newLimitCents }
              : { ":owner": owner },
          )
        : conditionItem(
            fundKey(route),
            "attribute_not_exists(activeSettlementKey) OR activeSettlementKey <> :owner",
            { ":owner": owner },
          ),
    ],
    deadline,
  );
}
export async function finishApplying(
  dynamoClient: DynamoDBClient,
  route: StripeLinkRoute,
  record: ApplyingSettlement,
  outcome: RampCreditOutcome,
  evidence: string,
  deadline: number,
) {
  const uncertain = outcome.status === "unconfirmed";
  const owner = settlementOwner(record);
  const ownerValues: AttributeValues = {
    ":owner": owner,
    ...(outcome.status === "credited"
      ? { ":baseline": outcome.newLimitCents }
      : {}),
  };
  await transactWrite(
    dynamoClient,
    [
      updateItem(
        settlementKey(record),
        "SET #state = :resolved, outcome = :outcome, outcomeVersion = :version, outcomeRecordedAt = :recordedAt, providerEvidence = :evidence",
        "#state = :applying AND operationToken = :token",
        {
          ":resolved": "resolved",
          ":applying": "applying",
          ":token": record.operationToken,
          ":outcome": outcome,
          ":version": 1,
          ":recordedAt": new Date().toISOString(),
          ":evidence": evidence,
        },
        { "#state": "state" },
      ),
      uncertain
        ? conditionItem(
            fundKey(route),
            "activeSettlementKey = :owner",
            ownerValues,
          )
        : updateItem(
            fundKey(route),
            outcome.status === "credited"
              ? "SET lastConfirmedLimitCents = :baseline REMOVE activeSettlementKey"
              : "REMOVE activeSettlementKey",
            "activeSettlementKey = :owner",
            ownerValues,
          ),
    ],
    deadline,
  );
}
