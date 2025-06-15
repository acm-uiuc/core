import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { MantineProvider } from "@mantine/core";
import { LoginComponent } from "@ui/components/LoginComponent";

const renderWithProviders = () => {
  return render(
    <MemoryRouter>
      <MantineProvider
        withGlobalClasses
        withCssVariables
        forceColorScheme="light"
      >
        <LoginComponent />
      </MantineProvider>
    </MemoryRouter>,
  );
};

describe("LoginComponent tests", () => {
  it("renders the login component and verifies the logo and text", () => {
    renderWithProviders();
    const logo = screen.getByAltText("ACM Logo");
    expect(logo).toBeInTheDocument();

    const portalText = screen.getByText(
      "Welcome to the ACM@UIUC Management Portal",
    );
    expect(portalText).toBeInTheDocument();
  });

  it('verifies the "Authorized Users Only" section', () => {
    renderWithProviders();
    const authText = screen.getByRole("heading", {
      name: "Authorized Users Only",
    });
    expect(authText).toBeInTheDocument();

    const explanationText = screen.getByText(
      "Unauthorized or improper use or access of this system may result in disciplinary action, as well as civil and criminal penalties.",
    );
    expect(explanationText).toBeInTheDocument();
  });

  it('verifies the "Sign in with Illinois NetID" button', () => {
    renderWithProviders();
    const signInButton = screen.getByText("Sign in with Illinois NetID");
    expect(signInButton).toBeInTheDocument();
  });
});
