import { z, ZodError, ZodType } from "zod";

export enum AvailableSQSFunctions {
  Ping = "ping",
  EmailMembershipPass = "emailMembershipPass",
  ProvisionNewMember = "provisionNewMember",
  SendSaleEmail = "sendSaleEmail",
  EmailNotifications = "emailNotifications"
}

const sqsMessageMetadataSchema = z.object({
  reqId: z.string().min(1),
  initiator: z.string().min(1),
});

export type SQSMessageMetadata = z.infer<typeof sqsMessageMetadataSchema>;

const baseSchema = z.object({
  metadata: sqsMessageMetadataSchema,
});

const createSQSSchema = <
  T extends AvailableSQSFunctions,
  P extends ZodType<any>,
>(
  func: T,
  payloadSchema: P,
) =>
  baseSchema.extend({
    function: z.literal(func),
    payload: payloadSchema,
  });

export const sqsPayloadSchemas = {
  [AvailableSQSFunctions.Ping]: createSQSSchema(
    AvailableSQSFunctions.Ping,
    z.object({}),
  ),
  [AvailableSQSFunctions.EmailMembershipPass]: createSQSSchema(
    AvailableSQSFunctions.EmailMembershipPass,
    z.object({ email: z.string().email() }),
  ),
  [AvailableSQSFunctions.ProvisionNewMember]: createSQSSchema(
    AvailableSQSFunctions.ProvisionNewMember,
    z.object({ email: z.string().email() }),
  ),
  [AvailableSQSFunctions.SendSaleEmail]: createSQSSchema(
    AvailableSQSFunctions.SendSaleEmail,
    z.object({
      email: z.string().email(),
      qrCodeContent: z.string().min(1),
      itemName: z.string().min(1),
      quantity: z.number().min(1),
      size: z.string().optional(),
      customText: z.string().optional(),
      type: z.union([z.literal('event'), z.literal('merch')])
    }),
  ),
  [AvailableSQSFunctions.EmailNotifications]: createSQSSchema(
    AvailableSQSFunctions.EmailNotifications, z.object({
      to: z.array(z.string().email()).min(1),
      cc: z.optional(z.array(z.string().email()).min(1)),
      bcc: z.optional(z.array(z.string().email()).min(1)),
      subject: z.string().min(1),
      content: z.string().min(1),
    })
  )
} as const;

export const sqsPayloadSchema = z.discriminatedUnion("function", [
  sqsPayloadSchemas[AvailableSQSFunctions.Ping],
  sqsPayloadSchemas[AvailableSQSFunctions.EmailMembershipPass],
  sqsPayloadSchemas[AvailableSQSFunctions.ProvisionNewMember],
  sqsPayloadSchemas[AvailableSQSFunctions.SendSaleEmail],
  sqsPayloadSchemas[AvailableSQSFunctions.EmailNotifications],
] as const);

export type SQSPayload<T extends AvailableSQSFunctions> = z.infer<
  (typeof sqsPayloadSchemas)[T]
>;

export type AnySQSPayload = z.infer<typeof sqsPayloadSchema>;

export function parseSQSPayload(json: unknown): AnySQSPayload | ZodError {
  const parsed = sqsPayloadSchema.safeParse(json);
  if (parsed.success) {
    return parsed.data;
  } else {
    return parsed.error;
  }
}
