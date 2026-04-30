import "@mantine/core/styles.css";
import "@mantine/dropzone/styles.css";
import "@mantine/notifications/styles.css";
import "@mantine/dates/styles.css";
import { Button, Group, MantineProvider, Text } from "@mantine/core";
import { cssVariablesResolver, theme } from "./theme";
import { useColorScheme, useLocalStorage } from "@mantine/hooks";
import { Notifications, notifications } from "@mantine/notifications";
import { useEffect } from "react";

import ColorSchemeContext from "./ColorSchemeContext";
import { Router } from "./Router";
import { UserResolverProvider } from "./components/NameOptionalCard";
import { forceRefresh, startVersionPolling } from "./versionCheck";

export default function App() {
  const preferredColorScheme = useColorScheme();
  const [colorScheme, setColorScheme] = useLocalStorage({
    key: "acm-manage-color-scheme",
    defaultValue: preferredColorScheme,
  });

  useEffect(() => {
    startVersionPolling(() => {
      notifications.show({
        id: "version-update",
        title: "Update available",
        message: (
          <Group gap="xs" mt={4}>
            <Text size="sm">A new version of the app is available.</Text>
            <Button size="xs" variant="light" onClick={forceRefresh}>
              Refresh to update
            </Button>
          </Group>
        ),
        color: "blue",
        autoClose: false,
      });
    });
  }, []);

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
