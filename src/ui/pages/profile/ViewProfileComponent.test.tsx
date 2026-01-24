import React from "react";
import { render, screen, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { MantineProvider } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { vi } from "vitest";
import { ViewProfileComponent } from "./ViewProfileComponent";

describe("ViewProfileComponent tests", () => {
  const renderComponent = async (
    getProfile: () => Promise<any>,
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
            <ViewProfileComponent
              getProfile={getProfile}
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

  it("renders profile information after successfully fetching profile", async () => {
    const getProfile = vi.fn().mockResolvedValue({
      displayName: "John Doe",
      givenName: "John",
      surname: "Doe",
      mail: "john.doe@example.com",
    });
    await renderComponent(getProfile);

    expect(screen.getByTestId("profile-first-name")).toHaveTextContent("John");
    expect(screen.getByTestId("profile-last-name")).toHaveTextContent("Doe");
    expect(screen.getByTestId("profile-email")).toHaveTextContent(
      "john.doe@example.com",
    );
  });

  it("renders welcome alert when firstTime is true", async () => {
    const getProfile = vi.fn().mockResolvedValue({
      givenName: "John",
      surname: "Doe",
      mail: "john.doe@example.com",
    });
    await renderComponent(getProfile, true);

    expect(
      screen.getByText("Welcome to the ACM @ UIUC Management Portal"),
    ).toBeInTheDocument();
  });

  it("does not render welcome alert when firstTime is false", async () => {
    const getProfile = vi.fn().mockResolvedValue({
      givenName: "John",
      surname: "Doe",
      mail: "john.doe@example.com",
    });
    await renderComponent(getProfile, false);

    expect(
      screen.queryByText("Welcome to the ACM @ UIUC Management Portal"),
    ).not.toBeInTheDocument();
  });

  it("handles profile fetch failure gracefully", async () => {
    const notificationsMock = vi.spyOn(notifications, "show");
    const getProfile = vi
      .fn()
      .mockRejectedValue(new Error("Failed to fetch profile"));
    await renderComponent(getProfile);

    expect(notificationsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Failed to load user profile",
        color: "red",
      }),
    );
    notificationsMock.mockRestore();
  });

  it("displays placeholder when profile fields are empty", async () => {
    const getProfile = vi.fn().mockResolvedValue({
      givenName: null,
      surname: null,
      mail: null,
    });
    await renderComponent(getProfile);

    expect(screen.getByTestId("profile-first-name")).toHaveTextContent("—");
    expect(screen.getByTestId("profile-last-name")).toHaveTextContent("—");
    expect(screen.getByTestId("profile-email")).toHaveTextContent("—");
  });
});
