export type SigDetailRecord = {
  sigid: string;
  signame: string;
  description: string;
};

export type SigEntraRecord = {
    sigid: string;
    signame: string;
    leadGroupId: string;
    memberGroupId: string;
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