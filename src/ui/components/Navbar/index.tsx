"use client";

import {
  Group,
  Divider,
  Box,
  Burger,
  Drawer,
  ScrollArea,
  rem,
  AppShell,
  Text,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { useNavigate } from "react-router-dom";

import { extLinks, navItems, renderNavItems } from "../AppShell/index.js";
import { useAuth } from "../AuthContext/index.js";
import { DarkModeSwitch } from "../DarkModeSwitch/index.js";
import { AuthenticatedProfileDropdown } from "../ProfileDropdown/index.js";

import LogoBadge from "./Logo.js";
import classes from "./index.module.css";
import { getCurrentRevision } from "@ui/util/revision.js";

const HeaderNavbar: React.FC = () => {
  const [drawerOpened, { toggle: toggleDrawer, close: closeDrawer }] =
    useDisclosure(false);
  const { userData } = useAuth();
  const navigate = useNavigate();
  return (
    <Box>
      <header className={classes.header}>
        <Group justify="space-between" align="center" h="100%">
          <Group justify="start" align="center" h="100%" gap={10}>
            <LogoBadge />
          </Group>
          <Group
            h="100%"
            justify="end"
            align="center"
            gap={10}
            visibleFrom="sm"
          >
            <DarkModeSwitch />
            {userData ? (
              <AuthenticatedProfileDropdown userData={userData} />
            ) : null}
          </Group>
          <Burger
            opened={drawerOpened}
            onClick={toggleDrawer}
            hiddenFrom="sm"
          />
        </Group>
      </header>

      <Drawer
        opened={drawerOpened}
        onClose={closeDrawer}
        size="100%"
        padding="md"
        title="ACM@UIUC Management Portal"
        hiddenFrom="sm"
        zIndex={1000000}
      >
        <ScrollArea h={`calc(100vh - ${rem(80)})`} mx="-md">
          {renderNavItems(navItems, "", navigate)}
          <Divider my="sm" />
          {renderNavItems(extLinks, "", navigate)}
          <Divider my="sm" />
          {userData ? (
            <AuthenticatedProfileDropdown userData={userData} />
          ) : null}
          <Box px={{ base: "md" }}>
            <Text size="xs" fw={500}>
              &copy; {new Date().getFullYear()} ACM @ UIUC
            </Text>
            <Text size="xs" fw={500}>
              Revision <code>{getCurrentRevision()}</code>
            </Text>
          </Box>
        </ScrollArea>
      </Drawer>
    </Box>
  );
};

export { HeaderNavbar };
