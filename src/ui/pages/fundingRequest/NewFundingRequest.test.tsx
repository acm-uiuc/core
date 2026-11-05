import React, { useEffect } from "react";
import { render, screen, act } from "@testing-library/react";
import { vi } from "vitest";
import { MantineProvider } from "@mantine/core";
import userEvent from "@testing-library/user-event";
import NewFundingRequest, {
  buildFundingRequestPayload,
} from "./NewFundingRequest";
import { fundingRequestCreateSchema } from "@common/types/fundingRequest";

// The real selector asks the API which orgs the user leads; pretend they lead C01.
vi.mock("@ui/components/ManageableOrgsSelector", () => ({
  ManageableOrgsSelector: ({ label, onOrgsLoaded }: any) => {
    useEffect(() => {
      onOrgsLoaded?.(["C01"]);
    }, []);
    return <div>{label}</div>;
  },
}));

const renderComponent = async (createFundingRequest = vi.fn()) => {
  await act(async () => {
    render(
      <MantineProvider forceColorScheme="light">
        <NewFundingRequest createFundingRequest={createFundingRequest} />
      </MantineProvider>,
    );
  });
  return createFundingRequest;
};

describe("NewFundingRequest", () => {
  it("shows the request fields", async () => {
    await renderComponent();
    for (const label of [
      "Semester",
      "Organization",
      "Title",
      "Description",
      "Amount (USD)",
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it("does not submit an empty form", async () => {
    const create = await renderComponent();
    await userEvent.click(screen.getByText("Submit request"));
    expect(create).not.toHaveBeenCalled();
  });

  it("builds a valid payload with the amount in cents", () => {
    const payload = buildFundingRequestPayload({
      semesterId: "fa26",
      orgId: "C01",
      title: " Hackathon pizza ",
      description: "Pizza for 60 attendees at the fall hackathon.",
      amountDollars: 450.1,
    });
    expect(payload).toEqual({
      semesterId: "fa26",
      orgId: "C01",
      title: "Hackathon pizza",
      description: "Pizza for 60 attendees at the fall hackathon.",
      requestedAmountCents: 45010,
    });
    expect(fundingRequestCreateSchema.safeParse(payload).success).toBe(true);
  });
});
