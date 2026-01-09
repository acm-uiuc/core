export const EVENT_TEMPLATES = {
  weekly_meeting: {
    name: "Weekly Meeting",
    description: "Regular team meeting.",
    guidance: [
      "Update the description to be more specific, following the format given.",
      "Set the location and location link for where your weekly meeting is.",
      `Reference "Siebel CS", not "Siebel" in your location to avoid confusion, and include the room number.\nFor example: "Siebel CS 1106" or "CIF 0025".`,
      "Set the repeat end date for reading day of the current semester.",
    ],
    defaults: {
      title: "{{PRIMARY_ORG}} Weekly Meeting",
      description: "Come learn more about {{WHAT_YOUR_ORG_DOES}}!",
      host: "{{PRIMARY_ORG}}",
      location: "",
      locationLink: "",
      repeats: "weekly" as const,
      featured: false,
    },
  },
  social_event: {
    name: "Social Event",
    description: "Team social.",
    guidance: [
      "Specify what kind of social event (e.g., 'Game Night', 'Pizza Social')",
      "Mention if food/drinks will be provided",
      "Set a realistic end time for the event",
    ],
    defaults: {
      title: "",
      description:
        "Join {{PRIMARY_ORG}} for food, fun, and meeting other members!",
      host: "{{PRIMARY_ORG}}",
      location: "ACM Room (Siebel CS 1104)",
      locationLink: "https://maps.app.goo.gl/dwbBBBkfjkgj8gvA8",
      featured: false,
    },
  },
  hackathon: {
    name: "Hackathon",
    description: "Competitive event or hackathon.",
    guidance: [
      "Clearly state what the hackathon is about in the description.",
      "Link to the hackathon's main site.",
    ],
    defaults: {
      title: "",
      description:
        "Test your skills in this {{PRIMARY_ORG}} competition and compete for prizes!",
      host: "{{PRIMARY_ORG}}",
      location: "Siebel Center",
      locationLink: "https://maps.app.goo.gl/dwbBBBkfjkgj8gvA8",
      featured: true,
    },
  },
  corporate_event: {
    name: "Corporate Event",
    description:
      "Corporate event with a sponsor managed by the ACM Corporate Team.",
    guidance: ["Replace {{COMPANY_NAME}} and {{EVENT_TYPE}}."],
    defaults: {
      title: "{{COMPANY_NAME}} {{EVENT_TYPE}}",
      description:
        "Come network with {{COMPANY_NAME}}'s represenatives and learn more about their work, and explore job opportunities with them!",
      host: "ACM",
      location: "Siebel CS 2405",
      locationLink: "https://maps.app.goo.gl/u1uEUiFgu3XvQcv97",
      featured: true,
    },
  },
  major_event: {
    name: "Major Event",
    description: "Use only for events targeted at the general CS population.",
    guidance: [
      "Clearly state why people should attend.",
      "If this is a paid event, coordinate with the Infrastructure Chairs to get a paid event ID for this event.",
    ],
    defaults: {
      title: "{{EVENT_TITLE}}",
      description: "",
      host: "ACM",
      featured: true,
    },
  },
};
