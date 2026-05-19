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
  Group,
  Modal,
  Stack,
  ScrollArea,
  Alert,
  rem,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import ReactDiffViewer, { DiffMethod } from "react-diff-viewer-continued";
import { Dropzone, MIME_TYPES, FileWithPath } from "@mantine/dropzone";
import {
  IconUpload,
  IconX,
  IconFile,
  IconAlertCircle,
  IconDownload,
  IconInfoCircle,
} from "@tabler/icons-react";
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
  roomRequestDataSchema,
  validMimeTypes,
  maxAttachmentSizeBytes,
  RoomRequestFormValues,
  RoomRequestEditValues,
  roomRequestGetResponse,
  isEditableRoomRequestStatus,
} from "@common/types/roomRequest";
import { useParams } from "react-router-dom";
import { getStatusColor, getStatusIcon } from "./roomRequestUtils";
import { useForm } from "@mantine/form";
import { notifications } from "@mantine/notifications";
import FullScreenLoader from "@ui/components/AuthContext/LoadingScreen";
import { zod4Resolver as zodResolver } from "mantine-form-zod-resolver";
import {
  downloadFromS3PresignedUrl,
  uploadToS3PresignedUrl,
} from "@ui/util/s3";
import { NameOptionalUserCard } from "@ui/components/NameOptionalCard";
import { DEFAULT_TIMEZONE } from "@common/constants";
import { currentTimezone, formatWithOrdinal, fromNow } from "@common/time";
import { formatChicagoTime } from "@ui/components/UrbanaDateTimePicker";

const getCurrentStatus = (data: RoomRequestGetResponse): RoomRequestStatus => {
  if (data.data.currentStatus) {
    return data.data.currentStatus;
  }
  for (let i = data.updates.length - 1; i >= 0; i--) {
    if (data.updates[i].status !== RoomRequestStatus.EDITED) {
      return data.updates[i].status;
    }
  }
  return RoomRequestStatus.CREATED;
};

export const ViewRoomRequest: React.FC = () => {
  const { semesterId, requestId } = useParams();
  const [data, setData] = useState<RoomRequestGetResponse | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [uploadedFile, setUploadedFile] = useState<FileWithPath | null>(null);
  const [downloadingAttachment, setDownloadingAttachment] = useState<
    string | null
  >(null);
  const [diffModalOpened, diffModalControls] = useDisclosure(false);
  const [selectedDiff, setSelectedDiff] = useState<Record<
    string,
    { old: unknown; new: unknown }
  > | null>(null);
  const openDiffModal = (
    diff: Record<string, { old: unknown; new: unknown }>,
  ) => {
    setSelectedDiff(diff);
    diffModalControls.open();
  };
  const FIELD_LABELS: Record<string, string> = {
    host: "Host",
    title: "Title",
    theme: "Theme",
    description: "Description",
    eventStart: "Event Start",
    eventEnd: "Event End",
    isRecurring: "Recurring",
    recurrencePattern: "Recurrence Pattern",
    recurrenceEndDate: "Recurrence End Date",
    setupNeeded: "Setup Needed",
    setupMinutesBefore: "Setup Minutes Before",
    hostingMinors: "Hosting Minors",
    locationType: "Location Type",
    spaceType: "Space Type",
    requestsSccsRoom: "Requests SCCS Room",
    specificRoom: "Specific Room",
    estimatedAttendees: "Estimated Attendees",
    seatsNeeded: "Seats Needed",
    setupDetails: "Setup Details",
    onCampusPartners: "On-Campus Partners",
    offCampusPartners: "Off-Campus Partners",
    nonIllinoisSpeaker: "Non-UIUC Speaker",
    nonIllinoisAttendees: "Non-UIUC Attendees (%)",
    foodOrDrink: "Food or Drink",
    crafting: "Crafting",
    comments: "Comments",
  };
  const formatDiffValue = (value: unknown): string => {
    if (value === null || value === undefined || value === "") {
      return "(not set)";
    }
    if (typeof value === "boolean") {
      return value ? "Yes" : "No";
    }
    if (typeof value === "string") {
      const asDate = new Date(value);
      if (
        /^\d{4}-\d{2}-\d{2}T/.test(value) &&
        !Number.isNaN(asDate.getTime())
      ) {
        return formatChicagoTime(Math.floor(asDate.getTime() / 1000)) ?? value;
      }
      return value;
    }
    if (typeof value === "number") {
      return String(value);
    }
    return JSON.stringify(value);
  };
  const wrapText = (text: string, width = 60): string =>
    text
      .split("\n")
      .flatMap((line) => {
        if (line.length <= width) {
          return [line];
        }
        const words = line.split(" ");
        const out: string[] = [];
        let current = "";
        for (const word of words) {
          if (current && current.length + word.length + 1 > width) {
            out.push(current);
            current = word;
          } else {
            current = current ? `${current} ${word}` : word;
          }
        }
        if (current) {
          out.push(current);
        }
        return out;
      })
      .join("\n");
  const buildSnapshotText = (
    diff: Record<string, { old: unknown; new: unknown }>,
    side: "old" | "new",
  ): string =>
    Object.keys(diff)
      .sort()
      .map((key) => {
        const label = FIELD_LABELS[key] ?? key;
        const value = formatDiffValue(diff[key][side]);
        return `${label}:\n${wrapText(value)}`;
      })
      .join("\n\n");

  const newStatusForm = useForm<{
    status: RoomRequestStatusUpdatePostBody["status"] | null;
    notes: string;
  }>({
    initialValues: { status: null, notes: "" },
    validate: zodResolver(roomRequestStatusUpdateRequest),
  });
  const handleFileDrop = async (files: FileWithPath[]) => {
    if (files.length === 0) {
      return;
    }
    const file = files[0];
    if (file.size > maxAttachmentSizeBytes) {
      notifications.show({
        title: "File too large",
        message: `File must be less than ${maxAttachmentSizeBytes / 1e6}MB`,
        color: "red",
        icon: <IconAlertCircle size={16} />,
      });
      return;
    }

    if (!validMimeTypes.includes(file.type as any)) {
      notifications.show({
        title: "Invalid file type",
        message: "Please upload a different file and try again.",
        color: "red",
        icon: <IconAlertCircle size={16} />,
      });
      return;
    }

    setUploadedFile(file);
  };

  const handleFileRemove = () => {
    setUploadedFile(null);
  };

  const handleDownloadAttachment = async (
    createdAt: string,
    status: string,
    filename?: string,
  ) => {
    if (!filename) {
      return;
    }
    const attachmentKey = `${createdAt}#${status}`;
    setDownloadingAttachment(attachmentKey);
    try {
      const response = await api.get<{ downloadUrl: string }>(
        `/api/v1/roomRequests/${semesterId}/${requestId}/attachmentDownloadUrl/${createdAt}/${status}`,
      );
      await downloadFromS3PresignedUrl(response.data.downloadUrl, filename);
    } catch (e) {
      notifications.show({
        title: "Failed to download attachment",
        message: "Please try again or contact support.",
        color: "red",
        icon: <IconAlertCircle size={16} />,
      });
    } finally {
      setDownloadingAttachment(null);
    }
  };

  const handleStatusChange = async (
    payload: RoomRequestStatusUpdatePostBody,
  ): Promise<{ uploadUrl?: string }> => {
    const response = await api.post(
      `/api/v1/roomRequests/${semesterId}/${requestId}/status`,
      payload,
    );
    return response.data;
  };
  const editRoomRequest = async (
    payload: RoomRequestEditValues,
  ): Promise<{ id: string }> => {
    const response = await api.patch(
      `/api/v1/roomRequests/${semesterId}/${requestId}`,
      payload,
    );
    await updateData();
    return response.data;
  };
  const updateData = async () => {
    const response = await api.get(
      `/api/v1/roomRequests/${semesterId}/${requestId}`,
    );
    try {
      const real = await roomRequestGetResponse.parseAsync(response.data);
      setData(real);
    } catch (e) {
      notifications.show({
        title: "Failed to validate room reservation",
        message: "Data may not render correctly or may be invalid.",
        color: "red",
      });
      setData({
        data: await roomRequestDataSchema.parseAsync(response.data.data),
        updates: response.data.updates,
      });
    }
  };
  const submitStatusChange = async () => {
    try {
      newStatusForm.validate();
      if (!newStatusForm.isValid()) {
        return;
      }
      setIsSubmitting(true);

      // Prepare payload with optional attachment info
      const payload: RoomRequestStatusUpdatePostBody = {
        status: newStatusForm.values.status!,
        notes: newStatusForm.values.notes,
      };

      // Add attachment info if file is uploaded
      if (uploadedFile) {
        payload.attachmentInfo = {
          filename: uploadedFile.name,
          fileSizeBytes: uploadedFile.size,
          contentType: uploadedFile.type,
        };
      }

      const response = await handleStatusChange(payload);

      // Handle S3 file upload if uploadUrl is returned
      let uploadSuccess = true;
      if (uploadedFile) {
        if (response.uploadUrl) {
          try {
            await uploadToS3PresignedUrl(
              response.uploadUrl,
              uploadedFile,
              uploadedFile.type,
            );
          } catch (uploadError) {
            uploadSuccess = false;
            notifications.show({
              color: "red",
              title: "File upload failed",
              message:
                "The status was updated but the file could not be uploaded.",
              icon: <IconAlertCircle size={16} />,
            });
          }
        } else {
          uploadSuccess = false;
          notifications.show({
            color: "red",
            title: "File upload failed",
            message:
              "No upload URL was provided. The status was updated but the file could not be uploaded.",
            icon: <IconAlertCircle size={16} />,
          });
        }
      }

      // Show success notification if upload succeeded or no file was attached
      if (uploadSuccess) {
        notifications.show({
          title: "Status update submitted!",
          message: "The requestor has been notified.",
        });
      }

      // Always reload data and clear form since status update succeeded
      updateData();
      setIsSubmitting(false);
      newStatusForm.reset();
      handleFileRemove();
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
      .filter((status) => status !== getCurrentStatus(data))
      .filter((status) => status !== RoomRequestStatus.CREATED)
      .filter((status) => status !== RoomRequestStatus.EDITED)
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
          <Badge color={getStatusColor(getCurrentStatus(data))}>
            {formatStatus(getCurrentStatus(data))}
          </Badge>
        </Container>
      )}
      {!data && <FullScreenLoader />}
      <Grid ml={{ base: "sm", sm: "xl" }}>
        <Grid.Col span={{ base: 12, sm: 8 }}>
          {data &&
            (isEditableRoomRequestStatus(getCurrentStatus(data)) ? (
              <>
                <Alert
                  color="blue"
                  variant="light"
                  mb="md"
                  icon={<IconInfoCircle size={16} />}
                  title="This request is editable"
                >
                  You can edit this room request until it is submitted to UIUC.
                  After submission, the details become read-only.
                </Alert>
                <NewRoomRequest
                  initialValues={data.data}
                  editRoomRequest={editRoomRequest}
                />
              </>
            ) : (
              <NewRoomRequest viewOnly initialValues={data.data} />
            ))}
          <AuthGuard
            resourceDef={{
              service: "core",
              validRoles: [AppRoles.ROOM_REQUEST_UPDATE],
            }}
            showSidebar
            isAppShell={false}
          >
            {data && data.data && (
              <Stack mt="xl" gap="md">
                <Group justify="space-between" align="center">
                  <Title order={2}>Update Status</Title>
                  {getStatusOptions(getCurrentStatus(data)).length > 0 && (
                    <Button
                      onClick={submitStatusChange}
                      color="green"
                      disabled={
                        isSubmitting ||
                        !newStatusForm.values.status ||
                        !newStatusForm.values.notes
                      }
                    >
                      {isSubmitting ? (
                        <>
                          <Loader size={16} color="white" />
                          Submitting...
                        </>
                      ) : (
                        "Submit Status Update"
                      )}
                    </Button>
                  )}
                </Group>
                {getStatusOptions(getCurrentStatus(data)).length > 0 ? (
                  <>
                    <Select
                      label="New Status"
                      placeholder="Select new status"
                      data={getStatusOptions(getCurrentStatus(data))}
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

                        <Text size="sm" fw={500} mt="md" mb="xs">
                          Attachment (Optional)
                        </Text>
                        <Text size="xs" c="dimmed" mb="xs">
                          Upload a PDF or image file (max{" "}
                          {maxAttachmentSizeBytes / 1e6}MB)
                        </Text>

                        {!uploadedFile ? (
                          <Dropzone
                            onDrop={handleFileDrop}
                            maxSize={maxAttachmentSizeBytes}
                            accept={validMimeTypes}
                            multiple={false}
                          >
                            <Group
                              justify="center"
                              gap="xl"
                              mih={220}
                              style={{ pointerEvents: "none" }}
                            >
                              <Dropzone.Accept>
                                <IconUpload
                                  style={{
                                    width: rem(52),
                                    height: rem(52),
                                    color: "var(--mantine-color-blue-6)",
                                  }}
                                  stroke={1.5}
                                />
                              </Dropzone.Accept>
                              <Dropzone.Reject>
                                <IconX
                                  style={{
                                    width: rem(52),
                                    height: rem(52),
                                    color: "var(--mantine-color-red-6)",
                                  }}
                                  stroke={1.5}
                                />
                              </Dropzone.Reject>
                              <Dropzone.Idle>
                                <IconFile
                                  style={{
                                    width: rem(52),
                                    height: rem(52),
                                    color: "var(--mantine-color-dimmed)",
                                  }}
                                  stroke={1.5}
                                />
                              </Dropzone.Idle>

                              <div>
                                <Text size="xl" inline>
                                  Drag file here or click to select
                                </Text>
                                <Text size="sm" c="dimmed" inline mt={7}>
                                  Attach a file (
                                  {validMimeTypes
                                    .map((x) => x.split("/")[1].toUpperCase())
                                    .join(", ")}
                                  )
                                </Text>
                              </div>
                            </Group>
                          </Dropzone>
                        ) : (
                          <Paper withBorder p="md" radius="md">
                            <Group justify="space-between">
                              <Group>
                                <IconFile size={24} />
                                <div>
                                  <Text size="sm" fw={500}>
                                    {uploadedFile.name}
                                  </Text>
                                  <Text size="xs" c="dimmed">
                                    {(uploadedFile.size / 1024).toFixed(2)} KB
                                  </Text>
                                </div>
                              </Group>
                              <Button
                                size="xs"
                                variant="subtle"
                                color="red"
                                onClick={handleFileRemove}
                              >
                                Remove
                              </Button>
                            </Group>
                          </Paper>
                        )}
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
              </Stack>
            )}
          </AuthGuard>
        </Grid.Col>
        <Grid.Col span={{ base: 12, sm: 3 }} ml={{ base: 0, sm: "lg" }}>
          {data && (
            <ScrollArea
              type="auto"
              offsetScrollbars
              styles={{ root: { maxWidth: "100%" } }}
            >
              <Timeline
                active={data.updates.length}
                bulletSize={22}
                lineWidth={2}
                style={{ minWidth: rem(260) }}
              >
                {data.updates.map((x, i) => {
                  const bulletColor = getStatusColor(x.status);
                  const nextStatus = data.updates[i + 1]?.status;
                  const lineColor = nextStatus
                    ? getStatusColor(nextStatus)
                    : bulletColor;
                  const bulletBg =
                    bulletColor === "black"
                      ? "var(--mantine-color-dark-6)"
                      : `var(--mantine-color-${bulletColor}-filled)`;
                  return (
                    <Timeline.Item
                      bullet={getStatusIcon(x.status)}
                      color={lineColor}
                      styles={{
                        itemBullet: {
                          backgroundColor: bulletBg,
                          borderColor: bulletBg,
                          color: "var(--mantine-color-white)",
                        },
                      }}
                      title={
                        <Text size="md" fw={400}>
                          {formatStatus(x.status)}
                        </Text>
                      }
                    >
                      {x.createdBy && (
                        <NameOptionalUserCard email={x.createdBy} />
                      )}
                      {x.notes && (
                        <Text c="dimmed" size="xs" mt={4}>
                          {x.notes}
                        </Text>
                      )}
                      {x.status === RoomRequestStatus.EDITED && x.diff && (
                        <Button
                          size="compact-xs"
                          variant="light"
                          mt={4}
                          onClick={() =>
                            openDiffModal(
                              x.diff as Record<
                                string,
                                { old: unknown; new: unknown }
                              >,
                            )
                          }
                        >
                          More details
                        </Button>
                      )}
                      {x.attachmentFilename && (
                        <Button
                          size="compact-xs"
                          variant="light"
                          mt={4}
                          leftSection={
                            downloadingAttachment ===
                            `${x.createdAt}#${x.status}` ? (
                              <Loader size={12} />
                            ) : (
                              <IconDownload size={12} />
                            )
                          }
                          onClick={() =>
                            handleDownloadAttachment(
                              x.createdAt,
                              x.status,
                              x.attachmentFilename,
                            )
                          }
                          disabled={
                            downloadingAttachment ===
                            `${x.createdAt}#${x.status}`
                          }
                        >
                          {downloadingAttachment ===
                          `${x.createdAt}#${x.status}`
                            ? "Downloading..."
                            : x.attachmentFilename}
                        </Button>
                      )}
                      {x.createdAt && (
                        <Tooltip
                          label={formatChicagoTime(
                            Math.floor(new Date(x.createdAt).getTime() / 1000),
                          )}
                          position="top"
                          withArrow
                        >
                          <Text c="dimmed" size="xs" mt={2}>
                            {fromNow(x.createdAt, currentTimezone())}
                          </Text>
                        </Tooltip>
                      )}
                    </Timeline.Item>
                  );
                })}
              </Timeline>
            </ScrollArea>
          )}
        </Grid.Col>
      </Grid>
      <Modal
        opened={diffModalOpened}
        onClose={diffModalControls.close}
        title="Edit details"
        size="xl"
      >
        {selectedDiff && Object.keys(selectedDiff).length > 0 ? (
          <ReactDiffViewer
            oldValue={buildSnapshotText(selectedDiff, "old")}
            newValue={buildSnapshotText(selectedDiff, "new")}
            splitView={false}
            hideLineNumbers
            compareMethod={DiffMethod.WORDS}
            showDiffOnly={false}
            styles={{
              contentText: {
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                overflowWrap: "anywhere",
              },
              line: {
                wordBreak: "break-word",
              },
            }}
          />
        ) : (
          <Text c="dimmed">No details available.</Text>
        )}
      </Modal>
    </AuthGuard>
  );
};
