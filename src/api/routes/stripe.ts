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
  createStripeLink,
  createCheckoutSessionWithCustomer,
  deactivateStripeLink,
  deactivateStripeProduct,
  getPaymentMethodDescriptionString,
  getPaymentMethodForPaymentIntent,
  StripeLinkCreateParams,
  InvoiceAddParams,
  SupportedStripePaymentMethod,
  supportedStripePaymentMethods,
  recordInvoicePayment,
} from "api/functions/stripe.js";
import { getSecretValue } from "api/plugins/auth.js";
import { genericConfig, notificationRecipients } from "common/config.js";
import {
  BaseError,
  DatabaseFetchError,
  DatabaseInsertError,
  InternalServerError,
  NotFoundError,
  UnauthenticatedError,
  UnauthorizedError,
  ValidationError,
} from "common/errors/index.js";
import { Modules } from "common/modules.js";
import { AppRoles } from "common/roles.js";
import {
  invoiceLinkGetResponseSchema,
  invoiceLinkPostRequestSchema,
  invoiceLinkPostResponseSchema,
  createInvoicePostRequestSchema,
  createInvoiceConflictResponseSchema,
  createInvoicePostResponseSchema,
} from "common/types/stripe.js";
import { FastifyPluginAsync } from "fastify";
import { FastifyZodOpenApiTypeProvider } from "fastify-zod-openapi";
import stripe, { Stripe } from "stripe";
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

const stripeRoutes: FastifyPluginAsync = async (fastify, _options) => {
  await fastify.register(rawbody, {
    field: "rawBody",
    global: false,
    runFirst: true,
  });
  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().get(
    "/paymentLinks",
    {
      schema: withRoles(
        [AppRoles.STRIPE_LINK_CREATOR],
        withTags(["Stripe"], {
          summary: "Get available Stripe payment links.",
          response: {
            201: {
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
          createdAt: item.createdAt || null,
        }),
      );
      reply.status(200).send(parsed);
    }),
  );
  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().post(
    "/createInvoice",
    {
      schema: withRoles(
        [AppRoles.STRIPE_LINK_CREATOR],
        withTags(["Stripe"], {
          summary: "Create an invoice (no Stripe side effects).",
          body: createInvoicePostRequestSchema,
          response: {
            201: {
              description: "Invoice created.",
              content: {
                "application/json": {
                  schema: createInvoicePostResponseSchema,
                },
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
      onRequest: fastify.authorizeFromSchema,
    },
    async (request, reply) => {
      const emailDomain = request.body.contactEmail.split("@").at(-1)!;

      const result = await addInvoice({
        ...request.body,
        emailDomain,
        redisClient: fastify.redisClient,
        dynamoClient: fastify.dynamoClient,
        stripeApiKey: fastify.secretConfig.stripe_secret_key as string,
      });

      if (result.needsConfirmation) {
        return reply.status(409).send({
          needsConfirmation: true,
          customerId: result.customerId,
          current: result.current,
          incoming: result.incoming,
          message: "Customer info differs. Confirm update before proceeding.",
        });
      }

      const token = encodeInvoiceToken({
        orgId: request.body.acmOrg,
        emailDomain,
        invoiceId: request.body.invoiceId,
      });

      return reply.status(201).send({
        id: request.body.invoiceId,
        link: `${fastify.environmentConfig.UserFacingUrl}/api/v1/stripe/pay/${token}`, // http:127.0.1.1:8080 for local
      });
    },
  );
  fastify.get("/pay/:token", async (request, reply) => {
    const { token } = request.params as { token: string };

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
      unit_amount: amountUsd * 100,
      currency: "usd",
      product_data: {
        name: `Invoice ${invoiceId}`,
      },
    });

    const checkoutUrl: string = await createCheckoutSessionWithCustomer({
      customerId,
      stripeApiKey: fastify.secretConfig.stripe_secret_key as string,
      items: [{ price: price.id, quantity: 1 }],
      initiator: "invoice-pay",
      allowPromotionCodes: true,
      successUrl: `${fastify.environmentConfig.UserFacingUrl}/success`,
      returnUrl: `${fastify.environmentConfig.UserFacingUrl}/cancel`,
      metadata: {
        invoice_id: invoiceId,
        acm_org: orgId,
      },
      statementDescriptorSuffix: maxLength("INVOICE", 7),
      delayedSettlementAllowed: true,
    });

    return reply.redirect(checkoutUrl, 302);
  });
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

        const email =
          session.customer_details?.email ?? session.customer_email ?? null;

        if (!invoiceId || !acmOrg) {
          return null;
        }
        if (!email || !email.includes("@")) {
          return null;
        }

        const domain = email.split("@").at(-1)!.toLowerCase();
        return { invoiceId, acmOrg, email, domain };
      };
      try {
        const sig = request.headers["stripe-signature"];
        if (!sig || typeof sig !== "string") {
          throw new Error("Missing or invalid Stripe signature");
        }
        if (!secretApiConfig) {
          throw new InternalServerError({
            message: "Could not connect to Stripe.",
          });
        }
        event = stripe.webhooks.constructEvent(
          request.rawBody,
          sig,
          secretApiConfig.stripe_links_endpoint_secret as string,
        );
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
            const pk = `${meta.acmOrg}#${meta.domain}`;

            const amountCents = session.amount_total ?? 0;
            const currency = session.currency ?? "usd";
            const checkoutSessionId = session.id;
            const paymentIntentId = session.payment_intent?.toString() ?? null;

            // decrement owed only when actually settled/paid:
            const decrementOwed =
              session.payment_status === "paid" ||
              event.type === "checkout.session.async_payment_succeeded";

            await recordInvoicePayment({
              dynamoClient: fastify.dynamoClient,
              pk,
              invoiceId: meta.invoiceId,
              eventId: event.id,
              checkoutSessionId,
              paymentIntentId,
              amountCents,
              currency,
              billingEmail: meta.email,
              decrementOwed,
            });

            return reply
              .status(200)
              .send({ handled: true, requestId: request.id });
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
                      to: getAllUserEmails(unmarshalledEntry.userId),
                      subject: `Payment Pending for Invoice ${unmarshalledEntry.invoiceId}`,
                      content: `
ACM @ UIUC has received intent of ${paidInFull ? "full" : "partial"} payment for Invoice ${unmarshalledEntry.invoiceId} (${withCurrency} paid by ${name}, ${email}).

The payee has used a payment method which does not settle funds immediately. Therefore, ACM @ UIUC is still waiting for funds to settle and <b>no services should be performed until the funds settle.</b>

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
