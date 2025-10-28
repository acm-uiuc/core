import {
  QueryCommand,
  ScanCommand,
  TransactWriteItemsCommand,
  UpdateItemCommand,
  PutItemCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { withRoles, withTags } from "api/components/index.js";
import { buildAuditLogTransactPut } from "api/functions/auditLog.js";
import {
  createStripeLink,
  deactivateStripeLink,
  deactivateStripeProduct,
  getPaymentMethodDescriptionString,
  getPaymentMethodForPaymentIntent,
  paymentMethodTypeToFriendlyName,
  StripeLinkCreateParams,
  SupportedStripePaymentMethod,
  supportedStripePaymentMethods,
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
  invoiceLinkPostResponseSchema,
  invoiceLinkPostRequestSchema,
  invoiceLinkGetResponseSchema,
} from "common/types/stripe.js";
import { FastifyPluginAsync } from "fastify";
import { FastifyZodOpenApiTypeProvider } from "fastify-zod-openapi";
import stripe, { Stripe } from "stripe";
import rawbody from "fastify-raw-body";
import { AvailableSQSFunctions, SQSPayload } from "common/types/sqsMessage.js";
import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import * as z from "zod/v4";
import { getAllUserEmails } from "common/utils.js";
import { STRIPE_LINK_RETENTION_DAYS } from "common/constants.js";

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
        }),
      ),
      onRequest: fastify.authorizeFromSchema,
    },
    async (request, reply) => {
      let dynamoCommand;
      if (request.userRoles?.has(AppRoles.BYPASS_OBJECT_LEVEL_AUTH)) {
        dynamoCommand = new ScanCommand({
          TableName: genericConfig.StripeLinksDynamoTableName,
        });
      } else {
        dynamoCommand = new QueryCommand({
          TableName: genericConfig.StripeLinksDynamoTableName,
          KeyConditionExpression: "userId = :userId",
          ExpressionAttributeValues: {
            ":userId": { S: request.username! },
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
    },
  );
  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().post(
    "/paymentLinks",
    {
      schema: withRoles(
        [AppRoles.STRIPE_LINK_CREATOR],
        withTags(["Stripe"], {
          summary: "Create a Stripe payment link.",
          body: invoiceLinkPostRequestSchema,
        }),
      ),
      onRequest: fastify.authorizeFromSchema,
    },
    async (request, reply) => {
      if (!request.username) {
        throw new UnauthenticatedError({ message: "No username found" });
      }
      const secretApiConfig = fastify.secretConfig;
      const payload: StripeLinkCreateParams = {
        ...request.body,
        createdBy: request.username,
        stripeApiKey: secretApiConfig.stripe_secret_key as string,
      };
      const { url, linkId, priceId, productId } =
        await createStripeLink(payload);
      const invoiceId = request.body.invoiceId;
      const logStatement = buildAuditLogTransactPut({
        entry: {
          module: Modules.STRIPE,
          actor: request.username,
          target: `Link ${linkId} | Invoice ${invoiceId}`,
          message: "Created Stripe payment link",
        },
      });
      const dynamoCommand = new TransactWriteItemsCommand({
        TransactItems: [
          ...(logStatement ? [logStatement] : []),
          {
            Put: {
              TableName: genericConfig.StripeLinksDynamoTableName,
              Item: marshall(
                {
                  userId: request.username,
                  linkId,
                  priceId,
                  productId,
                  invoiceId,
                  url,
                  amount: request.body.invoiceAmountUsd,
                  active: true,
                  createdAt: new Date().toISOString(),
                },
                { removeUndefinedValues: true },
              ),
            },
          },
        ],
      });
      try {
        await fastify.dynamoClient.send(dynamoCommand);
      } catch (e) {
        await deactivateStripeLink({
          stripeApiKey: secretApiConfig.stripe_secret_key as string,
          linkId,
        });
        fastify.log.info(
          `Deactivated Stripe link ${linkId} due to error in writing to database.`,
        );
        if (e instanceof BaseError) {
          throw e;
        }
        fastify.log.error(e);
        throw new DatabaseInsertError({
          message: "Could not write Stripe link to database.",
        });
      }
      reply.status(201).send({ id: linkId, link: url });
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
        }),
      ),
      onRequest: fastify.authorizeFromSchema,
    },
    async (request, reply) => {
      if (!request.username) {
        throw new UnauthenticatedError({ message: "No username found" });
      }
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
        !request.userRoles?.has(AppRoles.BYPASS_OBJECT_LEVEL_AUTH)
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
      // expire deleted links at 90 days
      const expiresAt =
        Math.floor(Date.now() / 1000) + 86400 * STRIPE_LINK_RETENTION_DAYS;
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
      return reply.status(201).send();
    },
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
                      subject: `Payment Recieved for Invoice ${unmarshalledEntry.invoiceId}`,
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
          const customerId = intent.customer?.toString() ?? "UNKNOWN";
          const email =
            intent.receipt_email ??
            intent.metadata?.billing_email ??
            "unknown@example.com";
          const acmOrg = intent.metadata?.acm_org ?? "ACM@UIUC";
          const domain = email.split("@")[1] ?? "unknown.com";

          await fastify.dynamoClient.send(
            new PutItemCommand({
              TableName: genericConfig.StripePaymentsDynamoTableName,
              Item: marshall({
                primaryKey: `${acmOrg}#${domain}`,
                sortKey: `customer`,
                amount,
                currency,
                status: "succeeded",
                billingEmail: email,
                createdAt: Date.now(),
                eventId: event.id,
              }),
            }),
          );

          request.log.info(
            `Recorded successful payment ${intent.id} from ${email} (${amount} ${currency})`,
          );

          return reply
            .status(200)
            .send({ handled: true, requestId: request.id });
        }
        default:
          request.log.warn(`Unhandled event type: ${event.type}`);
      }
      return reply.code(200).send({ handled: false, requestId: request.id });
    },
  );
};

export default stripeRoutes;
