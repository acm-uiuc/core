import { unmarshall } from "@aws-sdk/util-dynamodb";
const fulfilledMerchItem1 = {
  stripe_pi: {
    S: "pi_3Q5GewDiGOXU9RuS16txRR5D",
  },
  email: {
    S: "testing0@illinois.edu",
  },
  fulfilled: {
    BOOL: true,
  },
  item_id: {
    S: "2024_fa_barcrawl",
  },
  quantity: {
    N: "1",
  },
  refunded: {
    BOOL: false,
  },
  scannerEmail: {
    S: "dsingh14@illinois.edu",
  },
  size: {
    S: "M",
  },
};

const unfulfilledMerchItem1 = {
  stripe_pi: {
    S: "pi_8J4NrYdA3S7cW8Ty92FnGJ6L",
  },
  email: {
    S: "testing1@illinois.edu",
  },
  fulfilled: {
    BOOL: false,
  },
  item_id: {
    S: "2024_fa_barcrawl",
  },
  quantity: {
    N: "3",
  },
  refunded: {
    BOOL: false,
  },
  size: {
    S: "L",
  },
};

const refundedMerchItem = {
  stripe_pi: {
    S: "pi_6T9QvUwR2IOj4CyF35DsXK7P",
  },
  email: {
    S: "testing2@illinois.edu",
  },
  fulfilled: {
    BOOL: false,
  },
  item_id: {
    S: "2024_fa_barcrawl",
  },
  quantity: {
    N: "3",
  },
  refunded: {
    BOOL: true,
  },
  size: {
    S: "L",
  },
};

const fulfilledMerchItem2 = {
  stripe_pi: {
    S: "pi_5L8SwOdN9PXu6RyV83FgQK1C",
  },
  email: {
    S: "testing2@illinois.edu",
  },
  fulfilled: {
    BOOL: true,
  },
  item_id: {
    S: "2024_fa_barcrawl",
  },
  quantity: {
    N: "1",
  },
  refunded: {
    BOOL: false,
  },
  size: {
    S: "XS",
  },
  total_paid: {
    N: 500,
  },
};

const dynamoTableData = [
  fulfilledMerchItem1,
  unfulfilledMerchItem1,
  refundedMerchItem,
  fulfilledMerchItem2,
];

const dynamoTableDataUnmarshalled = dynamoTableData.map((x: any) => {
  const temp = unmarshall(x);
  delete temp.createdBy;
  return temp;
});

export {
  dynamoTableData,
  fulfilledMerchItem1,
  unfulfilledMerchItem1,
  refundedMerchItem,
  fulfilledMerchItem2,
  dynamoTableDataUnmarshalled,
};
