import * as z from "zod/v4";


export const illinoisSemesterId = z
  .string()
  .min(1)
  .max(4)
  .regex(/^(fa|sp|su|wi)\d{2}$/)
  .meta({
    description: "Short semester slug for a given semester.",
    id: "IllinoisSemesterId",
    examples: ["sp25", "fa24"],
  });

export const illinoisNetId = z
  .string()
  .min(3, { message: "NetID must be at least 3 characters." })
  .max(8, { message: "NetID cannot be more than 8 characters." })
  .regex(/^[a-zA-Z]{2}[a-zA-Z-]*(?:[2-9]|[1-9][0-9]{1,2})?$/, {
    message: "NetID is not valid!",
  })
  .meta({
    description: "Valid Illinois NetID. See https://answers.uillinois.edu/illinois/page.php?id=78766 for more information.",
    example: "rjjones",
    id: "IllinoisNetId",
  });
