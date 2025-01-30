import { pino } from "pino";
export const logger = pino().child({ context: "sqsHandler" });
