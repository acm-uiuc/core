import React from "react";
import { Container, Title } from "@mantine/core";
import { AuthGuard } from "@ui/components/AuthGuard";
import { useApi } from "@ui/util/api";
import { UserProfileData, UserProfileDataBase } from "@common/types/msGraphApi";
import { ManageProfileComponent } from "./ManageProfileComponent";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "@ui/components/AuthContext";
import { transformCommaSeperatedName } from "@common/utils";

export const ManageProfilePage: React.FC = () => {
  const graphApi = useApi("msGraphApi");
  const api = useApi("core");
  const { setLoginStatus } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const returnTo = searchParams.get("returnTo") || undefined;
  const firstTime = searchParams.get("firstTime") === "true" || false;
  const getProfile = async () => {
    const raw = (
      await graphApi.get(
        "/v1.0/me?$select=userPrincipalName,givenName,surname,displayName,otherMails,mail",
      )
    ).data as UserProfileDataBase;
    const discordUsername = raw.otherMails?.filter((x) =>
      x.endsWith("@discord"),
    );
    const enhanced = raw as UserProfileData;
    if (discordUsername?.length === 1) {
      enhanced.discordUsername = discordUsername[0].replace("@discord", "");
      enhanced.otherMails = enhanced.otherMails?.filter(
        (x) => !x.endsWith("@discord"),
      );
    }
    const normalizedName = transformCommaSeperatedName(
      enhanced.displayName || "",
    );
    const extractedFirstName =
      enhanced.givenName || normalizedName.split(" ")[0];
    let extractedLastName = enhanced.surname || normalizedName.split(" ")[1];
    if (!enhanced.surname) {
      extractedLastName = extractedLastName.slice(1, extractedLastName.length);
    }
    return {
      ...enhanced,
      displayName: normalizedName,
      givenName: extractedFirstName,
      surname: extractedLastName,
    };
  };

  const setProfile = async (data: UserProfileData) => {
    const newOtherEmails = [data.mail || data.userPrincipalName];
    if (data.discordUsername && data.discordUsername.trim() !== "") {
      newOtherEmails.push(`${data.discordUsername.trim()}@discord`);
    }
    data.otherMails = newOtherEmails;
    delete data.discordUsername;
    const response = await api.patch("/api/v1/iam/profile", data);
    if (response.status < 299 && firstTime) {
      setLoginStatus(true);
    }
    if (returnTo) {
      return navigate(returnTo);
    }
    return response.data;
  };

  return (
    <AuthGuard resourceDef={{ service: "core", validRoles: [] }} showSidebar>
      <Container fluid>
        <Title>Edit Profile</Title>
        <ManageProfileComponent
          getProfile={getProfile}
          setProfile={setProfile}
          firstTime={firstTime}
        />
      </Container>
    </AuthGuard>
  );
};
