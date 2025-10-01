import React from "react";
import { render, screen, act, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { MantineProvider } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { ManageOrganizationForm } from "./ManageOrganizationForm";
import { MemoryRouter } from "react-router-dom";

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
            <ManageOrganizationForm
              organizationId="ACM"
              getOrganizationData={getOrganizationDataMock}
              updateOrganizationData={updateOrganizationDataMock}
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
      expect(getOrganizationDataMock).toHaveBeenCalledWith("ACM");
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
          <ManageOrganizationForm
            organizationId="ACM"
            getOrganizationData={getOrganizationDataMock}
            updateOrganizationData={updateOrganizationDataMock}
          />
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
            <ManageOrganizationForm
              organizationId="SIGWeb"
              getOrganizationData={getOrganizationDataMock}
              updateOrganizationData={updateOrganizationDataMock}
            />
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
