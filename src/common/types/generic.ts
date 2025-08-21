import * as z from "zod/v4";


export const illinoisSemesterId = z
  .string()
  .length(4)
  .regex(/^(fa|sp|su|wi)\d{2}$/)
  .meta({
    description: "Short semester slug for a given semester.",
    id: "IllinoisSemesterId",
    example: "fa24",
  });

export const illinoisNetId = z
  .string()
  .min(3, { message: "NetID must be at least 3 characters." })
  .max(8, { message: "NetID cannot be more than 8 characters." })
  .regex(/^[a-z]{2}[a-z0-9-]{1,6}$/i, {
    message: "NetID is malformed.",
  })
  .meta({
    description: "Valid Illinois NetID. See https://answers.uillinois.edu/illinois/page.php?id=78766 for more information.",
    example: "rjjones",
    id: "IllinoisNetId",
  });
