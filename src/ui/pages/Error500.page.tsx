import { Container, Title, Text, Anchor } from "@mantine/core";
import React from "react";

import { HeaderNavbar } from "@ui/components/Navbar";

export const Error500Page: React.FC = () => (
  <>
    <HeaderNavbar />
    <Container>
      <Title>An Error Occurred</Title>
      <Text>
        Perhaps you would like to <Anchor href="/">go home</Anchor>?
      </Text>
    </Container>
  </>
);
