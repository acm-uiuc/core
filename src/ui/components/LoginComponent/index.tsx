import {
  Text,
  Paper,
  Group,
  PaperProps,
  Divider,
  Center,
  Alert,
  Anchor,
  Title,
} from "@mantine/core";
import { IconLock } from "@tabler/icons-react";
import { useSearchParams } from "react-router-dom";

import { AcmLoginButton } from "./AcmLoginButton.js";

import brandImgUrl from "@ui/banner-blue.png";

export function LoginComponent(props: PaperProps) {
  const [searchParams] = useSearchParams();
  const returnTo = searchParams.get("returnTo") || undefined;

  return (
    <Paper radius="md" p="xl" withBorder {...props}>
      <Center>
        <img
          src={brandImgUrl}
          alt="ACM Logo"
          style={{ height: "5em", marginBottom: "1em" }}
        />
      </Center>

      <Center>
        <Text size="lg" fw={500}>
          Welcome to the ACM@UIUC Management Portal
        </Text>
      </Center>

      <Alert
        title={
          <Title order={5} style={{ color: "var(--illinois-blue)" }}>
            Authorized Users Only
          </Title>
        }
        icon={<IconLock style={{ color: "var(--illinois-blue)" }} />}
        color="var(--illinois-blue)"
        style={{ backgroundColor: "rgba(0, 83, 179, 0.1)" }}
      >
        <Text size="sm">
          Unauthorized or improper use or access of this system may result in
          disciplinary action, as well as civil and criminal penalties.
        </Text>
      </Alert>

      <Group grow mb="md" mt="md">
        <AcmLoginButton radius="xl" returnTo={returnTo || "/"}>
          Sign in with Illinois NetID
        </AcmLoginButton>
      </Group>
    </Paper>
  );
}
