import React, { useState, useEffect, useRef } from "react";
import {
  Modal,
  Button,
  Stack,
  Text,
  Alert,
  Paper,
  Group,
  Badge,
  LoadingOverlay,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  IconQrcode,
  IconCheck,
  IconAlertCircle,
  IconCamera,
} from "@tabler/icons-react";
import { Html5Qrcode } from "html5-qrcode";

interface CheckInModalProps {
  opened: boolean;
  onClose: () => void;
  eventId: string;
  checkInAttendee: (eventId: string, userId: string) => Promise<void>;
}

export const CheckInModal: React.FC<CheckInModalProps> = ({
  opened,
  onClose,
  eventId,
  checkInAttendee,
}) => {
  const [scanning, setScanning] = useState(false);
  const [cameraPermission, setCameraPermission] = useState<
    "granted" | "denied" | "prompt" | null
  >(null);
  const [lastScannedUser, setLastScannedUser] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const scannerInstanceRef = useRef<boolean>(false);

  useEffect(() => {
    // Check camera permission on mount
    checkCameraPermission();

    return () => {
      // Cleanup scanner when modal closes or unmounts
      stopScanning();
    };
  }, []);

  useEffect(() => {
    // Stop scanning when modal closes
    if (!opened) {
      stopScanning();
    }
  }, [opened]);

  const checkCameraPermission = async () => {
    try {
      const permissionStatus = await navigator.permissions.query({
        name: "camera" as PermissionName,
      });
      setCameraPermission(permissionStatus.state);

      permissionStatus.onchange = () => {
        setCameraPermission(permissionStatus.state);
      };
    } catch (error) {
      console.error("Error checking camera permission:", error);
      setCameraPermission("prompt");
    }
  };

  const startScanning = async () => {
    try {
      // Request camera permission
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
      });
      stream.getTracks().forEach((track) => track.stop()); // Stop immediately, just needed for permission

      setCameraPermission("granted");
      setScanning(true);

      // Initialize QR scanner
      if (!scannerRef.current && !scannerInstanceRef.current) {
        scannerInstanceRef.current = true;
        const html5QrCode = new Html5Qrcode("qr-reader");
        scannerRef.current = html5QrCode;

        await html5QrCode.start(
          { facingMode: "environment" },
          {
            fps: 10,
            qrbox: { width: 250, height: 250 },
          },
          async (decodedText) => {
            // QR code successfully scanned
            await handleScan(decodedText);
          },
          (errorMessage) => {},
        );
      }
    } catch (error: any) {
      console.error("Error starting scanner:", error);
      setCameraPermission("denied");
      notifications.show({
        title: "Camera Access Denied",
        message:
          "Please enable camera permissions in your browser settings to scan QR codes.",
        color: "red",
      });
    }
  };

  const stopScanning = async () => {
    if (scannerRef.current && scannerInstanceRef.current) {
      try {
        await scannerRef.current.stop();
        scannerRef.current.clear();
      } catch (error) {
        console.error("Error stopping scanner:", error);
      } finally {
        scannerRef.current = null;
        scannerInstanceRef.current = false;
      }
    }
    setScanning(false);
  };

  const handleScan = async (userId: string) => {
    if (processing) {
      return;
    } // Prevent duplicate scans

    setProcessing(true);
    setLastScannedUser(userId);

    try {
      await checkInAttendee(eventId, userId);

      notifications.show({
        title: "Check-In Successful",
        message: `User ${userId} has been checked in!`,
        color: "green",
        icon: <IconCheck size={16} />,
      });

      // Brief pause before allowing next scan
      setTimeout(() => {
        setProcessing(false);
      }, 2000);
    } catch (error: any) {
      console.error("Error checking in attendee:", error);

      let errorMessage = "Failed to check in attendee.";
      if (error?.response?.status === 404) {
        errorMessage = "User not found or not registered for this event.";
      } else if (error?.response?.status === 400) {
        errorMessage = "User may already be checked in.";
      }

      notifications.show({
        title: "Check-In Failed",
        message: errorMessage,
        color: "red",
        icon: <IconAlertCircle size={16} />,
      });

      setProcessing(false);
    }
  };

  const handleClose = () => {
    stopScanning();
    setLastScannedUser(null);
    onClose();
  };

  return (
    <Modal
      opened={opened}
      onClose={handleClose}
      title="Check-In Attendee"
      size="lg"
      centered
    >
      <Stack gap="md">
        {cameraPermission === "denied" && (
          <Alert
            icon={<IconAlertCircle size={16} />}
            color="red"
            variant="light"
          >
            <Text size="sm" fw={500} mb={4}>
              Camera Access Required
            </Text>
            <Text size="sm">
              Please enable camera permissions in your browser settings to scan
              QR codes.
            </Text>
          </Alert>
        )}

        {!scanning && cameraPermission !== "denied" && (
          <Paper withBorder p="xl" style={{ textAlign: "center" }}>
            <IconQrcode size={64} style={{ margin: "0 auto" }} />
            <Text mt="md" mb="md">
              Click the button below to start scanning attendee QR codes.
            </Text>
            <Button
              leftSection={<IconCamera size={16} />}
              onClick={startScanning}
              size="lg"
            >
              Start Scanning
            </Button>
          </Paper>
        )}

        {scanning && (
          <>
            <Paper withBorder p="md" pos="relative">
              <LoadingOverlay visible={processing} />
              <div
                id="qr-reader"
                style={{
                  width: "100%",
                  borderRadius: "8px",
                  overflow: "hidden",
                }}
              />
            </Paper>

            {lastScannedUser && (
              <Alert
                icon={<IconCheck size={16} />}
                color="green"
                variant="light"
              >
                <Group justify="space-between">
                  <div>
                    <Text size="sm" fw={500}>
                      Last Scanned
                    </Text>
                    <Text size="sm">{lastScannedUser}</Text>
                  </div>
                  <Badge color="green" size="lg">
                    Checked In
                  </Badge>
                </Group>
              </Alert>
            )}

            <Group justify="space-between">
              <Text size="sm" c="dimmed">
                Position the QR code within the frame
              </Text>
              <Button variant="outline" onClick={stopScanning} color="red">
                Stop Scanning
              </Button>
            </Group>
          </>
        )}
      </Stack>
    </Modal>
  );
};
