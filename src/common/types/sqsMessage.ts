import * as z from "zod/v4";
import { OrgUniqueId } from "./generic.js";

export enum AvailableSQSFunctions {
  Ping = "ping",
  EmailMembershipPass = "emailMembershipPass",
  ProvisionNewMember = "provisionNewMember",
  SendSaleEmail = "sendSaleEmail",
  EmailNotifications = "emailNotifications",
  CreateOrgGithubTeam = "createOrgGithubTeam",
  SyncExecCouncil = "syncExecCouncil",
  HandleStorePurchase = "handleStorePurchase",
}

const sqsMessageMetadataSchema = z.object({
  reqId: z.string().min(1),
  initiator: z.string().min(1)
});

export type SQSMessageMetadata = z.infer<typeof sqsMessageMetadataSchema>;

const baseSchema = z.object({
  metadata: sqsMessageMetadataSchema
});

const createSQSSchema = <
  T extends AvailableSQSFunctions,
  P extends z.ZodType<any>>(

    func: T,
    payloadSchema: P) =>

  baseSchema.extend({
    function: z.literal(func),
    payload: payloadSchema
  });

export const sqsPayloadSchemas = {
  [AvailableSQSFunctions.Ping]: createSQSSchema(
    AvailableSQSFunctions.Ping,
    z.object({})
  ),
  [AvailableSQSFunctions.EmailMembershipPass]: createSQSSchema(
    AvailableSQSFunctions.EmailMembershipPass,
    z.object({ email: z.email(), firstName: z.optional(z.string().min(1)) })
  ),
  [AvailableSQSFunctions.ProvisionNewMember]: createSQSSchema(
    AvailableSQSFunctions.ProvisionNewMember,
    z.object({ email: z.email(), firstName: z.string().min(1), lastName: z.string().min(1) })
  ),
  [AvailableSQSFunctions.SendSaleEmail]: createSQSSchema(
    AvailableSQSFunctions.SendSaleEmail,
    z.object({
      email: z.email(),
      qrCodeContent: z.string().min(1),
      customText: z.string().optional(),
      itemsPurchased: z.array(z.object({
        itemName: z.string().min(1),
        variantName: z.string().min(1).optional(),
        quantity: z.number().nonnegative(),
      })).min(1),
      isVerifiedIdentity: z.boolean().default(false)
    })
  ),
  [AvailableSQSFunctions.EmailNotifications]: createSQSSchema(
    AvailableSQSFunctions.EmailNotifications, z.object({
      to: z.array(z.email()).min(1),
      cc: z.optional(z.array(z.email()).min(1)),
      bcc: z.optional(z.array(z.string().email()).min(1)),
      subject: z.string().min(1),
      content: z.string().min(1),
      callToActionButton: z.object({
        name: z.string().min(1),
        url: z.string().min(1).url()
      }).optional()
    })
  ),
  [AvailableSQSFunctions.CreateOrgGithubTeam]: createSQSSchema(
    AvailableSQSFunctions.CreateOrgGithubTeam, z.object({
      orgId: OrgUniqueId,
      githubTeamName: z.string().min(1),
      githubTeamDescription: z.string().min(1)
    })
  ),
  [AvailableSQSFunctions.SyncExecCouncil]: createSQSSchema(
    AvailableSQSFunctions.SyncExecCouncil, z.object({})
  ),
  [AvailableSQSFunctions.HandleStorePurchase]: createSQSSchema(
    AvailableSQSFunctions.HandleStorePurchase, z.object({
      orderId: z.string().min(1),
      userId: z.email(),
      paymentIdentifier: z.string().min(1),
      paymentIntentId: z.string().min(1).optional(),
      isVerifiedIdentity: z.boolean()
    })
  )
} as const;

// Add this type helper
type AllSchemas = {
  [K in AvailableSQSFunctions]: (typeof sqsPayloadSchemas)[K];
};

export const sqsPayloadSchema = z.discriminatedUnion(
  "function",
  Object.values(sqsPayloadSchemas) as [
    (typeof sqsPayloadSchemas)[AvailableSQSFunctions],
    (typeof sqsPayloadSchemas)[AvailableSQSFunctions],
    ...((typeof sqsPayloadSchemas)[AvailableSQSFunctions])[]
  ]
);

export type SQSPayload<T extends AvailableSQSFunctions> = z.infer<
  (typeof sqsPayloadSchemas)[T]>;


export type AnySQSPayload = z.infer<typeof sqsPayloadSchema>;

export function parseSQSPayload(json: unknown): AnySQSPayload | z.ZodError {
  const parsed = sqsPayloadSchema.safeParse(json);
  if (parsed.success) {
    return parsed.data;
  } else {
    return parsed.error;
  }
}
