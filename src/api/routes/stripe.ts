import {
  QueryCommand,
  ScanCommand,
  TransactWriteItemsCommand,
  UpdateItemCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { withRoles, withTags } from "api/components/index.js";
import {
  buildAuditLogTransactPut,
  createAuditLogEntry,
} from "api/functions/auditLog.js";
import {
  createStripeLink,
  deactivateStripeLink,
  deactivateStripeProduct,
  StripeLinkCreateParams,
} from "api/functions/stripe.js";
import { getSecretValue } from "api/plugins/auth.js";
import { genericConfig } from "common/config.js";
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
import { z } from "zod";

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
      const secretApiConfig = await fastify.getCachedSecret(
        genericConfig.ConfigSecretName,
      );
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
          logStatement,
          {
            Put: {
              TableName: genericConfig.StripeLinksDynamoTableName,
              Item: marshall({
                userId: request.username,
                linkId,
                priceId,
                productId,
                invoiceId,
                url,
                amount: request.body.invoiceAmountUsd,
                active: true,
                createdAt: new Date().toISOString(),
              }),
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
            linkId: z.string().min(1).openapi({
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
      const dynamoCommand = new TransactWriteItemsCommand({
        TransactItems: [
          logStatement,
          {
            Update: {
              TableName: genericConfig.StripeLinksDynamoTableName,
              Key: {
                userId: { S: unmarshalledEntry.userId },
                linkId: { S: linkId },
              },
              UpdateExpression: "SET active = :new_val",
              ConditionExpression: "active = :old_val",
              ExpressionAttributeValues: {
                ":new_val": { BOOL: false },
                ":old_val": { BOOL: true },
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
        case "checkout.session.completed":
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
            request.log.info(
              `Registered payment of ${withCurrency} by ${name} (${email}) for payment link ${paymentLinkId} invoice ID ${unmarshalledEntry.invoiceId}). Invoice was paid ${paidInFull ? "in full." : "partially."}`,
            );
            // Notify link owner of payment
            let queueId;
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
                    to: [unmarshalledEntry.userId],
                    subject: `Payment Recieved for Invoice ${unmarshalledEntry.invoiceId}`,
                    content: `ACM @ UIUC has received ${paidInFull ? "full" : "partial"} payment for Invoice ${unmarshalledEntry.invoiceId} (${withCurrency} by ${name}, ${email}).\n\nPlease contact Officer Board with any questions.`,
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
                  logStatement,
                  {
                    Update: {
                      TableName: genericConfig.StripeLinksDynamoTableName,
                      Key: {
                        userId: { S: unmarshalledEntry.userId },
                        linkId: { S: paymentLinkId },
                      },
                      UpdateExpression: "SET active = :new_val",
                      ConditionExpression: "active = :old_val",
                      ExpressionAttributeValues: {
                        ":new_val": { BOOL: false },
                        ":old_val": { BOOL: true },
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
            return reply.status(200).send({
              handled: true,
              requestId: request.id,
              queueId: queueId || "",
            });
          }
          return reply
            .code(200)
            .send({ handled: false, requestId: request.id });

        default:
          request.log.warn(`Unhandled event type: ${event.type}`);
      }
      return reply.code(200).send({ handled: false, requestId: request.id });
    },
  );
};

export default stripeRoutes;
