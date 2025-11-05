import React from "react";
import { useRouteError } from "react-router-dom";
import { Container, Title, Text, Card, Accordion } from "@mantine/core";
import { AcmAppShell } from "@ui/components/AppShell";

export const ErrorPage: React.FC = () => {
  const error = useRouteError() as Error;

  return (
    <AcmAppShell>
      <Container>
        <Card shadow="sm" p="lg" radius="md" withBorder>
          <Title order={2}>Oops! Something went wrong.</Title>
          <Text size="lg" c="dimmed" mt="md">
            We're sorry, but an unexpected error has occurred. Please contact
            support if this error persists.
          </Text>

          <Accordion mt="md">
            <Accordion.Item value="error-details">
              <Accordion.Control>Error Details</Accordion.Control>
              <Accordion.Panel>
                <Card withBorder p="md" mt="md">
                  <Text c="red">
                    <pre>{error.stack || error.message}</pre>
                  </Text>
                </Card>
              </Accordion.Panel>
            </Accordion.Item>
          </Accordion>
        </Card>
      </Container>
    </AcmAppShell>
  );
};
