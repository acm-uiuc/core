import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { MantineProvider } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { MemoryRouter } from "react-router-dom";
import StripeCurrentLinksPanel from "./CurrentLinks";

vi.mock("@ui/components/AuthContext", async () => {
  return {
    useAuth: vi.fn().mockReturnValue({
      userData: { email: "infraunittests@acm.illinois.edu" },
    }),
  };
});

describe("StripeCurrentLinksPanel Tests", () => {
  const getLinksMock = vi.fn();
  const deactivateLinkMock = vi.fn();

  const renderComponent = async () => {
    await act(async () => {
      render(
        <MemoryRouter>
          <MantineProvider
            withGlobalClasses
            withCssVariables
            forceColorScheme="light"
          >
            <StripeCurrentLinksPanel
              getLinks={getLinksMock}
              deactivateLink={deactivateLinkMock}
            />
          </MantineProvider>
        </MemoryRouter>,
      );
    });
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders table with no items", async () => {
    getLinksMock.mockResolvedValue([]);
    await renderComponent();

    expect(getLinksMock).toHaveBeenCalledOnce();
    expect(await screen.findByText("Current Links")).toBeInTheDocument();
    expect(
      await screen.findByText("No payment links found."),
    ).toBeInTheDocument();
  });

  it("renders table with a few items", async () => {
    getLinksMock.mockResolvedValue([
      {
        id: "1",
        active: true,
        invoiceId: "INV-001",
        invoiceAmountUsd: 5000,
        userId: "user@example.com",
        createdAt: "2024-02-01",
        link: "http://example.com",
      },
      {
        id: "2",
        active: false,
        invoiceId: "INV-002",
        invoiceAmountUsd: 7500,
        userId: "infraunittests@acm.illinois.edu",
        createdAt: null,
        link: "http://example.com/2",
      },
    ]);
    await renderComponent();

    expect(getLinksMock).toHaveBeenCalledOnce();
    const rows = screen.getAllByRole("row");
    expect(rows).toHaveLength(3); // Header + 2 data rows
    expect(rows[1]).toHaveTextContent("INV-001");
    expect(rows[1]).toHaveTextContent("$50");
    expect(rows[2]).toHaveTextContent("INV-002");
    expect(rows[2]).toHaveTextContent("$75");
    expect(screen.getByText("You")).toBeInTheDocument();
    expect(screen.getByText("Unknown")).toBeInTheDocument();
    const user = userEvent.setup();
    const copyButtons = screen.getAllByRole("button", { name: /copy/i });
    await user.click(copyButtons[0]);
    await act(async () => {
      const clipboardText = await navigator.clipboard.readText();
      expect(clipboardText).toBe("http://example.com");
    });
    await user.click(copyButtons[1]);
    await act(async () => {
      const clipboardText = await navigator.clipboard.readText();
      expect(clipboardText).toBe("http://example.com/2");
    });
  });

  it('correctly replaces the user email with "You"', async () => {
    getLinksMock.mockResolvedValue([
      {
        id: "3",
        active: true,
        invoiceId: "INV-003",
        invoiceAmountUsd: 10000,
        userId: "infraunittests@acm.illinois.edu",
        createdAt: "2024-02-05",
        link: "http://example.com/3",
      },
    ]);
    await renderComponent();

    expect(getLinksMock).toHaveBeenCalledOnce();
    expect(await screen.findByText("You")).toBeInTheDocument();
  });

  it("handles API failure gracefully", async () => {
    const notificationsMock = vi.spyOn(notifications, "show");
    getLinksMock.mockRejectedValue(new Error("API Error"));
    await renderComponent();

    expect(getLinksMock).toHaveBeenCalledOnce();
    expect(notificationsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Error",
        message:
          "Failed to get payment links. Please try again or contact support.",
        color: "red",
      }),
    );

    notificationsMock.mockRestore();
  });

  it("allows selecting and deselecting rows", async () => {
    getLinksMock.mockResolvedValue([
      {
        id: "1",
        active: true,
        invoiceId: "INV-001",
        invoiceAmountUsd: 5000,
        userId: "user@example.com",
        createdAt: "2024-02-01",
        link: "http://example.com",
      },
    ]);
    await renderComponent();

    const checkbox = screen.getByLabelText("Select row");
    await userEvent.click(checkbox);
    expect(checkbox).toBeChecked();

    await userEvent.click(checkbox);
    expect(checkbox).not.toBeChecked();
  });

  it("triggers deactivation when clicking deactivate button with all active", async () => {
    getLinksMock.mockResolvedValue([
      {
        id: "abc123",
        active: true,
        invoiceId: "INV-001",
        invoiceAmountUsd: 5000,
        userId: "user@example.com",
        createdAt: "2024-02-01",
        link: "http://example.com",
      },
    ]);
    await renderComponent();

    const checkbox = screen.getByLabelText("Select row");
    await userEvent.click(checkbox);

    const deactivateButton = await screen.findByText(/Deactivate 1 link/);
    await userEvent.click(deactivateButton);

    expect(deactivateLinkMock).toHaveBeenCalledWith("abc123");
  });

  it("doesn't show deactivation when clicking deactivate button on non-active", async () => {
    getLinksMock.mockResolvedValue([
      {
        id: "abc123",
        active: false,
        invoiceId: "INV-001",
        invoiceAmountUsd: 5000,
        userId: "user@example.com",
        createdAt: "2024-02-01",
        link: "http://example.com",
      },
    ]);
    await renderComponent();

    const checkbox = screen.getByLabelText("Select row");
    await userEvent.click(checkbox);

    const deactivateButton = screen.queryByText(/Deactivate 1 link/);
    expect(deactivateButton).not.toBeInTheDocument();

    expect(deactivateLinkMock).not.toHaveBeenCalled();
  });

  it("only offers to deactivate one link when there is one active and one non-active", async () => {
    getLinksMock.mockResolvedValue([
      {
        id: "abc123",
        active: false,
        invoiceId: "INV-001",
        invoiceAmountUsd: 5000,
        userId: "user@example.com",
        createdAt: "2024-02-01",
        link: "http://example.com",
      },
      {
        id: "def456",
        active: true,
        invoiceId: "INV-002",
        invoiceAmountUsd: 5000,
        userId: "user@example.com",
        createdAt: "2024-02-01",
        link: "http://example.com",
      },
    ]);
    await renderComponent();

    const checkboxes = screen.getAllByLabelText("Select row");
    checkboxes.map(async (x) => await userEvent.click(x));

    const deactivateButton = await screen.findByText(
      /Deactivate 1 active link/,
    );
    await userEvent.click(deactivateButton);

    expect(deactivateLinkMock).toHaveBeenCalledTimes(1);
    expect(deactivateLinkMock).toHaveBeenNthCalledWith(1, "def456");
  });
});
