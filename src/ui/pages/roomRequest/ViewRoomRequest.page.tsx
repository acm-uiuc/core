import React, { useEffect, useState } from "react";
import {
  Container,
  Title,
  Grid,
  Timeline,
  Text,
  Tooltip,
  Paper,
  Select,
  Textarea,
  Badge,
  Button,
  Loader,
} from "@mantine/core";
import { AuthGuard } from "@ui/components/AuthGuard";
import { AppRoles } from "@common/roles";
import { useApi } from "@ui/util/api";
import NewRoomRequest from "./NewRoomRequest";
import {
  RoomRequestGetResponse,
  roomRequestSchema,
  RoomRequestStatus,
  RoomRequestStatusUpdatePostBody,
  roomRequestStatusUpdateRequest,
  formatStatus,
} from "@common/types/roomRequest";
import { useParams } from "react-router-dom";
import { getStatusColor, getStatusIcon } from "./roomRequestUtils";
import moment from "moment-timezone";
import { useForm, zodResolver } from "@mantine/form";
import { notifications } from "@mantine/notifications";
import FullScreenLoader from "@ui/components/AuthContext/LoadingScreen";

export const ViewRoomRequest: React.FC = () => {
  const { semesterId, requestId } = useParams();
  const [data, setData] = useState<RoomRequestGetResponse | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const newStatusForm = useForm<{
    status: RoomRequestStatus | null;
    notes: string;
  }>({
    initialValues: { status: null, notes: "" },
    validate: zodResolver(roomRequestStatusUpdateRequest),
  });
  const handleStatusChange = async (
    payload: RoomRequestStatusUpdatePostBody,
  ) => {
    await api.post(
      `/api/v1/roomRequests/${semesterId}/${requestId}/status`,
      payload,
    );
  };
  const updateData = async () => {
    const response = await api.get(
      `/api/v1/roomRequests/${semesterId}/${requestId}`,
    );
    const parsed = {
      data: await roomRequestSchema.parseAsync(response.data.data),
      updates: response.data.updates,
    };
    setData(parsed);
  };
  const submitStatusChange = async () => {
    try {
      newStatusForm.validate();
      if (!newStatusForm.isValid()) {
        return;
      }
      setIsSubmitting(true);
      await handleStatusChange(
        newStatusForm.values as RoomRequestStatusUpdatePostBody,
      );
      notifications.show({
        title: "Status update submitted!",
        message: "The requestor has been notified.",
      });
      updateData();
      setIsSubmitting(false);
      newStatusForm.reset();
    } catch (e) {
      notifications.show({
        color: "red",
        title: "Failed to submit update",
        message: "Please try again or contact support.",
      });
      setIsSubmitting(false);
      throw e;
    }
  };
  const api = useApi("core");
  const getStatusOptions = (currentStatus: RoomRequestStatus) => {
    if (!data?.updates) {
      return [];
    }
    if (currentStatus === RoomRequestStatus.APPROVED) {
      return [];
    }
    return Object.values(RoomRequestStatus)
      .filter(
        (status) => status !== data.updates[data.updates.length - 1].status,
      )
      .filter((status) => status !== RoomRequestStatus.CREATED)
      .map((status) => ({
        value: status,
        label: formatStatus(status),
      }));
  };
  useEffect(() => {
    updateData();
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
      {data && (
        <Container mb="xl" ml="xl">
          <Title>{data.data.title}</Title>
          <Badge
            color={getStatusColor(data.updates[data.updates.length - 1].status)}
          >
            {formatStatus(data.updates[data.updates.length - 1].status)}
          </Badge>
        </Container>
      )}
      {!data && <FullScreenLoader />}
      <Grid ml="xl">
        <Grid.Col span={8}>
          {data && <NewRoomRequest viewOnly initialValues={data?.data} />}
          <AuthGuard
            resourceDef={{
              service: "core",
              validRoles: [AppRoles.ROOM_REQUEST_UPDATE],
            }}
            showSidebar
            isAppShell={false}
          >
            {data && data.data && (
              <>
                <Text mb="md" size="xl">
                  Update Status
                </Text>
                {getStatusOptions(data.updates[data.updates.length - 1].status)
                  .length > 0 ? (
                  <>
                    <Select
                      label="New Status"
                      placeholder="Select new status"
                      data={getStatusOptions(
                        data.updates[data.updates.length - 1].status,
                      )}
                      allowDeselect={false}
                      key={newStatusForm.key("status")}
                      mb="md"
                      {...newStatusForm.getInputProps("status")}
                    />
                    {newStatusForm.values.status && (
                      <>
                        <Textarea
                          label="Status Message"
                          withAsterisk
                          description="Max 1000 characters."
                          placeholder="Provide any requisite details needed to use the room."
                          {...newStatusForm.getInputProps("notes")}
                        />
                        <Button
                          mt="md"
                          onClick={submitStatusChange}
                          color="green"
                        >
                          {isSubmitting ? (
                            <>
                              <Loader size={16} color="white" />
                              Submitting...
                            </>
                          ) : (
                            "Submit"
                          )}
                        </Button>
                      </>
                    )}
                  </>
                ) : (
                  <>
                    <Text size="sm">
                      This request has been finalized. No status updates can be
                      made at this time.
                    </Text>
                  </>
                )}
              </>
            )}
          </AuthGuard>
        </Grid.Col>
        <Grid.Col span={3} ml="lg">
          {data && (
            <>
              <Timeline
                active={data.updates.length}
                bulletSize={28}
                lineWidth={4}
              >
                {data.updates.map((x) => (
                  <Timeline.Item
                    bullet={getStatusIcon(x.status)}
                    title={formatStatus(x.status)}
                  >
                    {x.createdBy && <Text size="xs">{x.createdBy}</Text>}
                    {x.notes && (
                      <Text c="dimmed" size="sm">
                        {x.notes}
                      </Text>
                    )}
                    {x.createdAt && (
                      <Tooltip
                        label={moment
                          .tz(x.createdAt, "America/Chicago")
                          .format("MMMM Do YYYY, h:mm:ss a")}
                        position="top"
                        withArrow
                      >
                        <Text c="dimmed" size="xs">
                          {moment.tz(x.createdAt, "America/Chicago").fromNow()}
                        </Text>
                      </Tooltip>
                    )}
                  </Timeline.Item>
                ))}
              </Timeline>
              <Text mt="md" size="sm" c="dimmed">
                All times in the America/Chicago timezone.
              </Text>
            </>
          )}
        </Grid.Col>
      </Grid>
    </AuthGuard>
  );
};
