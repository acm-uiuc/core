import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { SQSClient } from "@aws-sdk/client-sqs";
import { ValidLoggers } from "api/types.js";
import {
  ConfigType,
  notificationRecipients,
  SecretConfig,
} from "common/config.js";
import { RunEnvironment } from "common/roles.js";
import { Proceeds, RampCreditOutcome } from "common/types/stripe.js";
import { SQSMessageMetadata } from "common/types/sqsMessage.js";
import { createHash, randomUUID } from "crypto";
import Stripe from "stripe";
import {
  deactivatePaidStripeLink,
  enqueueSubscriberCallback,
  getStripeAccountIdentity,
  getStripeNetProceeds,
  getStripePaymentIntentData,
  notifyLinkOwner,
  stripeRequestOptions,
} from "../stripe.js";
import {
  RampFundLimitResult,
  RampTargetValidation,
  setRampFundLimit,
  validateRampTarget,
} from "./client.js";
import {
  APPLY_GRACE_MS,
  NOTICE_DELAY_MS,
  AdvanceNotice,
  PendingSettlement,
  ResolvedSettlement,
  Settlement,
  StripeLinkRoute,
  StripeLinkSettlementKey,
  beginUpdate,
  claimFund,
  conditionFailure,
  enqueueStripeLinkSettlement,
  finishApplying,
  getStripeLinkRoute,
  queuedNoticeSchema,
  readControl,
  readSettlement,
  resolvePending,
  settlementOwner,
  updateSettlementRecord,
} from "./records.js";

const htmlEntities: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};
const usdFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});
function escapeHtml(value: string | null) {
  return (value ?? "Unknown").replace(
    /[&<>"']/g,
    (character) => htmlEntities[character]!,
  );
}
function dollars(amount: number) {
  return usdFormatter.format(amount / 100);
}
function outcomeContent(route: StripeLinkRoute, record: ResolvedSettlement) {
  const fund = escapeHtml(route.target.fundName);
  const invoice = escapeHtml(route.invoiceId);
  const outcome = record.outcome;
  const proceeds = outcome.proceeds;
  let result: string;
  switch (outcome.status) {
    case "credited":
      result =
        outcome.proceeds.netCents === 0
          ? `Ramp fund ${fund} spending limit remains ${dollars(outcome.newLimitCents)}. Verified net proceeds are zero; no Ramp mutation was made.`
          : `Ramp fund ${fund} spending limit increased from ${dollars(outcome.previousLimitCents)} to ${dollars(outcome.newLimitCents)}, crediting ${dollars(outcome.proceeds.netCents)} after Stripe fees for invoice ${invoice}.`;
      break;
    case "fund_missing":
      result = `Payment succeeded; Ramp fund ${fund} no longer exists or was terminated and was not credited.`;
      break;
    case "access_revoked":
      result = `Payment succeeded; the creator's management permission for Ramp fund ${fund} was observed lost and the fund was not credited.`;
      break;
    case "fund_ineligible":
      result = `Payment succeeded; Ramp fund ${fund} is no longer an eligible active non-repeating finite USD fund and was not credited.`;
      break;
    case "unavailable":
      result = `Payment succeeded, but Ramp fund ${fund} was not credited (${escapeHtml(outcome.reason)}). ${proceeds ? "" : "Stripe fees and net proceeds could not be verified."} Contact Treasurer.`;
      break;
    case "unconfirmed":
      result = `Payment succeeded; the update to Ramp fund ${fund} from ${dollars(outcome.previousLimitCents)} to ${dollars(outcome.newLimitCents)} may have applied. Further automatic credits to this fund are blocked pending Treasurer reconciliation. Do not repeat this update.`;
      break;
  }
  return `ACM @ UIUC has received ${record.grossCents === route.amount ? "full" : "partial"} payment for Invoice ${invoice} (${dollars(record.grossCents)} paid by ${escapeHtml(record.payerName)}, ${escapeHtml(record.payerEmail)}).

${record.paymentMethod ? `Payment method: ${escapeHtml(record.paymentMethod)}.\n` : ""}
${record.grossCents === route.amount ? "This invoice should now be considered settled.\n" : ""}
${result}

Gross: ${dollars(record.grossCents)}.${proceeds ? ` Stripe fees: ${dollars(proceeds.feeCents)}. Net proceeds: ${dollars(proceeds.netCents)}.` : ""}
Payment reference: ${escapeHtml(settlementOwner(record))}. Recorded at ${escapeHtml(record.outcomeRecordedAt)} (result version ${record.outcomeVersion}). This result supersedes earlier planning notices and result emails for this payment.
Please contact Officer Board with any questions.`;
}

type ProcessorOptions = {
  dynamoClient: DynamoDBClient;
  sqsClient: SQSClient;
  secretConfig: SecretConfig;
  environmentConfig: ConfigType;
  runEnvironment: RunEnvironment;
  key: StripeLinkSettlementKey;
  metadata: SQSMessageMetadata;
  logger: ValidLoggers;
  stripeClient?: Stripe;
  remainingTimeInMillis?: () => number;
  remoteDeadline?: number;
};

async function resumePaymentDelivery(
  options: ProcessorOptions,
  stripeClient: Stripe,
  route: StripeLinkRoute,
  record: Settlement,
  deadline: number,
  remoteDeadline: number,
) {
  const { dynamoClient, sqsClient, environmentConfig, logger, metadata } =
    options;
  const tasks: Promise<unknown>[] = [];
  if (!record.callbackQueued) {
    tasks.push(
      (async () => {
        await enqueueSubscriberCallback({
          sqsClient,
          environmentConfig,
          requestLog: logger,
          requestId: metadata.reqId,
          eventId: record.eventId,
          eventType: "payment.succeeded",
          linkId: route.linkId,
          callbackUrl: route.callbackUrl,
          invoiceId: route.invoiceId,
          amount: record.grossCents,
          currency: record.currency,
          paidInFull: record.grossCents === route.amount,
          paymentMethod: record.paymentMethod,
          payerName: record.payerName,
          payerEmail: record.payerEmail,
          occurredAt: record.occurredAt,
          deadline,
        });
        await updateSettlementRecord(
          dynamoClient,
          record,
          "SET callbackQueued = :true",
          "attribute_exists(primaryKey)",
          { ":true": true },
          undefined,
          deadline,
        );
      })(),
    );
  }
  if (!record.deactivated) {
    tasks.push(
      (async () => {
        if (record.grossCents === route.amount) {
          await deactivatePaidStripeLink({
            dynamoClient,
            stripeClient,
            entry: route,
            eventId: record.eventId,
            requestLog: logger,
            deadline: Math.min(deadline, remoteDeadline),
          });
        }
        await updateSettlementRecord(
          dynamoClient,
          record,
          "SET deactivated = :true",
          "attribute_exists(primaryKey)",
          { ":true": true },
          undefined,
          deadline,
        );
      })(),
    );
  }
  const deliveries = await Promise.allSettled(tasks);
  const failed = deliveries.find((delivery) => delivery.status === "rejected");
  if (failed?.status === "rejected") {
    throw failed.reason;
  }
  if (
    record.state === "resolved" &&
    record.ownerEmailQueuedVersion !== record.outcomeVersion
  ) {
    await notifyLinkOwner({
      sqsClient,
      environmentConfig,
      requestLog: logger,
      requestId: metadata.reqId,
      eventId: record.eventId,
      userId: route.userId,
      cc: [notificationRecipients[options.runEnvironment].Treasurer],
      subject: `Payment received for Invoice ${route.invoiceId}`,
      content: outcomeContent(route, record),
      deadline,
    });
    try {
      await updateSettlementRecord(
        dynamoClient,
        record,
        "SET ownerEmailQueuedVersion = :version",
        "#state = :resolved AND outcomeVersion = :version AND (attribute_not_exists(ownerEmailQueuedVersion) OR ownerEmailQueuedVersion < :version)",
        { ":resolved": "resolved", ":version": record.outcomeVersion },
        { "#state": "state" },
        deadline,
      );
    } catch (error) {
      if (!conditionFailure(error)) {
        throw error;
      }
      // Reconciliation won, or another sender already acknowledged this version.
    }
  }
}

export async function processStripeLinkSettlement(
  options: ProcessorOptions,
): Promise<void> {
  const startedAt = Date.now();
  const remaining = options.remainingTimeInMillis?.() ?? 30_000;
  const remoteDeadline = Math.min(
    startedAt + 12_000,
    startedAt + remaining - 5_000,
    options.remoteDeadline ?? Infinity,
  );
  const localDeadline = Math.min(
    startedAt + remaining - 1_000,
    remoteDeadline + 5_000,
  );
  const { dynamoClient, sqsClient, key, metadata, logger, runEnvironment } =
    options;
  // Do not mix credentials/configurations across an invocation or retry a PATCH.
  const secretConfig = { ...options.secretConfig };
  const environmentConfig = { ...options.environmentConfig };
  const stripeClient =
    options.stripeClient ??
    new Stripe(secretConfig.stripe_secret_key, {
      timeout: Math.max(1, remoteDeadline - Date.now()),
      maxNetworkRetries: 0,
    });
  const providerContext = {
    secretConfig,
    environmentConfig,
    dynamoClient,
    deadline: remoteDeadline,
  };
  const continuation = (delaySeconds = 60) =>
    enqueueStripeLinkSettlement({
      sqsClient,
      environmentConfig,
      key,
      metadata,
      delaySeconds,
      deadline: localDeadline,
    });
  let verifiedAccount = false;
  let financialError: unknown;
  // Each pass STRONGLY rereads after a condition failure or ambiguous response.
  // Exhausted local time throws; the current queue/webhook delivery must retry.
  for (let pass = 0; pass < 16 && Date.now() < localDeadline; pass++) {
    const record = await readSettlement(dynamoClient, key, localDeadline);
    if (!record) {
      throw new Error("Stripe settlement is not published yet.");
    }
    const route = await getStripeLinkRoute({
      dynamoClient,
      linkId: record.linkId,
      deadline: localDeadline,
    });
    if (
      !route ||
      route.stripeAccountId !== key.stripeAccountId ||
      route.livemode !== key.livemode
    ) {
      throw new Error(
        "Immutable Stripe settlement routing is missing or mismatched.",
      );
    }
    await resumePaymentDelivery(
      options,
      stripeClient,
      route,
      record,
      localDeadline,
      remoteDeadline,
    );
    if (record.state === "resolved") {
      // An old sender must not suppress a reconciliation's newer email version.
      const current = await readSettlement(dynamoClient, key, localDeadline);
      if (
        current?.state === "resolved" &&
        current.ownerEmailQueuedVersion === current.outcomeVersion &&
        current.callbackQueued &&
        current.deactivated
      ) {
        return;
      }
      continue;
    }
    if (record.state === "applying") {
      if (Date.now() < record.writeStartedAt + APPLY_GRACE_MS) {
        await continuation(
          Math.max(
            1,
            Math.ceil(
              (record.writeStartedAt + APPLY_GRACE_MS - Date.now()) / 1000,
            ),
          ),
        );
        return;
      }
      try {
        await finishApplying(
          dynamoClient,
          route,
          record,
          {
            status: "unconfirmed",
            proceeds: record.proceeds,
            previousLimitCents: record.previousLimitCents,
            newLimitCents: record.newLimitCents,
          },
          "Original write invocation did not persist a confirmed result; request finality requires reconciliation.",
          localDeadline,
        );
      } catch (error) {
        financialError = error;
      }
      continue;
    }
    const control = await readControl(dynamoClient, route, localDeadline);
    const owned = control.activeSettlementKey === settlementOwner(record);
    const unavailable = (
      reason: Extract<RampCreditOutcome, { status: "unavailable" }>["reason"],
    ): RampCreditOutcome => ({
      status: "unavailable",
      grossCents: record.grossCents,
      reason,
      ...(record.proceeds ? { proceeds: record.proceeds } : {}),
    });
    const resolve = async (outcome: RampCreditOutcome) => {
      try {
        await resolvePending(
          dynamoClient,
          route,
          record,
          outcome,
          owned,
          localDeadline,
        );
      } catch (error) {
        financialError = error;
      }
    };
    const defer = async (
      reason: PendingSettlement["waitReason"],
      delaySeconds = 60,
    ) => {
      try {
        await updateSettlementRecord(
          dynamoClient,
          record,
          "SET waitReason = :reason",
          "#state = :pending",
          { ":pending": "pending", ":reason": reason },
          { "#state": "state" },
          localDeadline,
        );
      } catch (error) {
        if (!conditionFailure(error)) {
          throw error;
        }
      }
      await continuation(delaySeconds);
    };
    if (Date.now() >= record.waitDeadline) {
      const reason = !record.proceeds
        ? (record.waitReason ?? "fees_unavailable")
        : record.proceeds.netCents > 0 &&
            (!record.advanceNotice ||
              record.advanceNotice.status === "planned" ||
              record.advanceNotice.notBefore >= record.waitDeadline)
          ? "coordination_window_expired"
          : control.pauseToken && !owned
            ? "fund_paused"
            : control.activeSettlementKey && !owned
              ? "fund_busy"
              : (record.waitReason ?? "provider_unavailable");
      await resolve(unavailable(reason));
      continue;
    }
    if (Date.now() >= remoteDeadline) {
      await continuation();
      return;
    }
    if (!verifiedAccount) {
      try {
        const account = await getStripeAccountIdentity({
          stripeClient,
          stripeApiKey: secretConfig.stripe_secret_key,
          dynamoClient,
          deadline: remoteDeadline,
        });
        if (
          account !== key.stripeAccountId ||
          key.livemode !== (runEnvironment === "prod") ||
          route.target.namespace !==
            (runEnvironment === "prod" ? "production" : "sandbox")
        ) {
          throw new Error(
            "Stripe account/mode or Ramp namespace drifted from immutable routing.",
          );
        }
        if (record.proceeds) {
          // A rotated credential for the same account can still have the wrong
          // mode. Verify the payment under this credential, without re-estimating
          // the canonical fees after the coordination delay.
          const intent = await getStripePaymentIntentData({
            stripeClient,
            stripeApiKey: secretConfig.stripe_secret_key,
            paymentIntentId: key.paymentIntentId,
            requestOptions: stripeRequestOptions(remoteDeadline),
          });
          if (
            intent.id !== key.paymentIntentId ||
            intent.livemode !== key.livemode ||
            intent.status !== "succeeded" ||
            intent.currency !== record.currency ||
            intent.amount_received !== record.grossCents
          ) {
            throw new Error(
              "Stripe credential does not match the immutable payment.",
            );
          }
        }
        verifiedAccount = true;
      } catch (error) {
        logger.warn(
          { err: error, paymentIntentId: key.paymentIntentId },
          "Stripe integration identity unavailable.",
        );
        await defer("provider_unavailable");
        return;
      }
    }
    if (!record.proceeds) {
      let proceeds: Proceeds | null;
      let intent: Stripe.PaymentIntent;
      try {
        intent = await getStripePaymentIntentData({
          stripeClient,
          stripeApiKey: secretConfig.stripe_secret_key,
          paymentIntentId: key.paymentIntentId,
          expand: ["latest_charge.balance_transaction"],
          requestOptions: stripeRequestOptions(remoteDeadline),
        });
      } catch (error) {
        logger.warn(
          { err: error, paymentIntentId: key.paymentIntentId },
          "Stripe proceeds unavailable.",
        );
        await defer("provider_unavailable");
        return;
      }
      try {
        proceeds = getStripeNetProceeds(intent);
        if (
          intent.id !== key.paymentIntentId ||
          intent.livemode !== key.livemode ||
          intent.status !== "succeeded" ||
          intent.amount_received !== record.grossCents ||
          (proceeds && proceeds.grossCents !== record.grossCents)
        ) {
          throw new Error("Invalid immutable payment proceeds.");
        }
      } catch (error) {
        logger.warn(
          { err: error, paymentIntentId: key.paymentIntentId },
          "Invalid Stripe proceeds; no Ramp write.",
        );
        await resolve(unavailable("invalid_proceeds"));
        continue;
      }
      if (!proceeds) {
        await defer("fees_unavailable");
        return;
      }
      try {
        await updateSettlementRecord(
          dynamoClient,
          record,
          "SET proceeds = :proceeds",
          "#state = :pending AND attribute_not_exists(proceeds)",
          { ":pending": "pending", ":proceeds": proceeds },
          { "#state": "state" },
          localDeadline,
        );
      } catch (error) {
        financialError = error;
      }
      continue;
    }
    if (record.proceeds.netCents > 0) {
      if (!record.advanceNotice) {
        const announcedNotBefore = Date.now() + NOTICE_DELAY_MS;
        if (announcedNotBefore >= record.waitDeadline) {
          await defer(
            "coordination_window_expired",
            Math.max(1, Math.ceil((record.waitDeadline - Date.now()) / 1000)),
          );
          return;
        }
        try {
          await updateSettlementRecord(
            dynamoClient,
            record,
            "SET advanceNotice = :notice",
            "#state = :pending AND proceeds.netCents > :zero AND attribute_not_exists(advanceNotice) AND waitDeadline > :announced",
            {
              ":pending": "pending",
              ":zero": 0,
              ":announced": announcedNotBefore,
              ":notice": { status: "planned", announcedNotBefore },
            },
            { "#state": "state" },
            localDeadline,
          );
        } catch (error) {
          financialError = error;
        }
        continue;
      }
      if (record.advanceNotice.status === "planned") {
        const notice = record.advanceNotice;
        await notifyLinkOwner({
          sqsClient,
          environmentConfig,
          requestLog: logger,
          requestId: metadata.reqId,
          eventId: record.eventId,
          userId: notificationRecipients[runEnvironment].Treasurer,
          subject: `Planned Ramp credit for Invoice ${route.invoiceId}`,
          content: `As of ${new Date(notice.announcedNotBefore - NOTICE_DELAY_MS).toISOString()}, Core plans to increase Ramp fund ${escapeHtml(route.target.fundName)} by ${dollars(record.proceeds.netCents)} for invoice ${escapeHtml(route.invoiceId)}, no earlier than ${new Date(notice.announcedNotBefore).toISOString()}. Processing may be later or skipped. Pause automatic credits before a manual edit. A later result email supersedes this planning notice.
Gross: ${dollars(record.proceeds.grossCents)}. Stripe fees: ${dollars(record.proceeds.feeCents)}. Net proceeds: ${dollars(record.proceeds.netCents)}.
Payment reference: ${escapeHtml(settlementOwner(record))}. This is a spending-limit change, not a cash deposit.`,
          deadline: localDeadline,
        });
        // Queue acceptance, not email receipt, starts the ten-minute gate.
        const queuedAt = Date.now();
        const queuedNotice: AdvanceNotice = queuedNoticeSchema.parse({
          ...notice,
          status: "queued",
          queuedAt,
          notBefore: Math.max(
            notice.announcedNotBefore,
            queuedAt + NOTICE_DELAY_MS,
          ),
        });
        try {
          await updateSettlementRecord(
            dynamoClient,
            record,
            "SET advanceNotice = :notice",
            "#state = :pending AND advanceNotice.#status = :planned AND advanceNotice.announcedNotBefore = :announced",
            {
              ":pending": "pending",
              ":planned": "planned",
              ":announced": notice.announcedNotBefore,
              ":notice": queuedNotice,
            },
            { "#state": "state", "#status": "status" },
            localDeadline,
          );
        } catch (error) {
          financialError = error;
        }
        continue;
      }
      if (record.advanceNotice.notBefore >= record.waitDeadline) {
        await resolve(unavailable("coordination_window_expired"));
        continue;
      }
      if (Date.now() < record.advanceNotice.notBefore) {
        await continuation(
          Math.max(
            1,
            Math.ceil((record.advanceNotice.notBefore - Date.now()) / 1000),
          ),
        );
        return;
      }
    }
    if (!owned) {
      try {
        await claimFund(dynamoClient, route, record, localDeadline);
      } catch (error) {
        // Ambiguous claim response may have established OUR owner. Prove it.
        const current = await readSettlement(dynamoClient, key, localDeadline);
        const freshControl = await readControl(
          dynamoClient,
          route,
          localDeadline,
        );
        if (
          current?.state !== "pending" ||
          freshControl.activeSettlementKey === settlementOwner(record)
        ) {
          continue;
        }
        if (!conditionFailure(error)) {
          throw error;
        }
        await defer(freshControl.pauseToken ? "fund_paused" : "fund_busy");
        return;
      }
      continue;
    }
    let fund: RampTargetValidation;
    try {
      fund = await validateRampTarget({
        context: providerContext,
        target: route.target,
      });
    } catch (error) {
      logger.warn(
        { err: error, paymentIntentId: key.paymentIntentId },
        "Ramp validation unavailable.",
      );
      await defer("provider_unavailable");
      return;
    }
    if (fund.status !== "eligible") {
      await resolve({ status: fund.status, proceeds: record.proceeds });
      continue;
    }
    if (
      control.lastConfirmedLimitCents !== undefined &&
      control.lastConfirmedLimitCents !== fund.limitCents
    ) {
      logger.warn(
        {
          expected: control.lastConfirmedLimitCents,
          observed: fund.limitCents,
          fundId: route.target.fundId,
        },
        "Ramp limit differs from confirmed baseline; no write.",
      );
      await defer("fund_busy");
      return;
    }
    if (record.proceeds.netCents === 0) {
      await resolve({
        status: "credited",
        proceeds: record.proceeds,
        previousLimitCents: fund.limitCents,
        newLimitCents: fund.limitCents,
      });
      continue;
    }
    const newLimitCents = fund.limitCents + record.proceeds.netCents;
    if (!Number.isSafeInteger(newLimitCents)) {
      await resolve(unavailable("invalid_proceeds"));
      continue;
    }
    if (
      runEnvironment === "prod" &&
      secretConfig.ramp_credits_enabled !== true
    ) {
      await defer("provider_unavailable");
      return;
    }
    // Reserve time for the bounded PATCH plus primary-region commit/handoff.
    if (
      remoteDeadline - Date.now() < 3_000 ||
      localDeadline - Date.now() < 5_000
    ) {
      await continuation();
      return;
    }
    const operation = {
      operationToken: randomUUID(),
      idempotencyKey: createHash("sha256")
        .update(settlementOwner(record))
        .digest("hex"),
      previousLimitCents: fund.limitCents,
      newLimitCents,
      writeStartedAt: Date.now(),
    };
    try {
      await beginUpdate(dynamoClient, route, record, operation, localDeadline);
    } catch (error) {
      financialError = error;
    }
    const applying = await readSettlement(dynamoClient, key, localDeadline);
    // Only THIS original invocation's fresh token can dispatch. Stored applying
    // operations encountered on entry never execute or retry their PATCH.
    if (
      applying?.state !== "applying" ||
      applying.operationToken !== operation.operationToken
    ) {
      continue;
    }
    let result: RampFundLimitResult;
    if (Date.now() >= remoteDeadline) {
      // This original invocation knows it never dispatched. Replays cannot use
      // this proof to dispatch a stored operation, but a guarded local rejection
      // can release its owner without inventing remote uncertainty.
      result = {
        status: "rejected",
        evidence:
          "Provider budget expired before PATCH dispatch; no request was sent.",
      };
    } else {
      try {
        result = await setRampFundLimit({
          context: providerContext,
          target: route.target,
          amountCents: newLimitCents,
          idempotencyKey: operation.idempotencyKey,
        });
      } catch (error) {
        result = {
          status: "unconfirmed",
          evidence:
            error instanceof Error ? error.message : "Unknown PATCH failure.",
        };
      }
    }
    const outcome: RampCreditOutcome =
      result.status === "confirmed"
        ? {
            status: "credited",
            proceeds: applying.proceeds,
            previousLimitCents: applying.previousLimitCents,
            newLimitCents: applying.newLimitCents,
          }
        : result.status === "fund_missing"
          ? { status: "fund_missing", proceeds: applying.proceeds }
          : result.status === "rejected"
            ? {
                status: "unavailable",
                grossCents: record.grossCents,
                proceeds: applying.proceeds,
                reason: "provider_unavailable",
              }
            : {
                status: "unconfirmed",
                proceeds: applying.proceeds,
                previousLimitCents: applying.previousLimitCents,
                newLimitCents: applying.newLimitCents,
              };
    logger.info(
      {
        paymentIntentId: key.paymentIntentId,
        operationToken: operation.operationToken,
        idempotencyKey: operation.idempotencyKey,
        providerEvidence: result.evidence,
        outcome,
      },
      "Ramp update result; never retry the PATCH.",
    );
    // Retry ONLY the local commit, rereading first. A reconciliation or a newer
    // owner cannot be overwritten/released by this late finalizer.
    for (
      let attempt = 0;
      attempt < 3 && Date.now() < localDeadline;
      attempt++
    ) {
      try {
        await finishApplying(
          dynamoClient,
          route,
          applying,
          outcome,
          result.evidence ?? result.status,
          localDeadline,
        );
        break;
      } catch (error) {
        financialError = error;
        const current = await readSettlement(dynamoClient, key, localDeadline);
        if (
          current?.state !== "applying" ||
          current.operationToken !== operation.operationToken
        ) {
          break;
        }
      }
    }
  }
  if (Date.now() < localDeadline) {
    await continuation();
    return;
  }
  throw (
    financialError ??
    new Error(
      "Stripe settlement finalization deadline exhausted; retry delivery.",
    )
  );
}
