import React from "react";
import { render, screen, act, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { MantineProvider } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { ManageOrgLinkPage } from "./ManageOrgLink.page";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const mockNavigate = vi.fn();
const mockGet = vi.fn();
const mockPost = vi.fn();

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock("@ui/util/api", () => ({
  useApi: () => ({
    get: mockGet,
    post: mockPost,
  }),
}));

vi.mock("@ui/components/AuthGuard", () => ({
  AuthGuard: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  getUserRoles: vi.fn().mockResolvedValue([]),
  getCoreOrgRoles: vi.fn().mockResolvedValue([]),
}));

vi.mock("@mantine/notifications", () => ({
  notifications: {
    show: vi.fn(),
  },
}));

describe("ManageOrgLinkPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const renderComponent = async (
    route: string,
    path: string = "/linkry/org/add",
  ) => {
    await act(async () => {
      render(
        <MemoryRouter initialEntries={[route]}>
          <MantineProvider
            withGlobalClasses
            withCssVariables
            forceColorScheme="light"
          >
            <Routes>
              <Route path={path} element={<ManageOrgLinkPage />} />
            </Routes>
          </MantineProvider>
        </MemoryRouter>,
      );
    });
  };

  it("redirects to /linkry if no org is specified", async () => {
    await renderComponent("/linkry/org/add");

    expect(mockNavigate).toHaveBeenCalledWith("/linkry");
    expect(notifications.show).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "No organization specified.",
        color: "red",
      }),
    );
  });

  it("renders the form with correct org name in title", async () => {
    await renderComponent("/linkry/org/add?org=C01");

    expect(
      screen.getByText((content) => content.includes("Add")),
    ).toBeInTheDocument();
    expect(
      screen.getByText((content) =>
        content.includes("Infrastructure Committee"),
      ),
    ).toBeInTheDocument();
  });

  it("displays the org shortcode in the short URL prefix", async () => {
    await renderComponent("/linkry/org/add?org=C01");

    expect(
      screen.getByText((content) => content.includes("infra.")),
    ).toBeInTheDocument();
  });

  it("renders form fields for creating a new org link", async () => {
    await renderComponent("/linkry/org/add?org=C01");

    expect(screen.getByText("Short URL")).toBeInTheDocument();
    expect(screen.getByText("URL to shorten")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Random" })).toBeInTheDocument();
  });

  it("has save button disabled until a field is edited", async () => {
    await renderComponent("/linkry/org/add?org=C01");

    const saveButton = screen.getByRole("button", { name: "Save" });
    expect(saveButton).toBeDisabled();
  });

  it("enables save button after typing in slug field", async () => {
    const user = userEvent.setup();
    await renderComponent("/linkry/org/add?org=C01");

    const slugInput = screen.getByRole("textbox", { name: /short url/i });
    await user.type(slugInput, "my-link");

    const saveButton = screen.getByRole("button", { name: "Save" });
    expect(saveButton).toBeEnabled();
  });

  it("generates a random slug when Random button is clicked", async () => {
    const user = userEvent.setup();
    await renderComponent("/linkry/org/add?org=C01");

    const slugInput = screen.getByRole("textbox", { name: /short url/i });
    expect(slugInput).toHaveValue("");

    await user.click(screen.getByRole("button", { name: "Random" }));

    expect(slugInput).not.toHaveValue("");
    expect((slugInput as HTMLInputElement).value).toHaveLength(6);
  });

  it("submits the form and navigates on success", async () => {
    mockPost.mockResolvedValue({});
    const user = userEvent.setup();
    await renderComponent("/linkry/org/add?org=C01");

    const slugInput = screen.getByRole("textbox", { name: /short url/i });
    const redirectInput = screen.getByRole("textbox", {
      name: /url to shorten/i,
    });

    await user.type(slugInput, "test-slug");
    await user.type(redirectInput, "https://example.com");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith("/api/v1/linkry/orgs/C01/redir", {
        slug: "test-slug",
        redirect: "https://example.com",
      });
    });

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith("/linkry?org=C01");
    });

    expect(notifications.show).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Org link created!",
      }),
    );
  });

  it("shows error notification on submit failure", async () => {
    mockPost.mockRejectedValue({
      response: { data: { message: "Slug already exists" } },
    });
    const user = userEvent.setup();
    await renderComponent("/linkry/org/add?org=C01");

    const slugInput = screen.getByRole("textbox", { name: /short url/i });
    const redirectInput = screen.getByRole("textbox", {
      name: /url to shorten/i,
    });

    await user.type(slugInput, "test-slug");
    await user.type(redirectInput, "https://example.com");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(notifications.show).toHaveBeenCalledWith(
        expect.objectContaining({
          color: "red",
          title: "Failed to create org link",
          message: "Slug already exists",
        }),
      );
    });
  });

  it("loads existing link data in edit mode", async () => {
    mockGet.mockResolvedValue({
      data: [
        {
          slug: "C01#existing-slug",
          redirect: "https://existing.com",
        },
      ],
    });

    await renderComponent(
      "/linkry/org/edit/existing-slug?org=C01",
      "/linkry/org/edit/:slug",
    );

    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledWith("/api/v1/linkry/orgs/C01/redir");
    });

    await waitFor(() => {
      const slugInput = screen.getByRole("textbox", { name: /short url/i });
      expect(slugInput).toHaveValue("existing-slug");
      expect(slugInput).toBeDisabled();
    });

    const redirectInput = screen.getByRole("textbox", {
      name: /url to shorten/i,
    });
    expect(redirectInput).toHaveValue("https://existing.com");
  });

  it("shows Edit in title when in edit mode", async () => {
    mockGet.mockResolvedValue({
      data: [
        {
          slug: "C01#my-slug",
          redirect: "https://example.com",
        },
      ],
    });

    await renderComponent(
      "/linkry/org/edit/my-slug?org=C01",
      "/linkry/org/edit/:slug",
    );

    await waitFor(() => {
      expect(
        screen.getByText((content) => content.includes("Edit")),
      ).toBeInTheDocument();
    });
  });

  it("hides Random button in edit mode", async () => {
    mockGet.mockResolvedValue({
      data: [
        {
          slug: "C01#my-slug",
          redirect: "https://example.com",
        },
      ],
    });

    await renderComponent(
      "/linkry/org/edit/my-slug?org=C01",
      "/linkry/org/edit/:slug",
    );

    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: "Random" }),
      ).not.toBeInTheDocument();
    });
  });

  it("redirects if link not found in edit mode", async () => {
    mockGet.mockResolvedValue({
      data: [
        {
          slug: "C01#other-slug",
          redirect: "https://other.com",
        },
      ],
    });

    await renderComponent(
      "/linkry/org/edit/missing-slug?org=C01",
      "/linkry/org/edit/:slug",
    );

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith("/linkry?org=C01");
    });

    expect(notifications.show).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Link not found.",
        color: "red",
      }),
    );
  });

  it("displays correct shortcode for different orgs", async () => {
    await renderComponent("/linkry/org/add?org=S01");

    expect(
      screen.getByText((content) => content.includes("sigpwny.")),
    ).toBeInTheDocument();
    expect(
      screen.getByText((content) => content.includes("SIGPwny")),
    ).toBeInTheDocument();
  });
});
