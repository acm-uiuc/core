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
  rem,
} from "@mantine/core";
import { Dropzone, MIME_TYPES, FileWithPath } from "@mantine/dropzone";
import {
  IconUpload,
  IconX,
  IconFile,
  IconAlertCircle,
  IconDownload,
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

export const ViewRoomRequest: React.FC = () => {
  const { semesterId, requestId } = useParams();
  const [data, setData] = useState<RoomRequestGetResponse | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [uploadedFile, setUploadedFile] = useState<FileWithPath | null>(null);
  const [downloadingAttachment, setDownloadingAttachment] = useState<
    string | null
  >(null);

  const newStatusForm = useForm<{
    status: RoomRequestStatus | null;
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
  const updateData = async () => {
    const response = await api.get(
      `/api/v1/roomRequests/${semesterId}/${requestId}`,
    );
    try {
      const parsed = {
        data: await roomRequestSchema.parseAsync(response.data.data),
        updates: response.data.updates,
      };
      setData(parsed);
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

                        <Button
                          mt="md"
                          onClick={submitStatusChange}
                          color="green"
                          disabled={isSubmitting}
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
                bulletSize={32}
                lineWidth={4}
              >
                {data.updates.map((x) => (
                  <Timeline.Item
                    bullet={getStatusIcon(x.status)}
                    title={<Text size="md">{formatStatus(x.status)}</Text>}
                  >
                    {x.createdBy && (
                      <NameOptionalUserCard email={x.createdBy} />
                    )}
                    {x.notes && (
                      <Text c="dimmed" size="sm" mt="xs">
                        {x.notes}
                      </Text>
                    )}
                    {x.attachmentFilename && (
                      <Button
                        size="xs"
                        variant="light"
                        mt="xs"
                        leftSection={
                          downloadingAttachment ===
                          `${x.createdAt}#${x.status}` ? (
                            <Loader size={14} />
                          ) : (
                            <IconDownload size={14} />
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
                          downloadingAttachment === `${x.createdAt}#${x.status}`
                        }
                      >
                        {downloadingAttachment === `${x.createdAt}#${x.status}`
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
                        <Text c="dimmed" size="xs" mt="xs">
                          {fromNow(x.createdAt, currentTimezone())}
                        </Text>
                      </Tooltip>
                    )}
                  </Timeline.Item>
                ))}
              </Timeline>
            </>
          )}
        </Grid.Col>
      </Grid>
    </AuthGuard>
  );
};
