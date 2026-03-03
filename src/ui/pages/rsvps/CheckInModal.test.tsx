import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { MantineProvider } from "@mantine/core";
import { CheckInModal } from "./CheckInModal";

describe("CheckInModal Component", () => {
  const mockOnClose = vi.fn();
  const mockCheckInAttendee = vi.fn();
  const eventId = "evt_123";

  const renderComponent = (props = {}) => {
    return render(
      <MantineProvider>
        <CheckInModal
          opened
          onClose={mockOnClose}
          eventId={eventId}
          checkInAttendee={mockCheckInAttendee}
          {...props}
        />
      </MantineProvider>,
    );
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckInAttendee.mockResolvedValue(undefined);
  });

  // ─── Rendering ────────────────────────────────────────────────────────────

  it("renders the modal with all expected UI elements", () => {
    renderComponent();

    expect(screen.getByText("Check-In Attendee")).toBeInTheDocument();
    expect(screen.getByText("Card Swiper Ready")).toBeInTheDocument();
    expect(
      screen.getByText("Swipe any iCard or enter UIN manually"),
    ).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText("Swipe card or type UIN"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Check In/i }),
    ).toBeInTheDocument();
  });

  it("renders the supported formats help text", () => {
    renderComponent();

    expect(screen.getByText(/Supported formats/i)).toBeInTheDocument();
    expect(screen.getByText(/ACMCARD####XXXXXXXXX/)).toBeInTheDocument();
    expect(screen.getByText(/9-digit number/)).toBeInTheDocument();
  });

  it("has the Check In button disabled when input is empty", () => {
    renderComponent();

    expect(screen.getByRole("button", { name: /Check In/i })).toBeDisabled();
  });

  it("enables the Check In button when input has a value", async () => {
    const user = userEvent.setup();
    renderComponent();

    await user.type(
      screen.getByPlaceholderText("Swipe card or type UIN"),
      "123456789",
    );

    expect(screen.getByRole("button", { name: /Check In/i })).toBeEnabled();
  });

  // ─── Manual UIN Entry ─────────────────────────────────────────────────────

  it("checks in an attendee with a valid 9-digit UIN via button click", async () => {
    const user = userEvent.setup();
    renderComponent();

    await user.type(
      screen.getByPlaceholderText("Swipe card or type UIN"),
      "123456789",
    );
    await user.click(screen.getByRole("button", { name: /Check In/i }));

    await waitFor(() => {
      expect(mockCheckInAttendee).toHaveBeenCalledWith(eventId, "123456789");
    });

    expect(screen.getByText("Check-In Successful")).toBeInTheDocument();
    expect(screen.getByText("Manual UIN Entry")).toBeInTheDocument();
    expect(screen.getByText("123456789")).toBeInTheDocument();
  });

  it("checks in an attendee with a valid 9-digit UIN via Enter key", async () => {
    const user = userEvent.setup();
    renderComponent();

    await user.type(
      screen.getByPlaceholderText("Swipe card or type UIN"),
      "987654321{Enter}",
    );

    await waitFor(() => {
      expect(mockCheckInAttendee).toHaveBeenCalledWith(eventId, "987654321");
    });

    expect(screen.getByText("Check-In Successful")).toBeInTheDocument();
  });

  it("shows 'UIN:' label in the success panel", async () => {
    const user = userEvent.setup();
    renderComponent();

    await user.type(
      screen.getByPlaceholderText("Swipe card or type UIN"),
      "123456789{Enter}",
    );

    await waitFor(() => {
      expect(screen.getByText("UIN:")).toBeInTheDocument();
    });
  });

  it("clears the input field after a successful check-in", async () => {
    const user = userEvent.setup();
    renderComponent();

    const input = screen.getByPlaceholderText("Swipe card or type UIN");
    await user.type(input, "123456789{Enter}");

    await waitFor(() => {
      expect(mockCheckInAttendee).toHaveBeenCalled();
    });

    expect(input).toHaveValue("");
  });

  it("does nothing when Enter is pressed with only whitespace", async () => {
    const user = userEvent.setup();
    renderComponent();

    await user.type(
      screen.getByPlaceholderText("Swipe card or type UIN"),
      "   {Enter}",
    );

    expect(mockCheckInAttendee).not.toHaveBeenCalled();
  });

  // ─── ACM Card Swipe ───────────────────────────────────────────────────────

  it("parses a standard ACM card swipe and extracts the 9-digit UIN", async () => {
    const user = userEvent.setup();
    renderComponent();

    // Format: ACMCARD + 4 digits + 9-digit UIN
    await user.type(
      screen.getByPlaceholderText("Swipe card or type UIN"),
      "ACMCARD6397678788595{Enter}",
    );

    await waitFor(() => {
      expect(mockCheckInAttendee).toHaveBeenCalledWith(eventId, "678788595");
    });

    expect(screen.getByText("Check-In Successful")).toBeInTheDocument();
  });

  it("falls back gracefully when ACM card format has a non-standard prefix length", async () => {
    const user = userEvent.setup();
    renderComponent();

    // Flexible match: ACMCARD + variable-length prefix + 9-digit UIN
    await user.type(
      screen.getByPlaceholderText("Swipe card or type UIN"),
      "ACMCARD123456789{Enter}",
    );

    await waitFor(() => {
      expect(mockCheckInAttendee).toHaveBeenCalledWith(eventId, "123456789");
    });
  });

  // ─── Invalid Input ────────────────────────────────────────────────────────

  it("shows an error for input that is not a 9-digit UIN or ACM card", async () => {
    const user = userEvent.setup();
    renderComponent();

    await user.type(
      screen.getByPlaceholderText("Swipe card or type UIN"),
      "notauin{Enter}",
    );

    expect(mockCheckInAttendee).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(
        screen.getByText("Invalid input format. Enter a 9-digit UIN"),
      ).toBeInTheDocument();
    });
  });

  it("shows an error for an email address input", async () => {
    const user = userEvent.setup();
    renderComponent();

    await user.type(
      screen.getByPlaceholderText("Swipe card or type UIN"),
      "test@example.com{Enter}",
    );

    expect(mockCheckInAttendee).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(
        screen.getByText("Invalid input format. Enter a 9-digit UIN"),
      ).toBeInTheDocument();
    });
  });

  it("shows an error for a UIN with fewer than 9 digits", async () => {
    const user = userEvent.setup();
    renderComponent();

    await user.type(
      screen.getByPlaceholderText("Swipe card or type UIN"),
      "12345{Enter}",
    );

    expect(mockCheckInAttendee).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(
        screen.getByText("Invalid input format. Enter a 9-digit UIN"),
      ).toBeInTheDocument();
    });
  });

  it("shows an error for a UIN with more than 9 digits", async () => {
    const user = userEvent.setup();
    renderComponent();

    await user.type(
      screen.getByPlaceholderText("Swipe card or type UIN"),
      "1234567890{Enter}",
    );

    expect(mockCheckInAttendee).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(
        screen.getByText("Invalid input format. Enter a 9-digit UIN"),
      ).toBeInTheDocument();
    });
  });

  // ─── Cooldown ─────────────────────────────────────────────────────────────

  it("prevents a second check-in within the 2-second cooldown period", async () => {
    const user = userEvent.setup();
    renderComponent();

    const input = screen.getByPlaceholderText("Swipe card or type UIN");

    await user.type(input, "123456789{Enter}");
    await waitFor(() => expect(mockCheckInAttendee).toHaveBeenCalledTimes(1));

    // Immediately attempt a second check-in — should be blocked by cooldown
    await user.type(input, "987654321{Enter}");

    expect(mockCheckInAttendee).toHaveBeenCalledTimes(1);
  });

  // ─── Check-In History ─────────────────────────────────────────────────────

  it("shows recent check-in history after multiple check-ins past the cooldown", async () => {
    const user = userEvent.setup();
    renderComponent();

    const input = screen.getByPlaceholderText("Swipe card or type UIN");

    await user.type(input, "111111111{Enter}");
    await waitFor(() => expect(mockCheckInAttendee).toHaveBeenCalledTimes(1));

    await act(async () => {
      await new Promise((r) => setTimeout(r, 2100));
    });

    await user.type(input, "222222222{Enter}");
    await waitFor(() => expect(mockCheckInAttendee).toHaveBeenCalledTimes(2));

    expect(
      screen.getByText("Recent Check-Ins (1 previous)"),
    ).toBeInTheDocument();
    // First UIN should now appear in the history list
    expect(screen.getByText("111111111")).toBeInTheDocument();
  });

  // ─── API Error Handling ───────────────────────────────────────────────────

  it("displays a structured API error message on check-in failure", async () => {
    const user = userEvent.setup();
    mockCheckInAttendee.mockRejectedValue({
      response: {
        data: { message: "Attendee not registered for this event." },
      },
    });

    renderComponent();

    await user.type(
      screen.getByPlaceholderText("Swipe card or type UIN"),
      "123456789{Enter}",
    );

    await waitFor(() => {
      expect(screen.getByText("Check-In Error")).toBeInTheDocument();
      expect(
        screen.getByText("Attendee not registered for this event."),
      ).toBeInTheDocument();
    });
  });

  it("displays a generic fallback error when the API error has no message", async () => {
    const user = userEvent.setup();
    mockCheckInAttendee.mockRejectedValue(new Error("Network Error"));

    renderComponent();

    await user.type(
      screen.getByPlaceholderText("Swipe card or type UIN"),
      "123456789{Enter}",
    );

    await waitFor(() => {
      expect(
        screen.getByText("Failed to check in attendee."),
      ).toBeInTheDocument();
    });
  });

  it("does not display a success banner when check-in fails", async () => {
    const user = userEvent.setup();
    mockCheckInAttendee.mockRejectedValue(new Error("Network Error"));

    renderComponent();

    await user.type(
      screen.getByPlaceholderText("Swipe card or type UIN"),
      "123456789{Enter}",
    );

    await waitFor(() => {
      expect(screen.getByText("Check-In Error")).toBeInTheDocument();
    });

    expect(screen.queryByText("Check-In Successful")).not.toBeInTheDocument();
  });

  // ─── Modal Lifecycle ──────────────────────────────────────────────────────

  it("resets all state when the modal is closed and reopened", async () => {
    const user = userEvent.setup();

    const { rerender } = render(
      <MantineProvider>
        <CheckInModal
          opened
          onClose={mockOnClose}
          eventId={eventId}
          checkInAttendee={mockCheckInAttendee}
        />
      </MantineProvider>,
    );

    await user.type(
      screen.getByPlaceholderText("Swipe card or type UIN"),
      "123456789{Enter}",
    );
    await waitFor(() =>
      expect(screen.getByText("Check-In Successful")).toBeInTheDocument(),
    );

    // Close the modal
    rerender(
      <MantineProvider>
        <CheckInModal
          opened={false}
          onClose={mockOnClose}
          eventId={eventId}
          checkInAttendee={mockCheckInAttendee}
        />
      </MantineProvider>,
    );

    // Reopen the modal
    rerender(
      <MantineProvider>
        <CheckInModal
          opened
          onClose={mockOnClose}
          eventId={eventId}
          checkInAttendee={mockCheckInAttendee}
        />
      </MantineProvider>,
    );

    expect(screen.queryByText("Check-In Successful")).not.toBeInTheDocument();
    expect(screen.queryByText("Recent Check-Ins")).not.toBeInTheDocument();
    expect(screen.queryByText("Check-In Error")).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText("Swipe card or type UIN")).toHaveValue(
      "",
    );
  });
});
