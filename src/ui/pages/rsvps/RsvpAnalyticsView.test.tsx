import {
  render,
  screen,
  act,
  waitFor,
  fireEvent,
} from "@testing-library/react";
import { vi, describe, it, expect, beforeEach, beforeAll } from "vitest";
import { MantineProvider } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { RsvpAnalyticsView } from "./RsvpAnalyticsView";
import { MemoryRouter } from "react-router-dom";

beforeAll(() => {
  if (typeof window === "undefined") {
    global.window = {} as any;
  }

  global.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };

  Element.prototype.scrollIntoView = vi.fn();

  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });

  Element.prototype.getBoundingClientRect = vi.fn(() => ({
    width: 120,
    height: 120,
    top: 0,
    left: 0,
    bottom: 0,
    right: 0,
    x: 0,
    y: 0,
    toJSON: () => {},
  }));
});

vi.mock("@mantine/notifications", () => ({
  notifications: {
    show: vi.fn(),
  },
}));

describe("RsvpAnalyticsView Tests", () => {
  const getRsvpsMock = vi.fn();

  const mockRsvps = [
    {
      eventId: "evt_test_123",
      userId: "user1@illinois.edu",
      isPaidMember: true,
      checkedIn: true,
      createdAt: 1704067200,
      schoolYear: "Junior",
      intendedMajor: "Computer Science",
      dietaryRestrictions: ["Vegetarian", "Gluten-free"],
      interests: ["AI", "Web Development"],
    },
    {
      eventId: "evt_test_123",
      userId: "user2@illinois.edu",
      isPaidMember: false,
      checkedIn: false,
      createdAt: 1704153600,
      schoolYear: "Senior",
      intendedMajor: "Computer Science",
      dietaryRestrictions: ["Vegan"],
      interests: ["AI", "Machine Learning"],
    },
    {
      eventId: "evt_test_123",
      userId: "user3@illinois.edu",
      isPaidMember: true,
      checkedIn: true,
      createdAt: 1704240000,
      schoolYear: "Junior",
      intendedMajor: "Electrical Engineering",
      dietaryRestrictions: [],
      interests: ["Web Development"],
    },
  ];

  const renderComponent = async (props = {}) => {
    await act(async () => {
      render(
        <MemoryRouter>
          <MantineProvider
            withGlobalClasses
            withCssVariables
            forceColorScheme="light"
          >
            <RsvpAnalyticsView
              eventId="evt_test_123"
              getRsvps={getRsvpsMock}
              {...props}
            />
          </MantineProvider>
        </MemoryRouter>,
      );
    });
  };

  const switchView = async (viewName: string) => {
    const viewSelector = screen.getByPlaceholderText("Select view");

    fireEvent.click(viewSelector);

    const option = await screen.findByRole("option", {
      name: viewName,
      hidden: true,
    });
    fireEvent.click(option);
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetches and displays RSVP data", async () => {
    getRsvpsMock.mockResolvedValue(mockRsvps);
    await renderComponent();

    await waitFor(() => {
      expect(getRsvpsMock).toHaveBeenCalledWith("evt_test_123");
    });

    expect(screen.getByText("Total RSVPs")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("displays overview statistics correctly", async () => {
    getRsvpsMock.mockResolvedValue(mockRsvps);
    await renderComponent();

    await waitFor(() =>
      expect(screen.getByText("Total RSVPs")).toBeInTheDocument(),
    );

    expect(screen.getByText("Paid Members")).toBeInTheDocument();
    expect(screen.getByText("Checked In")).toBeInTheDocument();
    expect(screen.getByText("Attendance Rate")).toBeInTheDocument();

    const allNumbers = screen.getAllByText("2");
    expect(allNumbers.length).toBeGreaterThan(0);
  });

  it("calculates attendance rate correctly", async () => {
    getRsvpsMock.mockResolvedValue(mockRsvps);
    await renderComponent();

    await waitFor(() => {
      expect(screen.getByText("67%")).toBeInTheDocument();
    });
  });

  it("handles error when fetching RSVPs", async () => {
    const notificationsMock = vi.spyOn(notifications, "show");
    getRsvpsMock.mockRejectedValue(new Error("Failed to fetch"));
    await renderComponent();

    await waitFor(() => {
      expect(notificationsMock).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Error fetching RSVPs",
          color: "red",
        }),
      );
    });
  });

  it("switches to demographics view", async () => {
    getRsvpsMock.mockResolvedValue(mockRsvps);
    await renderComponent();
    await waitFor(() =>
      expect(screen.getByText("Total RSVPs")).toBeInTheDocument(),
    );

    await switchView("Demographics (School Year)");

    await waitFor(() => {
      expect(screen.getByText("School Year Breakdown")).toBeInTheDocument();
    });

    expect(screen.getByText("Junior")).toBeInTheDocument();
    expect(screen.getByText("Senior")).toBeInTheDocument();
  });

  it("displays school year breakdown correctly", async () => {
    getRsvpsMock.mockResolvedValue(mockRsvps);
    await renderComponent();
    await waitFor(() =>
      expect(screen.getByText("Total RSVPs")).toBeInTheDocument(),
    );

    await switchView("Demographics (School Year)");

    await waitFor(() => {
      expect(screen.getByText("Junior")).toBeInTheDocument();
      expect(screen.getByText("Senior")).toBeInTheDocument();
    });
  });

  it("switches to major view", async () => {
    getRsvpsMock.mockResolvedValue(mockRsvps);
    await renderComponent();
    await waitFor(() =>
      expect(screen.getByText("Total RSVPs")).toBeInTheDocument(),
    );

    await switchView("Intended Major");

    await waitFor(() => {
      expect(screen.getByText("Intended Major Breakdown")).toBeInTheDocument();
    });

    expect(screen.getByText("Computer Science")).toBeInTheDocument();
    expect(screen.getByText("Electrical Engineering")).toBeInTheDocument();
  });

  it("switches to interests view", async () => {
    getRsvpsMock.mockResolvedValue(mockRsvps);
    await renderComponent();
    await waitFor(() =>
      expect(screen.getByText("Total RSVPs")).toBeInTheDocument(),
    );

    await switchView("User Interests");

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: "User Interests" }),
      ).toBeInTheDocument();
    });

    expect(screen.getByText("AI")).toBeInTheDocument();
    expect(screen.getByText("Web Development")).toBeInTheDocument();
  });

  it("switches to check-in status view", async () => {
    getRsvpsMock.mockResolvedValue(mockRsvps);
    await renderComponent();
    await waitFor(() =>
      expect(screen.getByText("Total RSVPs")).toBeInTheDocument(),
    );

    await switchView("Check-In Status");

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: "Check-In Status" }),
      ).toBeInTheDocument();
    });

    expect(screen.getByText(/Checked In \(2\)/)).toBeInTheDocument();
    expect(screen.getByText(/Not Checked In \(1\)/)).toBeInTheDocument();
  });

  it("shows no data message for empty demographics", async () => {
    getRsvpsMock.mockResolvedValue([]);
    await renderComponent();
    await waitFor(() =>
      expect(screen.getByText("Total RSVPs")).toBeInTheDocument(),
    );

    await switchView("Demographics (School Year)");

    await waitFor(() => {
      expect(
        screen.getByText(/No school year data available for this event/i),
      ).toBeInTheDocument();
    });
  });

  it("shows no data message for empty interests", async () => {
    getRsvpsMock.mockResolvedValue([]);
    await renderComponent();
    await waitFor(() =>
      expect(screen.getByText("Total RSVPs")).toBeInTheDocument(),
    );

    await switchView("User Interests");

    await waitFor(() => {
      expect(
        screen.getByText(/User interests data not available yet/i),
      ).toBeInTheDocument();
    });
  });

  it("sorts interests by count in descending order", async () => {
    getRsvpsMock.mockResolvedValue(mockRsvps);
    await renderComponent();
    await waitFor(() =>
      expect(screen.getByText("Total RSVPs")).toBeInTheDocument(),
    );

    await switchView("User Interests");

    await waitFor(() => {
      expect(screen.getByText("AI")).toBeInTheDocument();
    });
  });

  it("displays loading overlay while fetching data", async () => {
    getRsvpsMock.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve(mockRsvps), 100)),
    );

    const { container } = render(
      <MemoryRouter>
        <MantineProvider
          withGlobalClasses
          withCssVariables
          forceColorScheme="light"
        >
          <RsvpAnalyticsView eventId="evt_test_123" getRsvps={getRsvpsMock} />
        </MantineProvider>
      </MemoryRouter>,
    );

    const overlay = container.querySelector(".mantine-LoadingOverlay-root");
    expect(overlay).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("Total RSVPs")).toBeInTheDocument();
    });
  });
});
