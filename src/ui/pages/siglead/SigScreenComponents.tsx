import React, { useEffect, useMemo, useState } from 'react';
import { OrganizationList } from '@common/orgs';
import { NavLink, Paper } from '@mantine/core';
import { IconUsersGroup } from '@tabler/icons-react';
import { useLocation } from 'react-router-dom';
import { SigMemberCount } from '@common/types/siglead';

const renderSigLink = (sigMemCount: SigMemberCount, index: number) => {
  const color = 'light-dark(var(--mantine-color-black), var(--mantine-color-white))';
  const size = '18px';
  const org = sigMemCount.sigid;
  const count = sigMemCount.count;
  return (
    <NavLink
      href={`${useLocation().pathname}/${org}`}
      active={index % 2 === 0}
      label={org}
      color="var(--mantine-color-blue-light)"
      variant="filled"
      rightSection={
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            color: `${color}`,
            fontSize: `${size}`,
          }}
        >
          <span>{count}</span>
          <IconUsersGroup />
        </div>
      }
      styles={{
        label: {
          color: `${color}`,
          fontSize: `${size}`,
        },
      }}
    />
  );
};

type props = {
  SigMemberCounts: SigMemberCount[];
};
export const ScreenComponent: React.FC<props> = ({ SigMemberCounts }) => {
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
          borderRadius: '8px',
          padding: '10px 16px',
          marginBottom: '8px',
          fontSize: '22px',
        }}
      >
        <span>Organization</span>
        <span>Member Count</span>
      </Paper>
      {/* {OrganizationList.map(renderSigLink)} */}
      {SigMemberCounts.map(renderSigLink)}
    </>
  );
};
