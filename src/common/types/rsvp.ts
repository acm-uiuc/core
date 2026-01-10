import * as z from "zod/v4";

const rsvpQuestionType = z.enum(["TEXT", "BOOLEAN", "SELECT"]);

export const rsvpSubmissionBodySchema = z.object({
  responses: z.record(z.string(), z.union([z.string(), z.boolean()])).optional()
    .meta({
      description: "Map of Question IDs to answers (Text or Boolean). Required if the event has configured questions.",
      example: { diet: "Vegetarian", tshirt: "M" }
    }),
});

const rsvpQuestionSchema = z.object({
  id: z.string().min(1).meta({ description: "Unique ID for storing the answer (e.g., 'dietary')" }),
  prompt: z.string().min(1).meta({ description: "The actual question text (e.g., 'Do you have dietary restrictions?')" }),
  type: rsvpQuestionType.meta({ description: "The type of input to show" }),
  required: z.boolean().default(false),
  options: z.array(z.string()).optional().meta({ description: "Options if type is SELECT" }),
});

export const rsvpConfigSchema = z
  .object({
    rsvpLimit: z.number().int().min(0).max(20000).nullable().meta({
      description:
        "The maximum number of attendees allowed. Set to null for unlimited.",
      example: 50,
    }),
    rsvpCheckInEnabled: z.boolean().meta({
      description: "Whether check-in for attendance is enabled for this event.",
      example: true,
    }),
    rsvpQuestions: z.array(rsvpQuestionSchema).optional().meta({
      description: "List of custom questions to ask users during RSVP.",
      example: [
        { id: "diet", prompt: "Dietary Restrictions?", type: "TEXT", required: false },
        { id: "tshirt", prompt: "T-Shirt Size", type: "SELECT", options: ["S", "M", "L", "XL"], required: true }
      ]
    }),
    rsvpCloseAt: z.number().int().meta({
      description: "Epoch timestamp (ms) representing the RSVP deadline. Users cannot RSVP after this time.",
      example: 1705512000000,
    }),
    rsvpOpenAt: z.number().int().meta({
      description: "Epoch timestamp (ms) representing when RSVPs open for this event.",
      example: 1705512000000,
    }),
  })
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
    responses: z
      .record(z.string(), z.union([z.string(), z.boolean()]))
      .optional()
      .meta({
        description:
          "The user's answers to the custom questions configured for this event.",
        example: {
          dietary: "Vegetarian",
          photoRelease: true,
          tshirt: "L",
        },
      }),
    // checkedIn: z.boolean().optional().meta({
    //   description:
    //     "Indicates if the user has checked in. Only present if check-in is enabled for the event.",
    //   example: false,
    // }),
    createdAt: z.number().int().meta({
      description: "Epoch timestamp (ms) when the RSVP was created.",
      example: 1705512000000,
    }),
  })
  .meta({
    description: "Represents a single confirmed RSVP record in the database.",
    id: "RsvpItem",
  });
