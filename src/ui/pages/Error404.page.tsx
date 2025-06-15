import { Container, Title, Text, Anchor } from "@mantine/core";
import React from "react";
import { AcmAppShell } from "@ui/components/AppShell";

export const Error404Page: React.FC = () => {
  return (
    <AcmAppShell showSidebar={false}>
      <Container>
        <Title>Page Not Found</Title>
        <Text>
          Perhaps you would like to <Anchor href="/">go home</Anchor>?
        </Text>
      </Container>
    </AcmAppShell>
  );
};
