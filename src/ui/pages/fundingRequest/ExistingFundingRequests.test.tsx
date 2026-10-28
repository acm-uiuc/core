import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { MantineProvider } from "@mantine/core";
import { vi } from "vitest";
import ExistingFundingRequests, {
  getFundingRequestStatusColor,
} from "./ExistingFundingRequests";
import {
  FundingRequestListResponse,
  FundingRequestStatus,
  FundingRequestType,
} from "@common/types/fundingRequest";

const sampleRequests: FundingRequestListResponse = [
  {
    requestId: "req-1",
    semesterId: "fa26",
    orgId: "C01",
    type: FundingRequestType.FUNDING,
    title: "Hackathon snacks",
    requestedAmountCents: 12550,
    status: FundingRequestStatus.SUBMITTED,
    createdBy: "lead@illinois.edu",
    createdAt: "2026-10-20T12:00:00.000Z",
  },
  {
    requestId: "req-2",
    semesterId: "fa26",
    orgId: "C01",
    type: FundingRequestType.REIMBURSEMENT,
    title: "Workshop supplies",
    requestedAmountCents: 5000,
    approvedAmountCents: 4000,
    status: FundingRequestStatus.APPROVED,
    createdBy: "lead@illinois.edu",
    createdAt: "2026-10-10T12:00:00.000Z",
  },
];

const renderTable = (
  getFundingRequests: (semester: string) => Promise<FundingRequestListResponse>,
  semester = "fa26",
) =>
  render(
    <MemoryRouter>
      <MantineProvider
        withGlobalClasses
        withCssVariables
        forceColorScheme="light"
      >
        <ExistingFundingRequests
          getFundingRequests={getFundingRequests}
          semester={semester}
        />
      </MantineProvider>
    </MemoryRouter>,
  );

describe("ExistingFundingRequests", () => {
  it("fetches requests for the selected semester and shows them", async () => {
    const getFundingRequests = vi.fn().mockResolvedValue(sampleRequests);
    renderTable(getFundingRequests);

    expect(await screen.findByText("Hackathon snacks")).toBeInTheDocument();
    expect(screen.getByText("Workshop supplies")).toBeInTheDocument();
    expect(getFundingRequests).toHaveBeenCalledWith("fa26");
  });

  it("formats amounts, types and statuses", async () => {
    renderTable(vi.fn().mockResolvedValue(sampleRequests));

    expect(await screen.findByText("$125.50")).toBeInTheDocument();
    expect(screen.getByText("$50.00")).toBeInTheDocument();
    expect(screen.getByText("$40.00")).toBeInTheDocument();
    expect(screen.getByText("Funding")).toBeInTheDocument();
    expect(screen.getByText("Reimbursement")).toBeInTheDocument();
    expect(screen.getByText("Submitted")).toBeInTheDocument();
    expect(screen.getByText("Approved")).toBeInTheDocument();
  });

  it("shows a message when there are no requests", async () => {
    renderTable(vi.fn().mockResolvedValue([]));
    expect(
      await screen.findByText("No funding requests for this semester."),
    ).toBeInTheDocument();
  });

  it("shows an error when loading fails", async () => {
    renderTable(vi.fn().mockRejectedValue(new Error("network down")));
    expect(
      await screen.findByText(
        "Could not load funding requests. Please try again later.",
      ),
    ).toBeInTheDocument();
  });

  it("refetches when the semester changes", async () => {
    const getFundingRequests = vi.fn().mockResolvedValue([]);
    const { rerender } = renderTable(getFundingRequests, "fa26");
    await waitFor(() =>
      expect(getFundingRequests).toHaveBeenCalledWith("fa26"),
    );

    rerender(
      <MemoryRouter>
        <MantineProvider
          withGlobalClasses
          withCssVariables
          forceColorScheme="light"
        >
          <ExistingFundingRequests
            getFundingRequests={getFundingRequests}
            semester="sp26"
          />
        </MantineProvider>
      </MemoryRouter>,
    );
    await waitFor(() =>
      expect(getFundingRequests).toHaveBeenCalledWith("sp26"),
    );
  });

  it("gives every status its own color", () => {
    const colors = Object.values(FundingRequestStatus).map(
      getFundingRequestStatusColor,
    );
    expect(new Set(colors).size).toBe(colors.length);
  });
});
