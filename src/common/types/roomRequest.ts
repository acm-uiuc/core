import { z } from 'zod';
import { OrganizationList } from '../orgs.js';

export const eventThemeOptions = [
  "Arts & Music",
  "Athletics",
  "Cultural",
  "Fundraising",
  "Group Business",
  "Learning",
  "Service",
  "Social",
  "Spirituality"
] as [string, ...string[]];

export const spaceTypeOptions = [
  { value: "campus_classroom", label: "Campus Classroom" },
  { value: "campus_performance", label: "Campus Performance Space *" },
  { value: "bif", label: "Business Instructional Facility (BIF)" },
  { value: "campus_rec", label: "Campus Rec (ARC, CRCE, Ice Arena, Illini Grove) *" },
  { value: "illini_union", label: "Illini Union *" },
  { value: "stock_pavilion", label: "Stock Pavilion" }
];


export enum RoomRequestStatus {
  CREATED = "created",
  REJECTED_BY_ACM = "rejected_by_acm",
  SUBMITTED = "submitted",
  APPROVED = "approved",
  REJECTED_BY_UIUC = "rejected_by_uiuc"
}

export const roomRequestSchema = z.object({
  host: z.enum(OrganizationList),
  title: z.string().min(2, "Title must have at least 2 characters"),
  theme: z.enum(eventThemeOptions),
  description: z.string()
    .min(10, "Description must have at least 10 words")
    .max(1000, "Description cannot exceed 1000 characters")
    .refine(val => val.split(/\s+/).filter(Boolean).length >= 10, {
      message: "Description must have at least 10 words"
    }),
  hostingMinors: z.boolean().nullable().optional(),
  locationType: z.enum(['in-person', 'virtual', 'both']),
  spaceType: z.string().optional(),
  specificRoom: z.string().optional(),
  estimatedAttendees: z.number().positive().optional(),
  seatsNeeded: z.number().positive().optional(),
  setupDetails: z.string().nullable().optional(),
  onCampusPartners: z.string().nullable().optional(),
  offCampusPartners: z.string().nullable().optional(),
  nonIllinoisSpeaker: z.string().nullable().optional(),
  nonIllinoisAttendees: z.number().nullable().optional(),
  foodOrDrink: z.boolean().nullable().optional(),
  crafting: z.boolean().nullable().optional(),
  comments: z.string().optional(),
});

export type RoomRequestFormValues = z.infer<typeof roomRequestSchema>;

export const roomRequestPostResponse = z.object({
  id: z.string().uuid(),
  status: z.literal(RoomRequestStatus.CREATED),
})

export type RoomRequestPostResponse = z.infer<typeof roomRequestPostResponse>;
