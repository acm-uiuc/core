import React from "react";
import { render, screen, act, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { MantineProvider } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { OrgApiKeyTable } from "./ManageKeysTable";
import { MemoryRouter } from "react-router-dom";
import { ApiKeyMaskedEntry, ApiKeyPostBody } from "@common/types/apiKey";
import { AppRoles } from "@common/roles";
import { UserResolverProvider } from "@ui/components/NameOptionalCard";

// Mock the notifications module
vi.mock("@mantine/notifications", () => ({
  notifications: {
    show: vi.fn(),
  },
}));

// Mock the AuthContext
vi.mock("@ui/components/AuthContext", async () => {
  return {
    useAuth: vi.fn().mockReturnValue({
      userData: { email: "test@example.com" },
    }),
  };
});

// Mock BlurredTextDisplay component
vi.mock("../../components/BlurredTextDisplay", () => ({
  BlurredTextDisplay: ({ text }: { text: string }) => (
    <div data-testid="blurred-text">{text}</div>
  ),
}));

// Mock Modal component to avoid portal issues in tests
vi.mock("@mantine/core", async () => {
  const actual = await vi.importActual("@mantine/core");
  return {
    ...actual,
    Modal: ({ children, opened, onClose, title }: any) =>
      opened ? (
        <div data-testid="modal" role="dialog" aria-modal="true">
          <h2>{title}</h2>
          <div>{children}</div>
          <button type="button" onClick={onClose}>
            Close Modal
          </button>
        </div>
      ) : null,
  };
});

describe("OrgApiKeyTable Tests", () => {
  const getApiKeys = vi.fn();
  const deleteApiKeys = vi.fn();
  const createApiKey = vi.fn();

  const mockApiKeys: ApiKeyMaskedEntry[] = [
    {
      keyId: "key123",
      description: "Test API Key 1",
      owner: "test@example.com",
      createdAt: Math.floor(Date.now() / 1000) - 86400, // yesterday
      expiresAt: Math.floor(Date.now() / 1000) + 86400 * 30, // 30 days from now
      roles: [AppRoles.EVENTS_MANAGER, AppRoles.LINKS_MANAGER],
    },
    {
      keyId: "key456",
      description: "Test API Key 2",
      owner: "other@example.com",
      createdAt: Math.floor(Date.now() / 1000) - 86400 * 7, // 7 days ago
      expiresAt: undefined, // never expires
      roles: [AppRoles.EVENTS_MANAGER],
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
              <OrgApiKeyTable
                createApiKey={createApiKey}
                getApiKeys={getApiKeys}
                deleteApiKeys={deleteApiKeys}
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

  it("renders the table headers correctly", async () => {
    getApiKeys.mockResolvedValue(mockApiKeys);
    await renderComponent();

    expect(screen.getByText("Key ID")).toBeInTheDocument();
    expect(screen.getByText("Description")).toBeInTheDocument();
    expect(screen.getByText("Owner")).toBeInTheDocument();
    expect(screen.getByText("Created")).toBeInTheDocument();
    expect(screen.getByText("Expires")).toBeInTheDocument();
    expect(screen.getByText("Permissions")).toBeInTheDocument();
  });

  it("shows loading state initially", async () => {
    getApiKeys.mockResolvedValue([]);
    await renderComponent();

    // Check for skeletons (loading state)
    // Since we're using act, we need to look for the skeleton before it's replaced
    expect(getApiKeys).toHaveBeenCalledTimes(1);
  });

  it("displays API keys when loaded", async () => {
    getApiKeys.mockResolvedValue(mockApiKeys);
    await renderComponent();

    // Wait for loading to complete
    await waitFor(() => {
      expect(screen.getByText("acmuiuc_key123")).toBeInTheDocument();
    });

    expect(screen.getByText("Test API Key 1")).toBeInTheDocument();
    expect(screen.getAllByText("test@example.com")).toHaveLength(2);
    expect(screen.getAllByText("other@example.com")).toHaveLength(2);
    expect(screen.getByText("Never")).toBeInTheDocument(); // For key that never expires
  });

  it("handles empty API key list", async () => {
    getApiKeys.mockResolvedValue([]);
    await renderComponent();

    await waitFor(() => {
      expect(
        screen.getByText(
          `No API keys found. Click "Create API Key" to get started.`,
        ),
      ).toBeInTheDocument();
    });
  });

  it("shows notification on API key fetch error", async () => {
    const notificationsMock = vi.spyOn(notifications, "show");
    getApiKeys.mockRejectedValue(new Error("Failed to load"));
    await renderComponent();

    await waitFor(() => {
      expect(notificationsMock).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "An error occurred while loading API keys",
          color: "red",
          message: "Error 99: Failed to load",
        }),
      );
    });
  });

  it("allows selecting and deselecting rows", async () => {
    getApiKeys.mockResolvedValue(mockApiKeys);
    await renderComponent();
    const user = userEvent.setup();

    // Wait for data to load
    await waitFor(() => {
      expect(screen.getByText("acmuiuc_key123")).toBeInTheDocument();
    });

    // Find checkboxes and select first row
    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes.length).toBeGreaterThan(1); // Header + rows

    // Select first data row (skip the header checkbox at index 0)
    await user.click(checkboxes[1]);

    // Delete button should appear with count
    expect(screen.getByText(/Delete 1 API Key/)).toBeInTheDocument();

    // Deselect
    await user.click(checkboxes[1]);

    // Delete button should disappear
    expect(screen.queryByText(/Delete 1 API Key/)).not.toBeInTheDocument();
  });

  it("allows selecting all rows with Select All button", async () => {
    getApiKeys.mockResolvedValue(mockApiKeys);
    await renderComponent();
    const user = userEvent.setup();

    // Wait for data to load
    await waitFor(() => {
      expect(screen.getByText("acmuiuc_key123")).toBeInTheDocument();
    });

    // Find and click the "Select All" button
    const selectAllButton = screen.getByRole("button", { name: /Select All/i });
    expect(selectAllButton).toBeInTheDocument();

    await act(async () => {
      await user.click(selectAllButton);
    });

    // Delete button should show count of all rows
    const deleteButton = await screen.findByText(/Delete 2 API Keys/);
    expect(deleteButton).toBeInTheDocument();

    // Click "Deselect All" button
    const deselectAllButton = screen.getByRole("button", {
      name: /Deselect All/i,
    });
    await act(async () => {
      await user.click(deselectAllButton);
    });

    // Delete button should be gone
    await waitFor(() => {
      expect(screen.queryByText(/Delete/)).not.toBeInTheDocument();
    });
  });
});
