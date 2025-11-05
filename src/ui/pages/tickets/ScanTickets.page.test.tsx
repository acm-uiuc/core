import React from "react";
import { render, screen, act, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter } from "react-router-dom";
import {
  ScanTicketsPage,
  APIResponseSchema,
  PurchasesByEmailResponse,
  ProductType,
} from "./ScanTickets.page";

// Mock the AuthGuard component
vi.mock("@ui/components/AuthGuard", () => ({
  AuthGuard: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// Mock the navigator.mediaDevices
Object.defineProperty(global.navigator, "mediaDevices", {
  writable: true,
  value: {
    getUserMedia: vi.fn(),
    enumerateDevices: vi.fn().mockResolvedValue([]),
  },
});

describe("ScanTicketsPage Tests", () => {
  const mockGetOrganizations = vi.fn();
  const mockGetTicketItems = vi.fn();
  const mockGetPurchasesByEmail = vi.fn();
  const mockCheckInTicket = vi.fn();
  const mockgetEmailFromUIN = vi.fn();

  const mockTicketItems = {
    tickets: [
      {
        itemId: "ticket-1",
        itemName: "Event 1",
        itemSalesActive: "2024-01-01T00:00:00.000Z",
      },
      { itemId: "ticket-2", itemName: "Event 2", itemSalesActive: false },
    ],
    merch: [
      {
        itemId: "merch-1",
        itemName: "Merch 1",
        itemSalesActive: "2024-01-01T00:00:00.000Z",
      },
    ],
  };

  const mockPurchasesResponse: PurchasesByEmailResponse = {
    tickets: [
      {
        valid: true,
        type: ProductType.Ticket,
        ticketId: "ticket-123",
        purchaserData: {
          email: "test@illinois.edu",
          productId: "ticket-1",
          quantity: 1,
        },
        refunded: false,
        fulfilled: false,
      },
    ],
    merch: [
      {
        valid: true,
        type: ProductType.Merch,
        ticketId: "merch-456",
        purchaserData: {
          email: "test@illinois.edu",
          productId: "merch-1",
          quantity: 1,
          size: "L",
        },
        refunded: false,
        fulfilled: false,
      },
    ],
  };

  const mockCheckInResponse: APIResponseSchema = {
    valid: true,
    type: ProductType.Ticket,
    ticketId: "ticket-123",
    purchaserData: {
      email: "test@illinois.edu",
      productId: "ticket-1",
      quantity: 1,
    },
    refunded: false,
    fulfilled: false,
  };

  const renderComponent = async () => {
    await act(async () => {
      render(
        <MemoryRouter>
          <MantineProvider
            withGlobalClasses
            withCssVariables
            forceColorScheme="light"
          >
            <ScanTicketsPage
              getOrganizations={mockGetOrganizations}
              getTicketItems={mockGetTicketItems}
              getPurchasesByEmail={mockGetPurchasesByEmail}
              checkInTicket={mockCheckInTicket}
              getEmailFromUIN={mockgetEmailFromUIN}
            />
          </MantineProvider>
        </MemoryRouter>,
      );
    });
  };

  const selectEvent = async (
    user: ReturnType<typeof userEvent.setup>,
    eventId: string,
  ) => {
    // Click on the select to open dropdown
    const selectInput = screen.getByRole("searchbox", {
      name: /select event/i,
    });
    await user.click(selectInput);

    // Find and click the option
    const option = await screen.findByRole("option", {
      name: new RegExp(eventId),
    });
    await user.click(option);
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetOrganizations.mockResolvedValue(["org1", "org2"]);
    mockGetTicketItems.mockResolvedValue(mockTicketItems);
  });

  it("renders the page correctly", async () => {
    await renderComponent();

    await waitFor(() => {
      expect(screen.getByText("Scan Tickets")).toBeInTheDocument();
      expect(
        screen.getByPlaceholderText("Enter UIN, NetID, or Email"),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Submit Manual Entry" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Start Camera" }),
      ).toBeInTheDocument();
    });
  });

  it("loads ticket items on mount", async () => {
    await renderComponent();

    await waitFor(() => {
      expect(mockGetOrganizations).toHaveBeenCalledTimes(1);
      expect(mockGetTicketItems).toHaveBeenCalledTimes(1);
    });
  });

  describe("Manual Entry - Email", () => {
    it("submits email and marks single valid ticket automatically", async () => {
      mockGetPurchasesByEmail.mockResolvedValue({
        tickets: [mockPurchasesResponse.tickets[0]],
        merch: [],
      });
      mockCheckInTicket.mockResolvedValue(mockCheckInResponse);

      const user = userEvent.setup();
      await renderComponent();

      await waitFor(() => {
        expect(
          screen.getByPlaceholderText("Enter UIN, NetID, or Email"),
        ).toBeInTheDocument();
      });

      // Select an event first
      await selectEvent(user, "Event 1");

      await user.type(
        screen.getByPlaceholderText("Enter UIN, NetID, or Email"),
        "test@illinois.edu",
      );
      await user.click(
        screen.getByRole("button", { name: "Submit Manual Entry" }),
      );

      await waitFor(() => {
        expect(mockGetPurchasesByEmail).toHaveBeenCalledWith(
          "test@illinois.edu",
        );
        expect(mockCheckInTicket).toHaveBeenCalledWith({
          type: "ticket",
          ticketId: "ticket-123",
        });
      });
    });

    it("submits email on Enter key press", async () => {
      mockGetPurchasesByEmail.mockResolvedValue({
        tickets: [mockPurchasesResponse.tickets[0]],
        merch: [],
      });
      mockCheckInTicket.mockResolvedValue(mockCheckInResponse);

      const user = userEvent.setup();
      await renderComponent();

      await waitFor(() => {
        expect(
          screen.getByPlaceholderText("Enter UIN, NetID, or Email"),
        ).toBeInTheDocument();
      });

      // Select an event first
      await selectEvent(user, "Event 1");

      const input = screen.getByPlaceholderText("Enter UIN, NetID, or Email");
      await user.type(input, "test@illinois.edu");
      await user.keyboard("{Enter}");

      await waitFor(() => {
        expect(mockGetPurchasesByEmail).toHaveBeenCalledWith(
          "test@illinois.edu",
        );
      });
    });
  });

  describe("Manual Entry - NetID", () => {
    it("converts NetID to email format", async () => {
      mockGetPurchasesByEmail.mockResolvedValue({
        tickets: [mockPurchasesResponse.tickets[0]],
        merch: [],
      });
      mockCheckInTicket.mockResolvedValue(mockCheckInResponse);

      const user = userEvent.setup();
      await renderComponent();

      await waitFor(() => {
        expect(
          screen.getByPlaceholderText("Enter UIN, NetID, or Email"),
        ).toBeInTheDocument();
      });

      // Select an event first
      await selectEvent(user, "Event 1");

      await user.type(
        screen.getByPlaceholderText("Enter UIN, NetID, or Email"),
        "testuser",
      );
      await user.click(
        screen.getByRole("button", { name: "Submit Manual Entry" }),
      );

      await waitFor(() => {
        expect(mockGetPurchasesByEmail).toHaveBeenCalledWith(
          "testuser@illinois.edu",
        );
      });
    });
  });

  describe("Manual Entry - UIN", () => {
    it("converts UIN to NetID then email format", async () => {
      mockgetEmailFromUIN.mockResolvedValue("testuser");
      mockGetPurchasesByEmail.mockResolvedValue({
        tickets: [mockPurchasesResponse.tickets[0]],
        merch: [],
      });
      mockCheckInTicket.mockResolvedValue(mockCheckInResponse);

      const user = userEvent.setup();
      await renderComponent();

      await waitFor(() => {
        expect(
          screen.getByPlaceholderText("Enter UIN, NetID, or Email"),
        ).toBeInTheDocument();
      });

      // Select an event first
      await selectEvent(user, "Event 1");

      await user.type(
        screen.getByPlaceholderText("Enter UIN, NetID, or Email"),
        "123456789",
      );
      await user.click(
        screen.getByRole("button", { name: "Submit Manual Entry" }),
      );

      await waitFor(() => {
        expect(mockgetEmailFromUIN).toHaveBeenCalledWith("123456789");
        expect(mockGetPurchasesByEmail).toHaveBeenCalledWith(
          "testuser@illinois.edu",
        );
      });
    });

    it("shows error when UIN conversion fails", async () => {
      mockgetEmailFromUIN.mockRejectedValue(new Error("UIN not found"));

      const user = userEvent.setup();
      await renderComponent();

      await waitFor(() => {
        expect(
          screen.getByPlaceholderText("Enter UIN, NetID, or Email"),
        ).toBeInTheDocument();
      });

      // Select an event first
      await selectEvent(user, "Event 1");

      await user.type(
        screen.getByPlaceholderText("Enter UIN, NetID, or Email"),
        "123456789",
      );
      await user.click(
        screen.getByRole("button", { name: "Submit Manual Entry" }),
      );

      await waitFor(() => {
        expect(
          screen.getByText(
            "Failed to convert UIN to NetID. Please enter NetID or email instead.",
          ),
        ).toBeInTheDocument();
      });
    });
  });

  describe("Multiple Tickets Selection", () => {
    it("shows selection modal when multiple valid tickets exist", async () => {
      // Mock both ticket-1 and ticket-2 with different products
      mockGetPurchasesByEmail.mockResolvedValue({
        tickets: [
          mockPurchasesResponse.tickets[0],
          {
            ...mockPurchasesResponse.tickets[0],
            ticketId: "ticket-456",
            purchaserData: {
              ...mockPurchasesResponse.tickets[0].purchaserData,
              productId: "ticket-1", // Same product
            },
          },
        ],
        merch: [],
      });

      const user = userEvent.setup();
      await renderComponent();

      await waitFor(() => {
        expect(
          screen.getByRole("searchbox", { name: /select event/i }),
        ).toBeInTheDocument();
      });

      // Select event first
      await selectEvent(user, "Event 1");

      await waitFor(() => {
        expect(
          screen.getByPlaceholderText("Enter UIN, NetID, or Email"),
        ).toBeInTheDocument();
      });

      await user.type(
        screen.getByPlaceholderText("Enter UIN, NetID, or Email"),
        "test@illinois.edu",
      );
      await user.click(
        screen.getByRole("button", { name: "Submit Manual Entry" }),
      );

      await waitFor(() => {
        expect(
          screen.getByText(
            "Multiple valid tickets found. Please select which one to mark:",
          ),
        ).toBeInTheDocument();
      });
    });

    it("marks selected ticket from multiple options", async () => {
      mockGetPurchasesByEmail.mockResolvedValue({
        tickets: [
          mockPurchasesResponse.tickets[0],
          {
            ...mockPurchasesResponse.tickets[0],
            ticketId: "ticket-456",
            purchaserData: {
              ...mockPurchasesResponse.tickets[0].purchaserData,
              productId: "ticket-1",
            },
          },
        ],
        merch: [],
      });
      mockCheckInTicket.mockResolvedValue(mockCheckInResponse);

      const user = userEvent.setup();
      await renderComponent();

      await waitFor(() => {
        expect(
          screen.getByRole("searchbox", { name: /select event/i }),
        ).toBeInTheDocument();
      });

      // Select event first
      await selectEvent(user, "Event 1");

      await waitFor(() => {
        expect(
          screen.getByPlaceholderText("Enter UIN, NetID, or Email"),
        ).toBeInTheDocument();
      });

      await user.type(
        screen.getByPlaceholderText("Enter UIN, NetID, or Email"),
        "test@illinois.edu",
      );
      await user.click(
        screen.getByRole("button", { name: "Submit Manual Entry" }),
      );

      await waitFor(() => {
        expect(screen.getByText("TICKET - ticket-1")).toBeInTheDocument();
      });

      // Click on the first ticket option
      const ticketOption = screen.getByText("TICKET - ticket-1").closest("div");
      await user.click(ticketOption!);

      await waitFor(() => {
        expect(mockCheckInTicket).toHaveBeenCalledWith({
          type: "ticket",
          ticketId: "ticket-123",
        });
      });
    });
  });

  describe("Event/Item Filter", () => {
    it("filters tickets by selected event/item", async () => {
      mockGetPurchasesByEmail.mockResolvedValue(mockPurchasesResponse);
      mockCheckInTicket.mockResolvedValue(mockCheckInResponse);

      const user = userEvent.setup();
      await renderComponent();

      await waitFor(() => {
        expect(
          screen.getByRole("searchbox", { name: /select event/i }),
        ).toBeInTheDocument();
      });

      // Select event first
      await selectEvent(user, "Event 1");

      await waitFor(() => {
        expect(
          screen.getByPlaceholderText("Enter UIN, NetID, or Email"),
        ).toBeInTheDocument();
      });

      await user.type(
        screen.getByPlaceholderText("Enter UIN, NetID, or Email"),
        "test@illinois.edu",
      );
      await user.click(
        screen.getByRole("button", { name: "Submit Manual Entry" }),
      );

      // Should automatically mark since we're filtering by ticket-1
      await waitFor(() => {
        expect(mockCheckInTicket).toHaveBeenCalled();
      });
    });
  });

  describe("Error Handling", () => {
    it("shows error when no valid tickets found", async () => {
      mockGetPurchasesByEmail.mockResolvedValue({
        tickets: [],
        merch: [],
      });

      const user = userEvent.setup();
      await renderComponent();

      await waitFor(() => {
        expect(
          screen.getByRole("searchbox", { name: /select event/i }),
        ).toBeInTheDocument();
      });

      // Select event first
      await selectEvent(user, "Event 1");

      await waitFor(() => {
        expect(
          screen.getByPlaceholderText("Enter UIN, NetID, or Email"),
        ).toBeInTheDocument();
      });

      await user.type(
        screen.getByPlaceholderText("Enter UIN, NetID, or Email"),
        "test@illinois.edu",
      );
      await user.click(
        screen.getByRole("button", { name: "Submit Manual Entry" }),
      );

      await waitFor(() => {
        expect(
          screen.getByText(
            "No valid tickets found for this user and selected event/item.",
          ),
        ).toBeInTheDocument();
      });
    });

    it("shows error when all tickets are refunded", async () => {
      mockGetPurchasesByEmail.mockResolvedValue({
        tickets: [
          {
            ...mockPurchasesResponse.tickets[0],
            refunded: true,
          },
        ],
        merch: [],
      });

      const user = userEvent.setup();
      await renderComponent();

      await waitFor(() => {
        expect(
          screen.getByRole("searchbox", { name: /select event/i }),
        ).toBeInTheDocument();
      });

      // Select event first
      await selectEvent(user, "Event 1");

      await waitFor(() => {
        expect(
          screen.getByPlaceholderText("Enter UIN, NetID, or Email"),
        ).toBeInTheDocument();
      });

      await user.type(
        screen.getByPlaceholderText("Enter UIN, NetID, or Email"),
        "test@illinois.edu",
      );
      await user.click(
        screen.getByRole("button", { name: "Submit Manual Entry" }),
      );

      await waitFor(() => {
        expect(
          screen.getByText(
            "No valid tickets found for this user and selected event/item.",
          ),
        ).toBeInTheDocument();
      });
    });

    it("handles API errors gracefully", async () => {
      mockGetPurchasesByEmail.mockRejectedValue(new Error("API Error"));

      const user = userEvent.setup();
      await renderComponent();

      await waitFor(() => {
        expect(
          screen.getByRole("searchbox", { name: /select event/i }),
        ).toBeInTheDocument();
      });

      // Select event first
      await selectEvent(user, "Event 1");

      await waitFor(() => {
        expect(
          screen.getByPlaceholderText("Enter UIN, NetID, or Email"),
        ).toBeInTheDocument();
      });

      await user.type(
        screen.getByPlaceholderText("Enter UIN, NetID, or Email"),
        "test@illinois.edu",
      );
      await user.click(
        screen.getByRole("button", { name: "Submit Manual Entry" }),
      );

      await waitFor(() => {
        expect(
          screen.getByText(
            "Failed to fetch ticket information. Please check your connection and try again.",
          ),
        ).toBeInTheDocument();
      });
    });
  });

  describe("Submit Button State", () => {
    it("disables submit button when no event selected", async () => {
      await renderComponent();

      await waitFor(() => {
        expect(
          screen.getByRole("searchbox", { name: /select event/i }),
        ).toBeInTheDocument();
      });

      // Button should not be visible yet
      expect(
        screen.queryByRole("button", { name: "Submit Manual Entry" }),
      ).not.toBeInTheDocument();
    });

    it("enables submit button when input has value and event selected", async () => {
      const user = userEvent.setup();
      await renderComponent();

      await waitFor(() => {
        expect(
          screen.getByRole("searchbox", { name: /select event/i }),
        ).toBeInTheDocument();
      });

      // Select event first
      await selectEvent(user, "Event 1");

      await waitFor(() => {
        expect(
          screen.getByPlaceholderText("Enter UIN, NetID, or Email"),
        ).toBeInTheDocument();
      });

      await user.type(
        screen.getByPlaceholderText("Enter UIN, NetID, or Email"),
        "test@illinois.edu",
      );

      await waitFor(() => {
        expect(
          screen.getByRole("button", { name: "Submit Manual Entry" }),
        ).not.toBeDisabled();
      });
    });
  });

  describe("Success Modal", () => {
    it("displays success modal after marking ticket", async () => {
      mockGetPurchasesByEmail.mockResolvedValue({
        tickets: [mockPurchasesResponse.tickets[0]],
        merch: [],
      });
      mockCheckInTicket.mockResolvedValue(mockCheckInResponse);

      const user = userEvent.setup();
      await renderComponent();

      await waitFor(() => {
        expect(
          screen.getByRole("searchbox", { name: /select event/i }),
        ).toBeInTheDocument();
      });

      // Select event first
      await selectEvent(user, "Event 1");

      await waitFor(() => {
        expect(
          screen.getByPlaceholderText("Enter UIN, NetID, or Email"),
        ).toBeInTheDocument();
      });

      await user.type(
        screen.getByPlaceholderText("Enter UIN, NetID, or Email"),
        "test@illinois.edu",
      );
      await user.click(
        screen.getByRole("button", { name: "Submit Manual Entry" }),
      );

      await waitFor(() => {
        expect(
          screen.getByText("Ticket verified successfully!"),
        ).toBeInTheDocument();
        expect(
          screen.getByText(/Email: test@illinois.edu/),
        ).toBeInTheDocument();
      });
    });

    it("clears input after closing success modal", async () => {
      mockGetPurchasesByEmail.mockResolvedValue({
        tickets: [mockPurchasesResponse.tickets[0]],
        merch: [],
      });
      mockCheckInTicket.mockResolvedValue(mockCheckInResponse);

      const user = userEvent.setup();
      await renderComponent();

      await waitFor(() => {
        expect(
          screen.getByRole("searchbox", { name: /select event/i }),
        ).toBeInTheDocument();
      });

      // Select event first
      await selectEvent(user, "Event 1");

      await waitFor(() => {
        expect(
          screen.getByPlaceholderText("Enter UIN, NetID, or Email"),
        ).toBeInTheDocument();
      });

      const input = screen.getByPlaceholderText("Enter UIN, NetID, or Email");
      await user.type(input, "test@illinois.edu");
      await user.click(
        screen.getByRole("button", { name: "Submit Manual Entry" }),
      );

      await waitFor(() => {
        expect(
          screen.getByText("Ticket verified successfully!"),
        ).toBeInTheDocument();
      });

      await user.click(screen.getByRole("button", { name: "Close" }));

      await waitFor(() => {
        expect(input).toHaveValue("");
      });
    });
  });
});
