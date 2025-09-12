import React from "react";
import { render, screen, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { vi } from "vitest";
import GroupMemberManagement from "./GroupMemberManagement";
import { MantineProvider } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import userEvent from "@testing-library/user-event";

describe("Exec Group Management Panel tests", () => {
  const renderComponent = async (
    fetchMembers: () => Promise<any[]>,
    updateMembers: () => Promise<any>,
  ) => {
    await act(async () => {
      render(
        <MemoryRouter>
          <MantineProvider
            withGlobalClasses
            withCssVariables
            forceColorScheme="light"
          >
            <GroupMemberManagement
              fetchMembers={fetchMembers}
              updateMembers={updateMembers}
            />
          </MantineProvider>
        </MemoryRouter>,
      );
    });
  };

  beforeEach(() => {
    vi.resetModules();
  });

  it("renders with no members", async () => {
    const fetchMembers = async () => [];
    const updateMembers = async () => ({ success: [] });
    await renderComponent(fetchMembers, updateMembers);
    expect(screen.queryByText(/.*@.*/)).not.toBeInTheDocument();
  });

  it("renders with a single member", async () => {
    const fetchMembers = async () => [
      { name: "Doe, John", email: "jdoe@illinois.edu" },
    ];
    const updateMembers = async () => ({
      success: [{ email: "jdoe@illinois.edu" }],
    });

    await renderComponent(fetchMembers, updateMembers);
    expect(
      screen.getByText(
        (content, element) =>
          element?.textContent === "Doe, Johnjdoe@illinois.edu",
      ),
    ).toBeInTheDocument();
  });

  it("renders with multiple members", async () => {
    const fetchMembers = async () => [
      { name: "Doe, John", email: "jdoe@illinois.edu" },
      { name: "Smith, Jane", email: "jsmith@illinois.edu" },
      { name: "Brown, Bob", email: "bbrown@illinois.edu" },
    ];
    const updateMembers = async () => ({
      success: [
        { email: "jdoe@illinois.edu" },
        { email: "jsmith@illinois.edu" },
        { email: "bbrown@illinois.edu" },
      ],
    });

    await renderComponent(fetchMembers, updateMembers);

    expect(
      screen.getByText(
        (content, element) =>
          element?.textContent === "Doe, Johnjdoe@illinois.edu",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        (content, element) =>
          element?.textContent === "Smith, Janejsmith@illinois.edu",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        (content, element) =>
          element?.textContent === "Brown, Bobbbrown@illinois.edu",
      ),
    ).toBeInTheDocument();
  });

  it("adds a new member and saves changes", async () => {
    const notificationsMock = vi.spyOn(notifications, "show");
    const user = userEvent.setup();
    const fetchMembers = async () => [];
    const updateMembers = vi.fn().mockResolvedValue({
      success: [{ email: "member@illinois.edu" }],
      failure: [],
    });

    await renderComponent(fetchMembers, updateMembers);

    // Input the email
    const emailInput = screen.getByPlaceholderText("Enter email to add");
    await user.type(emailInput, "member@illinois.edu");

    // Click Add Member button
    const addButton = screen.getByRole("button", { name: "Add Member" });
    await user.click(addButton);

    // Match the queued member
    expect(screen.getByText("member")).toBeInTheDocument();
    expect(screen.getByText("member@illinois.edu")).toBeInTheDocument();

    // Save Changes
    const saveButton = screen.getByRole("button", { name: "Save Changes" });
    expect(saveButton).toBeEnabled();
    await user.click(saveButton);

    await screen.findByText("Confirm Changes");
    const confirmButton = screen.getByRole("button", {
      name: "Confirm and Save",
    });
    await user.click(confirmButton);

    expect(updateMembers).toHaveBeenCalledWith(["member@illinois.edu"], []);
    notificationsMock.mockRestore();
  });

  it("removes an existing member and saves changes", async () => {
    const notificationsMock = vi.spyOn(notifications, "show");
    const user = userEvent.setup();
    const fetchMembers = async () => [
      { name: "Existing Member", email: "existing@illinois.edu" },
    ];
    const updateMembers = vi.fn().mockResolvedValue({
      success: [{ email: "existing@illinois.edu" }],
      failure: [],
    });

    await renderComponent(fetchMembers, updateMembers);

    // Click remove button for the existing member
    const removeButton = screen.getByRole("button", { name: /Remove/ });
    await user.click(removeButton);

    // Verify member shows removal badge
    expect(screen.getByText("Queued for removal")).toBeInTheDocument();

    // Save changes
    const saveButton = screen.getByRole("button", { name: "Save Changes" });
    expect(saveButton).toBeEnabled();
    await user.click(saveButton);

    await screen.findByText("Confirm Changes");
    const confirmButton = screen.getByRole("button", {
      name: "Confirm and Save",
    });
    await user.click(confirmButton);

    // Verify updateMembers was called with correct parameters
    expect(updateMembers).toHaveBeenCalledWith([], ["existing@illinois.edu"]);

    // Verify member is removed from the list
    expect(
      screen.queryByText(/Existing Member \(existing@illinois\.edu\)/),
    ).not.toBeInTheDocument();

    // Verify success notification
    expect(notificationsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "All changes processed successfully!",
        color: "green",
      }),
    );

    notificationsMock.mockRestore();
  });

  it("handles failed member updates correctly", async () => {
    const notificationsMock = vi.spyOn(notifications, "show");
    const user = userEvent.setup();
    const fetchMembers = async () => [];
    const updateMembers = vi.fn().mockResolvedValue({
      success: [],
      failure: [
        {
          email: "member@illinois.edu",
          message: "User does not exist in directory",
        },
      ],
    });

    await renderComponent(fetchMembers, updateMembers);

    // Add a member that will fail
    const emailInput = screen.getByPlaceholderText("Enter email to add");
    await user.type(emailInput, "member@illinois.edu");
    await user.click(screen.getByRole("button", { name: "Add Member" }));

    // Verify member shows in queue
    expect(screen.getByText("member@illinois.edu")).toBeInTheDocument();
    expect(screen.getByText("Queued for addition")).toBeInTheDocument();

    // Try to save changes
    await user.click(screen.getByRole("button", { name: "Save Changes" }));
    await screen.findByText("Confirm Changes");
    await user.click(screen.getByRole("button", { name: "Confirm and Save" }));

    expect(notificationsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Error with member@illinois.edu",
        message: "User does not exist in directory",
        color: "red",
      }),
    );

    // Verify member is no longer shown as queued
    expect(screen.queryByText("Queued for addition")).not.toBeInTheDocument();

    // Verify Save Changes button is disabled
    expect(screen.getByRole("button", { name: "Save Changes" })).toBeDisabled();

    notificationsMock.mockRestore();
  });
});
