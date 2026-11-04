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

export const formatFundingRequestStatus = (status: FundingRequestStatus) => {
  const text = status.replaceAll("_", " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
};

export const formatCentsAsUsd = (cents: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    cents / 100,
  );
