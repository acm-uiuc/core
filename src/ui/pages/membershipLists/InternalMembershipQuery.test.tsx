import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { MantineProvider } from "@mantine/core";
import { MembershipListQuery } from "./InternalMembershipQuery";

// Mock the useClipboard hook from @mantine/hooks
vi.mock("@mantine/hooks", async (importOriginal) => {
  const originalModule =
    await importOriginal<typeof import("@mantine/hooks")>();
  return {
    ...originalModule,
    useClipboard: vi.fn(() => ({
      copy: vi.fn(),
      copied: false,
    })),
  };
});

// Mock implementation for the clipboard API
Object.assign(navigator, {
  clipboard: {
    writeText: vi.fn().mockResolvedValue(undefined),
  },
});

describe("MembershipListQuery Tests", () => {
  const queryFunctionMock = vi
    .fn()
    .mockImplementation(async (netIds: string[]) => {
      const validNetIds = ["rjjones", "test2"];
      const members = netIds.filter((id) => validNetIds.includes(id));
      const nonMembers = netIds.filter((id) => !validNetIds.includes(id));
      return { members, nonMembers };
    });

  const renderComponent = () => {
    render(
      <MantineProvider>
        <MembershipListQuery queryFunction={queryFunctionMock} />
      </MantineProvider>,
    );
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the component correctly", () => {
    renderComponent();
    expect(
      screen.getByLabelText(/Enter NetIDs or Illinois Emails/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Query Memberships/i }),
    ).toBeInTheDocument();
  });

  it("disables the query button when the input is empty", () => {
    renderComponent();
    expect(
      screen.getByRole("button", { name: /Query Memberships/i }),
    ).toBeDisabled();
  });

  it("enables the query button when input is provided", async () => {
    renderComponent();
    const user = userEvent.setup();
    const textarea = screen.getByLabelText(/Enter NetIDs or Illinois Emails/i);
    await user.type(textarea, "test");
    expect(
      screen.getByRole("button", { name: /Query Memberships/i }),
    ).toBeEnabled();
  });

  it("correctly processes input and displays members and non-members", async () => {
    renderComponent();
    const user = userEvent.setup();
    const textarea = screen.getByLabelText(/Enter NetIDs or Illinois Emails/i);
    const queryButton = screen.getByRole("button", {
      name: /Query Memberships/i,
    });
    const inputText =
      "rjjones, invalid, TEST2@illinois.edu, rjjones, someone@gmail.com";

    await user.type(textarea, inputText);
    await user.click(queryButton);

    expect(queryFunctionMock).toHaveBeenCalledTimes(1);
    expect(queryFunctionMock).toHaveBeenCalledWith([
      "rjjones",
      "invalid",
      "test2",
    ]);

    expect(await screen.findByText(/Paid Members \(2\)/i)).toBeVisible();
    expect(await screen.findByText(/Not Paid Members \(1\)/i)).toBeVisible();
    expect(await screen.findByText(/Invalid Entries \(1\)/i)).toBeVisible();
  });
});
