import { z } from "zod";
import { OrganizationList } from "../orgs.js";

export const eventThemeOptions = [
  "Arts & Music",
  "Athletics",
  "Cultural",
  "Fundraising",
  "Group Business",
  "Learning",
  "Service",
  "Social",
  "Spirituality",
] as [string, ...string[]];

export function getPreviousSemesters() {
  const currentDate = new Date();
  const currentYear = currentDate.getFullYear();
  const currentMonth = currentDate.getMonth() + 1;

  let semesters = [];
  let currentSemester = "";

  if (currentMonth >= 1 && currentMonth <= 5) {
    currentSemester = "Spring";
  } else if (currentMonth >= 6 && currentMonth <= 12) {
    currentSemester = "Fall";
  }

  if (currentSemester === "Spring") {
    semesters.push({
      value: `fa${(currentYear - 1).toString().slice(-2)}`,
      label: `Fall ${currentYear - 1}`,
    });
    semesters.push({
      value: `sp${(currentYear - 1).toString().slice(-2)}`,
      label: `Spring ${currentYear - 1}`,
    });
    semesters.push({
      value: `fa${(currentYear - 2).toString().slice(-2)}`,
      label: `Fall ${currentYear - 2}`,
    });
  } else if (currentSemester === "Fall") {
    semesters.push({
      value: `sp${currentYear.toString().slice(-2)}`,
      label: `Spring ${currentYear}`,
    });
    semesters.push({
      value: `fa${(currentYear - 1).toString().slice(-2)}`,
      label: `Fall ${currentYear - 1}`,
    });
    semesters.push({
      value: `sp${(currentYear - 1).toString().slice(-2)}`,
      label: `Spring ${currentYear - 1}`,
    });
  }

  return semesters.reverse();
}

export function getSemesters() {
  const currentDate = new Date();
  const currentYear = currentDate.getFullYear();
  const currentMonth = currentDate.getMonth() + 1;

  let semesters = [];
  let currentSemester = "";

  if (currentMonth >= 1 && currentMonth <= 5) {
    currentSemester = "Spring";
  } else if (currentMonth >= 6 && currentMonth <= 12) {
    currentSemester = "Fall";
  }

  if (currentSemester === "Spring") {
    semesters.push({
      value: `sp${currentYear.toString().slice(-2)}`,
      label: `Spring ${currentYear}`,
    });
    semesters.push({
      value: `fa${currentYear.toString().slice(-2)}`,
      label: `Fall ${currentYear}`,
    });
    semesters.push({
      value: `sp${(currentYear + 1).toString().slice(-2)}`,
      label: `Spring ${currentYear + 1}`,
    });
  } else if (currentSemester === "Fall") {
    semesters.push({
      value: `fa${currentYear.toString().slice(-2)}`,
      label: `Fall ${currentYear}`,
    });
    semesters.push({
      value: `sp${(currentYear + 1).toString().slice(-2)}`,
      label: `Spring ${currentYear + 1}`,
    });
    semesters.push({
      value: `fa${(currentYear + 1).toString().slice(-2)}`,
      label: `Fall ${currentYear + 1}`,
    });
  }

  return semesters;
}

export const spaceTypeOptions = [
  { value: "campus_classroom", label: "Campus Classroom" },
  { value: "campus_performance", label: "Campus Performance Space *" },
  { value: "bif", label: "Business Instructional Facility (BIF)" },
  {
    value: "campus_rec",
    label: "Campus Rec (ARC, CRCE, Ice Arena, Illini Grove) *",
  },
  { value: "illini_union", label: "Illini Union *" },
  { value: "stock_pavilion", label: "Stock Pavilion" },
];

export const specificRoomSetupRooms = [
  "illini_union",
  "campus_performance",
  "campus_rec",
];

export enum RoomRequestStatus {
  CREATED = "created",
  MORE_INFORMATION_NEEDED = "more_information_needed",
  REJECTED_BY_ACM = "rejected_by_acm",
  SUBMITTED = "submitted",
  APPROVED = "approved",
  REJECTED_BY_UIUC = "rejected_by_uiuc",
}

export const roomRequestStatusUpdateRequest = z.object({
  status: z.nativeEnum(RoomRequestStatus),
  notes: z.optional(z.string().min(1).max(1000)),
});

export const roomRequestStatusUpdate = roomRequestStatusUpdateRequest.extend({
  createdAt: z.string().datetime(),
  createdBy: z.string().email(),
});

export const roomRequestPostResponse = z.object({
  id: z.string().uuid(),
  status: z.literal(RoomRequestStatus.CREATED),
});

export const roomRequestBaseSchema = z.object({
  host: z.enum(OrganizationList),
  title: z.string().min(2, "Title must have at least 2 characters"),
  semester: z
    .string()
    .regex(/^(fa|sp|su|wi)\d{2}$/, "Invalid semester provided"),
});

export const roomRequestSchema = roomRequestBaseSchema
  .extend({
    eventStart: z.coerce.date({
      required_error: "Event start date and time is required",
      invalid_type_error: "Event start must be a valid date and time",
    }),
    eventEnd: z.coerce.date({
      required_error: "Event end date and time is required",
      invalid_type_error: "Event end must be a valid date and time",
    }),
    theme: z.enum(eventThemeOptions, {
      required_error: "Event theme must be provided",
      invalid_type_error: "Event theme must be provided",
    }),
    description: z
      .string()
      .min(10, "Description must have at least 10 words")
      .max(1000, "Description cannot exceed 1000 characters")
      .refine((val) => val.split(/\s+/).filter(Boolean).length >= 10, {
        message: "Description must have at least 10 words",
      }),
    // Recurring event fields
    isRecurring: z.boolean().default(false),
    recurrencePattern: z.enum(["weekly", "biweekly", "monthly"]).optional(),
    recurrenceEndDate: z.coerce.date().optional(),
    // Setup time fields
    setupNeeded: z.boolean().default(false),
    setupMinutesBefore: z.number().min(5).max(60).optional(),
    // Existing fields
    hostingMinors: z.boolean(),
    locationType: z.enum(["in-person", "virtual", "both"]),
    spaceType: z.string().min(1),
    specificRoom: z.string().min(1),
    estimatedAttendees: z.number().positive(),
    seatsNeeded: z.number().positive(),
    setupDetails: z.string().min(1).nullable().optional(),
    onCampusPartners: z.string().min(1).nullable(),
    offCampusPartners: z.string().min(1).nullable(),
    nonIllinoisSpeaker: z.string().min(1).nullable(),
    nonIllinoisAttendees: z.number().min(1).nullable(),
    foodOrDrink: z.boolean(),
    crafting: z.boolean(),
    comments: z.string().optional(),
  })
  .refine(
    (data) => {
      // Check if end time is after start time
      if (data.eventStart && data.eventEnd) {
        return data.eventEnd > data.eventStart;
      }
      return true;
    },
    {
      message: "End date/time must be after start date/time",
      path: ["eventEnd"],
    },
  )
  .refine(
    (data) => {
      // If recurrence is enabled, recurrence pattern must be provided
      if (data.isRecurring) {
        return !!data.recurrencePattern;
      }
      return true;
    },
    {
      message: "Please select a recurrence pattern",
      path: ["recurrencePattern"],
    },
  )
  .refine(
    (data) => {
      // If recurrence is enabled, end date must be provided
      if (data.isRecurring) {
        return !!data.recurrenceEndDate;
      }
      return true;
    },
    {
      message: "Please select an end date for the recurring event",
      path: ["recurrenceEndDate"],
    },
  )
  .refine(
    (data) => {
      if (data.isRecurring && data.recurrenceEndDate && data.eventStart) {
        const endDateWithTime = new Date(data.recurrenceEndDate);
        endDateWithTime.setHours(23, 59, 59, 999);
        return endDateWithTime >= data.eventStart;
      }
      return true;
    },
    {
      message: "End date must be on or after the event start date",
      path: ["recurrenceEndDate"],
    },
  )
  .refine(
    (data) => {
      // If setup is needed, setupMinutesBefore must be provided
      if (data.setupNeeded) {
        return !!data.setupMinutesBefore;
      }
      return true;
    },
    {
      message:
        "Please specify how many minutes before the event you need for setup",
      path: ["setupMinutesBefore"],
    },
  )
  .refine(
    (data) => {
      if (data.setupDetails === undefined && specificRoomSetupRooms.includes(data.spaceType)) {
        return false;
      }
      if (data.setupDetails && !specificRoomSetupRooms.includes(data.spaceType)) {
        return false;
      }
      return true;
    },
    {
      message: "Invalid setup details response.",
      path: ["setupDetails"],
    },
  )
  .superRefine((data, ctx) => {
    // Additional validation for conditional fields based on locationType
    if (data.locationType === "in-person" || data.locationType === "both") {
      if (!data.spaceType || data.spaceType.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Please select a space type",
          path: ["spaceType"],
        });
      }

      if (!data.specificRoom || data.specificRoom.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Please provide details about the room location",
          path: ["specificRoom"],
        });
      }

      if (!data.estimatedAttendees || data.estimatedAttendees <= 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Please provide an estimated number of attendees",
          path: ["estimatedAttendees"],
        });
      }

      if (!data.seatsNeeded || data.seatsNeeded <= 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Please specify how many seats you need",
          path: ["seatsNeeded"],
        });
      } else if (
        data.estimatedAttendees &&
        data.seatsNeeded < data.estimatedAttendees
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "Number of seats must be greater than or equal to number of attendees",
          path: ["seatsNeeded"],
        });
      }
    }

    // Validate conditional partner fields
    if (data.onCampusPartners === "") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Please provide details about on-campus partners",
        path: ["onCampusPartners"],
      });
    }

    if (data.offCampusPartners === "") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Please provide details about off-campus partners",
        path: ["offCampusPartners"],
      });
    }

    if (data.nonIllinoisSpeaker === "") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Please provide details about non-UIUC speakers",
        path: ["nonIllinoisSpeaker"],
      });
    }

    if (data.nonIllinoisAttendees === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Percentage must be greater than 0",
        path: ["nonIllinoisAttendees"],
      });
    }
  });

export type RoomRequestFormValues = z.infer<typeof roomRequestSchema>;

export const roomRequestGetResponse = z.object({
  data: roomRequestSchema,
  updates: z.array(roomRequestStatusUpdate),
});

export type RoomRequestPostResponse = z.infer<typeof roomRequestPostResponse>;

export type RoomRequestStatusUpdate = z.infer<typeof roomRequestStatusUpdate>;

export type RoomRequestGetResponse = z.infer<typeof roomRequestGetResponse>;

export type RoomRequestStatusUpdatePostBody = z.infer<
  typeof roomRequestStatusUpdateRequest
>;

export const roomGetResponse = z.array(
  roomRequestBaseSchema.extend({
    requestId: z.string().uuid(),
    status: z.nativeEnum(RoomRequestStatus),
  }),
);

export type RoomRequestGetAllResponse = z.infer<typeof roomGetResponse>;

export function capitalizeFirstLetter(string: string) {
  return string.charAt(0).toUpperCase() + string.slice(1);
}

export const formatStatus = (status: RoomRequestStatus) => {
  if (status === RoomRequestStatus.SUBMITTED) {
    return 'Submitted to UIUC';
  }
  return capitalizeFirstLetter(status)
    .replaceAll('_', ' ')
    .replaceAll('uiuc', 'UIUC')
    .replaceAll('acm', 'ACM');
};
