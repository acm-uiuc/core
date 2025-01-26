export const SIGList = [
  "SIGPwny",
  "SIGCHI",
  "GameBuilders",
  "SIGAIDA",
  "SIGGRAPH",
  "ICPC",
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
] as const;

export const CommitteeList = [
  "Infrastructure Committee",
  "Social Committee",
  "Mentorship Committee",
  "Academic Committee",
  "Corporate Committee",
  "Marketing Committee",
] as const;

export const OrganizationList = ["ACM", ...SIGList, ...CommitteeList] as const;
