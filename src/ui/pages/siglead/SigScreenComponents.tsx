import React, { useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import { OrganizationList } from '@common/orgs';
import { NavLink } from '@mantine/core';
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
  return <>{OrganizationList.map(renderSigLink)}</>;
};
