import { z, ZodError, ZodType } from "zod";

export enum AvailableSQSFunctions {
  Ping = "ping",
  EmailMembershipPass = "emailMembershipPass",
}

const sqsMessageMetadataSchema = z.object({
  reqId: z.string().min(1),
  initiator: z.string().min(1),
});

export type SQSMessageMetadata = z.infer<typeof sqsMessageMetadataSchema>;

const baseSchema = z.object({
  metadata: sqsMessageMetadataSchema,
});

const createSQSSchema = <T extends AvailableSQSFunctions, P extends ZodType<any>>(
  func: T,
  payloadSchema: P
) =>
  baseSchema.extend({
    function: z.literal(func),
    payload: payloadSchema,
  });

export const sqsPayloadSchemas = {
  [AvailableSQSFunctions.Ping]: createSQSSchema(AvailableSQSFunctions.Ping, z.object({})),
  [AvailableSQSFunctions.EmailMembershipPass]: createSQSSchema(
    AvailableSQSFunctions.EmailMembershipPass,
    z.object({ email: z.string().email() })
  ),
} as const;

export const sqsPayloadSchema = z.discriminatedUnion(
  "function",
  [
    sqsPayloadSchemas[AvailableSQSFunctions.Ping],
    sqsPayloadSchemas[AvailableSQSFunctions.EmailMembershipPass],
  ] as const
);


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
