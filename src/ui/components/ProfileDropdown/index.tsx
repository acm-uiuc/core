import {
  Popover,
  Box,
  Center,
  Group,
  ThemeIcon,
  Text,
  SimpleGrid,
  UnstyledButton,
  Divider,
  Button,
  rem,
  useMantineTheme,
  Avatar,
} from '@mantine/core';
import { IconChevronDown, IconUser, IconMail } from '@tabler/icons-react';
import { useState } from 'react';

import { AuthContextData, useAuth } from '../AuthContext/index.js';
import classes from '../Navbar/index.module.css';
import { useNavigate } from 'react-router-dom';

interface ProfileDropdownProps {
  userData?: AuthContextData;
}

const AuthenticatedProfileDropdown: React.FC<ProfileDropdownProps> = ({ userData }) => {
  const [opened, setOpened] = useState(false);
  const theme = useMantineTheme();
  const navigate = useNavigate();
  const { logout } = useAuth();
  if (!userData) {
    return null;
  }
  return (
    <Popover
      width={300}
      position="bottom"
      radius="md"
      shadow="md"
      withinPortal
      opened={opened}
      onClose={() => setOpened(false)}
      zIndex={1000010}
    >
      <Popover.Target>
        <a
          href="#"
          className={classes.link}
          onClick={(event) => {
            event.preventDefault();
            setOpened((o) => !o);
          }}
        >
          <Center inline>
            <Box component="span" mr={5}>
              <Group visibleFrom="sm">
                <Avatar name={userData.name} color="initials"></Avatar>
              </Group>
              <Group hiddenFrom="sm">
                <Text size="sm" fw={500}>
                  My Account
                </Text>
              </Group>
            </Box>
            <IconChevronDown
              style={{ width: rem(16), height: rem(16) }}
              color={theme.colors.blue[6]}
            />
          </Center>
        </a>
      </Popover.Target>

      <Popover.Dropdown
        style={{ overflow: 'hidden' }}
        aria-label="Authenticated My Account Dropdown"
      >
        <SimpleGrid cols={1} spacing={0}>
          <UnstyledButton className={classes.subLink} key="name">
            <Group wrap="nowrap" align="flex-start">
              <ThemeIcon size={40} variant="default" radius="md">
                <IconUser
                  style={{ width: rem(22), height: rem(22) }}
                  color={theme.colors.blue[6]}
                />
              </ThemeIcon>
              <div>
                <Text size="xs" c="dimmed">
                  Name
                </Text>
                <Text size="sm" fw={500}>
                  {userData.name}
                </Text>
              </div>
            </Group>
          </UnstyledButton>
          <UnstyledButton className={classes.subLink} key="email">
            <Group wrap="nowrap" align="flex-start">
              <ThemeIcon size={40} variant="default" radius="md">
                <IconMail
                  style={{ width: rem(22), height: rem(22) }}
                  color={theme.colors.blue[6]}
                />
              </ThemeIcon>
              <div>
                <Text size="xs" c="dimmed">
                  Email
                </Text>
                <Text size="sm" fw={500}>
                  {userData.email}
                </Text>
              </div>
            </Group>
          </UnstyledButton>
          <Divider my="sm" />
          <Button
            variant="primary"
            mb="sm"
            fullWidth
            onClick={() => {
              navigate('/profile');
            }}
          >
            Edit Profile
          </Button>
          <Button
            variant="outline"
            fullWidth
            onClick={async () => {
              await logout();
            }}
          >
            Log Out
          </Button>
        </SimpleGrid>
      </Popover.Dropdown>
    </Popover>
  );
};

export { AuthenticatedProfileDropdown };
