import React, { useState, useEffect, useRef } from "react";
import {
  Modal,
  Button,
  Stack,
  Text,
  Alert,
  Paper,
  Group,
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
  const [lastScannedUser, setLastScannedUser] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);

  const scannerRef = useRef<Html5Qrcode | null>(null);
  const isMountedRef = useRef(true);
  const lastScanTimeRef = useRef<number>(0);
  const scanCooldownMs = 3000;

  useEffect(() => {
    if (scanning && !scannerRef.current) {
      initializeScanner();
    }
  }, [scanning]);

  useEffect(() => {
    if (!opened) {
      cleanupScanner();
      setScanning(false);
      setLastScannedUser(null);
      lastScanTimeRef.current = 0;
    }
  }, [opened]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      cleanupScanner();
    };
  }, []);

  const cleanupScanner = async () => {
    if (!scannerRef.current) {
      return;
    }

    try {
      const state = await scannerRef.current.getState();
      if (state === 2) {
        await scannerRef.current.stop();
      }
    } catch (e) {
      /* empty */
    }

    try {
      scannerRef.current.clear();
    } catch (e) {
      /* empty */
    }

    scannerRef.current = null;
  };

  const initializeScanner = async () => {
    try {
      const element = document.getElementById("qr-reader");
      if (!element) {
        throw new Error("QR reader element not found");
      }

      const html5QrCode = new Html5Qrcode("qr-reader");
      scannerRef.current = html5QrCode;

      await html5QrCode.start(
        { facingMode: "environment" },
        {
          fps: 10,
          qrbox: { width: 250, height: 250 },
        },
        async (decodedText) => {
          if (isMountedRef.current) {
            await handleScan(decodedText);
          }
        },
        (errorMessage) => {
          // Suppress scanning errors
        },
      );
    } catch (error: any) {
      console.error("Failed to start scanner:", error);

      let message = "Could not access camera.";

      if (
        error.name === "NotAllowedError" ||
        error.toString().includes("NotAllowedError")
      ) {
        message =
          "Camera permission denied. Please allow camera access in your browser settings.";
      } else if (
        error.name === "NotReadableError" ||
        error.toString().includes("NotReadableError")
      ) {
        message =
          "Camera is already in use. Please close other apps using the camera.";
      } else if (
        error.name === "NotFoundError" ||
        error.toString().includes("NotFoundError")
      ) {
        message = "No camera found on this device.";
      }

      notifications.show({
        title: "Scanner Error",
        message,
        color: "red",
        icon: <IconAlertCircle size={16} />,
        autoClose: 2000,
      });

      setScanning(false);
      await cleanupScanner();
    }
  };

  const handleScan = async (userId: string) => {
    if (processing || !isMountedRef.current) {
      return;
    }

    const now = Date.now();
    if (now - lastScanTimeRef.current < scanCooldownMs) {
      return;
    }

    lastScanTimeRef.current = now;
    setProcessing(true);

    try {
      await checkInAttendee(eventId, userId);
      setLastScannedUser(userId);

      notifications.show({
        title: "Check-In Successful",
        message: `User ${userId} checked in.`,
        color: "green",
        icon: <IconCheck size={16} />,
        autoClose: 2000,
      });

      setTimeout(() => {
        if (isMountedRef.current) {
          setProcessing(false);
        }
      }, 2000);
    } catch (error: any) {
      notifications.show({
        title: "Check-In Failed",
        message: error?.response?.data?.message || "Failed to check in.",
        color: "red",
        icon: <IconAlertCircle size={16} />,
        autoClose: 2000,
      });

      if (isMountedRef.current) {
        setProcessing(false);
      }
    }
  };

  const stopScanning = async () => {
    await cleanupScanner();
    setScanning(false);
    setProcessing(false);
    lastScanTimeRef.current = 0;
  };

  const handleModalClose = async () => {
    await stopScanning();
    onClose();
  };

  return (
    <Modal
      opened={opened}
      onClose={handleModalClose}
      title="Check-In Attendee"
      size="lg"
      centered
    >
      <Stack gap="md">
        {!scanning ? (
          <Paper withBorder p="xl" style={{ textAlign: "center" }}>
            <IconQrcode size={64} style={{ margin: "0 auto", opacity: 0.5 }} />
            <Text mt="md" mb="md" c="dimmed">
              Ready to scan? Click below to activate your camera.
            </Text>
            <Button
              leftSection={<IconCamera size={16} />}
              onClick={() => setScanning(true)}
              size="lg"
            >
              Start Scanning
            </Button>
          </Paper>
        ) : (
          <>
            <Paper
              withBorder
              p="sm"
              pos="relative"
              bg="black"
              style={{ minHeight: 300 }}
            >
              <LoadingOverlay visible={processing} overlayProps={{ blur: 2 }} />
              <div
                id="qr-reader"
                style={{ width: "100%", borderRadius: "8px" }}
              />
            </Paper>

            {lastScannedUser && (
              <Alert
                icon={<IconCheck size={16} />}
                color="green"
                variant="light"
              >
                <Text size="sm" fw={500}>
                  Last Scanned: {lastScannedUser}
                </Text>
              </Alert>
            )}

            <Group justify="flex-end">
              <Button variant="subtle" onClick={stopScanning} color="gray">
                Stop Scanning
              </Button>
            </Group>
          </>
        )}
      </Stack>
    </Modal>
  );
};
