import React from "react";
import { Container, Title } from "@mantine/core";
import { AuthGuard } from "@ui/components/AuthGuard";
import { useApi } from "@ui/util/api";
import { UserProfileData } from "@common/types/msGraphApi";
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
        "/v1.0/me?$select=userPrincipalName,givenName,surname,displayName,mail",
      )
    ).data as UserProfileData;
    const normalizedName = transformCommaSeperatedName(raw.displayName || "");
    const extractedFirstName = raw.givenName || normalizedName.split(" ")[0];
    let extractedLastName = raw.surname || normalizedName.split(" ")[1];
    if (!raw.surname) {
      extractedLastName = extractedLastName.slice(1, extractedLastName.length);
    }
    return {
      ...raw,
      displayName: normalizedName,
      givenName: extractedFirstName,
      surname: extractedLastName,
    };
  };

  const setProfile = async (data: UserProfileData) => {
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
