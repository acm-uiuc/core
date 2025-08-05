import React from "react";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { MantineProvider } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import InternalMembershipQuery from "./InternalMembershipQuery";
import { Modules, ModulesToHumanName } from "@common/modules";
import { MemoryRouter } from "react-router-dom";

describe("InternalMembershipQuery Tests", () => {
  const validNetIds = ["rjjones", "test2"];
  const queryInternalMembershipMock = vi
    .fn()
    .mockImplementation((netId) => validNetIds.includes(netId));
  const renderComponent = async () => {
    await act(async () => {
      render(
        <MemoryRouter>
          <MantineProvider
            withGlobalClasses
            withCssVariables
            forceColorScheme="light"
          >
            <InternalMembershipQuery
              queryInternalMembership={queryInternalMembershipMock}
            />
          </MantineProvider>
        </MemoryRouter>,
      );
    });
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset notification spy
    vi.spyOn(notifications, "show");
  });

  it("renders the component correctly", async () => {
    await renderComponent();

    expect(screen.getByText("NetID")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Query Membership/i }),
    ).toBeInTheDocument();
  });

  it("disables query button when no NetID is provided", async () => {
    await renderComponent();
    expect(
      screen.getByRole("button", { name: /Query Membership/i }),
    ).toBeDisabled();
    expect(queryInternalMembershipMock).not.toHaveBeenCalled();
  });
  it("correctly renders members", async () => {
    await renderComponent();
    const user = userEvent.setup();
    const textbox = screen.getByRole("textbox", { name: /NetID/i });
    await user.type(textbox, "rjjones");
    await user.click(screen.getByRole("button", { name: /Query Membership/i }));
    expect(queryInternalMembershipMock).toHaveBeenCalledExactlyOnceWith(
      "rjjones",
    );
    expect(screen.getByText("is a paid member.")).toBeVisible();
  });
  it("correctly renders non-members", async () => {
    await renderComponent();
    const user = userEvent.setup();
    const textbox = screen.getByRole("textbox", { name: /NetID/i });
    await user.type(textbox, "invalid");
    await user.click(screen.getByRole("button", { name: /Query Membership/i }));
    expect(queryInternalMembershipMock).toHaveBeenCalledExactlyOnceWith(
      "invalid",
    );
    expect(screen.getByText("is not a paid member.")).toBeVisible();
  });
});
