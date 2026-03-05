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

  Object.defineProperty(window, "innerWidth", {
    writable: true,
    value: 1200,
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

  it("fetches and displays RSVP data on load", async () => {
    getRsvpsMock.mockResolvedValue(mockRsvps);
    await renderComponent();

    await waitFor(() =>
      expect(getRsvpsMock).toHaveBeenCalledWith("evt_test_123"),
    );
    expect(screen.getByText("Total RSVPs")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("displays all four overview stat cards", async () => {
    getRsvpsMock.mockResolvedValue(mockRsvps);
    await renderComponent();

    await waitFor(() =>
      expect(screen.getByText("Total RSVPs")).toBeInTheDocument(),
    );
    expect(screen.getByText("Paid Members")).toBeInTheDocument();
    expect(screen.getByText("Checked In")).toBeInTheDocument();
    expect(screen.getByText("Attendance Rate")).toBeInTheDocument();
  });

  it("calculates attendance rate correctly", async () => {
    getRsvpsMock.mockResolvedValue(mockRsvps);
    await renderComponent();

    await waitFor(() => expect(screen.getByText("67%")).toBeInTheDocument());
  });

  it("shows N/A attendance rate when there are no RSVPs", async () => {
    getRsvpsMock.mockResolvedValue([]);
    await renderComponent();

    await waitFor(() => expect(screen.getByText("N/A")).toBeInTheDocument());
  });

  it("shows loading overlay while fetching", async () => {
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

    expect(
      container.querySelector(".mantine-LoadingOverlay-root"),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByText("Total RSVPs")).toBeInTheDocument(),
    );
  });

  it("shows error notification on fetch failure", async () => {
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

  it("switches to attendees view and renders table", async () => {
    getRsvpsMock.mockResolvedValue(mockRsvps);
    await renderComponent();
    await waitFor(() =>
      expect(screen.getByText("Total RSVPs")).toBeInTheDocument(),
    );

    await switchView("All Attendees");

    await waitFor(() =>
      expect(screen.getByTestId("attendees-table")).toBeInTheDocument(),
    );
    expect(screen.getByText("user1@illinois.edu")).toBeInTheDocument();
    expect(screen.getByText("user2@illinois.edu")).toBeInTheDocument();
    expect(screen.getByText("user3@illinois.edu")).toBeInTheDocument();
  });

  it("shows attendee count in title", async () => {
    getRsvpsMock.mockResolvedValue(mockRsvps);
    await renderComponent();
    await waitFor(() =>
      expect(screen.getByText("Total RSVPs")).toBeInTheDocument(),
    );

    await switchView("All Attendees");

    await waitFor(() =>
      expect(screen.getByText("All Attendees (3)")).toBeInTheDocument(),
    );
  });

  it("shows check-in status badges per attendee", async () => {
    getRsvpsMock.mockResolvedValue(mockRsvps);
    await renderComponent();
    await waitFor(() =>
      expect(screen.getByText("Total RSVPs")).toBeInTheDocument(),
    );

    await switchView("All Attendees");

    await waitFor(() =>
      expect(screen.getByTestId("attendees-table")).toBeInTheDocument(),
    );
    expect(screen.getAllByText("Checked In").length).toBeGreaterThan(0);
    expect(screen.getByText("Not Checked In")).toBeInTheDocument();
  });

  it("shows membership badges per attendee", async () => {
    getRsvpsMock.mockResolvedValue(mockRsvps);
    await renderComponent();
    await waitFor(() =>
      expect(screen.getByText("Total RSVPs")).toBeInTheDocument(),
    );

    await switchView("All Attendees");

    await waitFor(() =>
      expect(screen.getByTestId("attendees-table")).toBeInTheDocument(),
    );
    expect(screen.getAllByText("Paid").length).toBeGreaterThan(0);
    expect(screen.getByText("Free")).toBeInTheDocument();
  });

  it("shows dietary restriction badges per attendee", async () => {
    getRsvpsMock.mockResolvedValue(mockRsvps);
    await renderComponent();
    await waitFor(() =>
      expect(screen.getByText("Total RSVPs")).toBeInTheDocument(),
    );

    await switchView("All Attendees");

    await waitFor(() =>
      expect(screen.getByTestId("attendees-table")).toBeInTheDocument(),
    );
    expect(screen.getByText("Vegetarian")).toBeInTheDocument();
    expect(screen.getByText("Vegan")).toBeInTheDocument();
  });

  it("shows RSVP timestamp for attendees", async () => {
    getRsvpsMock.mockResolvedValue(mockRsvps);
    await renderComponent();
    await waitFor(() =>
      expect(screen.getByText("Total RSVPs")).toBeInTheDocument(),
    );

    await switchView("All Attendees");

    await waitFor(() =>
      expect(screen.getByTestId("attendees-table")).toBeInTheDocument(),
    );
    expect(
      screen.getByText(new Date(1704067200 * 1000).toLocaleString()),
    ).toBeInTheDocument();
  });

  it("shows empty message in attendees view when no RSVPs", async () => {
    getRsvpsMock.mockResolvedValue([]);
    await renderComponent();
    await waitFor(() =>
      expect(screen.getByText("Total RSVPs")).toBeInTheDocument(),
    );

    await switchView("All Attendees");

    await waitFor(() =>
      expect(
        screen.getByText("No RSVPs for this event yet"),
      ).toBeInTheDocument(),
    );
  });

  it("switches to demographics view and shows school year breakdown", async () => {
    getRsvpsMock.mockResolvedValue(mockRsvps);
    await renderComponent();
    await waitFor(() =>
      expect(screen.getByText("Total RSVPs")).toBeInTheDocument(),
    );

    await switchView("Demographics (School Year)");

    await waitFor(() =>
      expect(screen.getByText("School Year Breakdown")).toBeInTheDocument(),
    );
    expect(screen.getByText("Junior")).toBeInTheDocument();
    expect(screen.getByText("Senior")).toBeInTheDocument();
  });

  it("shows empty message for demographics when no data", async () => {
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

  it("switches to major view and shows breakdown", async () => {
    getRsvpsMock.mockResolvedValue(mockRsvps);
    await renderComponent();
    await waitFor(() =>
      expect(screen.getByText("Total RSVPs")).toBeInTheDocument(),
    );

    await switchView("Intended Major");

    await waitFor(() =>
      expect(screen.getByText("Intended Major Breakdown")).toBeInTheDocument(),
    );
    expect(screen.getByText("Computer Science")).toBeInTheDocument();
    expect(screen.getByText("Electrical Engineering")).toBeInTheDocument();
  });

  it("shows empty message for major when no data", async () => {
    getRsvpsMock.mockResolvedValue([]);
    await renderComponent();
    await waitFor(() =>
      expect(screen.getByText("Total RSVPs")).toBeInTheDocument(),
    );

    await switchView("Intended Major");

    await waitFor(() => {
      expect(
        screen.getByText(/No major data available for this event/i),
      ).toBeInTheDocument();
    });
  });

  it("switches to interests view and shows breakdown", async () => {
    getRsvpsMock.mockResolvedValue(mockRsvps);
    await renderComponent();
    await waitFor(() =>
      expect(screen.getByText("Total RSVPs")).toBeInTheDocument(),
    );

    await switchView("User Interests");

    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: "User Interests" }),
      ).toBeInTheDocument(),
    );
    expect(screen.getByText("AI")).toBeInTheDocument();
    expect(screen.getByText("Web Development")).toBeInTheDocument();
  });

  it("shows empty message for interests when no data", async () => {
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

  it("sorts interests by count descending", async () => {
    getRsvpsMock.mockResolvedValue(mockRsvps);
    await renderComponent();
    await waitFor(() =>
      expect(screen.getByText("Total RSVPs")).toBeInTheDocument(),
    );

    await switchView("User Interests");

    await waitFor(() => expect(screen.getByText("AI")).toBeInTheDocument());
    const rows = screen.getAllByTestId(/breakdown-row/);
    expect(rows[0]).toHaveTextContent("AI");
  });

  it("switches to dietary view and shows breakdown", async () => {
    getRsvpsMock.mockResolvedValue(mockRsvps);
    await renderComponent();
    await waitFor(() =>
      expect(screen.getByText("Total RSVPs")).toBeInTheDocument(),
    );

    await switchView("Dietary Restrictions");

    await waitFor(() =>
      expect(screen.getByText("Dietary Restrictions")).toBeInTheDocument(),
    );
    expect(screen.getByText("Vegetarian")).toBeInTheDocument();
    expect(screen.getByText("Vegan")).toBeInTheDocument();
  });

  it("shows empty message for dietary when no data", async () => {
    getRsvpsMock.mockResolvedValue([]);
    await renderComponent();
    await waitFor(() =>
      expect(screen.getByText("Total RSVPs")).toBeInTheDocument(),
    );

    await switchView("Dietary Restrictions");

    await waitFor(() => {
      expect(
        screen.getByText(
          /No dietary restrictions data available for this event/i,
        ),
      ).toBeInTheDocument();
    });
  });
});
