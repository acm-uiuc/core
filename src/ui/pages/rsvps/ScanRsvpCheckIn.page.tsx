import {
  Title,
  Button,
  Alert,
  Paper,
  Stack,
  Text,
  Group,
  Badge,
  Code,
  Container,
  LoadingOverlay,
  Select,
  TextInput,
} from "@mantine/core";
import {
  IconAlertCircle,
  IconCheck,
  IconCamera,
  IconQrcode,
} from "@tabler/icons-react";
import jsQR from "jsqr";
import React, { useEffect, useState, useRef, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { AuthGuard } from "@ui/components/AuthGuard";
import { useApi } from "@ui/util/api";
import { AppRoles } from "@common/roles";

interface ScannableEvent {
  id: string;
  title: string;
  start: string;
  rsvpEnabled?: boolean;
}

interface CheckInRecord {
  netId: string;
  upn: string;
  dietaryRestrictions: string[];
  timestamp: Date;
}

/**
 * The RSVP app encodes the bare NetID into the attendee's check-in QR code
 * (see rsvp/src/pages/Home.page.tsx). Accept that, and tolerate a full
 * UIUC email since the check-in API only wants the local part.
 */
export const parseNetIdFromQr = (raw: string): string | null => {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 64) {
    return null;
  }
  const netId = trimmed.replace(/@illinois\.edu$/i, "").toLowerCase();
  // Mirrors the API's NetID validation, plus a letter to reject bare digits
  // (a 9-digit UIN is not a NetID and must not be sent down this path).
  if (!/^[a-z0-9-]+$/.test(netId) || !/[a-z]/.test(netId)) {
    return null;
  }
  return netId;
};

const ScanRsvpCheckInInternal: React.FC = () => {
  const api = useApi("core");
  const [searchParams, setSearchParams] = useSearchParams();

  const [events, setEvents] = useState<ScannableEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(true);
  const [selectedEvent, setSelectedEvent] = useState<string | null>(
    searchParams.get("eventId"),
  );

  const [videoDevices, setVideoDevices] = useState<
    { value: string; label: string }[]
  >([]);
  const [selectedDevice, setSelectedDevice] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [cameraLoading, setCameraLoading] = useState(false);

  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState("");
  const [manualInput, setManualInput] = useState("");
  const [lastCheckIn, setLastCheckIn] = useState<CheckInRecord | null>(null);
  const [history, setHistory] = useState<CheckInRecord[]>([]);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationFrameId = useRef<number>(0);
  const isScanningRef = useRef(false);
  const lastScanTime = useRef<number>(0);
  const lastScannedCode = useRef<string>("");
  // Read inside the rAF loop, which closes over stale state otherwise.
  const selectedEventRef = useRef<string | null>(selectedEvent);
  const processingRef = useRef(false);
  const scanCooldownMs = 2000;

  useEffect(() => {
    selectedEventRef.current = selectedEvent;
  }, [selectedEvent]);

  const getVideoDevices = useCallback(async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const found = devices
        .filter((device) => device.kind === "videoinput")
        .map((device) => ({
          value: device.deviceId,
          label: device.label || `Camera ${device.deviceId.slice(0, 4)}...`,
        }));
      setVideoDevices(found);
      const backCamera = found.find(
        (device) =>
          device.label.toLowerCase().includes("back") ||
          device.label.toLowerCase().includes("environment"),
      );
      setSelectedDevice((prev) => prev ?? backCamera?.value ?? found[0]?.value);
    } catch (err) {
      console.error("Failed to enumerate video devices:", err);
    }
  }, []);

  const stopScanning = useCallback(() => {
    setIsScanning(false);
    isScanningRef.current = false;
    setCameraLoading(false);

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    if (animationFrameId.current) {
      cancelAnimationFrame(animationFrameId.current);
    }
  }, []);

  useEffect(() => {
    canvasRef.current = document.createElement("canvas");
    getVideoDevices();

    const fetchEvents = async () => {
      setEventsLoading(true);
      try {
        // This list endpoint is unauthenticated, so scanners can pick an event
        // without needing EVENTS_MANAGER.
        const response = await api.get("/api/v1/events?upcomingOnly=true");
        const upcoming = (response.data as ScannableEvent[])
          .filter((event) => event.rsvpEnabled)
          .sort(
            (a, b) => new Date(a.start).getTime() - new Date(b.start).getTime(),
          );
        setEvents(upcoming);
      } catch (err) {
        console.error("Failed to fetch events:", err);
        setError("Could not load events. Refresh to try again.");
      } finally {
        setEventsLoading(false);
      }
    };
    fetchEvents();

    return () => {
      stopScanning();
      if (animationFrameId.current) {
        cancelAnimationFrame(animationFrameId.current);
      }
    };
  }, [api, getVideoDevices, stopScanning]);

  const checkInAttendee = async (
    eventId: string,
    netId: string,
  ): Promise<{ upn: string; dietaryRestrictions: string[] }> => {
    const response = await api.post(`/api/v1/rsvp/checkIn/event/${eventId}`, {
      netId,
    });
    return response.data;
  };

  const handleCheckIn = async (netId: string) => {
    const eventId = selectedEventRef.current;
    if (!eventId) {
      setError("Select an event before scanning.");
      return;
    }

    setProcessing(true);
    processingRef.current = true;
    setError("");

    try {
      const result = await checkInAttendee(eventId, netId);
      const record: CheckInRecord = {
        netId,
        upn: result.upn || netId,
        dietaryRestrictions: result.dietaryRestrictions || [],
        timestamp: new Date(),
      };
      setLastCheckIn(record);
      setHistory((prev) => [record, ...prev].slice(0, 10));
    } catch (err: any) {
      if (err?.response?.status === 400) {
        setError(`${netId} has not RSVP'd to this event.`);
      } else {
        setError(`Failed to check in ${netId}.`);
      }
      setLastCheckIn(null);
    } finally {
      setProcessing(false);
      processingRef.current = false;
    }
  };

  const processVideoFrame = (video: HTMLVideoElement): string | null => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return null;
    }
    const width = video.videoWidth;
    const height = video.videoHeight;
    if (!width || !height) {
      return null;
    }
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return null;
    }
    ctx.drawImage(video, 0, 0, width, height);
    const imageData = ctx.getImageData(0, 0, width, height);
    const code = jsQR(imageData.data, imageData.width, imageData.height, {
      inversionAttempts: "dontInvert",
    });
    return code?.data || null;
  };

  const processFrame = async () => {
    if (!isScanningRef.current || !videoRef.current || !streamRef.current) {
      return;
    }

    try {
      const qrCode = processVideoFrame(videoRef.current);
      const now = Date.now();
      if (
        qrCode &&
        !processingRef.current &&
        (qrCode !== lastScannedCode.current ||
          now - lastScanTime.current > scanCooldownMs)
      ) {
        const netId = parseNetIdFromQr(qrCode);
        if (netId) {
          lastScanTime.current = now;
          lastScannedCode.current = qrCode;
          await handleCheckIn(netId);
        }
      }
    } catch (err) {
      console.error("Frame processing error:", err);
    }

    if (isScanningRef.current) {
      animationFrameId.current = requestAnimationFrame(processFrame);
    }
  };

  const startScanning = async () => {
    if (!selectedEvent) {
      setError("Select an event before starting the camera.");
      return;
    }
    try {
      setError("");
      setCameraLoading(true);
      setIsScanning(true);
      isScanningRef.current = true;
      lastScannedCode.current = "";
      lastScanTime.current = 0;

      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
      if (animationFrameId.current) {
        cancelAnimationFrame(animationFrameId.current);
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: selectedDevice
          ? { deviceId: { exact: selectedDevice } }
          : { facingMode: "environment" },
      });

      // A stop or unmount during the permission prompt ran stopScanning() while
      // streamRef was still null, so it could not stop this stream. Discard it
      // here, otherwise the camera stays on with nothing left to shut it off.
      if (!isScanningRef.current || !videoRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        stopScanning();
        return;
      }

      if (!videoDevices.some((device) => device.label)) {
        getVideoDevices();
      }
      streamRef.current = stream;

      videoRef.current.srcObject = stream;
      await new Promise<void>((resolve) => {
        if (videoRef.current) {
          videoRef.current.onloadeddata = () => resolve();
        } else {
          // The element is gone; resolving avoids awaiting forever.
          resolve();
        }
      });
      // streamRef is set from here on, so stopScanning() can stop the tracks.
      if (!isScanningRef.current || !videoRef.current) {
        stopScanning();
        return;
      }

      await videoRef.current.play();
      if (!isScanningRef.current) {
        stopScanning();
        return;
      }

      setCameraLoading(false);
      animationFrameId.current = requestAnimationFrame(processFrame);
    } catch (err) {
      console.error("Start scanning error:", err);
      setError(err instanceof Error ? err.message : "Failed to start camera");
      setIsScanning(false);
      isScanningRef.current = false;
      setCameraLoading(false);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
    }
  };

  const handleManualSubmit = async () => {
    const netId = parseNetIdFromQr(manualInput);
    if (!netId) {
      setError("Enter a valid NetID.");
      return;
    }
    setManualInput("");
    await handleCheckIn(netId);
  };

  const eventOptions = events.map((event) => ({
    value: event.id,
    label: `${event.title} — ${new Date(event.start).toLocaleDateString()}`,
  }));

  return (
    <Container size="sm">
      <Group gap="xs" mb="md">
        <IconQrcode size={28} />
        <Title order={1}>RSVP Check-In Scanner</Title>
      </Group>

      <Stack gap="md">
        <Select
          label="Event"
          placeholder={
            eventsLoading
              ? "Loading events..."
              : "Select an event to check into"
          }
          data={eventOptions}
          value={selectedEvent}
          onChange={(value) => {
            setSelectedEvent(value);
            setSearchParams(value ? { eventId: value } : {});
            setLastCheckIn(null);
            setHistory([]);
            setError("");
          }}
          disabled={eventsLoading || isScanning}
          searchable
          allowDeselect={false}
          nothingFoundMessage="No upcoming events have RSVPs enabled"
        />

        <div
          style={{
            width: "100%",
            minHeight: "320px",
            maxHeight: "70vh",
            position: "relative",
            aspectRatio: "4/3",
          }}
        >
          <video
            ref={videoRef}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              borderRadius: "8px",
              background: "var(--mantine-color-gray-2)",
            }}
            playsInline
            muted
          />
          <LoadingOverlay visible={cameraLoading} />
        </div>

        <Text c="dimmed" size="xs" ta="center">
          Scan the attendee's <strong>Check-In QR Code</strong> from the ACM
          RSVP app.
        </Text>

        <Select
          label="Camera"
          placeholder="Choose a camera"
          data={videoDevices}
          value={selectedDevice}
          allowDeselect={false}
          onChange={(value) => {
            setSelectedDevice(value);
            if (isScanning) {
              stopScanning();
              setTimeout(() => startScanning(), 100);
            }
          }}
          disabled={cameraLoading || isScanning}
        />

        <Button
          onClick={isScanning ? stopScanning : startScanning}
          leftSection={<IconCamera size={16} />}
          color={isScanning ? "red" : "blue"}
          disabled={!selectedEvent}
          fullWidth
        >
          {isScanning ? "Stop Camera" : "Start Camera"}
        </Button>

        <Group align="flex-end" gap="xs">
          <TextInput
            label="Or enter a NetID manually"
            placeholder="netid"
            value={manualInput}
            onChange={(e) => setManualInput(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                handleManualSubmit();
              }
            }}
            disabled={processing || !selectedEvent}
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            style={{ flex: 1 }}
          />
          <Button
            onClick={handleManualSubmit}
            loading={processing}
            disabled={!manualInput.trim() || !selectedEvent}
          >
            Check In
          </Button>
        </Group>

        {error && (
          <Alert
            icon={<IconAlertCircle size={16} />}
            title="Check-In Error"
            color="red"
          >
            {error}
          </Alert>
        )}

        {lastCheckIn && (
          <Paper p="md" withBorder bg="green.0">
            <Stack gap="sm">
              <Group gap="xs">
                <IconCheck size={20} color="green" />
                <Text fw={700} size="lg">
                  Check-In Successful
                </Text>
                <Text size="xs" c="dimmed">
                  {lastCheckIn.timestamp.toLocaleTimeString()}
                </Text>
              </Group>
              <Code>{lastCheckIn.upn}</Code>
              {lastCheckIn.dietaryRestrictions.length > 0 ? (
                <>
                  <Text fw={600} size="sm">
                    Dietary Restrictions:
                  </Text>
                  <Group gap="xs">
                    {lastCheckIn.dietaryRestrictions.map((restriction) => (
                      <Badge key={restriction} color="orange">
                        {restriction}
                      </Badge>
                    ))}
                  </Group>
                </>
              ) : (
                <Text size="sm" c="dimmed">
                  No dietary restrictions
                </Text>
              )}
            </Stack>
          </Paper>
        )}

        {history.length > 1 && (
          <Paper p="md" withBorder>
            <Stack gap="sm">
              <Text fw={700} size="md">
                Recent Check-Ins ({history.length - 1} previous)
              </Text>
              <Stack gap="xs">
                {history.slice(1, 6).map((record, idx) => (
                  <Paper key={idx} p="sm" withBorder bg="gray.0">
                    <Group justify="space-between">
                      <Text size="sm" fw={500}>
                        {record.netId}
                      </Text>
                      <Text size="xs" c="dimmed">
                        {record.timestamp.toLocaleTimeString()}
                      </Text>
                    </Group>
                  </Paper>
                ))}
              </Stack>
            </Stack>
          </Paper>
        )}
      </Stack>
    </Container>
  );
};

export const ScanRsvpCheckInPage: React.FC = () => (
  <AuthGuard
    resourceDef={{
      service: "core",
      validRoles: [AppRoles.RSVP_MANAGER, AppRoles.RSVP_SCANNER],
    }}
  >
    <ScanRsvpCheckInInternal />
  </AuthGuard>
);
