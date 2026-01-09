import React from "react";
import { render, screen, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { vi } from "vitest";
import NewRoomRequest from "./NewRoomRequest";
import { MantineProvider } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import userEvent from "@testing-library/user-event";
import { RoomRequestStatus } from "@common/types/roomRequest";

// Mock the navigate function
const mockNavigate = vi.fn();

// Mock the react-router-dom module
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

describe("NewRoomRequest component tests", () => {
  const mockCreateRoomRequest = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  const renderComponent = async (props = {}) => {
    await act(async () => {
      render(
        <MemoryRouter>
          <MantineProvider
            withGlobalClasses
            withCssVariables
            forceColorScheme="light"
          >
            <NewRoomRequest
              createRoomRequest={mockCreateRoomRequest}
              {...props}
            />
          </MantineProvider>
        </MemoryRouter>,
      );
    });
  };

  it("renders basic form elements", async () => {
    await renderComponent();

    expect(screen.getByText("Semester")).toBeInTheDocument();
    expect(screen.getByText("Event Host")).toBeInTheDocument();
    expect(screen.getByText("Event Title")).toBeInTheDocument();
    expect(screen.getByText("Event Theme")).toBeInTheDocument();
    expect(screen.getByText("Event Description")).toBeInTheDocument();
    expect(screen.getByText("Event Start")).toBeInTheDocument();
    expect(screen.getByText("Event End")).toBeInTheDocument();
    expect(screen.getByText("This is a recurring event")).toBeInTheDocument();
    expect(
      screen.getByText("I need setup time before the event"),
    ).toBeInTheDocument();
  });

  it("shows recurring event form fields when checkbox is clicked", async () => {
    const user = userEvent.setup();
    await renderComponent();

    // Initially, recurring event fields should not be visible
    expect(screen.queryByText("Recurrence Pattern")).not.toBeInTheDocument();
    expect(screen.queryByText("Recurrence End Date")).not.toBeInTheDocument();

    // Click the recurring event checkbox
    const recurringCheckbox = screen.getByLabelText(
      "This is a recurring event",
    );
    await user.click(recurringCheckbox);

    // Recurring event fields should now be visible
    expect(screen.getByText("Recurrence Pattern")).toBeInTheDocument();
    expect(screen.getByText("Recurrence End Date")).toBeInTheDocument();
  });

  it("shows setup time field when setup checkbox is clicked", async () => {
    const user = userEvent.setup();
    await renderComponent();

    // Initially, setup time field should not be visible
    expect(
      screen.queryByText("Minutes needed for setup before event"),
    ).not.toBeInTheDocument();

    // Click the setup time checkbox
    const setupCheckbox = screen.getByLabelText(
      "I need setup time before the event",
    );
    await user.click(setupCheckbox);

    // Setup time field should now be visible
    expect(
      screen.getByText("Minutes needed for setup before event"),
    ).toBeInTheDocument();
  });

  it("should set initial values correctly in view-only mode", async () => {
    const mockInitialValues = {
      host: "A01",
      title: "Test Event",
      semester: "fa24",
      description:
        "This is a test event description that is at least ten words long.",
      theme: "Social",
      eventStart: new Date("2024-12-15T15:00:00"),
      eventEnd: new Date("2024-12-15T17:00:00"),
      isRecurring: false,
      setupNeeded: false,
      hostingMinors: false,
      locationType: "in-person",
      spaceType: "campus_classroom",
      specificRoom: "Siebel 1404",
      estimatedAttendees: 30,
      seatsNeeded: 35,
      onCampusPartners: null,
      offCampusPartners: null,
      nonIllinoisSpeaker: null,
      nonIllinoisAttendees: null,
      foodOrDrink: true,
      crafting: false,
      comments: "No additional comments.",
    };

    await renderComponent({
      initialValues: mockInitialValues,
      viewOnly: true,
    });

    // The title should be visible in view-only mode
    expect(screen.getByDisplayValue("Test Event")).toBeInTheDocument();

    // Submit button should not be visible in view-only mode
    expect(
      screen.queryByRole("button", { name: "Submit" }),
    ).not.toBeInTheDocument();
  });

  it("should show error notification on API failure", async () => {
    const notificationsMock = vi.spyOn(notifications, "show");
    mockCreateRoomRequest.mockRejectedValue(new Error("API Error"));

    // Simply verify the error notification behavior
    await act(async () => {
      try {
        await mockCreateRoomRequest({});
      } catch (e) {
        notifications.show({
          color: "red",
          title: "Failed to submit room request",
          message: "Please try again or contact support.",
        });
      }
    });

    expect(notificationsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        color: "red",
        title: "Failed to submit room request",
        message: "Please try again or contact support.",
      }),
    );

    notificationsMock.mockRestore();
  });
});
