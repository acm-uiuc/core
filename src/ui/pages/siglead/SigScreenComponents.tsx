import React, { useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import { OrganizationList } from '@common/orgs';
import { NavLink, Paper } from '@mantine/core';
import { AuthGuard } from '@ui/components/AuthGuard';
import { AppRoles } from '@common/roles';
import { IconUsersGroup } from '@tabler/icons-react';
import { useLocation } from 'react-router-dom';

// use personn icon
// import { IconPlus, IconTrash } from '@tabler/icons-react';

// const OrganizationListEnum = z.enum(OrganizationList);

// const renderTableRow = (org: string) => {
//     const count = 50;
//     return(
//         <Transition mounted={true} transition="fade" duration={400} timingFunction="ease">
//         {(styles) => (
//           <tr style={{ ...styles, display: 'table-row' }}>
//             <Table.Td>{org}</Table.Td>
//             <Table.Td>{count}</Table.Td>
//           </tr>
//         )}
//       </Transition>
//     )
// }

const renderSigLink = (org: string, index: number) => {
  return (
    <NavLink
      href={`${useLocation().pathname}/${org}`}
      label={org}
      variant="filled"
      active={index % 2 === 0}
      rightSection={
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span>MemberCount[{index}]</span>
          <IconUsersGroup />
        </div>
      }
    />
  );
};

export const ScreenComponent: React.FC = () => {
  return (
    <>
      <Paper
        shadow="xs"
        p="sm"
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontWeight: 'bold',
          // backgroundColor: "#f8f9fa",
          borderRadius: '8px',
          padding: '10px 16px',
          marginBottom: '8px',
        }}
      >
        <span>Organization</span>
        <span>Member Count</span>
      </Paper>
      {OrganizationList.map(renderSigLink)}
    </>
  );
};

import { Table } from '@mantine/core';

export const SigTable = () => {
  const location = useLocation();
  return (
    <Table highlightOnHover>
      {/* Headers */}
      <thead>
        <tr>
          <th>Organization</th>
          <th>Member Count</th>
        </tr>
      </thead>

      <tbody>
        {OrganizationList.map((org, index) => (
          <tr key={index}>
            {/* Organization Column */}
            <td>
              <NavLink
                href={`${location.pathname}/${org}`}
                label={org}
                variant="filled"
                active={index % 2 === 0}
              />
            </td>

            {/* Member Count Column */}
            <td style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span>MemberCount[{index}]</span>
              <IconUsersGroup />
            </td>
          </tr>
        ))}
      </tbody>
      {/* <tbody>
        {OrganizationList.map((org, index) => (
          <tr key={index}>
            <td>{renderSigLink(org, index)}</td>
          </tr>
        ))}
      </tbody> */}
    </Table>
  );
};

// const navLinks = [
//   { label: "Home", icon: <IconHome size={16} />, path: "/" },
//   { label: "Profile", icon: <IconUser size={16} />, path: "/profile" },
//   { label: "Settings", icon: <IconSettings size={16} />, path: "/settings" },
// ];

// export const NavLinkTable = () => {
//   return (
//     <Table highlightOnHover>
//       <thead>
//         <tr>
//           <th>Navigation</th>
//         </tr>
//       </thead>
//       <tbody>
//         {navLinks.map((link, index) => (
//           <tr key={index}>
//             <td>
//               <NavLink
//                 label={link.label}
//                 component={Link} // Integrates with React Router
//                 to={link.path}
//               />
//             </td>
//           </tr>
//         ))}
//       </tbody>
//     </Table>
//   );
// }
