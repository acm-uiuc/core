import React from "react";

import { AcmAppShell } from "@ui/components/AppShell";
import { Title, Text } from "@mantine/core";
import { useAuth } from "@ui/components/AuthContext";

export const HomePage: React.FC = () => {
  const { userData } = useAuth();
  return (
    <>
      <AcmAppShell showSidebar>
        <Title order={1}>Welcome, {userData?.name?.split(" ")[0]}!</Title>
        <Text>
          Navigate the ACM @ UIUC Management Portal using the links in the menu
          bar.
        </Text>
      </AcmAppShell>
    </>
  );
};
