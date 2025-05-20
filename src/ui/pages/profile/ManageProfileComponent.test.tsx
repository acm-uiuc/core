import React from "react";
import { render, screen, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { MantineProvider } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { ManageProfileComponent } from "./ManageProfileComponent";

describe("ManageProfileComponent tests", () => {
  const renderComponent = async (
    getProfile: () => Promise<any>,
    setProfile: (data: any) => Promise<any>,
    firstTime: boolean = false,
  ) => {
    await act(async () => {
      render(
        <MemoryRouter>
          <MantineProvider
            withGlobalClasses
            withCssVariables
            forceColorScheme="light"
          >
            <ManageProfileComponent
              getProfile={getProfile}
              setProfile={setProfile}
              firstTime={firstTime}
            />
          </MantineProvider>
        </MemoryRouter>,
      );
    });
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders loading overlay when fetching profile", async () => {
    const getProfile = vi.fn().mockResolvedValue(new Promise(() => {})); // Never resolves
    const setProfile = vi.fn();

    await renderComponent(getProfile, setProfile);

    expect(screen.getByTestId("profile-loading")).toBeInTheDocument();
  });

  it("renders profile form after successfully fetching profile", async () => {
    const getProfile = vi.fn().mockResolvedValue({
      displayName: "John Doe",
      givenName: "John",
      surname: "Doe",
      mail: "john.doe@example.com",
    });
    const setProfile = vi.fn();

    await renderComponent(getProfile, setProfile);

    expect(screen.getByTestId("edit-displayName")).toHaveValue("John Doe");
    expect(screen.getByTestId("edit-firstName")).toHaveValue("John");
    expect(screen.getByTestId("edit-lastName")).toHaveValue("Doe");
    expect(screen.getByTestId("edit-email")).toHaveValue(
      "john.doe@example.com",
    );
  });

  it("handles profile fetch failure gracefully", async () => {
    const notificationsMock = vi.spyOn(notifications, "show");
    const getProfile = vi
      .fn()
      .mockRejectedValue(new Error("Failed to fetch profile"));
    const setProfile = vi.fn();

    await renderComponent(getProfile, setProfile);

    expect(notificationsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Failed to load user profile",
        color: "red",
      }),
    );

    notificationsMock.mockRestore();
  });

  it("allows editing profile fields and saving changes", async () => {
    const notificationsMock = vi.spyOn(notifications, "show");
    const getProfile = vi.fn().mockResolvedValue({
      displayName: "John Doe",
      givenName: "John",
      surname: "Doe",
      mail: "john.doe@example.com",
    });
    const setProfile = vi.fn().mockResolvedValue({});

    await renderComponent(getProfile, setProfile);

    const user = userEvent.setup();

    // Edit fields
    await user.clear(screen.getByTestId("edit-displayName"));
    await user.type(screen.getByTestId("edit-displayName"), "Jane Doe");

    // Save changes
    const saveButton = screen.getByRole("button", { name: "Save" });
    await user.click(saveButton);

    expect(setProfile).toHaveBeenCalledWith({
      displayName: "Jane Doe",
      givenName: "John",
      surname: "Doe",
      mail: "john.doe@example.com",
    });

    expect(notificationsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Profile updated successfully",
        message: "Changes may take some time to reflect.",
        color: "green",
      }),
    );

    notificationsMock.mockRestore();
  });

  it("shows first-time user alert when `firstTime` is true", async () => {
    const getProfile = vi.fn().mockResolvedValue({
      displayName: "",
      givenName: "",
      surname: "",
      mail: "new.user@example.com",
    });
    const setProfile = vi.fn();

    await renderComponent(getProfile, setProfile, true);

    expect(
      screen.getByText(
        "Your profile is incomplete. Please provide us with the information below and click Save.",
      ),
    ).toBeInTheDocument();
  });

  it("handles profile update failure gracefully", async () => {
    const notificationsMock = vi.spyOn(notifications, "show");
    const getProfile = vi.fn().mockResolvedValue({
      displayName: "John Doe",
      givenName: "John",
      surname: "Doe",
      mail: "john.doe@example.com",
    });
    const setProfile = vi
      .fn()
      .mockRejectedValue(new Error("Failed to update profile"));

    await renderComponent(getProfile, setProfile);

    const user = userEvent.setup();

    // Attempt to save without any changes
    const saveButton = screen.getByRole("button", { name: "Save" });
    await user.click(saveButton);

    expect(notificationsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Failed to update profile",
        color: "red",
      }),
    );

    notificationsMock.mockRestore();
  });

  it("disables the save button when no profile data is loaded", async () => {
    const getProfile = vi.fn().mockResolvedValue(null);
    const setProfile = vi.fn();

    await renderComponent(getProfile, setProfile);

    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });
});
