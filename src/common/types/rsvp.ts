import * as z from "zod/v4";

export const rsvpConfigSchema = z
  .object({
    rsvpLimit: z.number().int().min(0).nullable().meta({
      description:
        "The maximum number of attendees allowed. Set to null for unlimited.",
      example: 50,
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
    createdAt: z.number().int().meta({
      description: "Epoch timestamp (ms) when the RSVP was created.",
      example: 1705512000000,
    }),
  })
  .meta({
    description: "Represents a single confirmed RSVP record in the database.",
    id: "RsvpItem",
  });
