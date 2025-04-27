import { render, screen } from "@testing-library/react";
import App from "./App";

describe("App", () => {
  it("renders the App component and verifies the logo and text", () => {
    render(<App />);

    // Verify there are two instances of the logo
    const logos = screen.getAllByAltText(/ACM Logo/i); // Assuming the alt text for the logo is "ACM Logo"
    expect(logos).toHaveLength(2);

    // Verify the text "ACM@UIUC Management Portal" is present
    const portalText = screen.getByText(/ACM@UIUC Management Portal/i);
    expect(portalText).toBeInTheDocument();
  });

  it('verifies the "Authorized Users Only" section', () => {
    render(<App />);

    // Verify the "Authorized Users Only" text is present
    const authText = screen.getByText(/Authorized Users Only/i);
    expect(authText).toBeInTheDocument();

    // Verify the explanation text is present
    const explanationText = screen.getByText(
      /Unauthorized or improper use or access/i,
    );
    expect(explanationText).toBeInTheDocument();
  });

  it('verifies the "Sign in with Illinois NetID" button', () => {
    render(<App />);

    // Verify the button is present
    const signInButton = screen.getByRole("button", {
      name: /Sign in with Illinois NetID/i,
    });
    expect(signInButton).toBeInTheDocument();
  });

  it("verifies the theme toggle is present", () => {
    render(<App />);

    // Verify the theme toggle is present
    const themeToggle = screen.getByRole("switch"); // Assuming it uses a switch role
    expect(themeToggle).toBeInTheDocument();
  });
});
