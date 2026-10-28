import * as z from "zod/v4";
import { illinoisSemesterId, OrgUniqueId } from "./generic.js";

export enum FundingRequestType {
  FUNDING = "funding",
  REIMBURSEMENT = "reimbursement",
}

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
  type: z.enum(FundingRequestType),
  title: z.string(),
  requestedAmountCents: z.number().int(),
  approvedAmountCents: z.number().int().optional(),
  status: z.enum(FundingRequestStatus),
  createdBy: z.string(),
  createdAt: z.string(),
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

export const formatFundingRequestType = (type: FundingRequestType) =>
  type === FundingRequestType.FUNDING ? "Funding" : "Reimbursement";

export const formatCentsAsUsd = (cents: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    cents / 100,
  );
