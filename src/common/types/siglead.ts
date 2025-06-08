export type SigDetailRecord = {
  sigid: string;
  signame: string;
  description: string;
};

export type SigMemberRecord = {
  sigGroupId: string;
  email: string;
  designation: string;
  memberName: string;
};

export type SigleadGetRequest = {
  Params: { sigid: string };
  Querystring: undefined;
  Body: undefined;
};

export type SigMemberCount = {
  sigid: string;
  signame: string;
  count: number;
};

export type SigMemberUpdateRecord = {
  sigGroupId: string;
  email: string;
  id: string;
  memberName: string;
  designation: string;
  createdAt: string;
  updatedAt: string;
}

export type DynamoDBItem = {
  Item: {
    [key: string]: {
      [key: string]: string;
    };
  };
  ReturnConsumedCapacity: string;
  TableName: string;
}