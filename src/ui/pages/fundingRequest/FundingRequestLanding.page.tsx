import React, { useState } from "react";
import { Container, Tabs, Title } from "@mantine/core";
import { AuthGuard } from "@ui/components/AuthGuard";
import { AppRoles } from "@common/roles";
import { useApi } from "@ui/util/api";
import {
  FundingRequestCreate,
  FundingRequestListResponse,
  FundingRequestPostResponse,
} from "@common/types/fundingRequest";
import {
  SemesterSelect,
  useSemesterSearchParam,
} from "@ui/components/SemesterSelect";
import ExistingFundingRequests from "./ExistingFundingRequests";
import NewFundingRequest from "./NewFundingRequest";

export const ManageFundingRequestsPage: React.FC = () => {
  const api = useApi("core");
  const { semester, setSemester, semesterOptions } = useSemesterSearchParam();
  const [activeTab, setActiveTab] = useState<string | null>(
    "existing_requests",
  );
  // Bumped after a successful create so the table reloads and shows the new request.
  const [listVersion, setListVersion] = useState(0);

  const getFundingRequests = async (
    semesterId: string,
  ): Promise<FundingRequestListResponse> => {
    const response = await api.get<FundingRequestListResponse>(
      "/api/v1/fundingRequests",
      { params: { semesterId } },
    );
    return response.data;
  };

  const createFundingRequest = async (
    payload: FundingRequestCreate,
  ): Promise<FundingRequestPostResponse> => {
    const response = await api.post<FundingRequestPostResponse>(
      "/api/v1/fundingRequests",
      payload,
    );
    setSemester(payload.semesterId);
    setListVersion((v) => v + 1);
    setActiveTab("existing_requests");
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
        <Tabs variant="pills" value={activeTab} onChange={setActiveTab} mt="sm">
          <Tabs.List>
            <Tabs.Tab value="existing_requests">Existing Requests</Tabs.Tab>
            <Tabs.Tab value="new_request">New Request</Tabs.Tab>
          </Tabs.List>

          <Tabs.Panel value="existing_requests">
            <SemesterSelect
              placeholder="Select semester to view funding requests"
              value={semester}
              onChange={setSemester}
              options={semesterOptions}
            />
            <ExistingFundingRequests
              key={listVersion}
              getFundingRequests={getFundingRequests}
              semester={semester}
            />
          </Tabs.Panel>

          <Tabs.Panel value="new_request">
            <NewFundingRequest createFundingRequest={createFundingRequest} />
          </Tabs.Panel>
        </Tabs>
      </Container>
    </AuthGuard>
  );
};
