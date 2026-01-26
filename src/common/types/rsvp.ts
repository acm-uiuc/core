import * as z from "zod/v4";

export const rsvpSubmissionBodySchema = z.object({
  responses: z
    .record(z.string(), z.union([z.string(), z.boolean()]))
    .optional()
    .meta({
      description:
        "Map of Question IDs to answers (Text or Boolean). Required if the event has configured questions.",
      example: { diet: "Vegetarian", tshirt: "M" },
    }),
});

const rsvpQuestionBase = z.object({
  id: z.string().min(1).meta({
    description: "Unique ID for storing the answer (e.g., 'dietary')",
  }),
  prompt: z.string().min(1).meta({ description: "The actual question text" }),
  required: z.boolean().default(false),
});

export const rsvpQuestionSchema = z.discriminatedUnion("type", [
  rsvpQuestionBase.extend({ type: z.literal("TEXT") }),
  rsvpQuestionBase.extend({ type: z.literal("BOOLEAN") }),
  rsvpQuestionBase.extend({
    type: z.literal("SELECT"),
    options: z
      .array(z.string())
      .min(1)
      .meta({ description: "Available options for SELECT type" }),
  }),
]);

export const rsvpConfigSchema = z
  .object({
    rsvpLimit: z.number().int().min(0).max(20000).nullable().meta({
      description:
        "The maximum number of attendees allowed. Set to null for unlimited.",
      example: 50,
    }),
    rsvpCheckInEnabled: z.boolean().default(false).meta({
      description:
        "Whether check-in for attendance is enabled for this event. Defaults to false",
      example: true,
    }),
    rsvpQuestions: z
      .array(rsvpQuestionSchema)
      .default([])
      .meta({
        description:
          "List of custom questions to ask users during RSVP. Defaults to an empty array.",
        example: [
          {
            id: "diet",
            prompt: "Dietary Restrictions?",
            type: "TEXT",
            required: false,
          },
          {
            id: "tshirt",
            prompt: "T-Shirt Size",
            type: "SELECT",
            options: ["S", "M", "L", "XL"],
            required: true,
          },
        ],
      }),
    rsvpCloseAt: z.number().int().min(0).meta({
      description:
        "Epoch timestamp (sec) representing the RSVP deadline. Users cannot RSVP after this time.",
      example: 1705512000,
    }),
    rsvpOpenAt: z.number().int().min(0).meta({
      description:
        "Epoch timestamp (sec) representing when RSVPs open for this event.",
      example: 1705512000,
    }),
  })
  .refine(
    (data) => {
      if (
        data.rsvpOpenAt === undefined ||
        data.rsvpOpenAt === null ||
        data.rsvpCloseAt === undefined ||
        data.rsvpCloseAt === null
      ) {
        return true;
      }
      return data.rsvpOpenAt < data.rsvpCloseAt;
    },
    {
      message: "RSVP open time must be before close time",
      path: ["rsvpOpenAt"],
    },
  )
  .refine(
    (data) => {
      const ids = data.rsvpQuestions?.map((q) => q.id) ?? [];
      return ids.length === new Set(ids).size;
    },
    {
      message: "Question IDs must be unique within the event",
      path: ["rsvpQuestions"],
    },
  )
  .meta({
    id: "RsvpConfig",
    description: "Configuration payload for updating event RSVP settings.",
  });

export const rsvpItemSchema = z
  .object({
    eventId: z.string().meta({
      description: "The unique identifier for the event.",
      example: "evt_sp25_intro_to_databases",
    }),
    userId: z.string().meta({
      description: "The User Principal Name (UPN) of the attendee.",
      example: "rjjones@illinois.edu",
    }),
    isPaidMember: z.boolean().meta({
      description:
        "Indicates if the user held a paid membership at the time of RSVP.",
      example: true,
    }),
    createdAt: z.number().int().meta({
      description: "Epoch timestamp (sec) when the RSVP was created.",
      example: 1705512000,
    }),
  })
  .meta({
    description: "Represents a single confirmed RSVP record in the database.",
    id: "RsvpItem",
  });
