import {
  Anchor,
  AppShell,
  Divider,
  Group,
  LoadingOverlay,
  NavLink,
  Skeleton,
  Text,
  useMantineColorScheme,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import {
  IconCalendar,
  IconCoin,
  IconLink,
  IconFileDollar,
  IconPizza,
  IconTicket,
  IconLock,
  IconDoor,
  IconHistory,
  IconKey,
  IconUsers,
  IconExternalLink,
} from "@tabler/icons-react";
import { ReactNode } from "react";
import { useNavigate } from "react-router-dom";

import { useAuth } from "../AuthContext/index.js";
import { HeaderNavbar } from "../Navbar/index.js";
import { AuthenticatedProfileDropdown } from "../ProfileDropdown/index.js";
import { getCurrentRevision } from "@ui/util/revision.js";
import { AppRoles } from "@common/roles.js";
import { AuthGuard } from "../AuthGuard/index.js";

export interface AcmAppShellProps {
  children: ReactNode;
  active?: string;
  showLoader?: boolean;
  authenticated?: boolean;
  showSidebar?: boolean;
}

export const navItems = [
  {
    link: "/events/manage",
    name: "Events",
    icon: IconCalendar,
    description: null,
    validRoles: [AppRoles.EVENTS_MANAGER],
  },
  {
    link: "/tickets",
    name: "Ticketing/Merch",
    icon: IconTicket,
    description: null,
    validRoles: [AppRoles.TICKETS_MANAGER, AppRoles.TICKETS_SCANNER],
  },
  {
    link: "/iam",
    name: "IAM",
    icon: IconLock,
    description: null,
    validRoles: [AppRoles.IAM_ADMIN, AppRoles.IAM_INVITE_ONLY],
  },
  {
    link: "/stripe",
    name: "Stripe Link Creator",
    icon: IconCoin,
    description: null,
    validRoles: [AppRoles.STRIPE_LINK_CREATOR],
  },
  {
    link: "/roomRequests",
    name: "Room Requests",
    icon: IconDoor,
    description: null,
    validRoles: [AppRoles.ROOM_REQUEST_CREATE, AppRoles.ROOM_REQUEST_UPDATE],
  },
  {
    link: "/siglead-management",
    name: "SigLead",
    icon: IconUsers,
    description: null,
    validRoles: [AppRoles.SIGLEAD_MANAGER],
  },
  {
    link: "/linkry",
    name: "Link Shortener",
    icon: IconLink,
    description: null,
    validRoles: [AppRoles.LINKS_MANAGER, AppRoles.LINKS_ADMIN],
  },
  {
    link: "/logs",
    name: "Audit Logs",
    icon: IconHistory,
    description: null,
    validRoles: [AppRoles.AUDIT_LOG_VIEWER],
  },
  {
    link: "/apiKeys",
    name: "API Keys",
    icon: IconKey,
    description: null,
    validRoles: [AppRoles.MANAGE_ORG_API_KEYS],
  },
  {
    link: "/externalMembership",
    name: "External Membership",
    icon: IconExternalLink,
    description: null,
    validRoles: [
      AppRoles.VIEW_EXTERNAL_MEMBERSHIP_LIST,
      AppRoles.MANAGE_EXTERNAL_MEMBERSHIP_LIST,
    ],
  },
];

export const extLinks = [
  {
    link: "https://go.acm.illinois.edu/reimburse",
    name: "Funding and Reimbursement Requests",
    icon: IconFileDollar,
    description: null,
  },
  {
    link: "https://go.acm.illinois.edu/sigpizza",
    name: "Pizza Request Form",
    icon: IconPizza,
    description: null,
  },
];

function isSameParentPath(
  path1: string | undefined,
  path2: string | undefined,
) {
  if (!path1 || !path2) {
    return false;
  }
  const splitPath1 = path1.split("/");
  const splitPath2 = path2.split("/");

  // Ensure both paths are long enough to have a parent path
  if (splitPath1.length < 2 || splitPath2.length < 2) {
    return false;
  }

  // Remove the last element (assumed to be the file or final directory)
  const parentPath1 = splitPath1.slice(0, -1).join("/");
  const parentPath2 = splitPath2.slice(0, -1).join("/");
  return parentPath1 === parentPath2 && parentPath1 !== "/app";
}

export const renderNavItems = (
  items: Record<string, any>[],
  active: string | undefined,
  navigate: CallableFunction,
) =>
  items.map((item) => {
    const link = (
      <NavLink
        style={{ borderRadius: 5 }}
        h={48}
        mt="sm"
        onClick={() => {
          if (item.link.includes("://")) {
            window.location.href = item.link;
          } else {
            navigate(item.link);
          }
        }}
        key={item.name}
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
    );
    if (item.link.at(0) === "/") {
      return (
        <AuthGuard
          resourceDef={{ service: "core", validRoles: item.validRoles }}
          isAppShell={false}
          key={`${item.name}-wrap`}
          loadingSkeleton={
            <Skeleton h={48} style={{ borderRadius: 5 }} mt="sm" />
          }
        >
          {link}
        </AuthGuard>
      );
    }
    return link;
  });

type SidebarNavItemsProps = {
  items: Record<string, any>[];
  visible: boolean;
  active?: string;
};
const SidebarNavItems: React.FC<SidebarNavItemsProps> = ({
  items,
  visible,
  active,
}) => {
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
  const navigate = useNavigate();
  return (
    <AppShell
      padding="md"
      header={{ height: 60 }}
      navbar={{
        width: showSidebar ? 200 : 0,
        breakpoint: "sm",
        collapsed: { mobile: !opened },
      }}
    >
      <AppShell.Header>
        <HeaderNavbar />
      </AppShell.Header>
      {showSidebar && (
        <AppShell.Navbar p="sm">
          <AppShell.Section grow>
            <SidebarNavItems
              items={navItems}
              visible={showSidebar}
              active={active}
            />
            <br />
            <Divider label="Other Services" />
            <SidebarNavItems
              items={extLinks}
              visible={showSidebar}
              active={active}
            />
            <Group hiddenFrom="sm">
              <Divider />
              <AuthenticatedProfileDropdown userData={userData || {}} />
            </Group>
          </AppShell.Section>
          <AppShell.Section>
            <Text size="xs" fw={500}>
              &copy; {new Date().getFullYear()} ACM @ UIUC
            </Text>
            <Text size="xs" fw={500}>
              Revision <code>{getCurrentRevision()}</code>
            </Text>
            <Anchor
              component="button"
              size="xs"
              fw={500}
              onClick={() => navigate("/tos")}
            >
              Terms of Service
            </Anchor>
          </AppShell.Section>
        </AppShell.Navbar>
      )}
      <AppShell.Main>
        {showLoader ? (
          <LoadingOverlay
            visible={showLoader}
            loaderProps={{ color: colorScheme === "dark" ? "white" : "black" }}
          />
        ) : (
          children
        )}
      </AppShell.Main>
    </AppShell>
  );
};

export { AcmAppShell, SidebarNavItems };
