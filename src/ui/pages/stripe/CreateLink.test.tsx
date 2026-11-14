import React from "react";
import {
  render,
  screen,
  act,
  waitFor,
  fireEvent,
} from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import { vi } from "vitest";
import { MantineProvider } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import StripeCreateLinkPanel from "./CreateLink";
import { MemoryRouter } from "react-router-dom";
import { RampFundsResponse } from "@common/types/stripe";

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const connectedFunds = (
  funds: RampFundsResponse["funds"],
): RampFundsResponse => ({
  status: "connected",
  funds,
});

describe("StripeCreateLinkPanel Tests", () => {
  const createLinkMock = vi.fn();
  const getRampFundsMock = vi.fn();

  const renderComponent = async () => {
    await act(async () => {
      render(
        <MemoryRouter>
          <MantineProvider
            withGlobalClasses
            withCssVariables
            forceColorScheme="light"
          >
            <StripeCreateLinkPanel
              createLink={createLinkMock}
              getRampFunds={getRampFundsMock}
            />
          </MantineProvider>
        </MemoryRouter>,
      );
    });
  };

  const fillRequiredFields = async (user: UserEvent) => {
    await user.type(screen.getByPlaceholderText("ACM100"), "INV123");
    await user.type(screen.getByPlaceholderText("John Doe"), "John Doe");
    await user.type(
      screen.getByPlaceholderText("email@illinois.edu"),
      "johndoe@example.com",
    );
  };

  const submitForm = async (user: UserEvent) => {
    await user.click(screen.getByRole("button", { name: "Create Link" }));
  };

  beforeEach(() => {
    vi.clearAllMocks();
    getRampFundsMock.mockResolvedValue(connectedFunds([]));
  });

  it("renders the form fields correctly", async () => {
    await renderComponent();

    expect(screen.getByText("Invoice ID")).toBeInTheDocument();
    expect(screen.getByText("Invoice Amount")).toBeInTheDocument();
    expect(screen.getByText("Invoice Recipient Name")).toBeInTheDocument();
    expect(screen.getByText("Invoice Recipient Email")).toBeInTheDocument();
    expect(screen.getByText("Ramp fund (optional)")).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText("Search for a Ramp fund"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Create Link" }),
    ).toBeInTheDocument();
  });

  it("validates required fields before submission", async () => {
    const user = userEvent.setup();
    await renderComponent();
    await submitForm(user);
    expect(createLinkMock).toHaveBeenCalledTimes(0);
    await user.type(
      screen.getByPlaceholderText("email@illinois.edu"),
      "invalidEmail",
    );
    await user.clear(screen.getByPlaceholderText("ACM100"));
    expect(createLinkMock).toHaveBeenCalledTimes(0);
  });

  it("displays success modal with returned link", async () => {
    createLinkMock.mockResolvedValue({ link: "https://test-link.com" });
    const user = userEvent.setup();
    await renderComponent();

    await fillRequiredFields(user);
    await submitForm(user);

    expect(
      await screen.findByText("Payment Link Created!"),
    ).toBeInTheDocument();
    expect(screen.getByText("https://test-link.com")).toBeInTheDocument();
  });

  it("targets the selected Ramp fund on submission", async () => {
    createLinkMock.mockResolvedValue({ link: "https://test-link.com" });
    getRampFundsMock.mockResolvedValue(
      connectedFunds([
        { id: "fund-1", displayName: "Fund One" },
        { id: "fund-2", displayName: "Fund Two" },
      ]),
    );
    const user = userEvent.setup();
    await renderComponent();

    await fillRequiredFields(user);
    await user.click(screen.getByPlaceholderText("Search for a Ramp fund"));
    await user.click(await screen.findByText("Fund One"));
    await submitForm(user);

    await waitFor(() => {
      expect(createLinkMock).toHaveBeenCalledTimes(1);
    });
    expect(createLinkMock.mock.calls[0][0]).toMatchObject({
      invoiceId: "INV123",
      rampFundId: "fund-1",
    });
  });

  it("clears the Ramp fund selection back to an ordinary link", async () => {
    createLinkMock.mockResolvedValue({ link: "https://test-link.com" });
    getRampFundsMock.mockResolvedValue(
      connectedFunds([{ id: "fund-1", displayName: "Fund One" }]),
    );
    const user = userEvent.setup();
    await renderComponent();

    await fillRequiredFields(user);
    await user.click(screen.getByPlaceholderText("Search for a Ramp fund"));
    await user.click(await screen.findByText("Fund One"));

    const clearButton = screen.getByLabelText("Clear Ramp fund");
    await user.click(clearButton);
    await submitForm(user);

    await waitFor(() => {
      expect(createLinkMock).toHaveBeenCalledTimes(1);
    });
    expect(createLinkMock.mock.calls[0][0]).not.toHaveProperty("rampFundId");
  });

  it("still allows ordinary creation when Ramp is unavailable", async () => {
    createLinkMock.mockResolvedValue({ link: "https://test-link.com" });
    getRampFundsMock.mockResolvedValue({ status: "unavailable", funds: [] });
    const user = userEvent.setup();
    await renderComponent();

    expect(
      await screen.findByText("Ramp is currently unavailable."),
    ).toBeInTheDocument();
    await fillRequiredFields(user);
    await submitForm(user);

    await waitFor(() => {
      expect(createLinkMock).toHaveBeenCalledTimes(1);
    });
    expect(createLinkMock.mock.calls[0][0]).not.toHaveProperty("rampFundId");
  });

  it("treats a failed funds request as unavailable and keeps ordinary creation", async () => {
    createLinkMock.mockResolvedValue({ link: "https://test-link.com" });
    getRampFundsMock.mockRejectedValue(new Error("network failure"));
    const user = userEvent.setup();
    await renderComponent();

    expect(
      await screen.findByText("Ramp is currently unavailable."),
    ).toBeInTheDocument();
    await fillRequiredFields(user);
    await submitForm(user);

    await waitFor(() => {
      expect(createLinkMock).toHaveBeenCalledTimes(1);
    });
    expect(createLinkMock.mock.calls[0][0]).not.toHaveProperty("rampFundId");
  });

  it("shows a distinct message when no Ramp account is linked", async () => {
    getRampFundsMock.mockResolvedValue({ status: "not_linked", funds: [] });
    await renderComponent();

    expect(
      await screen.findByText(/No Ramp account is linked/),
    ).toBeInTheDocument();
  });

  it("shows a distinct message when there are no eligible funds", async () => {
    getRampFundsMock.mockResolvedValue(connectedFunds([]));
    await renderComponent();

    expect(
      await screen.findByText("No eligible Ramp funds are available."),
    ).toBeInTheDocument();
  });

  it("invalidates a selected fund that disappears on refresh", async () => {
    getRampFundsMock
      .mockResolvedValueOnce(
        connectedFunds([
          { id: "fund-1", displayName: "Fund One" },
          { id: "fund-2", displayName: "Fund Two" },
        ]),
      )
      .mockResolvedValue(
        connectedFunds([{ id: "fund-2", displayName: "Fund Two" }]),
      );
    const user = userEvent.setup();
    await renderComponent();

    await user.click(screen.getByPlaceholderText("Search for a Ramp fund"));
    await user.click(await screen.findByText("Fund One"));

    await user.click(screen.getByRole("button", { name: "Refresh" }));

    expect(await screen.findByText(/no longer eligible/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create Link" })).toBeDisabled();
  });

  it("does not submit a link when a stale fund selection becomes invalid", async () => {
    createLinkMock.mockResolvedValue({ link: "https://test-link.com" });
    getRampFundsMock
      .mockResolvedValueOnce(
        connectedFunds([{ id: "fund-1", displayName: "Fund One" }]),
      )
      .mockResolvedValue(
        connectedFunds([{ id: "fund-2", displayName: "Fund Two" }]),
      );
    const user = userEvent.setup();
    await renderComponent();

    await fillRequiredFields(user);
    await user.click(screen.getByPlaceholderText("Search for a Ramp fund"));
    await user.click(await screen.findByText("Fund One"));

    await user.click(screen.getByRole("button", { name: "Refresh" }));
    expect(await screen.findByText(/no longer eligible/)).toBeInTheDocument();

    const form = screen.getByPlaceholderText("ACM100").closest("form");
    if (!form) {
      throw new Error("expected a form to submit");
    }
    fireEvent.submit(form);

    expect(createLinkMock).not.toHaveBeenCalled();
  });

  it("applies only the latest funds response when requests race", async () => {
    const first = deferred<RampFundsResponse>();
    const second = deferred<RampFundsResponse>();
    getRampFundsMock
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const user = userEvent.setup();
    await renderComponent();

    await user.click(screen.getByRole("button", { name: "Refresh" }));

    await act(async () => {
      second.resolve(connectedFunds([{ id: "fund-a", displayName: "Fund A" }]));
    });
    await act(async () => {
      first.resolve(connectedFunds([{ id: "fund-b", displayName: "Fund B" }]));
    });

    await user.click(screen.getByPlaceholderText("Search for a Ramp fund"));
    expect(await screen.findByText("Fund A")).toBeInTheDocument();
    expect(screen.queryByText("Fund B")).not.toBeInTheDocument();
  });

  it("shows an error notification and does not open the modal on creation failure", async () => {
    const notificationsMock = vi.spyOn(notifications, "show");
    createLinkMock.mockRejectedValue(new Error("API Error"));
    const user = userEvent.setup();
    await renderComponent();

    await fillRequiredFields(user);
    await submitForm(user);

    await waitFor(() => {
      expect(notificationsMock).toHaveBeenCalled();
    });
    expect(screen.queryByText("Payment Link Created!")).not.toBeInTheDocument();

    notificationsMock.mockRestore();
  });
});
