import React from "react";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { MantineProvider } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { LogRenderer } from "./LogRenderer";
import { Modules, ModulesToHumanName } from "@common/modules";
import { MemoryRouter } from "react-router-dom";
import { UserResolverProvider } from "@ui/components/NameOptionalCard";

describe("LogRenderer Tests", () => {
  const getLogsMock = vi.fn();

  // Mock date for consistent testing
  const mockCurrentDate = new Date("2023-01-15T12:00:00Z");

  // Sample log data for testing
  const sampleLogs = [
    {
      actor: "admin",
      createdAt: Math.floor(mockCurrentDate.getTime() / 1000) - 3600,
      expireAt: Math.floor(mockCurrentDate.getTime() / 1000) + 86400,
      message: "User created",
      module: Modules.IAM,
      requestId: "req-123",
      target: "user@example.com",
    },
    {
      actor: "system",
      createdAt: Math.floor(mockCurrentDate.getTime() / 1000) - 7200,
      expireAt: Math.floor(mockCurrentDate.getTime() / 1000) + 86400,
      message: "Config updated",
      module: Modules.AUDIT_LOG,
      requestId: "req-456",
      target: Modules.STRIPE,
    },
  ];

  const renderComponent = async () => {
    await act(async () => {
      render(
        <MemoryRouter>
          <MantineProvider
            withGlobalClasses
            withCssVariables
            forceColorScheme="light"
          >
            <UserResolverProvider resolutionDisabled>
              <LogRenderer getLogs={getLogsMock} />
            </UserResolverProvider>
          </MantineProvider>
        </MemoryRouter>,
      );
    });
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // Mock Date.now to return a fixed timestamp
    vi.spyOn(Date, "now").mockImplementation(() => mockCurrentDate.getTime());
    // Reset notification spy
    vi.spyOn(notifications, "show");
  });

  it("renders the filter controls correctly", async () => {
    await renderComponent();

    expect(screen.getByText("Filter Logs")).toBeInTheDocument();
    expect(screen.getByText("Module")).toBeInTheDocument();
    expect(screen.getByText("Start Time")).toBeInTheDocument();
    expect(screen.getByText("End Time")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Fetch Logs/i }),
    ).toBeInTheDocument();
  });

  it("shows error notification when fetch logs without selecting a module", async () => {
    const user = userEvent.setup();
    await renderComponent();

    await user.click(screen.getByRole("button", { name: /Fetch Logs/i }));

    expect(notifications.show).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Missing parameters",
        message: "Please select a module and time range",
        color: "red",
      }),
    );
    expect(getLogsMock).not.toHaveBeenCalled();
  });

  it("fetches logs successfully when parameters are valid", async () => {
    getLogsMock.mockResolvedValue(sampleLogs);
    const user = userEvent.setup();
    await renderComponent();

    // Select a module
    await user.click(screen.getByPlaceholderText("Select service module"));
    // Find and click on the IAM option
    await user.click(screen.getByText(ModulesToHumanName[Modules.IAM]));

    // Click fetch logs
    await user.click(screen.getByRole("button", { name: /Fetch Logs/i }));

    // Verify the getLogs was called with correct parameters
    expect(getLogsMock).toHaveBeenCalledWith(
      Modules.IAM,
      expect.any(Number), // Start timestamp
      expect.any(Number), // End timestamp
    );

    // Verify logs are displayed
    await screen.findByText("User created");
    expect(screen.getByText("admin")).toBeInTheDocument();
    expect(screen.getAllByText("user@example.com")).length(2);
    expect(screen.getByText("req-123")).toBeInTheDocument();
  });

  it("handles API errors gracefully", async () => {
    getLogsMock.mockRejectedValue(new Error("API Error"));
    const user = userEvent.setup();
    await renderComponent();

    // Select a module
    await user.click(screen.getByPlaceholderText("Select service module"));
    await user.click(screen.getByText(ModulesToHumanName[Modules.EVENTS]));

    // Click fetch logs
    await user.click(screen.getByRole("button", { name: /Fetch Logs/i }));

    expect(notifications.show).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Error fetching logs",
        message: "Failed to load logs. Please try again later.",
        color: "red",
      }),
    );
  });

  it("filters logs based on search query", async () => {
    getLogsMock.mockResolvedValue(sampleLogs);
    const user = userEvent.setup();
    await renderComponent();

    // Select a module and fetch logs
    await user.click(screen.getByPlaceholderText("Select service module"));
    await user.click(screen.getByText(ModulesToHumanName[Modules.AUDIT_LOG]));
    await user.click(screen.getByRole("button", { name: /Fetch Logs/i }));

    // Wait for logs to display
    await screen.findByText("User created");

    // Search for 'config'
    await user.type(screen.getByPlaceholderText("Search in logs..."), "config");

    // "User created" should no longer be visible, but "Config updated" should be
    expect(screen.queryByText("User created")).not.toBeInTheDocument();
    expect(screen.getByText("Config updated")).toBeInTheDocument();
  });

  it("toggles between UTC and local time display", async () => {
    getLogsMock.mockResolvedValue(sampleLogs);
    const user = userEvent.setup();
    await renderComponent();

    // Select a module and fetch logs
    await user.click(screen.getByPlaceholderText("Select service module"));
    await user.click(screen.getByText(ModulesToHumanName[Modules.IAM]));
    await user.click(screen.getByRole("button", { name: /Fetch Logs/i }));

    // Wait for logs to display
    await screen.findByText("User created");

    // Check default is local time
    expect(
      screen.getByText(/Show times in local timezone/),
    ).toBeInTheDocument();

    // Toggle to UTC
    await user.click(screen.getByRole("switch"));
    expect(screen.getByText(/Show times in UTC/)).toBeInTheDocument();
  });

  it("paginates logs correctly", async () => {
    // Create 15 sample logs
    const manyLogs = Array(15)
      .fill(null)
      .map((_, index) => ({
        actor: `actor-${index}`,
        createdAt: Math.floor(mockCurrentDate.getTime() / 1000) - index * 100,
        expireAt: Math.floor(mockCurrentDate.getTime() / 1000) + 86400,
        message: `Message ${index}`,
        module: Modules.IAM,
        requestId: `req-${index}`,
        target: `target-${index}`,
      }));

    getLogsMock.mockResolvedValue(manyLogs);
    const user = userEvent.setup();
    await renderComponent();

    // Select a module and fetch logs
    await user.click(screen.getByPlaceholderText("Select service module"));
    await user.click(screen.getByText(ModulesToHumanName[Modules.IAM]));
    await user.click(screen.getByRole("button", { name: /Fetch Logs/i }));

    // Wait for logs to display - first page should show entries 0-9
    await screen.findByText("Message 0");
    expect(screen.getByText("Message 9")).toBeInTheDocument();
    expect(screen.queryByText("Message 10")).not.toBeInTheDocument();

    // Go to page 2
    await user.click(screen.getByRole("button", { name: "2" }));

    // Second page should show entries 10-14
    expect(screen.queryByText("Message 9")).not.toBeInTheDocument();
    expect(screen.getByText("Message 10")).toBeInTheDocument();
    expect(screen.getByText("Message 14")).toBeInTheDocument();

    // Change page size
    await user.click(screen.getByText("10"));
    await user.click(screen.getByText("25"));

    // Should now show all logs on one page
    expect(screen.getByText("Message 0")).toBeInTheDocument();
    expect(screen.getByText("Message 14")).toBeInTheDocument();
  });

  it("shows empty state when no logs are returned", async () => {
    getLogsMock.mockResolvedValue([]);
    const user = userEvent.setup();
    await renderComponent();

    // Select a module and fetch logs
    await user.click(screen.getByPlaceholderText("Select service module"));
    await user.click(
      screen.getByText(ModulesToHumanName[Modules.MOBILE_WALLET]),
    );
    await user.click(screen.getByRole("button", { name: /Fetch Logs/i }));

    // Should show empty state
    expect(screen.getByText("No logs to display")).toBeInTheDocument();
  });

  it("displays translated module names when viewing audit logs", async () => {
    const auditLogs = [
      {
        actor: "admin",
        createdAt: Math.floor(mockCurrentDate.getTime() / 1000) - 3600,
        expireAt: Math.floor(mockCurrentDate.getTime() / 1000) + 86400,
        message: "Module accessed",
        module: Modules.AUDIT_LOG,
        requestId: "req-789",
        target: Modules.STRIPE, // This should be translated to "Stripe" in the UI
      },
    ];

    getLogsMock.mockResolvedValue(auditLogs);
    const user = userEvent.setup();
    await renderComponent();

    // Select the AUDIT_LOG module
    await user.click(screen.getByPlaceholderText("Select service module"));
    await user.click(screen.getByText(ModulesToHumanName[Modules.AUDIT_LOG]));
    await user.click(screen.getByRole("button", { name: /Fetch Logs/i }));

    // Wait for logs to display
    await screen.findByText("Module accessed");

    // The target column should show "Stripe" (the human-readable name) instead of "stripe"
    expect(screen.getAllByText("Stripe Integration")).toHaveLength(2);
  });

  it("respects date range selection when fetching logs", async () => {
    getLogsMock.mockResolvedValue(sampleLogs);
    const user = userEvent.setup();
    await renderComponent();

    // Select a module
    await user.click(screen.getByPlaceholderText("Select service module"));
    await user.click(screen.getByText(ModulesToHumanName[Modules.LINKRY]));

    // Open and set Start Time
    await user.click(screen.getByRole("button", { name: /Start Time/i }));
    const [startInput] = await screen.findAllByRole("textbox");
    await user.type(startInput, "01/10/2023 12:00 AM");

    // Open and set End Time
    await user.click(screen.getByRole("button", { name: /End Time/i }));
    const [endInput] = await screen.findAllByRole("textbox");
    await user.type(endInput, "01/11/2023 11:59 PM");

    // Click Fetch Logs
    await user.click(screen.getByRole("button", { name: /Fetch Logs/i }));

    // Assert that getLogsMock was called with correct arguments
    expect(getLogsMock).toHaveBeenCalledWith(
      "linkry",
      expect.any(Number),
      expect.any(Number),
    );
  });
});
