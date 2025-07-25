import { transformSigLeadToURI } from "./utils.js";

export const SIGList = [
  "SIGPwny",
  "SIGCHI",
  "GameBuilders",
  "SIGAIDA",
  "SIGGRAPH",
  "SIGICPC",
  "SIGMobile",
  "SIGMusic",
  "GLUG",
  "SIGNLL",
  "SIGma",
  "SIGQuantum",
  "SIGecom",
  "SIGPLAN",
  "SIGPolicy",
  "SIGARCH",
  "SIGRobotics",
  "SIGtricity",
] as [string, ...string[]];

export const CommitteeList = [
  "Infrastructure Committee",
  "Social Committee",
  "Mentorship Committee",
  "Academic Committee",
  "Corporate Committee",
  "Marketing Committee",
] as [string, ...string[]];
export const OrganizationList = ["ACM", ...SIGList, ...CommitteeList] as [string, ...string[]];

const orgIds2Name: Record<string, string> = {};
OrganizationList.forEach((org) => {
  const sigid = transformSigLeadToURI(org);
  orgIds2Name[sigid] = org;
});
export { orgIds2Name };