import { render, screen, act, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { MantineProvider } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { RsvpConfigForm } from "./ManageRsvpConfigForm";
import { MemoryRouter } from "react-router-dom";

vi.mock("@mantine/notifications", () => ({
  notifications: {
    show: vi.fn(),
  },
}));

describe("RsvpConfigForm Tests", () => {
  const getRsvpConfigMock = vi.fn();
  const updateRsvpConfigMock = vi.fn();

  const mockRsvpConfig = {
    rsvpOpenAt: 1704067200,
    rsvpCloseAt: 1706745600,
    rsvpLimit: 100,
    rsvpCheckInEnabled: true,
  };

  const renderComponent = async (props = {}) => {
    await act(async () => {
      render(
        <MemoryRouter>
          <MantineProvider
            withGlobalClasses
            withCssVariables
            forceColorScheme="light"
          >
            <RsvpConfigForm
              eventId="evt_test_123"
              getRsvpConfig={getRsvpConfigMock}
              updateRsvpConfig={updateRsvpConfigMock}
              {...props}
            />
          </MantineProvider>
        </MemoryRouter>,
      );
    });
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders loading overlay initially", async () => {
    getRsvpConfigMock.mockImplementation(() => new Promise(() => {}));
    await renderComponent();

    expect(screen.getByTestId("rsvp-config-loading")).toBeInTheDocument();
  });

  it("fetches and displays RSVP config data", async () => {
    getRsvpConfigMock.mockResolvedValue(mockRsvpConfig);
    await renderComponent();

    const openInput = await screen.findByLabelText(/RSVP Opens At/i);
    expect(openInput).toBeInTheDocument();

    expect(screen.getByLabelText(/RSVP Closes At/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/RSVP Limit/i)).toBeInTheDocument();

    expect(openInput).toHaveTextContent("01/01/2024 00:00");
  });

  it("handles RSVP config fetch failure with 404", async () => {
    const error: any = { response: { status: 404 } };
    getRsvpConfigMock.mockRejectedValue(error);
    await renderComponent();

    expect(
      await screen.findByText("No RSVP Configuration Found"),
    ).toBeInTheDocument();

    expect(
      screen.getByText(
        "This event does not have an RSVP configuration yet. You can create one by filling out the form below.",
      ),
    ).toBeInTheDocument();
  });

  it("handles RSVP config fetch failure with other errors", async () => {
    const notificationsMock = vi.spyOn(notifications, "show");
    getRsvpConfigMock.mockRejectedValue(new Error("Network error"));
    await renderComponent();

    await waitFor(() => {
      expect(notificationsMock).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Error loading config",
          color: "red",
        }),
      );
    });

    notificationsMock.mockRestore();
  });

  it("allows editing RSVP limit", async () => {
    getRsvpConfigMock.mockResolvedValue(mockRsvpConfig);
    const user = userEvent.setup();
    await renderComponent();

    const limitInput = await screen.findByLabelText(/RSVP Limit/i);

    await user.clear(limitInput);
    await user.type(limitInput, "150");

    expect(limitInput).toHaveValue("150");
  });

  it("allows toggling check-in enabled", async () => {
    getRsvpConfigMock.mockResolvedValue(mockRsvpConfig);
    const user = userEvent.setup();
    await renderComponent();

    await screen.findByLabelText(/RSVP Opens At/i);

    const checkInSwitch = screen.getByRole("switch", {
      name: /Enable Check-In/i,
    });

    expect(checkInSwitch).toBeChecked();

    await user.click(checkInSwitch);
    expect(checkInSwitch).not.toBeChecked();
  });

  it("submits form with updated data", async () => {
    getRsvpConfigMock.mockResolvedValue(mockRsvpConfig);
    updateRsvpConfigMock.mockResolvedValue(undefined);
    const user = userEvent.setup();
    await renderComponent();

    const limitInput = await screen.findByLabelText(/RSVP Limit/i);
    await user.clear(limitInput);
    await user.type(limitInput, "200");

    const submitButton = screen.getByRole("button", {
      name: "Save Configuration",
    });
    await user.click(submitButton);

    await waitFor(() => {
      expect(updateRsvpConfigMock).toHaveBeenCalledWith(
        "evt_test_123",
        expect.objectContaining({
          rsvpLimit: 200,
        }),
      );
    });
  });

  it("shows success notification on successful save", async () => {
    const notificationsMock = vi.spyOn(notifications, "show");
    getRsvpConfigMock.mockResolvedValue(mockRsvpConfig);
    updateRsvpConfigMock.mockResolvedValue(undefined);
    const user = userEvent.setup();
    await renderComponent();

    const submitButton = await screen.findByRole("button", {
      name: "Save Configuration",
    });
    await user.click(submitButton);

    await waitFor(() => {
      expect(notificationsMock).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Success",
          color: "green",
        }),
      );
    });

    notificationsMock.mockRestore();
  });

  it("shows error notification on save failure", async () => {
    const notificationsMock = vi.spyOn(notifications, "show");
    getRsvpConfigMock.mockResolvedValue(mockRsvpConfig);
    updateRsvpConfigMock.mockRejectedValue(new Error("Save failed"));
    const user = userEvent.setup();
    await renderComponent();

    const submitButton = await screen.findByRole("button", {
      name: "Save Configuration",
    });
    await user.click(submitButton);

    await waitFor(() => {
      expect(notificationsMock).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Error",
          color: "red",
        }),
      );
    });

    notificationsMock.mockRestore();
  });

  it("validates that close time is after open time", async () => {
    const notificationsMock = vi.spyOn(notifications, "show");
    getRsvpConfigMock.mockResolvedValue({
      rsvpOpenAt: 1706745600,
      rsvpCloseAt: 1704067200,
      rsvpLimit: 100,
      rsvpCheckInEnabled: false,
    });
    const user = userEvent.setup();
    await renderComponent();

    const submitButton = await screen.findByRole("button", {
      name: "Save Configuration",
    });
    await user.click(submitButton);

    await waitFor(() => {
      expect(notificationsMock).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Invalid Times",
          color: "red",
        }),
      );
    });

    notificationsMock.mockRestore();
  });

  it("prevents negative RSVP limit values", async () => {
    getRsvpConfigMock.mockResolvedValue(mockRsvpConfig);
    const user = userEvent.setup();
    await renderComponent();

    const limitInput = await screen.findByLabelText(/RSVP Limit/i);
    await user.clear(limitInput);
    await user.type(limitInput, "-50");

    expect(limitInput).not.toHaveValue("-50");
  });

  it("handles null RSVP limit (unlimited)", async () => {
    getRsvpConfigMock.mockResolvedValue({
      ...mockRsvpConfig,
      rsvpLimit: null,
    });
    updateRsvpConfigMock.mockResolvedValue(undefined);
    const user = userEvent.setup();
    await renderComponent();

    const limitInput = await screen.findByLabelText(/RSVP Limit/i);

    expect(limitInput).toHaveValue("");

    const submitButton = screen.getByRole("button", {
      name: "Save Configuration",
    });
    await user.click(submitButton);

    await waitFor(() => {
      expect(updateRsvpConfigMock).toHaveBeenCalledWith(
        "evt_test_123",
        expect.objectContaining({
          rsvpLimit: null,
        }),
      );
    });
  });

  it("disables submit button while loading", async () => {
    getRsvpConfigMock.mockResolvedValue(mockRsvpConfig);
    updateRsvpConfigMock.mockImplementation(
      () => new Promise((resolve) => setTimeout(resolve, 500)),
    );
    const user = userEvent.setup();
    await renderComponent();

    const submitButton = await screen.findByRole("button", {
      name: "Save Configuration",
    });
    await user.click(submitButton);

    expect(submitButton).toBeDisabled();
  });

  it("resets form when event ID changes", async () => {
    getRsvpConfigMock.mockResolvedValue(mockRsvpConfig);
    const { rerender } = render(
      <MemoryRouter>
        <MantineProvider
          withGlobalClasses
          withCssVariables
          forceColorScheme="light"
        >
          <RsvpConfigForm
            eventId="evt_test_123"
            getRsvpConfig={getRsvpConfigMock}
            updateRsvpConfig={updateRsvpConfigMock}
          />
        </MantineProvider>
      </MemoryRouter>,
    );

    await screen.findByLabelText(/RSVP Opens At/i);

    const newConfig = {
      rsvpOpenAt: 1709251200,
      rsvpCloseAt: 1711929600,
      rsvpLimit: 50,
      rsvpCheckInEnabled: false,
    };
    getRsvpConfigMock.mockResolvedValue(newConfig);

    await act(async () => {
      rerender(
        <MemoryRouter>
          <MantineProvider
            withGlobalClasses
            withCssVariables
            forceColorScheme="light"
          >
            <RsvpConfigForm
              eventId="evt_test_456"
              getRsvpConfig={getRsvpConfigMock}
              updateRsvpConfig={updateRsvpConfigMock}
            />
          </MantineProvider>
        </MemoryRouter>,
      );
    });

    await waitFor(() => {
      expect(getRsvpConfigMock).toHaveBeenCalledWith("evt_test_456");
    });
  });

  it("sets default values when no config is found", async () => {
    const error: any = { response: { status: 404 } };
    getRsvpConfigMock.mockRejectedValue(error);
    await renderComponent();

    await screen.findByText("No RSVP Configuration Found");

    expect(screen.getByLabelText(/RSVP Opens At/i)).toBeInTheDocument();

    const checkInSwitch = screen.getByRole("switch", {
      name: /Enable Check-In/i,
    });
    expect(checkInSwitch).not.toBeChecked();
  });
});
