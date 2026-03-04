import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter } from "react-router-dom";
import { ViewStorePurchasesInternalPage } from "./ViewStorePurchases.page";
import { UserResolverProvider } from "@ui/components/NameOptionalCard";
import type {
  GetProductResponse,
  LineItem,
  ListOrdersResponse,
} from "@common/types/store";

vi.mock("@mantine/hooks", async () => {
  const actual = await vi.importActual("@mantine/hooks");
  return {
    ...actual,
  };
});

vi.mock("@ui/components/AuthContext", async () => {
  return {
    useAuth: vi.fn().mockReturnValue({
      userData: { email: "admin@acm.illinois.edu" },
    }),
  };
});

vi.mock("@ui/components/AuthGuard", () => ({
  AuthGuard: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@mantine/notifications", () => ({
  notifications: { show: vi.fn() },
}));

const MOCK_PRODUCT: GetProductResponse = {
  productId: "test-product",
  name: "ACM T-Shirt",
  description: "A cool shirt",
  variantFriendlyName: "Size",
  inventoryMode: "PER_VARIANT",
  verifiedIdentityRequired: true,
  variants: [
    {
      variantId: "small",
      name: "Small",
      memberPriceCents: 1500,
      nonmemberPriceCents: 2000,
      memberPriceId: "price_member_small",
      nonmemberPriceId: "price_nonmember_small",
      memberLists: ["acmpaid"],
      soldCount: 5,
      exchangesAllowed: true,
    },
    {
      variantId: "large",
      name: "Large",
      memberPriceCents: 1500,
      nonmemberPriceCents: 2000,
      memberPriceId: "price_member_large",
      nonmemberPriceId: "price_nonmember_large",
      memberLists: ["acmpaid"],
      soldCount: 3,
      exchangesAllowed: true,
    },
  ],
};

const makeLineItem = (overrides: Partial<LineItem> = {}): LineItem => ({
  orderId: "order-1",
  lineItemId: "li-1",
  productId: "test-product",
  variantId: "small",
  quantity: 1,
  priceId: "price_member_small",
  unitPriceCents: 1500,
  createdAt: 1700000000,
  isFulfilled: false,
  userId: "buyer@illinois.edu",
  status: "ACTIVE",
  ...overrides,
});

const openRefundModal = async (user: ReturnType<typeof userEvent.setup>) => {
  const refundButton = await screen.findByRole("button", { name: "Refund" });
  await user.click(refundButton);
  // Wait for modal content to appear
  await screen.findByText("You are about to issue the following refund:");
};

describe("ViewStorePurchasesInternalPage", () => {
  const getProductPurchasesMock = vi.fn();
  const getProductInformationMock = vi.fn();
  const refundOrderMock = vi.fn();

  const renderComponent = async () => {
    render(
      <MemoryRouter>
        <MantineProvider
          withGlobalClasses
          withCssVariables
          forceColorScheme="light"
        >
          <UserResolverProvider resolutionDisabled>
            <ViewStorePurchasesInternalPage
              productId="test-product"
              getProductPurchases={getProductPurchasesMock}
              getProductInformation={getProductInformationMock}
              refundOrder={refundOrderMock}
            />
          </UserResolverProvider>
        </MantineProvider>
      </MemoryRouter>,
    );
    // Wait for data to load and render
    await screen.findByText(/Showing \d+ of \d+ line items/);
  };

  beforeEach(() => {
    vi.clearAllMocks();
    getProductInformationMock.mockResolvedValue(MOCK_PRODUCT);
  });

  describe("table rendering", () => {
    it("shows title and empty state when no items match default ACTIVE filter", async () => {
      getProductPurchasesMock.mockResolvedValue({
        items: [makeLineItem({ status: "REFUNDED", lineItemId: "li-ref" })],
      });
      await renderComponent();

      expect(screen.getByText("Sales for ACM T-Shirt")).toBeInTheDocument();
      expect(
        screen.getByText("No orders match the current filters."),
      ).toBeInTheDocument();
      expect(screen.getByText("Showing 0 of 1 line items")).toBeInTheDocument();
    });

    it("renders table rows for ACTIVE items by default", async () => {
      getProductPurchasesMock.mockResolvedValue({
        items: [
          makeLineItem({ lineItemId: "li-1", userId: "alice@illinois.edu" }),
          makeLineItem({
            lineItemId: "li-2",
            userId: "bob@illinois.edu",
            variantId: "large",
          }),
          makeLineItem({
            lineItemId: "li-3",
            userId: "charlie@illinois.edu",
            status: "REFUNDED",
          }),
        ],
      });
      await renderComponent();

      const rows = screen.getAllByRole("row");
      // Header + 2 active rows (charlie is REFUNDED, filtered out)
      expect(rows).toHaveLength(3);
      expect(screen.getByText("Showing 2 of 3 line items")).toBeInTheDocument();
      // NameOptionalUserCard renders email in multiple spots, use getAllByText
      expect(screen.getAllByText("alice@illinois.edu").length).toBeGreaterThan(
        0,
      );
      expect(screen.getAllByText("bob@illinois.edu").length).toBeGreaterThan(0);
    });

    it("resolves variant names from product info", async () => {
      getProductPurchasesMock.mockResolvedValue({
        items: [
          makeLineItem({ lineItemId: "li-1", variantId: "small" }),
          makeLineItem({ lineItemId: "li-2", variantId: "large" }),
        ],
      });
      await renderComponent();

      expect(screen.getByText("Small")).toBeInTheDocument();
      expect(screen.getByText("Large")).toBeInTheDocument();
    });

    it("uses variantFriendlyName as column header", async () => {
      getProductPurchasesMock.mockResolvedValue({
        items: [makeLineItem()],
      });
      await renderComponent();

      expect(screen.getByText("Size")).toBeInTheDocument();
    });

    it("shows fulfillment status badges", async () => {
      getProductPurchasesMock.mockResolvedValue({
        items: [
          makeLineItem({ lineItemId: "li-1", isFulfilled: false }),
          makeLineItem({ lineItemId: "li-2", isFulfilled: true }),
        ],
      });
      await renderComponent();

      expect(screen.getByText("Yes")).toBeInTheDocument();
      expect(screen.getByText("No")).toBeInTheDocument();
    });
  });

  describe("filtering", () => {
    it("filters by user email", async () => {
      getProductPurchasesMock.mockResolvedValue({
        items: [
          makeLineItem({ lineItemId: "li-1", userId: "alice@illinois.edu" }),
          makeLineItem({ lineItemId: "li-2", userId: "bob@illinois.edu" }),
        ],
      });
      await renderComponent();

      expect(screen.getByText("Showing 2 of 2 line items")).toBeInTheDocument();

      const user = userEvent.setup();
      const filterInput = screen.getByPlaceholderText(
        "Filter by user email...",
      );
      await user.type(filterInput, "alice");

      await screen.findByText("Showing 1 of 2 line items");
      expect(screen.getAllByText("alice@illinois.edu").length).toBeGreaterThan(
        0,
      );
      expect(screen.queryByText("bob@illinois.edu")).not.toBeInTheDocument();
    });
  });

  describe("refund modal", () => {
    const ACTIVE_ITEM = makeLineItem({
      lineItemId: "li-active",
      userId: "buyer@illinois.edu",
      variantId: "small",
      quantity: 2,
      orderId: "order-refund-test",
    });

    beforeEach(() => {
      getProductPurchasesMock.mockResolvedValue({
        items: [ACTIVE_ITEM],
      });
    });

    it("opens refund modal with product details when Refund button is clicked", async () => {
      await renderComponent();
      const user = userEvent.setup();
      await openRefundModal(user);

      expect(
        screen.getByText("You are about to issue the following refund:"),
      ).toBeInTheDocument();
      // Product details shown in the modal
      expect(screen.getByText("ACM T-Shirt")).toBeInTheDocument();
      expect(
        screen.getByText((_, el) => el?.textContent === "Quantity: 2"),
      ).toBeInTheDocument();
    });

    it("disables Issue Refund button until email matches and justification is provided", async () => {
      await renderComponent();
      const user = userEvent.setup();
      await openRefundModal(user);

      const issueRefundButton = screen.getByRole("button", {
        name: "Issue Refund",
      });
      expect(issueRefundButton).toBeDisabled();

      // Type correct email but no justification
      const emailInput = screen.getByPlaceholderText("buyer@illinois.edu");
      await user.type(emailInput, "buyer@illinois.edu");
      expect(issueRefundButton).toBeDisabled();

      // Type justification under 10 chars
      const justificationInput = screen.getByRole("textbox", {
        name: /justification/i,
      });
      await user.type(justificationInput, "short");
      expect(issueRefundButton).toBeDisabled();

      // Type justification over 10 chars
      await user.clear(justificationInput);
      await user.type(justificationInput, "Customer requested cancellation");
      expect(issueRefundButton).toBeEnabled();
    }, 10000);

    it("disables Issue Refund button when email does not match", async () => {
      await renderComponent();
      const user = userEvent.setup();
      await openRefundModal(user);

      const emailInput = screen.getByPlaceholderText("buyer@illinois.edu");
      await user.type(emailInput, "wrong@illinois.edu");

      const justificationInput = screen.getByRole("textbox", {
        name: /justification/i,
      });
      await user.type(justificationInput, "Customer requested cancellation");

      expect(
        screen.getByRole("button", { name: "Issue Refund" }),
      ).toBeDisabled();
    }, 10000);

    it("shows audit log warning in the modal", async () => {
      await renderComponent();
      const user = userEvent.setup();
      await openRefundModal(user);

      expect(
        screen.getByText(
          "Refunds are permanent and will be recorded in the audit log along with your identity.",
        ),
      ).toBeInTheDocument();
    });
  });
});
