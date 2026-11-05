import * as z from "zod/v4";
import { illinoisSemesterId, OrgUniqueId } from "./generic.js";

export enum FundingRequestStatus {
  SUBMITTED = "submitted",
  NEEDS_UPDATE = "needs_update",
  APPROVED = "approved",
  DENIED = "denied",
  PAID = "paid",
}

export const fundingRequestListQuery = z.object({
  semesterId: illinoisSemesterId,
});

export const fundingRequestListItem = z.object({
  requestId: z.string(),
  semesterId: illinoisSemesterId,
  orgId: OrgUniqueId,
  title: z.string(),
  requestedAmountCents: z.number().int().nonnegative(),
  approvedAmountCents: z.number().int().nonnegative().optional(),
  status: z.enum(FundingRequestStatus),
  createdBy: z.string(),
  createdAt: z.iso.datetime(),
});

export const fundingRequestListResponse = z.array(fundingRequestListItem);

export type FundingRequestListItem = z.infer<typeof fundingRequestListItem>;
export type FundingRequestListResponse = z.infer<
  typeof fundingRequestListResponse
>;

// The POST body. These are the only fields a requester fills in; the server
// adds the IDs, status, timestamps and createdBy itself.
export const fundingRequestCreateSchema = z.object({
  semesterId: illinoisSemesterId,
  orgId: OrgUniqueId,
  title: z
    .string()
    .min(2, "Title must have at least 2 characters")
    .max(100, "Title cannot exceed 100 characters"),
  description: z
    .string()
    .min(10, "Description must have at least 10 characters")
    .max(2000, "Description cannot exceed 2000 characters"),
  requestedAmountCents: z
    .number()
    .int("Amount must be a whole number of cents")
    .positive("Amount must be greater than $0"),
});
export type FundingRequestCreate = z.infer<typeof fundingRequestCreateSchema>;

export const fundingRequestPostResponse = z.object({
  id: z.string().min(1),
  status: z.literal(FundingRequestStatus.SUBMITTED),
});
export type FundingRequestPostResponse = z.infer<
  typeof fundingRequestPostResponse
>;

export const formatFundingRequestStatus = (status: FundingRequestStatus) => {
  const text = status.replaceAll("_", " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
};

export const formatCentsAsUsd = (cents: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    cents / 100,
  );
