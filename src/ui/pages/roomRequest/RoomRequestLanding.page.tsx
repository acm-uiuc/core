import React from "react";
import { Container, Title, Tabs } from "@mantine/core";
import { AuthGuard } from "@ui/components/AuthGuard";
import { AppRoles } from "@common/roles";
import { useApi } from "@ui/util/api";
import ExistingRoomRequests from "./ExistingRoomRequests";
import NewRoomRequest from "./NewRoomRequest";
import {
  RoomRequestFormValues,
  RoomRequestListResponse,
  RoomRequestPostResponse,
  type RoomRequestStatus,
} from "@common/types/roomRequest";
import { OrganizationId } from "@acm-uiuc/js-shared";
import {
  SemesterSelect,
  useSemesterSearchParam,
} from "@ui/components/SemesterSelect";

export const ManageRoomRequestsPage: React.FC = () => {
  const api = useApi("core");
  const { semester, setSemester, semesterOptions } = useSemesterSearchParam();

  const createRoomRequest = async (
    payload: RoomRequestFormValues,
  ): Promise<RoomRequestPostResponse> => {
    const response = await api.post(`/api/v1/roomRequests`, payload);
    return response.data;
  };

  const getRoomRequests = async (
    semester: string,
  ): Promise<RoomRequestListResponse> => {
    const response = await api.get<
      {
        requestId: string;
        title: string;
        host: OrganizationId;
        status: RoomRequestStatus;
        requestsSccsRoom: boolean | undefined;
      }[]
    >(
      `/api/v1/roomRequests/${semester}?select=requestId&select=title&select=host&select=status&select=requestsSccsRoom`,
    );
    return response.data.map((x) => ({ ...x, semester }));
  };

  return (
    <AuthGuard
      resourceDef={{
        service: "core",
        validRoles: [
          AppRoles.ROOM_REQUEST_CREATE,
          AppRoles.ROOM_REQUEST_UPDATE,
        ],
      }}
      showSidebar
    >
      <Container>
        <Title>Room Requests</Title>
        <Tabs variant="pills" defaultValue="existing_requests">
          <Tabs.List>
            <Tabs.Tab value="existing_requests">Existing Requests</Tabs.Tab>
            <Tabs.Tab value="new_requests">New Request</Tabs.Tab>
          </Tabs.List>

          <Tabs.Panel value="existing_requests">
            <SemesterSelect
              placeholder="Select semester to view room requests"
              value={semester}
              onChange={setSemester}
              options={semesterOptions}
            />
            <ExistingRoomRequests
              getRoomRequests={getRoomRequests}
              semester={semester}
            />
          </Tabs.Panel>

          <Tabs.Panel value="new_requests">
            <br />
            <NewRoomRequest createRoomRequest={createRoomRequest} />
          </Tabs.Panel>
        </Tabs>
      </Container>
    </AuthGuard>
  );
};
