import { unmarshall } from "@aws-sdk/util-dynamodb";

const dynamoTableData = [
  {
    id: {
      S: "3138bead-b2c5-4bfe-bce4-4b478658cb78",
    },
    createdBy: {
      S: "infra@acm.illinois.edu",
    },
    description: {
      S: "Join us on Quad Day to learn more about ACM and CS at Illinois!",
    },
    end: {
      S: "2024-08-25T16:00:00",
    },
    featured: {
      BOOL: true,
    },
    host: {
      S: "ACM",
    },
    location: {
      S: "Main Quad",
    },
    locationLink: {
      S: "https://maps.app.goo.gl/2ZRYibtE7Yem5TrP6",
    },
    start: {
      S: "2024-08-25T12:00:00",
    },
    title: {
      S: "Quad Day",
    },
  },
  {
    id: {
      S: "5bc69f3b-e958-4c80-b041-ddeae0385db8",
    },
    createdBy: {
      S: "dsingh14@illinois.edu",
    },
    description: {
      S: "Test event.",
    },
    end: {
      S: "2024-07-25T19:00:00",
    },
    featured: {
      BOOL: false,
    },
    host: {
      S: "Infrastructure Committee",
    },
    location: {
      S: "ACM Middle Room",
    },
    repeatEnds: {
      S: "2024-09-05T19:00:00",
    },
    repeats: {
      S: "weekly",
    },
    start: {
      S: "2024-07-25T18:00:00",
    },
    title: {
      S: "Infra Meeting",
    },
  },
  {
    id: {
      S: "4d38608d-90bf-4a58-8701-3f1b659a53db",
    },
    createdBy: {
      S: "dsingh14@illinois.edu",
    },
    description: {
      S: "Test paid featured event.",
    },
    end: {
      S: "2024-09-25T19:00:00",
    },
    featured: {
      BOOL: true,
    },
    host: {
      S: "Social Committee",
    },
    location: {
      S: "ACM Middle Room",
    },
    start: {
      S: "2024-09-25T18:00:00",
    },
    title: {
      S: "Testing Paid and Featured Event",
    },
    paidEventId: {
      S: "sp24_semiformal",
    },
  },
  {
    id: {
      S: "accd7fe0-50ac-427b-8041-a2b3ddcd328e",
    },
    createdBy: {
      S: "dsingh14@illinois.edu",
    },
    description: {
      S: "Test event in the past.",
    },
    end: {
      S: "2024-07-25T19:00:00",
    },
    featured: {
      BOOL: false,
    },
    host: {
      S: "Infrastructure Committee",
    },
    location: {
      S: "ACM Middle Room",
    },
    start: {
      S: "2024-07-25T18:00:00",
    },
    title: {
      S: "Event in the past.",
    },
  },
  {
    id: {
      S: "78be8f2b-3d1d-4481-90b6-85bfd84d38b4",
    },
    createdBy: {
      S: "infra@acm.illinois.edu",
    },
    description: {
      S: "Meet and chat with your peers and fellow ACM members, with food on us!",
    },
    featured: {
      BOOL: true,
    },
    host: {
      S: "ACM",
    },
    location: {
      S: "Legends",
    },
    locationLink: {
      S: "https://goo.gl/maps/CXESXd3otbGZNqFP7",
    },
    repeats: {
      S: "weekly",
    },
    start: {
      S: "2024-08-30T17:00:00",
    },
    title: {
      S: "Weekly Happy Hour",
    },
  },
];

const infraEventsOnly = dynamoTableData.filter((x) => {
  return x["host"]["S"] === "Infrastructure Committee";
});

const infraEventsOnlyUnmarshalled = infraEventsOnly.map((x: any) => {
  const temp = unmarshall(x);
  delete temp.createdBy;
  return temp;
});

const dynamoTableDataUnmarshalled = dynamoTableData.map((x: any) => {
  const temp = unmarshall(x);
  delete temp.createdBy;
  return temp;
});

const dynamoTableDataUnmarshalledUpcomingOnly = dynamoTableData
  .map((x: any) => {
    const temp = unmarshall(x);
    delete temp.createdBy;
    return temp;
  })
  .filter((x: any) => x.title !== "Event in the past.");

export {
  dynamoTableData,
  dynamoTableDataUnmarshalled,
  dynamoTableDataUnmarshalledUpcomingOnly,
  infraEventsOnly,
  infraEventsOnlyUnmarshalled,
};
