import React, { useEffect, useMemo, useState } from "react";
import { Container, Title, Tabs, Select } from "@mantine/core";
import { AuthGuard } from "@ui/components/AuthGuard";
import { AppRoles } from "@common/roles";
import { useApi } from "@ui/util/api";
import ExistingRoomRequests from "./ExistingRoomRequests";
import NewRoomRequest from "./NewRoomRequest";
import {
  getPreviousSemesters,
  getSemesters,
  RoomRequestFormValues,
  RoomRequestListResponse,
  RoomRequestPostResponse,
  type RoomRequestStatus,
} from "@common/types/roomRequest";
import { OrganizationId } from "@acm-uiuc/js-shared";
import { useSearchParams } from "react-router-dom";

export const ManageRoomRequestsPage: React.FC = () => {
  const api = useApi("core");
  const [semester, setSemesterState] = useState<string | null>(null);
  const nextSemesters = useMemo(() => getSemesters(), []);
  const semesterOptions = useMemo(
    () => [...getPreviousSemesters(), ...nextSemesters],
    [nextSemesters],
  );
  const [searchParams, setSearchParams] = useSearchParams();

  const setSemester = (newSemester: string | null) => {
    if (newSemester && newSemester !== semester) {
      setSemesterState(newSemester);
      const currentParams = Object.fromEntries(searchParams.entries());
      setSearchParams({ ...currentParams, semester: newSemester });
    }
  };

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

  useEffect(() => {
    const semesterFromUrl = searchParams.get("semester");
    if (
      semesterFromUrl &&
      semesterOptions.map((x) => x.value).includes(semesterFromUrl)
    ) {
      if (semesterFromUrl !== semester) {
        setSemesterState(semesterFromUrl);
      }
    } else {
      const defaultSemester = nextSemesters[0].value;
      if (defaultSemester !== semester) {
        setSemesterState(defaultSemester);
        const currentParams = Object.fromEntries(searchParams.entries());
        setSearchParams({ ...currentParams, semester: defaultSemester });
      }
    }
  }, [searchParams, semester, semesterOptions, nextSemesters, setSearchParams]);

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
            <Select
              label="Select Semester"
              placeholder="Select semester to view room requests"
              searchable
              value={semester}
              onChange={setSemester}
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

          <Tabs.Panel value="new_requests">
            <br />
            <NewRoomRequest createRoomRequest={createRoomRequest} />
          </Tabs.Panel>
        </Tabs>
      </Container>
    </AuthGuard>
  );
};
