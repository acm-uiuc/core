import { createTheme, CSSVariablesResolver } from "@mantine/core";

export const theme = createTheme({
  defaultRadius: "sm",
});

export const cssVariablesResolver: CSSVariablesResolver = () => ({
  variables: {
    "--illinois-blue": "#0053B3",
  },
  light: {},
  dark: {},
});
