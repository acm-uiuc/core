import React from "react";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { MantineProvider } from "@mantine/core";
import { getSemesters } from "@common/semesters";
import { useSemesterSearchParam } from "./index";

const Probe: React.FC = () => {
  const { semester } = useSemesterSearchParam();
  const location = useLocation();
  return (
    <>
      <div data-testid="semester">{semester}</div>
      <div data-testid="search">{location.search}</div>
    </>
  );
};

const renderAt = (url: string) =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <MantineProvider>
        <Probe />
      </MantineProvider>
    </MemoryRouter>,
  );

describe("useSemesterSearchParam", () => {
  const current = getSemesters()[0].value;

  it("defaults to the current semester and writes it to the URL", async () => {
    renderAt("/fundingRequests");
    expect(screen.getByTestId("semester")).toHaveTextContent(current);
    expect(await screen.findByText(`?semester=${current}`)).toBeInTheDocument();
  });

  it("uses a valid semester from the URL", () => {
    const upcoming = getSemesters()[1].value;
    renderAt(`/fundingRequests?semester=${upcoming}`);
    expect(screen.getByTestId("semester")).toHaveTextContent(upcoming);
  });

  it("ignores a semester that is not in the list", () => {
    renderAt("/fundingRequests?semester=fa99");
    expect(screen.getByTestId("semester")).toHaveTextContent(current);
  });
});
