import React from "react";
import { render, screen, act, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { MantineProvider } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { ManageOrganizationForm } from "./ManageOrganizationForm";
import { MemoryRouter } from "react-router-dom";
import { UserResolverProvider } from "@ui/components/NameOptionalCard";

// Mock the notifications module
vi.mock("@mantine/notifications", () => ({
  notifications: {
    show: vi.fn(),
  },
}));

describe("ManageOrganizationForm Tests", () => {
  const getOrganizationDataMock = vi.fn();
  const updateOrganizationDataMock = vi.fn();

  const mockOrgData = {
    description: "Test organization description",
    website: "https://test.example.com",
    links: [
      { type: "DISCORD", url: "https://discord.gg/test" },
      { type: "SLACK", url: "https://slack.com/test" },
    ],
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
            <UserResolverProvider resolutionDisabled>
              <ManageOrganizationForm
                organizationId="A01"
                getOrganizationData={getOrganizationDataMock}
                updateOrganizationData={updateOrganizationDataMock}
                {...props}
              />
            </UserResolverProvider>
          </MantineProvider>
        </MemoryRouter>,
      );
    });
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders loading overlay initially", async () => {
    getOrganizationDataMock.mockImplementation(
      () => new Promise(() => {}), // Never resolves
    );
    await renderComponent();

    expect(screen.getByTestId("org-loading")).toBeInTheDocument();
  });

  it("fetches and displays organization data", async () => {
    getOrganizationDataMock.mockResolvedValue(mockOrgData);
    await renderComponent();

    await waitFor(() => {
      expect(getOrganizationDataMock).toHaveBeenCalledWith("A01");
    });

    await waitFor(() => {
      expect(screen.queryByTestId("org-loading")).not.toBeInTheDocument();
    });

    expect(
      screen.getByDisplayValue("Test organization description"),
    ).toBeInTheDocument();
    expect(
      screen.getByDisplayValue("https://test.example.com"),
    ).toBeInTheDocument();
    expect(
      screen.getByDisplayValue("https://discord.gg/test"),
    ).toBeInTheDocument();
    expect(
      screen.getByDisplayValue("https://slack.com/test"),
    ).toBeInTheDocument();
  });

  it("handles organization data fetch failure", async () => {
    const notificationsMock = vi.spyOn(notifications, "show");
    getOrganizationDataMock.mockRejectedValue(new Error("Failed to fetch"));

    await renderComponent();

    await waitFor(() => {
      expect(notificationsMock).toHaveBeenCalledWith(
        expect.objectContaining({
          color: "red",
          message: "Failed to load organization data",
        }),
      );
    });

    notificationsMock.mockRestore();
  });

  it("allows editing form fields", async () => {
    getOrganizationDataMock.mockResolvedValue(mockOrgData);
    const user = userEvent.setup();
    await renderComponent();

    await waitFor(() => {
      expect(
        screen.getByDisplayValue("Test organization description"),
      ).toBeInTheDocument();
    });

    const descriptionField = screen.getByLabelText("Description");
    await user.clear(descriptionField);
    await user.type(descriptionField, "Updated description");

    expect(screen.getByDisplayValue("Updated description")).toBeInTheDocument();
  });

  it("submits form with updated data", async () => {
    getOrganizationDataMock.mockResolvedValue(mockOrgData);
    updateOrganizationDataMock.mockResolvedValue(undefined);
    const user = userEvent.setup();
    await renderComponent();

    await waitFor(() => {
      expect(
        screen.getByDisplayValue("Test organization description"),
      ).toBeInTheDocument();
    });

    const descriptionField = screen.getByLabelText("Description");
    await user.clear(descriptionField);
    await user.type(descriptionField, "New description");

    const submitButton = screen.getByRole("button", { name: "Save Changes" });
    await user.click(submitButton);

    await waitFor(() => {
      expect(updateOrganizationDataMock).toHaveBeenCalledWith({
        description: "New description",
        website: "https://test.example.com",
        links: [
          { type: "DISCORD", url: "https://discord.gg/test" },
          { type: "SLACK", url: "https://slack.com/test" },
        ],
      });
    });
  });

  it("adds a new link", async () => {
    getOrganizationDataMock.mockResolvedValue({
      description: "Test",
      website: "https://test.com",
      links: [],
    });
    const user = userEvent.setup();
    await renderComponent();

    await waitFor(() => {
      expect(
        screen.getByText(
          'No links added yet. Click "Add Link" to get started.',
        ),
      ).toBeInTheDocument();
    });

    const addButton = screen.getByRole("button", { name: "Add Link" });
    await user.click(addButton);

    await waitFor(() => {
      expect(screen.getByPlaceholderText("Select type")).toBeInTheDocument();
      expect(screen.getByPlaceholderText("https://...")).toBeInTheDocument();
    });
  });

  it("removes a link", async () => {
    getOrganizationDataMock.mockResolvedValue(mockOrgData);
    const user = userEvent.setup();
    await renderComponent();

    await waitFor(() => {
      expect(
        screen.getByDisplayValue("https://discord.gg/test"),
      ).toBeInTheDocument();
    });

    const removeButtons = screen.getAllByRole("button", { name: "" });
    const trashButton = removeButtons.find((btn) => btn.querySelector("svg"));

    if (trashButton) {
      await user.click(trashButton);
    }

    await waitFor(() => {
      expect(
        screen.queryByDisplayValue("https://discord.gg/test"),
      ).not.toBeInTheDocument();
    });
  });

  it("includes only non-empty links on submit", async () => {
    getOrganizationDataMock.mockResolvedValue({
      description: "Test",
      website: "https://test.com",
      links: [{ type: "DISCORD", url: "https://discord.gg/valid" }],
    });
    updateOrganizationDataMock.mockResolvedValue(undefined);
    const user = userEvent.setup();
    await renderComponent();

    await waitFor(() => {
      expect(
        screen.getByDisplayValue("https://discord.gg/valid"),
      ).toBeInTheDocument();
    });

    const submitButton = screen.getByRole("button", { name: "Save Changes" });
    await user.click(submitButton);

    await waitFor(() => {
      expect(updateOrganizationDataMock).toHaveBeenCalledWith({
        description: "Test",
        website: "https://test.com",
        links: [{ type: "DISCORD", url: "https://discord.gg/valid" }],
      });
    });
  });

  it("resets form when organization ID changes", async () => {
    getOrganizationDataMock.mockResolvedValue(mockOrgData);
    const { rerender } = render(
      <MemoryRouter>
        <MantineProvider
          withGlobalClasses
          withCssVariables
          forceColorScheme="light"
        >
          <UserResolverProvider resolutionDisabled>
            <ManageOrganizationForm
              organizationId="A01"
              getOrganizationData={getOrganizationDataMock}
              updateOrganizationData={updateOrganizationDataMock}
            />
          </UserResolverProvider>
        </MantineProvider>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(
        screen.getByDisplayValue("Test organization description"),
      ).toBeInTheDocument();
    });

    // Change organization ID
    const newOrgData = {
      description: "Different org",
      website: "https://different.com",
      links: [],
    };
    getOrganizationDataMock.mockResolvedValue(newOrgData);

    await act(async () => {
      rerender(
        <MemoryRouter>
          <MantineProvider
            withGlobalClasses
            withCssVariables
            forceColorScheme="light"
          >
            <UserResolverProvider resolutionDisabled>
              <ManageOrganizationForm
                organizationId="C01"
                getOrganizationData={getOrganizationDataMock}
                updateOrganizationData={updateOrganizationDataMock}
              />
            </UserResolverProvider>
          </MantineProvider>
        </MemoryRouter>,
      );
    });

    await waitFor(() => {
      expect(getOrganizationDataMock).toHaveBeenCalledWith("SIGWeb");
    });

    await waitFor(() => {
      expect(screen.getByDisplayValue("Different org")).toBeInTheDocument();
    });
  });

  it("handles missing optional fields", async () => {
    getOrganizationDataMock.mockResolvedValue({
      description: undefined,
      website: undefined,
      links: undefined,
    });
    await renderComponent();

    await waitFor(() => {
      expect(screen.queryByTestId("org-loading")).not.toBeInTheDocument();
    });

    expect(screen.getByLabelText("Description")).toHaveValue("");
    expect(screen.getByLabelText("Website")).toHaveValue("");
    expect(
      screen.getByText('No links added yet. Click "Add Link" to get started.'),
    ).toBeInTheDocument();
  });

  it("trims whitespace from fields on submit", async () => {
    getOrganizationDataMock.mockResolvedValue({
      description: "  Test with spaces  ",
      website: "  https://test.com  ",
      links: [],
    });
    updateOrganizationDataMock.mockResolvedValue(undefined);
    const user = userEvent.setup();
    await renderComponent();

    await waitFor(() => {
      expect(screen.queryByTestId("org-loading")).not.toBeInTheDocument();
    });

    const submitButton = screen.getByRole("button", { name: "Save Changes" });
    await user.click(submitButton);

    await waitFor(() => {
      expect(updateOrganizationDataMock).toHaveBeenCalledWith({
        description: "Test with spaces",
        website: "https://test.com",
        links: undefined,
      });
    });
  });

  it("converts empty strings to undefined on submit", async () => {
    getOrganizationDataMock.mockResolvedValue({
      description: "Test",
      website: "https://test.com",
      links: [],
    });
    updateOrganizationDataMock.mockResolvedValue(undefined);
    const user = userEvent.setup();
    await renderComponent();

    await waitFor(() => {
      expect(screen.queryByTestId("org-loading")).not.toBeInTheDocument();
    });

    // Clear the fields
    const descriptionField = screen.getByLabelText("Description");
    await user.clear(descriptionField);

    const websiteField = screen.getByLabelText("Website");
    await user.clear(websiteField);

    const submitButton = screen.getByRole("button", { name: "Save Changes" });
    await user.click(submitButton);

    await waitFor(() => {
      expect(updateOrganizationDataMock).toHaveBeenCalledWith({
        description: undefined,
        website: undefined,
        links: undefined,
      });
    });
  });

  it("disables submit button while loading", async () => {
    getOrganizationDataMock.mockResolvedValue(mockOrgData);
    updateOrganizationDataMock.mockImplementation(
      () => new Promise((resolve) => setTimeout(resolve, 1000)),
    );
    const user = userEvent.setup();
    await renderComponent();

    await waitFor(() => {
      expect(screen.queryByTestId("org-loading")).not.toBeInTheDocument();
    });

    const submitButton = screen.getByRole("button", { name: "Save Changes" });
    await user.click(submitButton);

    expect(submitButton).toBeDisabled();
  });
});

describe("ManageOrganizationForm - Lead Management Tests", () => {
  const getOrganizationDataMock = vi.fn();
  const updateOrganizationDataMock = vi.fn();
  const updateLeadsMock = vi.fn();

  const mockOrgDataWithLeads = {
    description: "Test organization",
    website: "https://test.com",
    links: [],
    leads: [
      {
        name: "John Doe",
        username: "jdoe@illinois.edu",
        title: "Chair",
      },
      {
        name: "Jane Smith",
        username: "jsmith@illinois.edu",
        title: "Vice Chair",
      },
    ],
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
            <UserResolverProvider resolutionDisabled>
              <ManageOrganizationForm
                organizationId="A01"
                getOrganizationData={getOrganizationDataMock}
                updateOrganizationData={updateOrganizationDataMock}
                updateLeads={updateLeadsMock}
                {...props}
              />
            </UserResolverProvider>
          </MantineProvider>
        </MemoryRouter>,
      );
    });
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("displays existing leads", async () => {
    getOrganizationDataMock.mockResolvedValue(mockOrgDataWithLeads);
    await renderComponent();

    await waitFor(() => {
      expect(screen.getAllByText("jdoe@illinois.edu").length).toEqual(2);
      expect(screen.getAllByText("jsmith@illinois.edu").length).toEqual(2);
      expect(screen.getByText("Vice Chair")).toBeInTheDocument();
    });

    const table = screen.getByRole("table");
    expect(table).toHaveTextContent("jdoe@illinois.edu");
    expect(table).toHaveTextContent("Chair");
    expect(table).toHaveTextContent("jsmith@illinois.edu");
    expect(table).toHaveTextContent("Vice Chair");
  });

  it("shows 'No leads found' when there are no leads", async () => {
    getOrganizationDataMock.mockResolvedValue({
      description: "Test",
      website: "https://test.com",
      links: [],
      leads: [],
    });
    await renderComponent();

    await waitFor(() => {
      expect(screen.getByText("No leads found.")).toBeInTheDocument();
    });
  });

  it("adds a new lead to the queue", async () => {
    getOrganizationDataMock.mockResolvedValue(mockOrgDataWithLeads);
    const user = userEvent.setup();
    await renderComponent();

    await waitFor(() => {
      expect(screen.getAllByText("jdoe@illinois.edu").length).toEqual(2);
    });

    // Fill in new lead form
    await user.type(
      screen.getByLabelText("Lead Email"),
      "bwilson@illinois.edu",
    );
    await user.type(screen.getByLabelText("Lead Title"), "Treasurer");

    // Click Add Lead button
    const addButton = screen.getByRole("button", { name: "Add Lead" });
    await user.click(addButton);

    // Check that the lead is queued
    await waitFor(() => {
      expect(screen.getAllByText("bwilson@illinois.edu").length).toEqual(2);
      expect(screen.getByText("Treasurer")).toBeInTheDocument();
      expect(screen.getByText("Queued for addition")).toBeInTheDocument();
    });
  });

  it("validates email format when adding lead", async () => {
    const notificationsMock = vi.spyOn(notifications, "show");
    getOrganizationDataMock.mockResolvedValue(mockOrgDataWithLeads);
    const user = userEvent.setup();
    await renderComponent();

    await waitFor(() => {
      expect(screen.getAllByText("jdoe@illinois.edu").length).toEqual(2);
    });

    // Fill in form with invalid email
    await user.type(screen.getByLabelText("Lead Email"), "invalid-email");
    await user.type(screen.getByLabelText("Lead Title"), "Treasurer");

    const addButton = screen.getByRole("button", { name: "Add Lead" });
    await user.click(addButton);

    await waitFor(() => {
      expect(notificationsMock).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Invalid Email",
          message: "Please enter a valid email address.",
          color: "orange",
        }),
      );
    });

    notificationsMock.mockRestore();
  });

  it("prevents adding duplicate leads", async () => {
    const notificationsMock = vi.spyOn(notifications, "show");
    getOrganizationDataMock.mockResolvedValue(mockOrgDataWithLeads);
    const user = userEvent.setup();
    await renderComponent();

    await waitFor(() => {
      expect(screen.getAllByText("jdoe@illinois.edu").length).toEqual(2);
    });

    // Try to add existing lead
    await user.type(screen.getByLabelText("Lead Email"), "jdoe@illinois.edu");
    await user.type(screen.getByLabelText("Lead Title"), "Member");

    const addButton = screen.getByRole("button", { name: "Add Lead" });
    await user.click(addButton);

    await waitFor(() => {
      expect(notificationsMock).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Duplicate Lead",
          message: "This user is already a lead or queued for addition.",
          color: "orange",
        }),
      );
    });

    notificationsMock.mockRestore();
  });

  it("queues a lead for removal", async () => {
    getOrganizationDataMock.mockResolvedValue(mockOrgDataWithLeads);
    const user = userEvent.setup();
    await renderComponent();

    await waitFor(() => {
      expect(screen.getAllByText("jdoe@illinois.edu").length).toEqual(2);
    });

    // Find and click the Remove button for the first lead
    const removeButtons = screen.getAllByRole("button", { name: "Remove" });
    await user.click(removeButtons[0]);

    // Check that the lead is queued for removal
    await waitFor(() => {
      expect(screen.getByText("Queued for removal")).toBeInTheDocument();
    });
  });

  it("cancels a queued removal", async () => {
    getOrganizationDataMock.mockResolvedValue(mockOrgDataWithLeads);
    const user = userEvent.setup();
    await renderComponent();

    await waitFor(() => {
      expect(screen.getAllByText("jdoe@illinois.edu").length).toEqual(2);
    });

    // Queue for removal
    const removeButtons = screen.getAllByRole("button", { name: "Remove" });
    await user.click(removeButtons[0]);

    await waitFor(() => {
      expect(screen.getByText("Queued for removal")).toBeInTheDocument();
    });

    // Cancel the removal
    const cancelButton = screen.getByRole("button", { name: "Cancel" });
    await user.click(cancelButton);

    await waitFor(() => {
      expect(screen.queryByText("Queued for removal")).not.toBeInTheDocument();
      expect(screen.getAllByText("Active").length).toEqual(2);
    });
  });

  it("cancels a queued addition", async () => {
    getOrganizationDataMock.mockResolvedValue(mockOrgDataWithLeads);
    const user = userEvent.setup();
    await renderComponent();

    await waitFor(() => {
      expect(screen.getAllByText("jdoe@illinois.edu").length).toEqual(2);
    });

    // Add a new lead
    await user.type(
      screen.getByLabelText("Lead Email"),
      "bwilson@illinois.edu",
    );
    await user.type(screen.getByLabelText("Lead Title"), "Treasurer");
    await user.click(screen.getByRole("button", { name: "Add Lead" }));

    await waitFor(() => {
      expect(screen.getAllByText("bwilson@illinois.edu").length).toEqual(2);
    });

    // Cancel the addition
    const cancelAddButton = screen.getByRole("button", { name: "Cancel Add" });
    await user.click(cancelAddButton);

    await waitFor(() => {
      expect(
        screen.queryByText("bwilson@illinois.edu"),
      ).not.toBeInTheDocument();
    });
  });

  it("opens confirmation modal when saving lead changes", async () => {
    getOrganizationDataMock.mockResolvedValue(mockOrgDataWithLeads);
    const user = userEvent.setup();
    await renderComponent();

    await waitFor(() => {
      expect(screen.getAllByText("jdoe@illinois.edu").length).toEqual(2);
    });

    // Add a new lead
    await user.type(
      screen.getByLabelText("Lead Email"),
      "bwilson@illinois.edu",
    );
    await user.type(screen.getByLabelText("Lead Title"), "Treasurer");
    await user.click(screen.getByRole("button", { name: "Add Lead" }));

    // Click save lead changes
    const saveButton = screen.getByTestId("save-lead-changes");
    await user.click(saveButton);

    // Check modal appears
    await waitFor(() => {
      expect(screen.getByText("Confirm Changes")).toBeInTheDocument();
      expect(screen.getByText("Leads to Add:")).toBeInTheDocument();
    });
  });

  it("saves lead changes when confirmed", async () => {
    getOrganizationDataMock.mockResolvedValue(mockOrgDataWithLeads);
    updateLeadsMock.mockResolvedValue(undefined);
    const user = userEvent.setup();
    await renderComponent();

    await waitFor(() => {
      expect(screen.getAllByText("jdoe@illinois.edu").length).toEqual(2);
    });

    // Add a new lead
    await user.type(
      screen.getByLabelText("Lead Email"),
      "bwilson@illinois.edu",
    );
    await user.type(screen.getByLabelText("Lead Title"), "Treasurer");
    await user.click(screen.getByRole("button", { name: "Add Lead" }));

    // Queue a removal
    const removeButtons = screen.getAllByRole("button", { name: "Remove" });
    await user.click(removeButtons[0]);

    // Open modal and confirm
    const saveButton = screen.getByTestId("save-lead-changes");
    await user.click(saveButton);

    await waitFor(() => {
      expect(screen.getByText("Confirm Changes")).toBeInTheDocument();
    });

    const confirmButton = screen.getByRole("button", {
      name: "Confirm and Save",
    });
    await user.click(confirmButton);

    // Verify the update function was called correctly
    await waitFor(() => {
      expect(updateLeadsMock).toHaveBeenCalledWith(
        [
          {
            name: "",
            nonVotingMember: false,
            username: "bwilson@illinois.edu",
            title: "Treasurer",
          },
        ],
        ["jdoe@illinois.edu"],
      );
    });
  });

  it("disables save button when no changes are queued", async () => {
    getOrganizationDataMock.mockResolvedValue(mockOrgDataWithLeads);
    await renderComponent();

    await waitFor(() => {
      expect(screen.getAllByText("jdoe@illinois.edu").length).toEqual(2);
    });

    const saveButton = screen.getByTestId("save-lead-changes");
    expect(saveButton).toBeDisabled();
  });

  it("clears form fields after adding a lead", async () => {
    getOrganizationDataMock.mockResolvedValue(mockOrgDataWithLeads);
    const user = userEvent.setup();
    await renderComponent();

    await waitFor(() => {
      expect(screen.getAllByText("jdoe@illinois.edu").length).toEqual(2);
    });

    // Fill in and submit form
    const emailInput = screen.getByLabelText("Lead Email");
    const titleInput = screen.getByLabelText("Lead Title");

    await user.type(emailInput, "bwilson@illinois.edu");
    await user.type(titleInput, "Treasurer");
    await user.click(screen.getByRole("button", { name: "Add Lead" }));

    // Check that fields are cleared
    await waitFor(() => {
      expect(emailInput).toHaveValue("");
      expect(titleInput).toHaveValue("");
    });
  });

  it("shows error notification when all fields are not filled", async () => {
    const notificationsMock = vi.spyOn(notifications, "show");
    getOrganizationDataMock.mockResolvedValue(mockOrgDataWithLeads);
    const user = userEvent.setup();
    await renderComponent();

    await waitFor(() => {
      expect(screen.getAllByText("jdoe@illinois.edu").length).toEqual(2);
    });

    // Try to add without filling all fields
    await user.type(
      screen.getByLabelText("Lead Email"),
      "bwilson@illinois.edu",
    );
    await user.click(screen.getByRole("button", { name: "Add Lead" }));

    await waitFor(() => {
      expect(notificationsMock).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Invalid Input",
          message: "All fields are required to add a lead.",
          color: "orange",
        }),
      );
    });

    notificationsMock.mockRestore();
  });

  it("does not show lead management section when updateLeads is not provided", async () => {
    getOrganizationDataMock.mockResolvedValue(mockOrgDataWithLeads);
    await act(async () => {
      render(
        <MemoryRouter>
          <MantineProvider
            withGlobalClasses
            withCssVariables
            forceColorScheme="light"
          >
            <UserResolverProvider resolutionDisabled>
              <ManageOrganizationForm
                organizationId="A01"
                getOrganizationData={getOrganizationDataMock}
                updateOrganizationData={updateOrganizationDataMock}
              />
            </UserResolverProvider>
          </MantineProvider>
        </MemoryRouter>,
      );
    });

    await waitFor(() => {
      expect(screen.queryByTestId("org-loading")).not.toBeInTheDocument();
    });

    expect(screen.queryByText("Organization Leads")).not.toBeInTheDocument();
  });
});
