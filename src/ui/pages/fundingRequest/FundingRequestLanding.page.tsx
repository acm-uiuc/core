import React from "react";
import { Container, Title } from "@mantine/core";
import { AuthGuard } from "@ui/components/AuthGuard";
import { AppRoles } from "@common/roles";
import { useApi } from "@ui/util/api";
import { FundingRequestListResponse } from "@common/types/fundingRequest";
import {
  SemesterSelect,
  useSemesterSearchParam,
} from "@ui/components/SemesterSelect";
import ExistingFundingRequests from "./ExistingFundingRequests";

export const ManageFundingRequestsPage: React.FC = () => {
  const api = useApi("core");
  const { semester, setSemester, semesterOptions } = useSemesterSearchParam();

  const getFundingRequests = async (
    semesterId: string,
  ): Promise<FundingRequestListResponse> => {
    const response = await api.get<FundingRequestListResponse>(
      "/api/v1/fundingRequests",
      { params: { semesterId } },
    );
    return response.data;
  };

  return (
    <AuthGuard
      resourceDef={{
        service: "core",
        validRoles: [
          AppRoles.FUNDING_REQUEST_VIEW_ALL,
          AppRoles.AT_LEAST_ONE_ORG_MANAGER,
        ],
      }}
      showSidebar
    >
      <Container>
        <Title>Funding Requests</Title>
        <SemesterSelect
          placeholder="Select semester to view funding requests"
          value={semester}
          onChange={setSemester}
          options={semesterOptions}
        />
        <ExistingFundingRequests
          getFundingRequests={getFundingRequests}
          semester={semester}
        />
      </Container>
    </AuthGuard>
  );
};
