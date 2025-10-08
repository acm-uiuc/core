import * as z from "zod/v4";
import { AllOrganizationNameList } from "@acm-uiuc/js-shared";
import { illinoisSemesterId } from "./generic.js"

export const eventThemeOptions = [
  "Arts & Music",
  "Athletics",
  "Cultural",
  "Fundraising",
  "Group Business",
  "Learning",
  "Service",
  "Social",
  "Spirituality"]

export function getPreviousSemesters() {
  const currentDate = new Date();
  const currentYear = currentDate.getFullYear();
  const currentMonth = currentDate.getMonth() + 1;

  let semesters: { value: string; label: string; }[] = [];
  let currentSemester = "";

  if (currentMonth >= 1 && currentMonth <= 5) {
    currentSemester = "Spring";
  } else if (currentMonth >= 6 && currentMonth <= 12) {
    currentSemester = "Fall";
  }

  if (currentSemester === "Spring") {
    semesters.push({
      value: `fa${(currentYear - 1).toString().slice(-2)}`,
      label: `Fall ${currentYear - 1}`
    });
    semesters.push({
      value: `sp${(currentYear - 1).toString().slice(-2)}`,
      label: `Spring ${currentYear - 1}`
    });
    semesters.push({
      value: `fa${(currentYear - 2).toString().slice(-2)}`,
      label: `Fall ${currentYear - 2}`
    });
  } else if (currentSemester === "Fall") {
    semesters.push({
      value: `sp${currentYear.toString().slice(-2)}`,
      label: `Spring ${currentYear}`
    });
    semesters.push({
      value: `fa${(currentYear - 1).toString().slice(-2)}`,
      label: `Fall ${currentYear - 1}`
    });
    semesters.push({
      value: `sp${(currentYear - 1).toString().slice(-2)}`,
      label: `Spring ${currentYear - 1}`
    });
  }

  return semesters.reverse();
}

export function getSemesters() {
  const currentDate = new Date();
  const currentYear = currentDate.getFullYear();
  const currentMonth = currentDate.getMonth() + 1;

  let semesters: { value: string; label: string; }[] = [];
  let currentSemester = "";

  if (currentMonth >= 1 && currentMonth <= 5) {
    currentSemester = "Spring";
  } else if (currentMonth >= 6 && currentMonth <= 12) {
    currentSemester = "Fall";
  }

  if (currentSemester === "Spring") {
    semesters.push({
      value: `sp${currentYear.toString().slice(-2)}`,
      label: `Spring ${currentYear}`
    });
    semesters.push({
      value: `fa${currentYear.toString().slice(-2)}`,
      label: `Fall ${currentYear}`
    });
    semesters.push({
      value: `sp${(currentYear + 1).toString().slice(-2)}`,
      label: `Spring ${currentYear + 1}`
    });
  } else if (currentSemester === "Fall") {
    semesters.push({
      value: `fa${currentYear.toString().slice(-2)}`,
      label: `Fall ${currentYear}`
    });
    semesters.push({
      value: `sp${(currentYear + 1).toString().slice(-2)}`,
      label: `Spring ${currentYear + 1}`
    });
    semesters.push({
      value: `fa${(currentYear + 1).toString().slice(-2)}`,
      label: `Fall ${currentYear + 1}`
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
    label: "Campus Rec (ARC, CRCE, Ice Arena, Illini Grove) *"
  },
  { value: "illini_union", label: "Illini Union *" },
  { value: "stock_pavilion", label: "Stock Pavilion" }];


export const specificRoomSetupRooms = [
  "illini_union",
  "campus_performance",
  "campus_rec"];


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
  notes: z.string().min(1).max(1000)
});

export const roomRequestStatusUpdate = roomRequestStatusUpdateRequest.extend({
  createdAt: z.string().datetime(),
  createdBy: z.string().email()
});

export const roomRequestPostResponse = z.object({
  id: z.string().uuid(),
  status: z.literal(RoomRequestStatus.CREATED)
});

export const roomRequestBaseSchema = z.object({
  host: z.enum(AllOrganizationNameList),
  title: z.string().min(2, "Title must have at least 2 characters"),
  semester: illinoisSemesterId
});
export const roomRequestDataSchema = roomRequestBaseSchema.extend({
  eventStart: z.coerce.date({
    error: (issue) => issue.input === undefined ? "Event start date and time is required" : "Event start must be a valid date and time"
  }).transform((date) => {
    const d = new Date(date);
    d.setSeconds(0, 0);
    return d;
  }),
  eventEnd: z.coerce.date({
    error: (issue) => issue.input === undefined ? "Event end date and time is required" : "Event end must be a valid date and time"
  }).transform((date) => {
    const d = new Date(date);
    d.setSeconds(0, 0);
    return d;
  }),
  theme: z.enum(eventThemeOptions, {
    error: (issue) => issue.input === undefined ? "Event theme must be provided" : "Event theme is invalid"
  }),
  description: z.
    string().
    min(10, "Description must have at least 10 words").
    max(1000, "Description cannot exceed 1000 characters").
    refine((val) => val.split(/\s+/).filter(Boolean).length >= 10, {
      message: "Description must have at least 10 words"
    }),
  // Recurring event fields
  isRecurring: z.boolean().default(false),
  recurrencePattern: z.enum(["weekly", "biweekly", "monthly"]).optional(),
  recurrenceEndDate: z.coerce.date().optional().transform((date) => {
    if (!date) { return date; }
    const d = new Date(date);
    d.setSeconds(0, 0);
    return d;
  }),
  // Setup time fields
  setupNeeded: z.boolean().default(false),
  setupMinutesBefore: z.number().min(5).max(60).optional(),
  // Existing fields
  hostingMinors: z.boolean(),
  locationType: z.enum(["in-person", "virtual", "both"]),
  spaceType: z.optional(z.string().min(1)),
  specificRoom: z.optional(z.string().min(1)),
  estimatedAttendees: z.optional(z.number().positive()),
  seatsNeeded: z.optional(z.number().positive()),
  setupDetails: z.string().min(1).nullable().optional(),
  onCampusPartners: z.string().min(1).nullable(),
  offCampusPartners: z.string().min(1).nullable(),
  nonIllinoisSpeaker: z.string().min(1).nullable(),
  nonIllinoisAttendees: z.number().min(1).nullable(),
  foodOrDrink: z.boolean(),
  crafting: z.boolean(),
  comments: z.string().optional()
});

export const roomRequestSchema = roomRequestDataSchema.
  refine(
    (data) => {
      return data.eventEnd > data.eventStart;
    },
    {
      message: "End date/time must be after start date/time",
      path: ["eventEnd"]
    }
  ).
  refine(
    (data) => {
      return data.eventEnd.getTime() - data.eventStart.getTime() >= 30 * 60 * 1000;
    },
    {
      message: "Event must be at least 30 minutes long",
      path: ["eventEnd"]
    }
  ).
  refine(
    (data) => {
      // If recurrence is enabled, recurrence pattern must be provided
      if (data.isRecurring) {
        return !!data.recurrencePattern;
      }
      return true;
    },
    {
      message: "Please select a recurrence pattern",
      path: ["recurrencePattern"]
    }
  ).
  refine(
    (data) => {
      // If recurrence is enabled, end date must be provided
      if (data.isRecurring) {
        return !!data.recurrenceEndDate;
      }
      return true;
    },
    {
      message: "Please select an end date for the recurring event",
      path: ["recurrenceEndDate"]
    }
  ).
  refine(
    (data) => {
      if (data.isRecurring && data.recurrenceEndDate && data.eventStart) {
        const endDateWithTime = new Date(data.recurrenceEndDate);
        endDateWithTime.setHours(23, 59, 59, 999);
        return endDateWithTime.getTime() >= data.eventStart.getTime();
      }
      return true;
    },
    {
      message: "End date must be on or after the event start date",
      path: ["recurrenceEndDate"]
    }
  ).
  refine(
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
      path: ["setupMinutesBefore"]
    }
  ).
  refine(
    (data) => {
      if (data.setupDetails === undefined && specificRoomSetupRooms.includes(data.spaceType || "")) {
        return false;
      }
      if (data.setupDetails && !specificRoomSetupRooms.includes(data.spaceType || "")) {
        return false;
      }
      return true;
    },
    {
      message: "Invalid setup details response.",
      path: ["setupDetails"]
    }
  ).
  superRefine((data, ctx) => {
    const isPhysicalLocation = data.locationType === "in-person" || data.locationType === "both";

    // Conditional physical location fields
    if (isPhysicalLocation) {
      if (!data.spaceType || data.spaceType.trim().length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Please select a space type",
          path: ["spaceType"]
        });
      }

      if (!data.specificRoom || data.specificRoom.trim().length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Please provide details about the room location",
          path: ["specificRoom"]
        });
      }

      if (data.estimatedAttendees === null || data.estimatedAttendees === undefined || data.estimatedAttendees <= 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Please provide an estimated number of attendees",
          path: ["estimatedAttendees"]
        });
      }

      if (data.seatsNeeded === null || data.seatsNeeded === undefined || data.seatsNeeded <= 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Please specify how many seats you need",
          path: ["seatsNeeded"]
        });
      } else if (
        data.estimatedAttendees &&
        data.seatsNeeded < data.estimatedAttendees) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "Number of seats must be greater than or equal to number of attendees",
          path: ["seatsNeeded"]
        });
      }
    }

    // Validate conditional partner fields
    if (data.onCampusPartners === "") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Please provide details about on-campus partners",
        path: ["onCampusPartners"]
      });
    }

    if (data.offCampusPartners === "") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Please provide details about off-campus partners",
        path: ["offCampusPartners"]
      });
    }

    if (data.nonIllinoisSpeaker === "") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Please provide details about non-UIUC speakers",
        path: ["nonIllinoisSpeaker"]
      });
    }

    if (data.nonIllinoisAttendees === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Percentage must be greater than 0",
        path: ["nonIllinoisAttendees"]
      });
    }

    // Setup details logic
    if (data.setupDetails === undefined && specificRoomSetupRooms.includes(data.spaceType || "")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Invalid setup details response.",
        path: ["setupDetails"]
      });
    }

    if (data.setupDetails && !specificRoomSetupRooms.includes(data.spaceType || "")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Invalid setup details response.",
        path: ["setupDetails"]
      });
    }
  });


export type RoomRequestFormValues = z.infer<typeof roomRequestSchema>;

export const roomRequestGetResponse = z.object({
  data: roomRequestSchema,
  updates: z.array(roomRequestStatusUpdate)
});

export type RoomRequestPostResponse = z.infer<typeof roomRequestPostResponse>;

export type RoomRequestStatusUpdate = z.infer<typeof roomRequestStatusUpdate>;

export type RoomRequestGetResponse = z.infer<typeof roomRequestGetResponse>;

export type RoomRequestStatusUpdatePostBody = z.infer<
  typeof roomRequestStatusUpdateRequest>;


export const roomGetResponse = z.array(
  roomRequestBaseSchema.extend({
    requestId: z.string().uuid(),
    status: z.nativeEnum(RoomRequestStatus)
  })
);

export type RoomRequestGetAllResponse = z.infer<typeof roomGetResponse>;

export function capitalizeFirstLetter(string: string) {
  return string.charAt(0).toUpperCase() + string.slice(1);
}

export const formatStatus = (status: RoomRequestStatus) => {
  if (status === RoomRequestStatus.SUBMITTED) {
    return 'Submitted to UIUC';
  }
  return capitalizeFirstLetter(status).
    replaceAll('_', ' ').
    replaceAll('uiuc', 'UIUC').
    replaceAll('acm', 'ACM');
};
