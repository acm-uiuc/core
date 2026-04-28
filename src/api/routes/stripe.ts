import {
  QueryCommand,
  ScanCommand,
  TransactWriteItemsCommand,
  PutItemCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { withRoles, withTags } from "api/components/index.js";
import { buildAuditLogTransactPut } from "api/functions/auditLog.js";
import {
  addInvoice,
  createCheckoutSessionWithCustomer,
  deactivateStripeLink,
  deactivateStripeProduct,
  getPaymentMethodDescriptionString,
  getPaymentMethodForPaymentIntent,
  SupportedStripePaymentMethod,
  supportedStripePaymentMethods,
  recordInvoicePayment,
  deactivatePaymentLink,
} from "api/functions/stripe.js";
import { getSecretValue } from "api/plugins/auth.js";
import { genericConfig, notificationRecipients } from "common/config.js";
import {
  BaseError,
  DatabaseFetchError,
  DatabaseInsertError,
  InternalServerError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from "common/errors/index.js";
import { Modules } from "common/modules.js";
import { AppRoles } from "common/roles.js";
import {
  invoiceLinkGetResponseSchema,
  createInvoicePostRequestSchema,
  createInvoiceConflictResponseSchema,
  createInvoicePostResponseSchema,
} from "common/types/stripe.js";
import { FastifyPluginAsync, FastifyRequest } from "fastify";
import { FastifyZodOpenApiTypeProvider } from "fastify-zod-openapi";
import { Stripe } from "stripe";
import rawbody from "fastify-raw-body";
import { AvailableSQSFunctions, SQSPayload } from "common/types/sqsMessage.js";
import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import * as z from "zod/v4";
import {
  getAllUserEmails,
  encodeInvoiceToken,
  decodeInvoiceToken,
} from "common/utils.js";
import {
  STRIPE_LINK_RETENTION_DAYS,
  STRIPE_LINK_RETENTION_DAYS_QA,
} from "common/constants.js";
import { assertAuthenticated } from "api/authenticated.js";
import { maxLength } from "common/types/generic.js";
import { authorizeByOrgRoleOrSchema } from "api/functions/authorization.js";

const stripeRoutes: FastifyPluginAsync = async (fastify, _options) => {
  await fastify.register(rawbody, {
    field: "rawBody",
    global: false,
    runFirst: true,
  });

  const getRequestOrigin = (request: FastifyRequest) => {
    const proto = request.headers["x-forwarded-proto"] ?? "http";
    const host =
      request.headers["x-forwarded-host"] ??
      request.headers.host ??
      request.hostname;
    return `${proto}://${host}`;
  };

  const getInvoiceBaseUrl = (request: FastifyRequest) => {
    const reqOrigin = getRequestOrigin(request);

    if (
      reqOrigin.includes("localhost") ||
      reqOrigin.includes("127.0.0.1") ||
      reqOrigin.includes("0.0.0.0")
    ) {
      return reqOrigin;
    }

    // Deployed environments: use the public invoice domain from config
    return fastify.environmentConfig.PaymentBaseUrl;
  };

  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().get(
    "/paymentLinks",
    {
      schema: withRoles(
        [AppRoles.STRIPE_LINK_CREATOR],
        withTags(["Stripe"], {
          summary: "Get available Stripe payment links.",
          response: {
            200: {
              description: "Links retrieved successfully.",
              content: {
                "application/json": {
                  schema: invoiceLinkGetResponseSchema,
                },
              },
            },
          },
        }),
      ),
      onRequest: fastify.authorizeFromSchema,
    },
    assertAuthenticated(async (request, reply) => {
      let dynamoCommand;
      if (request.userRoles?.has(AppRoles.STRIPE_LINK_ADMIN)) {
        dynamoCommand = new ScanCommand({
          TableName: genericConfig.StripeLinksDynamoTableName,
        });
      } else {
        dynamoCommand = new QueryCommand({
          TableName: genericConfig.StripeLinksDynamoTableName,
          KeyConditionExpression: "userId = :userId",
          ExpressionAttributeValues: {
            ":userId": { S: request.username },
          },
        });
      }
      let result;
      try {
        result = await fastify.dynamoClient.send(dynamoCommand);
      } catch (e) {
        if (e instanceof BaseError) {
          throw e;
        }
        request.log.error(e);
        throw new DatabaseFetchError({
          message: "Could not get active links.",
        });
      }

      if (result.Count === 0 || !result.Items) {
        return [];
      }
      const parsed = result.Items.map((item) => unmarshall(item)).map(
        (item) => ({
          id: item.linkId,
          userId: item.userId,
          link: item.url,
          active: item.active,
          invoiceId: item.invoiceId,
          invoiceAmountUsd: item.amount,
          contactName: item.contactName ?? "",
          contactEmail: item.contactEmail ?? "",
          createdAt: item.createdAt || null,
        }),
      );
      reply.status(200).send(parsed);
    }),
  );
  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().post(
    "/paymentLinks",
    {
      schema: withRoles(
        [AppRoles.STRIPE_LINK_CREATOR],
        withTags(["Stripe"], {
          summary: "Create a Stripe payment link.",
          body: createInvoicePostRequestSchema,
          response: {
            201: {
              description: "Invoice created.",
              content: {
                "application/json": { schema: createInvoicePostResponseSchema },
              },
            },
            409: {
              description: "Customer info mismatch.",
              content: {
                "application/json": {
                  schema: createInvoiceConflictResponseSchema,
                },
              },
            },
          },
        }),
      ),
      onRequest: fastify.authorizeFromSchema, // <-- ADD THIS
    },
    assertAuthenticated(async (request, reply) => {
      // <-- WRAP THIS
      await authorizeByOrgRoleOrSchema(fastify, request, reply, {
        validRoles: [{ org: request.body.acmOrg, role: "LEAD" }],
      });

      const emailDomain = request.body.contactEmail.split("@").at(-1)!;

      const addRes = await addInvoice({
        ...request.body,
        createdBy: request.username,
        redisClient: fastify.redisClient,
        dynamoClient: fastify.dynamoClient,
        stripeApiKey: fastify.secretConfig.stripe_secret_key as string,
      });

      if (addRes.needsConfirmation) {
        return reply.status(409).send({
          ...addRes,
          message:
            "Existing Stripe customer info differs; confirmation required before creating invoice.",
        });
      }

      const token = encodeInvoiceToken({
        orgId: request.body.acmOrg,
        emailDomain,
        invoiceId: request.body.invoiceId,
      });

      const baseUrl = getInvoiceBaseUrl(request);

      const isLocal =
        baseUrl.includes("localhost") ||
        baseUrl.includes("127.0.0.1") ||
        baseUrl.includes("0.0.0.0");

      const link = isLocal
        ? `${baseUrl}/api/v1/stripe/pay/${token}`
        : `${baseUrl}/${token}`;

      const linkId = crypto.randomUUID();

      const logStatement = buildAuditLogTransactPut({
        entry: {
          module: Modules.STRIPE,
          actor: request.username,
          target: `Link ${linkId} | Invoice ${request.body.invoiceId}`,
          message: "Created invoice payment link",
        },
      });

      try {
        await fastify.dynamoClient.send(
          new TransactWriteItemsCommand({
            TransactItems: [
              ...(logStatement ? [logStatement] : []),
              {
                Put: {
                  TableName: genericConfig.StripeLinksDynamoTableName,
                  Item: marshall(
                    {
                      userId: request.username,
                      linkId,
                      active: true,
                      amount: request.body.invoiceAmountUsd,
                      createdAt: new Date().toISOString(),
                      invoiceId: request.body.invoiceId,
                      url: link,
                    },
                    { removeUndefinedValues: true },
                  ),
                },
              },
            ],
          }),
        );
      } catch (e) {
        if (e instanceof BaseError) {
          throw e;
        }
        request.log.error(e);
        throw new DatabaseInsertError({
          message: "Could not write invoice payment link to database.",
        });
      }
      return reply.status(201).send({
        id: linkId,
        invoiceId: request.body.invoiceId,
        link,
      });
    }),
  );
  fastify.get("/pay/:token", async (request, reply) => {
    const { token } = request.params as { token: string };
    const query = request.query as { token?: string };

    if (token === "status") {
      if (!query.token) {
        throw new ValidationError({ message: "Missing invoice token." });
      }

      const uiBase = fastify.environmentConfig.UserFacingUrl;
      const redirectUrl = `${uiBase}/stripe/status?token=${encodeURIComponent(query.token)}`;
      return reply.redirect(redirectUrl, 302);
    }

    if (token === "cancel") {
      if (!query.token) {
        throw new ValidationError({ message: "Missing invoice token." });
      }

      return reply.status(200).send({
        cancelled: true,
        token: query.token,
      });
    }

    const { orgId, emailDomain, invoiceId } = decodeInvoiceToken(token);

    const pk = `${orgId}#${emailDomain}`;

    // Fetch invoice
    const invoiceRes = await fastify.dynamoClient.send(
      new QueryCommand({
        TableName: genericConfig.StripePaymentsDynamoTableName,
        KeyConditionExpression: "primaryKey = :pk AND sortKey = :sk",
        ExpressionAttributeValues: {
          ":pk": { S: pk },
          ":sk": { S: `CHARGE#${invoiceId}` },
        },
        ConsistentRead: true,
      }),
    );

    if (!invoiceRes.Items?.length) {
      throw new NotFoundError({ endpointName: request.url });
    }

    // Fetch customer
    const customerRes = await fastify.dynamoClient.send(
      new QueryCommand({
        TableName: genericConfig.StripePaymentsDynamoTableName,
        KeyConditionExpression: "primaryKey = :pk AND sortKey = :sk",
        ExpressionAttributeValues: {
          ":pk": { S: pk },
          ":sk": { S: "CUSTOMER" },
        },
        ConsistentRead: true,
      }),
    );

    if (!customerRes.Items?.length) {
      throw new NotFoundError({ endpointName: request.url });
    }

    const customerId = unmarshall(customerRes.Items[0]).stripeCustomerId;
    const amountUsd = unmarshall(invoiceRes.Items[0]).invoiceAmtUsd;

    const stripe = new Stripe(fastify.secretConfig.stripe_secret_key as string);

    const price = await stripe.prices.create({
      unit_amount: Math.round(amountUsd * 100),
      currency: "usd",
      product_data: {
        name: `Invoice ${invoiceId}`,
      },
    });

    // const baseUrl = getInvoiceBaseUrl(request);

    // const checkoutUrl: string = await createCheckoutSessionWithCustomer({
    //   customerId,
    //   stripeApiKey: fastify.secretConfig.stripe_secret_key as string,
    //   items: [{ price: price.id, quantity: 1 }],
    //   initiator: "invoice-pay",
    //   allowPromotionCodes: true,
    //   successUrl: `${baseUrl}/stripe/status?token=${encodeURIComponent(token)}`,
    //   returnUrl: `${baseUrl}/stripe/cancel?token=${encodeURIComponent(token)}`,
    //   metadata: {
    //     invoice_id: invoiceId,
    //     acm_org: orgId,
    //     pk,
    //   },
    //   statementDescriptorSuffix: maxLength("INVOICE", 7),
    //   delayedSettlementAllowed: true,
    //   allowAchPush: true,
    // });

    const uiBase = fastify.environmentConfig.UserFacingUrl;
    const successUrl = `${uiBase}/stripe/status?token=${encodeURIComponent(token)}`;
    const returnUrl = `${uiBase}/stripe/status?token=${encodeURIComponent(token)}`;

    const checkoutUrl: string = await createCheckoutSessionWithCustomer({
      customerId,
      stripeApiKey: fastify.secretConfig.stripe_secret_key as string,
      items: [{ price: price.id, quantity: 1 }],
      initiator: "invoice-pay",
      allowPromotionCodes: true,
      successUrl,
      returnUrl,
      metadata: {
        invoice_id: invoiceId,
        acm_org: orgId,
        pk,
      },
      statementDescriptorSuffix: maxLength("INVOICE", 7),
      delayedSettlementAllowed: true,
      allowAchPush: true,
    });

    return reply.redirect(checkoutUrl, 302);
  });
  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().get(
    "/status",
    {
      schema: withTags(["Stripe"], {
        summary: "Get public invoice payment status by token.",
        querystring: z.object({
          token: z.string().min(1),
        }),
        response: {
          200: {
            description: "Invoice status retrieved successfully.",
            content: {
              "application/json": {
                schema: z.object({
                  invoiceId: z.string(),
                  acmOrg: z.string(),
                  status: z.enum(["paid", "partial", "pending", "unpaid"]),
                  invoiceAmountUsd: z.number(),
                  paidAmountUsd: z.number(),
                  remainingAmountUsd: z.number(),
                  lastPaidAt: z.string().nullable(),
                }),
              },
            },
          },
        },
      }),
    },
    async (request, reply) => {
      const { token } = request.query as { token: string };
      const { orgId, emailDomain, invoiceId } = decodeInvoiceToken(token);
      const pk = `${orgId}#${emailDomain}`;

      const invoiceRes = await fastify.dynamoClient.send(
        new QueryCommand({
          TableName: genericConfig.StripePaymentsDynamoTableName,
          KeyConditionExpression: "primaryKey = :pk AND sortKey = :sk",
          ExpressionAttributeValues: {
            ":pk": { S: pk },
            ":sk": { S: `CHARGE#${invoiceId}` },
          },
          ConsistentRead: true,
        }),
      );

      if (!invoiceRes.Items?.length) {
        throw new NotFoundError({ endpointName: request.url });
      }

      const invoice = unmarshall(invoiceRes.Items[0]) as {
        invoiceAmtUsd?: number;
        paidAmount?: number;
        lastPaidAt?: string | null;
        pendingPayment?: boolean;
      };

      const invoiceAmountUsd = invoice.invoiceAmtUsd ?? 0;
      const paidAmountUsd = invoice.paidAmount ?? 0;
      const remainingAmountUsd = Math.max(invoiceAmountUsd - paidAmountUsd, 0);
      const lastPaidAt = invoice.lastPaidAt ?? null;

      let status: "paid" | "partial" | "pending" | "unpaid" = "unpaid";

      if (remainingAmountUsd <= 0 && invoiceAmountUsd > 0) {
        status = "paid";
      } else if (paidAmountUsd > 0) {
        status = "partial";
      } else if (invoice.pendingPayment) {
        status = "pending";
      }

      return reply.status(200).send({
        invoiceId,
        acmOrg: orgId,
        status,
        invoiceAmountUsd,
        paidAmountUsd,
        remainingAmountUsd,
        lastPaidAt,
      });
    },
  );
  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().delete(
    "/paymentLinks/:linkId",
    {
      schema: withRoles(
        [AppRoles.STRIPE_LINK_CREATOR],
        withTags(["Stripe"], {
          summary: "Deactivate a Stripe payment link.",
          params: z.object({
            linkId: z.string().min(1).meta({
              description: "Payment Link ID",
              example: "plink_abc123",
            }),
          }),
          response: {
            204: {
              description: "Payment link deleted successfully.",
              content: {
                "application/json": {
                  schema: z.undefined(),
                },
              },
            },
          },
        }),
      ),
      onRequest: fastify.authorizeFromSchema,
    },
    assertAuthenticated(async (request, reply) => {
      const { linkId } = request.params;
      const response = await fastify.dynamoClient.send(
        new QueryCommand({
          TableName: genericConfig.StripeLinksDynamoTableName,
          IndexName: "LinkIdIndex",
          KeyConditionExpression: "linkId = :linkId",
          ExpressionAttributeValues: {
            ":linkId": { S: linkId },
          },
        }),
      );
      if (!response) {
        throw new DatabaseFetchError({
          message: "Could not check for payment link in table.",
        });
      }
      if (!response.Items || response.Items?.length !== 1) {
        throw new NotFoundError({ endpointName: request.url });
      }
      const unmarshalledEntry = unmarshall(response.Items[0]) as {
        userId: string;
        invoiceId: string;
        amount?: number;
        priceId?: string;
        productId?: string;
      };
      if (
        unmarshalledEntry.userId !== request.username &&
        !request.userRoles?.has(AppRoles.STRIPE_LINK_ADMIN)
      ) {
        throw new UnauthorizedError({
          message: "Not authorized to deactivate this payment link.",
        });
      }
      const logStatement = buildAuditLogTransactPut({
        entry: {
          module: Modules.STRIPE,
          actor: request.username,
          target: `Link ${linkId} | Invoice ${unmarshalledEntry.invoiceId}`,
          message: "Deactivated Stripe payment link",
        },
      });
      // expire deleted links
      const expiresAt =
        Math.floor(Date.now() / 1000) +
        86400 *
          (fastify.runEnvironment === "prod"
            ? STRIPE_LINK_RETENTION_DAYS
            : STRIPE_LINK_RETENTION_DAYS_QA);
      const dynamoCommand = new TransactWriteItemsCommand({
        TransactItems: [
          ...(logStatement ? [logStatement] : []),
          {
            Update: {
              TableName: genericConfig.StripeLinksDynamoTableName,
              Key: {
                userId: { S: unmarshalledEntry.userId },
                linkId: { S: linkId },
              },
              UpdateExpression: "SET active = :new_val, expiresAt = :ttl",
              ConditionExpression: "active = :old_val",
              ExpressionAttributeValues: {
                ":new_val": { BOOL: false },
                ":old_val": { BOOL: true },
                ":ttl": { N: expiresAt.toString() },
              },
            },
          },
        ],
      });
      const secretApiConfig =
        (await getSecretValue(
          fastify.secretsManagerClient,
          genericConfig.ConfigSecretName,
        )) || {};
      if (unmarshalledEntry.productId) {
        request.log.debug(
          `Deactivating Stripe product ${unmarshalledEntry.productId}`,
        );
        await deactivateStripeProduct({
          stripeApiKey: secretApiConfig.stripe_secret_key as string,
          productId: unmarshalledEntry.productId,
        });
      }
      request.log.debug(`Deactivating Stripe link ${linkId}`);
      await deactivateStripeLink({
        stripeApiKey: secretApiConfig.stripe_secret_key as string,
        linkId,
      });
      await fastify.dynamoClient.send(dynamoCommand);
      return reply.status(204).send();
    }),
  );
  fastify.post(
    "/webhook",
    {
      config: { rawBody: true },
      schema: withTags(["Stripe"], {
        summary:
          "Stripe webhook handler to track when Stripe payment links are used.",
        hide: true,
      }),
    },
    async (request, reply) => {
      let event: Stripe.Event;
      if (!request.rawBody) {
        throw new ValidationError({ message: "Could not get raw body." });
      }
      const secretApiConfig =
        (await getSecretValue(
          fastify.secretsManagerClient,
          genericConfig.ConfigSecretName,
        )) || {};
      const sessionToInvoiceMeta = (session: Stripe.Checkout.Session) => {
        const invoiceId = session.metadata?.invoice_id;
        const acmOrg = session.metadata?.acm_org;
        const pk = session.metadata?.pk;

        if (!invoiceId || !acmOrg) {
          return null;
        }

        if (pk) {
          const email =
            session.customer_details?.email ?? session.customer_email ?? null;
          return { invoiceId, acmOrg, pk, email };
        }

        const email =
          session.customer_details?.email ?? session.customer_email ?? null;
        if (!email || !email.includes("@")) {
          return null;
        }

        const domain = email.split("@").at(-1)!.toLowerCase();
        return { invoiceId, acmOrg, pk: `${acmOrg}#${domain}`, email };
      };
      try {
        const sig = request.headers["stripe-signature"];
        const sigStr = Array.isArray(sig) ? sig[0] : sig;

        if (sigStr) {
          // Signed webhook flow (unit tests)
          event = Stripe.webhooks.constructEvent(
            request.rawBody,
            sigStr,
            secretApiConfig.stripe_links_endpoint_secret as string,
          );
        } else {
          // Fallback flow: body = { id }, retrieve from Stripe
          const body = request.body as { id?: string };
          if (!body?.id || typeof body.id !== "string") {
            throw new ValidationError({
              message: "Missing event ID in webhook payload.",
            });
          }
          const stripeClient = new Stripe(
            fastify.secretConfig.stripe_secret_key as string,
          );
          event = await stripeClient.events.retrieve(body.id);
        }
      } catch (err: unknown) {
        if (err instanceof BaseError) {
          throw err;
        }
        throw new ValidationError({
          message: "Stripe webhook could not be validated.",
        });
      }
      switch (event.type) {
        case "checkout.session.async_payment_failed":
          if (event.data.object.payment_link) {
            const eventId = event.id;
            const paymentAmount = event.data.object.amount_total;
            const paymentCurrency = event.data.object.currency;
            const { email, name } = event.data.object.customer_details || {
              email: null,
              name: null,
            };
            const paymentLinkId = event.data.object.payment_link.toString();
            if (!paymentLinkId || !paymentCurrency || !paymentAmount) {
              request.log.info("Missing required fields.");
              return reply
                .code(200)
                .send({ handled: false, requestId: request.id });
            }
            const response = await fastify.dynamoClient.send(
              new QueryCommand({
                TableName: genericConfig.StripeLinksDynamoTableName,
                IndexName: "LinkIdIndex",
                KeyConditionExpression: "linkId = :linkId",
                ExpressionAttributeValues: {
                  ":linkId": { S: paymentLinkId },
                },
              }),
            );
            if (!response) {
              throw new DatabaseFetchError({
                message: "Could not check for payment link in table.",
              });
            }
            if (!response.Items || response.Items?.length !== 1) {
              return reply.status(200).send({
                handled: false,
                requestId: request.id,
              });
            }
            const unmarshalledEntry = unmarshall(response.Items[0]) as {
              userId: string;
              invoiceId: string;
              amount?: number;
              priceId?: string;
              productId?: string;
            };
            if (!unmarshalledEntry.userId || !unmarshalledEntry.invoiceId) {
              return reply.status(200).send({
                handled: false,
                requestId: request.id,
              });
            }
            const paidInFull = paymentAmount === unmarshalledEntry.amount;
            const withCurrency = new Intl.NumberFormat("en-US", {
              style: "currency",
              currency: paymentCurrency.toUpperCase(),
            })
              .formatToParts(paymentAmount / 100)
              .map((val) => val.value)
              .join("");

            // Notify link owner of failed payment
            let queueId;
            if (event.data.object.payment_status === "unpaid") {
              request.log.info(
                `Failed payment of ${withCurrency} by ${name} (${email}) for payment link ${paymentLinkId} invoice ID ${unmarshalledEntry.invoiceId}).`,
              );
              if (unmarshalledEntry.userId.includes("@")) {
                request.log.info(
                  `Sending email to ${unmarshalledEntry.userId}...`,
                );
                const sqsPayload: SQSPayload<AvailableSQSFunctions.EmailNotifications> =
                  {
                    function: AvailableSQSFunctions.EmailNotifications,
                    metadata: {
                      initiator: eventId,
                      reqId: request.id,
                    },
                    payload: {
                      to: getAllUserEmails(unmarshalledEntry.userId),
                      subject: `Payment Failed for Invoice ${unmarshalledEntry.invoiceId}`,
                      content: `
A ${paidInFull ? "full" : "partial"} payment for Invoice ${unmarshalledEntry.invoiceId} (${withCurrency} paid by ${name}, ${email}) <b>has failed.</b>

Please ask the payee to try again, perhaps with a different payment method, or contact Officer Board.
                    `,
                      callToActionButton: {
                        name: "View Your Stripe Links",
                        url: `${fastify.environmentConfig.UserFacingUrl}/stripe`,
                      },
                    },
                  };
                if (!fastify.sqsClient) {
                  fastify.sqsClient = new SQSClient({
                    region: genericConfig.AwsRegion,
                  });
                }
                const result = await fastify.sqsClient.send(
                  new SendMessageCommand({
                    QueueUrl: fastify.environmentConfig.SqsQueueUrl,
                    MessageBody: JSON.stringify(sqsPayload),
                    MessageGroupId: "invoiceNotification",
                  }),
                );
                queueId = result.MessageId || "";
              }
            }

            return reply.status(200).send({
              handled: true,
              requestId: request.id,
              queueId: queueId || "",
            });
          }
          return reply
            .code(200)
            .send({ handled: false, requestId: request.id });
        case "checkout.session.async_payment_succeeded":
        case "checkout.session.completed":
          const session = event.data.object as Stripe.Checkout.Session;

          const meta = sessionToInvoiceMeta(session);
          if (meta) {
            const pk = meta.pk;

            const amountCents = session.amount_total ?? 0;
            const currency = session.currency ?? "usd";
            const checkoutSessionId = session.id;
            const paymentIntentId = session.payment_intent?.toString() ?? null;

            let pendingAmountCents = amountCents;

            if (
              event.type === "checkout.session.completed" &&
              paymentIntentId
            ) {
              const stripeClient = new Stripe(
                fastify.secretConfig.stripe_secret_key as string,
              );

              const paymentIntent =
                await stripeClient.paymentIntents.retrieve(paymentIntentId);

              const amountRemaining =
                paymentIntent.next_action?.display_bank_transfer_instructions
                  ?.amount_remaining;

              if (typeof amountRemaining === "number") {
                pendingAmountCents = amountRemaining;
              }
            }

            const shouldSendPendingEmail =
              event.type === "checkout.session.completed";

            const shouldSendReceivedEmail =
              event.type === "checkout.session.async_payment_succeeded";

            const invoiceRecordRes = await fastify.dynamoClient.send(
              new QueryCommand({
                TableName: genericConfig.StripePaymentsDynamoTableName,
                KeyConditionExpression: "primaryKey = :pk AND sortKey = :sk",
                ExpressionAttributeValues: {
                  ":pk": { S: pk },
                  ":sk": { S: `CHARGE#${meta.invoiceId}` },
                },
                ConsistentRead: true,
              }),
            );

            const invoiceRecord = invoiceRecordRes.Items?.[0]
              ? unmarshall(invoiceRecordRes.Items[0])
              : null;

            const createdBy =
              typeof invoiceRecord?.createdBy === "string"
                ? invoiceRecord.createdBy
                : null;

            // decrement owed only when actually settled/paid:
            const decrementOwed =
              event.type === "checkout.session.async_payment_succeeded";

            const invoiceAmountUsd =
              typeof invoiceRecord?.invoiceAmtUsd === "number"
                ? invoiceRecord.invoiceAmtUsd
                : 0;

            const alreadyPaidUsd =
              typeof invoiceRecord?.paidAmount === "number"
                ? invoiceRecord.paidAmount
                : 0;

            const effectiveAmountCents =
              event.type === "checkout.session.completed"
                ? pendingAmountCents
                : amountCents;

            const thisPaymentUsd = effectiveAmountCents / 100;

            const remainingBeforePaymentUsd = Math.max(
              invoiceAmountUsd - alreadyPaidUsd,
              0,
            );

            const isFullPaymentForInvoice =
              thisPaymentUsd >= remainingBeforePaymentUsd;

            const paymentKind = isFullPaymentForInvoice ? "full" : "partial";

            const remainingAfterPaymentUsd = Math.max(
              invoiceAmountUsd - alreadyPaidUsd - thisPaymentUsd,
              0,
            );

            const remainingAfterFormatted = new Intl.NumberFormat("en-US", {
              style: "currency",
              currency: currency.toUpperCase(),
            }).format(remainingAfterPaymentUsd);

            const amountFormatted = new Intl.NumberFormat("en-US", {
              style: "currency",
              currency: currency.toUpperCase(),
            }).format(effectiveAmountCents / 100);

            const payerEmail =
              meta.email ??
              session.customer_details?.email ??
              session.customer_email ??
              "unknown";

            const overpaidUsd = Math.max(
              thisPaymentUsd - remainingBeforePaymentUsd,
              0,
            );

            const overpaidFormatted = new Intl.NumberFormat("en-US", {
              style: "currency",
              currency: currency.toUpperCase(),
            }).format(overpaidUsd);

            if (!decrementOwed) {
              request.log.info(
                `Not recording payment for invoice ${meta.invoiceId} because payment not settled yet (status=${session.payment_status}, event=${event.type}).`,
              );

              let queueId;

              if (shouldSendPendingEmail && createdBy?.includes("@")) {
                const sqsPayload: SQSPayload<AvailableSQSFunctions.EmailNotifications> =
                  {
                    function: AvailableSQSFunctions.EmailNotifications,
                    metadata: {
                      initiator: event.id,
                      reqId: request.id,
                    },
                    payload: {
                      to: getAllUserEmails(createdBy),
                      subject: `Payment pending for Invoice ${meta.invoiceId}`,
                      content: `
                    ACM @ UIUC has received intent of ${paymentKind} payment for Invoice ${meta.invoiceId} (${amountFormatted} attempted by ${payerEmail}).

                    The payee used a payment method that does not settle immediately. No services should be performed until the funds settle.

                    ${
                      overpaidUsd > 0
                        ? `This payment attempt exceeds the remaining balance by ${overpaidFormatted}. If the funds settle successfully, the invoice will be fully paid and the excess should be treated as an overpayment.`
                        : isFullPaymentForInvoice
                          ? "If these funds settle successfully, this invoice will be fully paid."
                          : `If these funds settle successfully, this invoice will still be partially paid. Remaining balance after settlement would be ${remainingAfterFormatted}.`
                    }

                    Please contact Officer Board with any questions.
                    `,
                      callToActionButton: {
                        name: "View Your Stripe Links",
                        url: `${fastify.environmentConfig.UserFacingUrl}/stripe`,
                      },
                    },
                  };

                if (!fastify.sqsClient) {
                  fastify.sqsClient = new SQSClient({
                    region: genericConfig.AwsRegion,
                  });
                }

                const result = await fastify.sqsClient.send(
                  new SendMessageCommand({
                    QueueUrl: fastify.environmentConfig.SqsQueueUrl,
                    MessageBody: JSON.stringify(sqsPayload),
                    MessageGroupId: "invoiceNotification",
                  }),
                );
                queueId = result.MessageId || "";
              }

              return reply.status(200).send({
                handled: true,
                requestId: request.id,
                queueId: queueId || "",
              });
            }

            let queueId;

            try {
              await recordInvoicePayment({
                dynamoClient: fastify.dynamoClient,
                pk,
                invoiceId: meta.invoiceId,
                eventId: event.id,
                checkoutSessionId,
                paymentIntentId,
                amountCents,
                currency,
                billingEmail:
                  meta.email ??
                  session.customer_details?.email ??
                  session.customer_email ??
                  "unknown",
                decrementOwed,
              });

              await deactivatePaymentLink({
                dynamoClient: fastify.dynamoClient,
                pk,
                invoiceId: meta.invoiceId,
                linkId: event.data.object.payment_link!.toString(),
              });
            } catch (e: unknown) {
              if (
                (e as { name?: string })?.name ===
                "TransactionCanceledException"
              ) {
                request.log.info(
                  `Duplicate webhook event ${event.id}, acknowledging.`,
                );
                return reply
                  .status(200)
                  .send({ handled: true, requestId: request.id });
              }
              throw e;
            }

            if (shouldSendReceivedEmail && createdBy?.includes("@")) {
              const amountFormatted = new Intl.NumberFormat("en-US", {
                style: "currency",
                currency: currency.toUpperCase(),
              }).format(amountCents / 100);

              const payerEmail =
                meta.email ??
                session.customer_details?.email ??
                session.customer_email ??
                "unknown";

              const sqsPayload: SQSPayload<AvailableSQSFunctions.EmailNotifications> =
                {
                  function: AvailableSQSFunctions.EmailNotifications,
                  metadata: {
                    initiator: event.id,
                    reqId: request.id,
                  },
                  payload: {
                    to: getAllUserEmails(createdBy),
                    cc: [
                      notificationRecipients[fastify.runEnvironment].Treasurer,
                    ],
                    subject: `Payment received for Invoice ${meta.invoiceId}`,
                    content: `
                    ACM @ UIUC has received ${paymentKind} payment for Invoice ${meta.invoiceId} (${amountFormatted} paid by ${payerEmail}).

                    ${
                      overpaidUsd > 0
                        ? `This invoice is now settled. This payment exceeded the remaining balance by ${overpaidFormatted}.`
                        : isFullPaymentForInvoice
                          ? "This invoice should now be considered settled."
                          : `This invoice has not yet been paid in full. Remaining balance: ${remainingAfterFormatted}.`
                    }

                    Please contact Officer Board with any questions.
                    `,
                    callToActionButton: {
                      name: "View Your Stripe Links",
                      url: `${fastify.environmentConfig.UserFacingUrl}/stripe`,
                    },
                  },
                };

              if (!fastify.sqsClient) {
                fastify.sqsClient = new SQSClient({
                  region: genericConfig.AwsRegion,
                });
              }

              const result = await fastify.sqsClient.send(
                new SendMessageCommand({
                  QueueUrl: fastify.environmentConfig.SqsQueueUrl,
                  MessageBody: JSON.stringify(sqsPayload),
                  MessageGroupId: "invoiceNotification",
                }),
              );
              queueId = result.MessageId || "";
            }

            return reply.status(200).send({
              handled: true,
              requestId: request.id,
              queueId: queueId || "",
            });
          }

          if (event.data.object.payment_link) {
            const eventId = event.id;
            const paymentAmount = event.data.object.amount_total;
            const paymentCurrency = event.data.object.currency;
            const paymentIntentId =
              event.data.object.payment_intent?.toString();
            if (!paymentIntentId) {
              request.log.warn(
                "Could not find payment intent ID in webhook payload!",
              );
              throw new ValidationError({
                message: "No payment intent ID found.",
              });
            }
            const stripeApiKey = fastify.secretConfig.stripe_secret_key;
            const paymentMethodData = await getPaymentMethodForPaymentIntent({
              paymentIntentId,
              stripeApiKey,
            });
            const paymentMethodType =
              paymentMethodData.type.toString() as SupportedStripePaymentMethod;
            if (
              !supportedStripePaymentMethods.includes(
                paymentMethodData.type.toString() as SupportedStripePaymentMethod,
              )
            ) {
              throw new InternalServerError({
                internalLog: `Unknown payment method type ${paymentMethodData.type}!`,
              });
            }
            const paymentMethodDescriptionData =
              paymentMethodData[paymentMethodType];
            if (!paymentMethodDescriptionData) {
              throw new InternalServerError({
                internalLog: `No payment method data for ${paymentMethodData.type}!`,
              });
            }
            const paymentMethodString = getPaymentMethodDescriptionString({
              paymentMethod: paymentMethodData,
              paymentMethodType,
            });
            const { email, name } = event.data.object.customer_details || {
              email: null,
              name: null,
            };
            const paymentLinkId = event.data.object.payment_link.toString();
            if (!paymentLinkId || !paymentCurrency || !paymentAmount) {
              request.log.info("Missing required fields.");
              return reply
                .code(200)
                .send({ handled: false, requestId: request.id });
            }
            const response = await fastify.dynamoClient.send(
              new QueryCommand({
                TableName: genericConfig.StripeLinksDynamoTableName,
                IndexName: "LinkIdIndex",
                KeyConditionExpression: "linkId = :linkId",
                ExpressionAttributeValues: {
                  ":linkId": { S: paymentLinkId },
                },
              }),
            );
            if (!response) {
              throw new DatabaseFetchError({
                message: "Could not check for payment link in table.",
              });
            }
            if (!response.Items || response.Items?.length !== 1) {
              return reply.status(200).send({
                handled: false,
                requestId: request.id,
              });
            }
            const unmarshalledEntry = unmarshall(response.Items[0]) as {
              userId: string;
              invoiceId: string;
              amount?: number;
              priceId?: string;
              productId?: string;
            };
            if (!unmarshalledEntry.userId || !unmarshalledEntry.invoiceId) {
              return reply.status(200).send({
                handled: false,
                requestId: request.id,
              });
            }
            const paidInFull = paymentAmount === unmarshalledEntry.amount;

            const withCurrency = new Intl.NumberFormat("en-US", {
              style: "currency",
              currency: paymentCurrency.toUpperCase(),
            })
              .formatToParts(paymentAmount / 100)
              .map((val) => val.value)
              .join("");

            // Notify link owner of payment
            let queueId;
            if (event.data.object.payment_status === "unpaid") {
              request.log.info(
                `Pending payment of ${withCurrency} by ${name} (${email}) for payment link ${paymentLinkId} invoice ID ${unmarshalledEntry.invoiceId}). Invoice was tentatively paid ${paidInFull ? "in full." : "partially."}`,
              );
              if (unmarshalledEntry.userId.includes("@")) {
                request.log.info(
                  `Sending email to ${unmarshalledEntry.userId}...`,
                );
                const sqsPayload: SQSPayload<AvailableSQSFunctions.EmailNotifications> =
                  {
                    function: AvailableSQSFunctions.EmailNotifications,
                    metadata: {
                      initiator: eventId,
                      reqId: request.id,
                    },
                    payload: {
                      to: getAllUserEmails(unmarshalledEntry.userId), // say how much they tried to paid, won't be confirmed until we received full payment - also tell if they overpaid
                      subject: `Payment pending for Invoice ${unmarshalledEntry.invoiceId}`,
                      content: `
                        ACM @ UIUC has received intent of ${paidInFull ? "full" : "partial"} payment for Invoice ${unmarshalledEntry.invoiceId} (${withCurrency} paid by ${email ?? "unknown"}).

                        The payee has used a payment method which does not settle funds immediately. Therefore, ACM @ UIUC is still waiting for funds to settle and <b>no services should be performed until the funds settle.</b>

                        ${
                          paidInFull
                            ? "If these funds settle successfully, this invoice will be fully paid."
                            : "If these funds settle successfully, this invoice will still be partially paid."
                        }

                        Please contact Officer Board with any questions.
                        `,
                      callToActionButton: {
                        name: "View Your Stripe Links",
                        url: `${fastify.environmentConfig.UserFacingUrl}/stripe`,
                      },
                    },
                  };
                if (!fastify.sqsClient) {
                  fastify.sqsClient = new SQSClient({
                    region: genericConfig.AwsRegion,
                  });
                }
                const result = await fastify.sqsClient.send(
                  new SendMessageCommand({
                    QueueUrl: fastify.environmentConfig.SqsQueueUrl,
                    MessageBody: JSON.stringify(sqsPayload),
                    MessageGroupId: "invoiceNotification",
                  }),
                );
                queueId = result.MessageId || "";
              }
            } else {
              request.log.info(
                `Registered payment of ${withCurrency} by ${name} (${email}) for payment link ${paymentLinkId} invoice ID ${unmarshalledEntry.invoiceId}). Invoice was paid ${paidInFull ? "in full." : "partially."}`,
              );
              if (unmarshalledEntry.userId.includes("@")) {
                request.log.info(
                  `Sending email to ${unmarshalledEntry.userId}...`,
                );
                const sqsPayload: SQSPayload<AvailableSQSFunctions.EmailNotifications> =
                  {
                    function: AvailableSQSFunctions.EmailNotifications,
                    metadata: {
                      initiator: eventId,
                      reqId: request.id,
                    },
                    payload: {
                      to: getAllUserEmails(unmarshalledEntry.userId),
                      cc: [
                        notificationRecipients[fastify.runEnvironment]
                          .Treasurer,
                      ],
                      subject: `Payment received for Invoice ${unmarshalledEntry.invoiceId}`,
                      content: `
ACM @ UIUC has received ${paidInFull ? "full" : "partial"} payment for Invoice ${unmarshalledEntry.invoiceId} (${withCurrency} paid by ${name}, ${email}).

${paymentMethodString ? `\nPayment method: ${paymentMethodString}.\n` : ""}

${paidInFull ? "\nThis invoice should now be considered settled.\n" : ""}
Please contact Officer Board with any questions.`,
                      callToActionButton: {
                        name: "View Your Stripe Links",
                        url: `${fastify.environmentConfig.UserFacingUrl}/stripe`,
                      },
                    },
                  };
                if (!fastify.sqsClient) {
                  fastify.sqsClient = new SQSClient({
                    region: genericConfig.AwsRegion,
                  });
                }
                const result = await fastify.sqsClient.send(
                  new SendMessageCommand({
                    QueueUrl: fastify.environmentConfig.SqsQueueUrl,
                    MessageBody: JSON.stringify(sqsPayload),
                    MessageGroupId: "invoiceNotification",
                  }),
                );
                queueId = result.MessageId || "";
              }
              // If full payment is done, disable the link
              if (paidInFull) {
                request.log.debug("Paid in full, disabling link.");
                const logStatement = buildAuditLogTransactPut({
                  entry: {
                    module: Modules.STRIPE,
                    actor: eventId,
                    target: `Link ${paymentLinkId} | Invoice ${unmarshalledEntry.invoiceId}`,
                    message:
                      "Disabled Stripe payment link as payment was made in full.",
                  },
                });
                const dynamoCommand = new TransactWriteItemsCommand({
                  TransactItems: [
                    ...(logStatement ? [logStatement] : []),
                    {
                      Update: {
                        TableName: genericConfig.StripeLinksDynamoTableName,
                        Key: {
                          userId: { S: unmarshalledEntry.userId },
                          linkId: { S: paymentLinkId },
                        },
                        UpdateExpression:
                          "SET active = :new_val, expiresAt = :ttl",
                        ConditionExpression: "active = :old_val",
                        ExpressionAttributeValues: {
                          ":new_val": { BOOL: false },
                          ":old_val": { BOOL: true },
                          ":ttl": {
                            N: (
                              Math.floor(Date.now() / 1000) +
                              86400 * STRIPE_LINK_RETENTION_DAYS
                            ).toString(),
                          },
                        },
                      },
                    },
                  ],
                });
                if (unmarshalledEntry.productId) {
                  request.log.debug(
                    `Deactivating Stripe product ${unmarshalledEntry.productId}`,
                  );
                  await deactivateStripeProduct({
                    stripeApiKey: secretApiConfig.stripe_secret_key as string,
                    productId: unmarshalledEntry.productId,
                  });
                }
                request.log.debug(`Deactivating Stripe link ${paymentLinkId}`);
                await deactivateStripeLink({
                  stripeApiKey: secretApiConfig.stripe_secret_key as string,
                  linkId: paymentLinkId,
                });
                await fastify.dynamoClient.send(dynamoCommand);
              }
            }

            return reply.status(200).send({
              handled: true,
              requestId: request.id,
              queueId: queueId || "",
            });
          }
          return reply
            .code(200)
            .send({ handled: false, requestId: request.id });
        case "payment_intent.partially_funded": {
          const intent = event.data.object as Stripe.PaymentIntent;

          const amountReceived = intent.amount_received ?? 0;
          const currency = intent.currency ?? "usd";
          const billingEmail =
            intent.receipt_email ?? intent.metadata?.billing_email ?? null;
          const acmOrg = intent.metadata?.acm_org;
          const invoiceId = intent.metadata?.invoice_id;

          if (!billingEmail || !acmOrg || !invoiceId) {
            request.log.info(
              "Skipping partially funded payment intent due to missing metadata/email.",
            );
            return reply
              .code(200)
              .send({ handled: false, requestId: request.id });
          }

          if (!billingEmail.includes("@")) {
            request.log.warn(
              "Invalid billing email for partially funded payment intent.",
            );
            return reply
              .code(200)
              .send({ handled: false, requestId: request.id });
          }

          const domain = billingEmail.split("@").at(-1)!.toLowerCase();
          const pk = `${acmOrg}#${domain}`;

          const invoiceRecordRes = await fastify.dynamoClient.send(
            new QueryCommand({
              TableName: genericConfig.StripePaymentsDynamoTableName,
              KeyConditionExpression: "primaryKey = :pk AND sortKey = :sk",
              ExpressionAttributeValues: {
                ":pk": { S: pk },
                ":sk": { S: `CHARGE#${invoiceId}` },
              },
              ConsistentRead: true,
            }),
          );

          const invoiceRecord = invoiceRecordRes.Items?.[0]
            ? unmarshall(invoiceRecordRes.Items[0])
            : null;

          const createdBy =
            typeof invoiceRecord?.createdBy === "string"
              ? invoiceRecord.createdBy
              : null;

          const invoiceAmountUsd =
            typeof invoiceRecord?.invoiceAmtUsd === "number"
              ? invoiceRecord.invoiceAmtUsd
              : 0;

          const alreadyPaidUsd =
            typeof invoiceRecord?.paidAmount === "number"
              ? invoiceRecord.paidAmount
              : 0;

          const thisPaymentUsd = amountReceived / 100 - alreadyPaidUsd;
          const remainingAfterPaymentUsd = Math.max(
            invoiceAmountUsd - alreadyPaidUsd - thisPaymentUsd,
            0,
          );

          if (createdBy?.includes("@")) {
            const amountFormatted = new Intl.NumberFormat("en-US", {
              style: "currency",
              currency: currency.toUpperCase(),
            }).format(thisPaymentUsd);

            const remainingAfterFormatted = new Intl.NumberFormat("en-US", {
              style: "currency",
              currency: currency.toUpperCase(),
            }).format(remainingAfterPaymentUsd);

            const sqsPayload: SQSPayload<AvailableSQSFunctions.EmailNotifications> =
              {
                function: AvailableSQSFunctions.EmailNotifications,
                metadata: {
                  initiator: event.id,
                  reqId: request.id,
                },
                payload: {
                  to: getAllUserEmails(createdBy),
                  cc: [
                    notificationRecipients[fastify.runEnvironment].Treasurer,
                  ],
                  subject: `Partial payment received for Invoice ${invoiceId}`,
                  content: `
                ACM @ UIUC has received a partial payment for Invoice ${invoiceId} (${amountFormatted} paid by ${billingEmail}).

                This invoice has not yet been paid in full. Remaining balance: ${remainingAfterFormatted}.

                Please contact Officer Board with any questions.
                `,
                  callToActionButton: {
                    name: "View Your Stripe Links",
                    url: `${fastify.environmentConfig.UserFacingUrl}/stripe`,
                  },
                },
              };

            if (!fastify.sqsClient) {
              fastify.sqsClient = new SQSClient({
                region: genericConfig.AwsRegion,
              });
            }

            const result = await fastify.sqsClient.send(
              new SendMessageCommand({
                QueueUrl: fastify.environmentConfig.SqsQueueUrl,
                MessageBody: JSON.stringify(sqsPayload),
                MessageGroupId: "invoiceNotification",
              }),
            );

            const queueId = result.MessageId || "";

            return reply.status(200).send({
              handled: true,
              requestId: request.id,
              queueId,
            });
          }

          return reply.status(200).send({
            handled: true,
            requestId: request.id,
          });
        }
        case "payment_intent.succeeded": {
          const intent = event.data.object as Stripe.PaymentIntent;

          const amount = intent.amount_received;
          const currency = intent.currency;
          const customerId = intent.customer?.toString();
          const email = intent.receipt_email ?? intent.metadata?.billing_email;
          const acmOrg = intent.metadata?.acm_org;

          if (!customerId) {
            request.log.info("Skipping payment intent with no customer ID.");
            return reply
              .code(200)
              .send({ handled: false, requestId: request.id });
          }

          if (!email) {
            request.log.warn("Missing email for payment intent.");
            return reply
              .code(200)
              .send({ handled: false, requestId: request.id });
          }

          if (!acmOrg) {
            request.log.warn("Missing acm_org for payment intent.");
            return reply
              .code(200)
              .send({ handled: false, requestId: request.id });
          }

          const normalizedEmail = email.trim();
          if (!normalizedEmail.includes("@")) {
            request.log.warn("Invalid email format for payment intent.");
            return reply
              .code(200)
              .send({ handled: false, requestId: request.id });
          }
          const [, domainPart] = normalizedEmail.split("@");
          if (!domainPart) {
            request.log.warn(
              "Could not derive email domain for payment intent.",
            );
            return reply
              .code(200)
              .send({ handled: false, requestId: request.id });
          }
          const domain = domainPart.toLowerCase();

          try {
            await fastify.dynamoClient.send(
              new PutItemCommand({
                TableName: genericConfig.StripePaymentsDynamoTableName,
                Item: marshall({
                  primaryKey: `${acmOrg}#${domain}`,
                  sortKey: event.id,
                  amount,
                  currency,
                  status: "succeeded",
                  billingEmail: normalizedEmail,
                  createdAt: new Date().toISOString(),
                  eventId: event.id,
                }),
              }),
            );

            request.log.info(
              `Recorded successful payment ${intent.id} from ${normalizedEmail} (${amount} ${currency})`,
            );

            return reply
              .status(200)
              .send({ handled: true, requestId: request.id });
          } catch (e) {
            if (e instanceof BaseError) {
              throw e;
            }
            request.log.error(e);
            throw new DatabaseInsertError({
              message: `Could not insert Stripe payment record: ${(e as Error).message}`,
            });
          }
        }
        default:
          request.log.warn(`Unhandled event type: ${event.type}`);
      }
      return reply.code(200).send({ handled: false, requestId: request.id });
    },
  );
};

export default stripeRoutes;
