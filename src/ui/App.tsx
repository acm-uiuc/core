import "@mantine/core/styles.css";
import "@mantine/dropzone/styles.css";
import "@mantine/notifications/styles.css";
import "@mantine/dates/styles.css";
import { MantineProvider } from "@mantine/core";
import { cssVariablesResolver, theme } from "./theme";
import { useColorScheme, useLocalStorage } from "@mantine/hooks";
import { Notifications } from "@mantine/notifications";

import ColorSchemeContext from "./ColorSchemeContext";
import { Router } from "./Router";
import { UserResolverProvider } from "./components/NameOptionalCard";

export default function App() {
  const preferredColorScheme = useColorScheme();
  const [colorScheme, setColorScheme] = useLocalStorage({
    key: "acm-manage-color-scheme",
    defaultValue: preferredColorScheme,
  });
  return (
    <ColorSchemeContext.Provider
      value={{ colorScheme, onChange: setColorScheme }}
    >
      <MantineProvider
        withGlobalClasses
        withCssVariables
        forceColorScheme={colorScheme}
        theme={theme}
        cssVariablesResolver={cssVariablesResolver}
      >
        <Notifications position="top-right" />
        <UserResolverProvider>
          <Router />
        </UserResolverProvider>
      </MantineProvider>
    </ColorSchemeContext.Provider>
  );
}
