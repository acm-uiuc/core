import React from 'react';
import { Container, Title } from '@mantine/core';
import { AuthGuard } from '@ui/components/AuthGuard';
import { useApi } from '@ui/util/api';
import { UserProfileData, UserProfileDataBase } from '@common/types/msGraphApi';
import { ManageProfileComponent } from './ManageProfileComponent';
import { useSearchParams } from 'react-router-dom';

export const ManageProfilePage: React.FC = () => {
  const api = useApi('msGraphApi');
  const [searchParams] = useSearchParams();
  const returnTo = searchParams.get('returnTo') || undefined;
  const firstTime = searchParams.get('firstTime') === 'true' || false;
  const getProfile = async () => {
    const raw = (
      await api.get(
        '/v1.0/me?$select=userPrincipalName,givenName,surname,displayName,otherMails,mail'
      )
    ).data as UserProfileDataBase;
    const discordUsername = raw.otherMails?.filter((x) => x.endsWith('@discord'));
    const enhanced = raw as UserProfileData;
    if (discordUsername?.length === 1) {
      enhanced.discordUsername = discordUsername[0].replace('@discord', '');
      enhanced.otherMails = enhanced.otherMails?.filter((x) => !x.endsWith('@discord'));
    }
    return enhanced;
  };

  const setProfile = async (data: UserProfileData) => {
    const newOtherEmails = [data.mail || data.userPrincipalName];
    if (data.discordUsername && data.discordUsername !== '') {
      newOtherEmails.push(`${data.discordUsername}@discord`);
    }
    data.otherMails = newOtherEmails;
    delete data.discordUsername;
    return (await api.patch('/v1.0/me', data)).data;
  };

  return (
    <AuthGuard resourceDef={{ service: 'core', validRoles: [] }} showSidebar={true}>
      <Container fluid>
        <Title>Edit Profile</Title>
        <ManageProfileComponent
          getProfile={getProfile}
          setProfile={setProfile}
          firstTime={firstTime}
          returnTo={returnTo}
        />
      </Container>
    </AuthGuard>
  );
};
