import * as z from "zod/v4";

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

const MAJORS = [
  "ACES Undeclared",
  "Accountancy",
  "Accountancy + Data Science",
  "Actuarial Science",
  "Advertising",
  "Aerospace Engineering",
  "African American Studies",
  "Agricultural & Biological Engineering",
  "Agricultural & Consumer Economics",
  "Agricultural Leadership, Education, & Communications",
  "Agronomy",
  "Animal Sciences",
  "Anthropology",
  "Architectural Studies",
  "Art & Art History",
  "Art Education",
  "Art History",
  "Art Undeclared",
  "Asian American Studies",
  "Astronomy",
  "Astronomy + Data Science",
  "Astrophysics",
  "Atmospheric Sciences",
  "Biochemistry",
  "Bioengineering",
  "Brain & Cognitive Science",
  "Business + Data Science",
  "Business Undeclared",
  "Chemical Engineering",
  "Chemical Engineering + Data Science",
  "Chemistry",
  "Civil Engineering",
  "Classics",
  "Communication",
  "Community Health",
  "Comparative & World Literature",
  "Computer Engineering",
  "Computer Science",
  "Computer Science + Advertising",
  "Computer Science + Animal Sciences",
  "Computer Science + Anthropology",
  "Computer Science + Astronomy",
  "Computer Science + Bioengineering",
  "Computer Science + Chemistry",
  "Computer Science + Crop Sciences",
  "Computer Science + Economics",
  "Computer Science + Education",
  "Computer Science + Geography & Geographic Information Science",
  "Computer Science + Linguistics",
  "Computer Science + Music",
  "Computer Science + Philosophy",
  "Computer Science + Physics",
  "Creative Writing",
  "Crop Sciences",
  "Dance",
  "Dietetics and Nutrition",
  "Early Childhood Education",
  "Earth, Society, & Environmental Sustainability",
  "East Asian Languages & Cultures",
  "Econometrics & Quantitative Economics",
  "Economics",
  "Electrical Engineering",
  "Elementary Education",
  "Engineering Mechanics",
  "Engineering Technology & Management for Agricultural Systems",
  "Engineering Undeclared",
  "English",
  "Environmental Engineering",
  "Finance",
  "Finance + Data Science",
  "Food Science",
  "French",
  "French (Teaching)",
  "Gender & Women's Studies",
  "Geography & Geographic Information Science",
  "Geology",
  "German (Teaching)",
  "Germanic Studies",
  "Global Studies",
  "Graphic Design",
  "History",
  "History of Art",
  "Hospitality Management",
  "Human Development & Family Studies",
  "Individual Plans of Study",
  "Industrial Design",
  "Industrial Engineering",
  "Information Sciences",
  "Information Sciences + Data Science",
  "Information Systems",
  "Innovation, Leadership & Engineering Entrepreneurship",
  "Instrumental Music",
  "Integrative Biology",
  "Interdisciplinary Health Sciences",
  "Interdisciplinary Studies",
  "Italian",
  "Jazz Performance",
  "Journalism",
  "Kinesiology",
  "Landscape Architecture",
  "Latin American Studies",
  "Latina/Latino Studies",
  "Learning & Education Studies",
  "Liberal Studies",
  "Linguistics",
  "Linguistics and TESL",
  "Lyric Theatre",
  "Management",
  "Marketing",
  "Materials Science & Engineering",
  "Materials Science & Engineering + Data Science",
  "Mathematics",
  "Mathematics & Computer Science",
  "Mechanical Engineering",
  "Media",
  "Media & Cinema Studies",
  "Middle Grades Education",
  "Molecular & Cellular Biology",
  "Molecular and Cellular Biology + Data Science",
  "Music",
  "Music Composition",
  "Music Education",
  "Music Technology",
  "Musicology",
  "Natural Resources & Environmental Sciences",
  "Neural Engineering",
  "Neuroscience",
  "Nuclear, Plasma, & Radiological Engineering",
  "Nuclear, Plasma, and Radiological Engineering + Data Science",
  "Nutrition and Health",
  "Operations Management",
  "Philosophy",
  "Physics",
  "Plant Biotechnology",
  "Political Science",
  "Portuguese",
  "Psychology",
  "Recreation, Sport & Tourism",
  "Religion",
  "Russian, East European, & Eurasian Studies",
  "Secondary Education",
  "Slavic Studies",
  "Social Work",
  "Sociology",
  "Spanish",
  "Spanish (Teaching)",
  "Special Education",
  "Speech & Hearing Science",
  "Statistics",
  "Statistics & Computer Science",
  "Strategy, Innovation and Entrepreneurship",
  "Studio Art",
  "Supply Chain Management",
  "Sustainability in Food & Environmental Systems",
  "Sustainable Design",
  "Systems Engineering and Design",
  "Teaching - Middle Grades Education",
  "Theatre",
  "Urban Studies & Planning",
  "Voice"
] as const;

export const majorSchema = z.enum(MAJORS).meta({description: "The student's primary major at UIUC"});

export const rsvpProfileSchema = z.object({
  schoolYear: z.enum(["Freshman", "Sophomore", "Junior", "Senior", "Graduate"]).meta({
    description: "The attendee's current year in school.",
    example: "Sophomore",
  }),
  intendedMajor: majorSchema.meta({
    description: "The student's primary major at UIUC",
    example: "Computer Science",
  }),
  interests: z.array(z.string()).meta({
    description: "List of attendee's interests.",
    example: ["AI", "Web Development"],
  }),
  dietaryRestrictions:z.array(z.string()).meta({
    description: "User's dietary restrictions."
  }),
  updatedAt: z.number().meta({
    description: "Epoch timestamp (sec) when the profile was last updated.",
    example: 1705512000,
  }),
}).meta({
  description: "Represents a user's RSVP profile information.",
});
