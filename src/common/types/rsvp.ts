import * as z from "zod/v4";
import { ALL_MAJORS } from "@acm-uiuc/js-shared";

export const rsvpConfigSchema = z
  .object({
    rsvpLimit: z.number().int().min(1).max(20000).nullable().meta({
      description:
        "The maximum number of attendees allowed. Set to null for unlimited.",
      example: 50,
    }),
    rsvpCheckInEnabled: z.boolean().default(false).meta({
      description:
        "Whether check-in for attendance is enabled for this event. Defaults to false",
      example: true,
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
  .meta({
    id: "RsvpConfig",
    description: "Configuration payload for updating event RSVP settings.",
  });

export const rsvpItemSchema = z.object({
  eventId: z.string().meta({ 
    description: "The ID of the event." 
  }),
  userId: z.string().meta({ 
    description: "The user's UPN." 
  }),
  isPaidMember: z.boolean().meta({ 
    description: "Membership status at time of RSVP." 
  }),
  checkedIn: z.boolean().default(false).meta({ 
    description: "Attendance status. False on creation." 
  }),
  createdAt: z.number().meta({ 
    description: "Unix timestamp of RSVP creation." 
  }),  
  schoolYear: z.string().meta({ 
    description: "Snapshot of user's year at time of RSVP." 
  }),
  intendedMajor: z.string().meta({ 
    description: "Snapshot of user's major at time of RSVP." 
  }),
  dietaryRestrictions:z.array(z.string()).meta({
    description: "User's dietary restrictions."
  }),
  interests: z.array(z.string()).meta({ 
    description: "Snapshot of user's interests." 
  }),
}).meta({ description: "The final RSVP record." });

export const majorSchema = z.enum(ALL_MAJORS).meta({description: "The student's primary major at UIUC"});

export const rsvpProfileSchema = z.object({
  schoolYear: z.enum(["Freshman", "Sophomore", "Junior", "Senior", "Graduate"]).meta({
    description: "The attendee's current year in school.",
    example: "Sophomore",
  }),
  intendedMajor: majorSchema.meta({
    description: "The student's primary major at UIUC",
    example: "Computer Science",
  }),
  interests: z.array(z.string()).default([]).meta({
    description: "List of attendee's interests.",
    example: ["AI", "Web Development"],
  }),
  dietaryRestrictions: z.array(z.string()).default([]).meta({
    description: "User's dietary restrictions."
  }),
  updatedAt: z.string().datetime().meta({
    description: "ISO timestamp when the profile was last updated.",
    example: "2026-03-04T22:58:04.694Z",
  }),
}).meta({
  description: "Represents a user's RSVP profile information.",
});
