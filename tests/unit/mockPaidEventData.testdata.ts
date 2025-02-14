import { unmarshall } from "@aws-sdk/util-dynamodb";

const dynamoTableData = [
  {
    event_id: {
      S: "test_barcrawl",
    },
    eventCost: {
      M: {
        others: {
          N: "100",
        },
        paid: {
          N: "0",
        },
      },
    },
    eventDetails: {
      S: "Join ACM",
    },
    eventImage: {
      S: "img/test.png",
    },
    eventProps: {
      M: {
        end: {
          N: "",
        },
        host: {
          S: "",
        },
        location: {
          S: "",
        },
      },
    },
    event_capacity: {
      N: "130",
    },
    event_name: {
      S: "ACM Fall 2023 Bar Crawl",
    },
    event_sales_active_utc: {
      N: "0",
    },
    event_time: {
      N: "1699578000",
    },
    member_price: {
      S: "price_1O6zHhDiGOXU9RuSvlrcIfOv",
    },
    nonmember_price: {
      S: "price_1O6zHhDiGOXU9RuSvlrcIfOv",
    },
    tickets_sold: {
      N: "0",
    },
  },
];

const dynamoTableDataUnmarshalled = dynamoTableData.map((x: any) => {
  const temp = unmarshall(x);
  return temp;
});

const dynamoTableDataUnmarshalledUpcomingOnly = dynamoTableData
  .map((x: any) => {
    const temp = unmarshall(x);
    return temp;
  })
  .filter((x: any) => x.title != "Event in the past.");

export {
  dynamoTableData,
  dynamoTableDataUnmarshalled,
  dynamoTableDataUnmarshalledUpcomingOnly,
};
