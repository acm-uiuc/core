import React, { useEffect, useState } from "react";
import { Container, Title, Tabs, Select, Loader } from "@mantine/core";
import { AuthGuard } from "@ui/components/AuthGuard";
import { AppRoles } from "@common/roles";
import { useApi } from "@ui/util/api";
import ExistingRoomRequests from "./ExistingRoomRequests";
import NewRoomRequest from "./NewRoomRequest";
import {
  getPreviousSemesters,
  getSemesters,
  RoomRequestFormValues,
  RoomRequestGetAllResponse,
  RoomRequestPostResponse,
  type RoomRequestStatus,
} from "@common/types/roomRequest";
import { OrganizationName } from "@acm-uiuc/js-shared";

export const ManageRoomRequestsPage: React.FC = () => {
  const api = useApi("core");
  const [semester, setSemester] = useState<string | null>(null); // TODO: Create a selector for this
  const [isLoading, setIsLoading] = useState(false);
  const nextSemesters = getSemesters();
  const semesterOptions = [...getPreviousSemesters(), ...nextSemesters];
  const createRoomRequest = async (
    payload: RoomRequestFormValues,
  ): Promise<RoomRequestPostResponse> => {
    const response = await api.post(`/api/v1/roomRequests`, payload);
    return response.data;
  };

  const getRoomRequests = async (
    semester: string,
  ): Promise<RoomRequestGetAllResponse> => {
    const response = await api.get<
      {
        requestId: string;
        title: string;
        host: OrganizationName;
        status: RoomRequestStatus;
      }[]
    >(
      `/api/v1/roomRequests/${semester}?select=requestId&select=title&select=host&select=status`,
    );
    return response.data.map((x) => ({ ...x, semester }));
  };

  useEffect(() => {
    setSemester(nextSemesters[0].value);
  }, []);
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

          {isLoading ? (
            <Loader size={16} />
          ) : (
            <Tabs.Panel value="existing_requests">
              <Select
                label="Select Semester"
                placeholder="Select semester to view room requests"
                searchable
                value={semester}
                onChange={(val) => {
                  setIsLoading(true);
                  setSemester(val);
                  setIsLoading(false);
                }}
                data={semesterOptions}
                mt="sm"
                mb="sm"
              />
              {semester && (
                <ExistingRoomRequests
                  getRoomRequests={getRoomRequests}
                  semester={semester}
                />
              )}
            </Tabs.Panel>
          )}

          <Tabs.Panel value="new_requests">
            <br />
            <NewRoomRequest createRoomRequest={createRoomRequest} />
          </Tabs.Panel>
        </Tabs>
      </Container>
    </AuthGuard>
  );
};
