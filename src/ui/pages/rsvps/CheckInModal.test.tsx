import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { MantineProvider } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { CheckInModal } from "./CheckInModal";

const { mockStart, mockStop, mockClear, mockGetState } = vi.hoisted(() => ({
  mockStart: vi.fn(),
  mockStop: vi.fn(),
  mockClear: vi.fn(),
  mockGetState: vi.fn(),
}));

vi.mock("html5-qrcode", () => {
  return {
    Html5Qrcode: class {
      start(...args: any[]) {
        return mockStart(...args);
      }
      stop(...args: any[]) {
        return mockStop(...args);
      }
      clear(...args: any[]) {
        return mockClear(...args);
      }
      getState(...args: any[]) {
        return mockGetState(...args);
      }
    },
  };
});

vi.mock("@mantine/notifications", () => ({
  notifications: {
    show: vi.fn(),
  },
}));

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
    mockStart.mockResolvedValue(undefined);
    mockStop.mockResolvedValue(undefined);
    mockClear.mockImplementation(() => {});
    mockGetState.mockReturnValue(2);
  });

  it("renders the start screen initially", () => {
    renderComponent();

    expect(screen.getByText("Check-In Attendee")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Start Scanning/i }),
    ).toBeInTheDocument();

    expect(document.getElementById("qr-reader")).not.toBeInTheDocument();
  });

  it("initializes the scanner when 'Start Scanning' is clicked", async () => {
    const user = userEvent.setup();
    renderComponent();

    const startBtn = screen.getByRole("button", { name: /Start Scanning/i });
    await user.click(startBtn);

    expect(document.getElementById("qr-reader")).toBeInTheDocument();

    expect(
      screen.getByRole("button", { name: /Stop Scanning/i }),
    ).toBeInTheDocument();

    await waitFor(() => {
      expect(mockStart).toHaveBeenCalledWith(
        { facingMode: "environment" },
        expect.objectContaining({ fps: 10 }),
        expect.any(Function),
        expect.any(Function),
      );
    });
  });

  it("handles a successful scan", async () => {
    const user = userEvent.setup();
    renderComponent();

    await user.click(screen.getByRole("button", { name: /Start Scanning/i }));

    await waitFor(() => expect(mockStart).toHaveBeenCalled());

    const [, , successCallback] = mockStart.mock.calls[0];

    const scannedUserId = "user_abc_123";
    await act(async () => {
      await successCallback(scannedUserId);
    });

    expect(mockCheckInAttendee).toHaveBeenCalledWith(eventId, scannedUserId);

    expect(notifications.show).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Check-In Successful",
        color: "green",
      }),
    );

    expect(
      screen.getByText(`Last Scanned: ${scannedUserId}`),
    ).toBeInTheDocument();
  });

  it("prevents duplicate scans within cooldown period", async () => {
    const user = userEvent.setup();
    renderComponent();

    await user.click(screen.getByRole("button", { name: /Start Scanning/i }));
    await waitFor(() => expect(mockStart).toHaveBeenCalled());

    const [, , successCallback] = mockStart.mock.calls[0];

    await act(async () => {
      await successCallback("user_1");
    });

    await act(async () => {
      await successCallback("user_1");
    });

    expect(mockCheckInAttendee).toHaveBeenCalledTimes(1);
  });

  it("handles check-in API errors", async () => {
    const user = userEvent.setup();
    mockCheckInAttendee.mockRejectedValue(new Error("Network Error"));

    renderComponent();

    await user.click(screen.getByRole("button", { name: /Start Scanning/i }));
    await waitFor(() => expect(mockStart).toHaveBeenCalled());

    const [, , successCallback] = mockStart.mock.calls[0];

    await act(async () => {
      await successCallback("user_bad");
    });

    expect(notifications.show).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Check-In Failed",
        color: "red",
      }),
    );
  });

  it("handles Camera Permission errors (NotAllowedError)", async () => {
    const user = userEvent.setup();

    const permissionError = new Error("NotAllowedError: Permission denied");
    permissionError.name = "NotAllowedError";

    mockStart.mockRejectedValue(permissionError);

    renderComponent();

    await user.click(screen.getByRole("button", { name: /Start Scanning/i }));

    await waitFor(() => {
      expect(notifications.show).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Scanner Error",
          message: expect.stringContaining("permission denied"),
        }),
      );
    });

    expect(mockClear).toHaveBeenCalled();
  });

  it("stops the scanner when 'Stop Scanning' is clicked", async () => {
    const user = userEvent.setup();
    renderComponent();

    await user.click(screen.getByRole("button", { name: /Start Scanning/i }));
    await waitFor(() => expect(mockStart).toHaveBeenCalled());

    const stopBtn = screen.getByRole("button", { name: /Stop Scanning/i });
    await user.click(stopBtn);

    await waitFor(() => {
      expect(mockGetState).toHaveBeenCalled();
      expect(mockStop).toHaveBeenCalled();
      expect(mockClear).toHaveBeenCalled();
    });

    expect(
      screen.getByRole("button", { name: /Start Scanning/i }),
    ).toBeInTheDocument();
  });

  it("cleans up the scanner when the modal is closed via props", async () => {
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

    await user.click(screen.getByRole("button", { name: /Start Scanning/i }));
    await waitFor(() => expect(mockStart).toHaveBeenCalled());

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

    await waitFor(() => {
      expect(mockGetState).toHaveBeenCalled();
      expect(mockStop).toHaveBeenCalled();
      expect(mockClear).toHaveBeenCalled();
    });
  });

  it("cleans up the scanner on component unmount", async () => {
    const user = userEvent.setup();
    const { unmount } = renderComponent();

    await user.click(screen.getByRole("button", { name: /Start Scanning/i }));
    await waitFor(() => expect(mockStart).toHaveBeenCalled());

    unmount();

    await waitFor(() => {
      expect(mockStop).toHaveBeenCalled();
      expect(mockClear).toHaveBeenCalled();
    });
  });
});
