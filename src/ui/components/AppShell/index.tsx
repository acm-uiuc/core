import {
  AppShell,
  Divider,
  Group,
  LoadingOverlay,
  NavLink,
  Text,
  useMantineColorScheme,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import {
  IconCalendar,
  IconCoin,
  IconLink,
  IconFileDollar,
  IconPizza,
  IconTicket,
} from '@tabler/icons-react';
import { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';

import { useAuth } from '../AuthContext/index.js';
import { HeaderNavbar } from '../Navbar/index.js';
import { AuthenticatedProfileDropdown } from '../ProfileDropdown/index.js';

interface AcmAppShellProps {
  children: ReactNode;
  active?: string;
  showLoader?: boolean;
  authenticated?: boolean;
  showSidebar?: boolean;
}

export const navItems = [
  {
    link: '/events/manage',
    name: 'Events',
    icon: IconCalendar,
    description: null,
  },
  {
    link: '/tickets',
    name: 'Ticketing/Merch',
    icon: IconTicket,
    description: null,
  },
];

export const extLinks = [
  {
    link: 'https://go.acm.illinois.edu/create',
    name: 'Link Shortener',
    icon: IconLink,
    description: null,
  },
  {
    link: 'https://stripelinks.acm.illinois.edu/create',
    name: 'Stripe Link Creator',
    icon: IconCoin,
    description: null,
  },
  {
    link: 'https://go.acm.illinois.edu/reimburse',
    name: 'Funding and Reimbursement Requests',
    icon: IconFileDollar,
    description: null,
  },
  {
    link: 'https://go.acm.illinois.edu/sigpizza',
    name: 'Pizza Request Form',
    icon: IconPizza,
    description: null,
  },
];

function isSameParentPath(path1: string | undefined, path2: string | undefined) {
  if (!path1 || !path2) {
    return false;
  }
  const splitPath1 = path1.split('/');
  const splitPath2 = path2.split('/');

  // Ensure both paths are long enough to have a parent path
  if (splitPath1.length < 2 || splitPath2.length < 2) {
    return false;
  }

  // Remove the last element (assumed to be the file or final directory)
  const parentPath1 = splitPath1.slice(0, -1).join('/');
  const parentPath2 = splitPath2.slice(0, -1).join('/');
  return parentPath1 === parentPath2 && parentPath1 !== '/app';
}

export const renderNavItems = (
  items: Record<string, any>[],
  active: string | undefined,
  navigate: CallableFunction
) =>
  items.map((item) => (
    <NavLink
      style={{ borderRadius: 5 }}
      h={48}
      mt="sm"
      onClick={() => {
        if (item.link.includes('://')) {
          window.location.href = item.link;
        } else {
          navigate(item.link);
        }
      }}
      key={item.link}
      label={
        <Text size="sm" fw={500}>
          {item.name}
        </Text>
      }
      active={active === item.link || isSameParentPath(active, item.link)}
      description={item.description || null}
      leftSection={<item.icon />}
    >
      {item.children ? renderNavItems(item.children, active, navigate) : null}
    </NavLink>
  ));

type SidebarNavItemsProps = {
  items: Record<string, any>[];
  visible: boolean;
  active?: string;
};
const SidebarNavItems: React.FC<SidebarNavItemsProps> = ({ items, visible, active }) => {
  const navigate = useNavigate();
  if (!visible) {
    return null;
  }
  return renderNavItems(items, active, navigate);
};

const AcmAppShell: React.FC<AcmAppShellProps> = ({
  children,
  active,
  showLoader,
  authenticated,
  showSidebar,
}) => {
  const { colorScheme } = useMantineColorScheme();
  if (authenticated === undefined) {
    authenticated = true;
  }
  if (showSidebar === undefined) {
    showSidebar = true;
  }
  const [opened, { toggle }] = useDisclosure();
  const { userData } = useAuth();
  return (
    <AppShell
      padding="md"
      header={{ height: 60 }}
      navbar={{
        width: 200,
        breakpoint: 'sm',
        collapsed: { mobile: !opened },
      }}
    >
      <AppShell.Header>
        <HeaderNavbar />
      </AppShell.Header>
      <AppShell.Navbar p="sm">
        <SidebarNavItems items={navItems} visible={showSidebar} active={active} />
        <br />
        <Divider label="Other Services" />
        <SidebarNavItems items={extLinks} visible={showSidebar} active={active} />
        <Group hiddenFrom="sm">
          <Divider />
          <AuthenticatedProfileDropdown userData={userData || {}} />
        </Group>
      </AppShell.Navbar>
      <AppShell.Main>
        {showLoader ? (
          <LoadingOverlay
            visible={showLoader}
            loaderProps={{ color: colorScheme === 'dark' ? 'white' : 'black' }}
          />
        ) : (
          children
        )}
      </AppShell.Main>
    </AppShell>
  );
};

export { AcmAppShell, SidebarNavItems };
