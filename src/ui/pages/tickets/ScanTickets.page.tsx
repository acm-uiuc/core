import {
  Title,
  Box,
  Modal,
  Button,
  Alert,
  Paper,
  Stack,
  Text,
  Group,
  LoadingOverlay,
  Select,
  TextInput,
} from "@mantine/core";
import { IconAlertCircle, IconCheck, IconCamera } from "@tabler/icons-react";
import jsQR from "jsqr";
import React, { useEffect, useState, useRef } from "react";

import FullScreenLoader from "@ui/components/AuthContext/LoadingScreen";
import { AuthGuard } from "@ui/components/AuthGuard";
import { useApi } from "@ui/util/api";
import { AppRoles } from "@common/roles";

interface QRDataMerch {
  type: string;
  stripe_pi: string;
  email: string;
}

interface QRDataTicket {
  type: string;
  ticket_id: string;
}

export interface PurchaseData {
  email: string;
  productId: string;
  quantity: number;
  size?: string;
}

export enum ProductType {
  Merch = "merch",
  Ticket = "ticket",
}

export interface APIResponseSchema {
  valid: boolean;
  type: ProductType;
  ticketId: string;
  purchaserData: PurchaseData;
  refunded: boolean;
  fulfilled: boolean;
}

export interface PurchasesByEmailResponse {
  merch: APIResponseSchema[];
  tickets: APIResponseSchema[];
}

type QRData = QRDataMerch | QRDataTicket;

export const recursiveToCamel = (item: unknown): unknown => {
  if (Array.isArray(item)) {
    return item.map((el: unknown) => recursiveToCamel(el));
  } else if (typeof item === "function" || item !== Object(item)) {
    return item;
  }
  return Object.fromEntries(
    Object.entries(item as Record<string, unknown>).map(
      ([key, value]: [string, unknown]) => [
        key.replace(/([-_][a-z])/gi, (c) =>
          c.toUpperCase().replace(/[-_]/g, ""),
        ),
        recursiveToCamel(value),
      ],
    ),
  );
};

// TODO: Implement this function to call API to get NetID from UIN
export const getNetIdFromUIN = async (uin: string): Promise<string> => {
  throw new Error("UIN to NetID conversion not yet implemented");
};

interface TicketItem {
  itemId: string;
  itemName: string;
  itemSalesActive: string | false;
}

interface TicketItemsResponse {
  tickets: TicketItem[];
  merch: TicketItem[];
}

interface ScanTicketsPageProps {
  getOrganizations?: () => Promise<string[]>;
  getTicketItems?: () => Promise<TicketItemsResponse>;
  getPurchasesByEmail?: (email: string) => Promise<PurchasesByEmailResponse>;
  checkInTicket?: (
    data:
      | QRData
      | { type: string; ticketId?: string; email?: string; stripePi?: string },
  ) => Promise<APIResponseSchema>;
  getNetIdFromUIN?: (uin: string) => Promise<string>;
}

export const ScanTicketsPage: React.FC<ScanTicketsPageProps> = ({
  getOrganizations: getOrganizationsProp,
  getTicketItems: getTicketItemsProp,
  getPurchasesByEmail: getPurchasesByEmailProp,
  checkInTicket: checkInTicketProp,
  getNetIdFromUIN: getNetIdFromUINProp = getNetIdFromUIN,
}) => {
  const [orgList, setOrgList] = useState<string[] | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [scanResult, setScanResult] = useState<APIResponseSchema | null>(null);
  const [error, setError] = useState<string>("");
  const [isScanning, setIsScanning] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [lastScannedCode, setLastScannedCode] = useState<string>("");
  const [videoDevices, setVideoDevices] = useState<
    { value: string; label: string }[]
  >([]);
  const [selectedDevice, setSelectedDevice] = useState<string | null>(null);
  const [manualInput, setManualInput] = useState<string>("");
  const [showTicketSelection, setShowTicketSelection] = useState(false);
  const [availableTickets, setAvailableTickets] = useState<APIResponseSchema[]>(
    [],
  );
  const [ticketItems, setTicketItems] = useState<Array<{
    group: string;
    items: Array<{ value: string; label: string }>;
  }> | null>(null);
  const [selectedItemFilter, setSelectedItemFilter] = useState<string | null>(
    null,
  );

  const api = useApi("core");
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationFrameId = useRef<number>(0);
  const lastScanTime = useRef<number>(0);
  const isScanningRef = useRef(false); // Use ref for immediate updates

  // Default API functions
  const getOrganizations =
    getOrganizationsProp ||
    (async () => {
      const response = await api.get("/api/v1/organizations");
      return response.data;
    });

  const getTicketItems =
    getTicketItemsProp ||
    (async () => {
      const response = await api.get("/api/v1/tickets");
      return response.data;
    });

  const getPurchasesByEmail =
    getPurchasesByEmailProp ||
    (async (email: string) => {
      const response = await api.get<PurchasesByEmailResponse>(
        `/api/v1/tickets/purchases/${encodeURIComponent(email)}`,
      );
      return response.data;
    });

  const checkInTicket =
    checkInTicketProp ||
    (async (data: any) => {
      const response = await api.post(
        `/api/v1/tickets/checkIn`,
        recursiveToCamel(data),
      );
      return response.data as APIResponseSchema;
    });

  const getVideoDevices = async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices
        .filter((device) => device.kind === "videoinput")
        .map((device) => ({
          value: device.deviceId,
          label:
            device.label ||
            (device.deviceId.slice(0, 4)
              ? `Camera ${device.deviceId.slice(0, 4)}...`
              : "Unknown Camera"),
        }));

      setVideoDevices(videoDevices);

      // Try to find and select a back-facing camera by default
      const backCamera = videoDevices.find(
        (device) =>
          device.label.toLowerCase().includes("back") ||
          device.label.toLowerCase().includes("environment"),
      );

      if (backCamera) {
        setSelectedDevice(backCamera.value);
      } else if (videoDevices.length > 0) {
        setSelectedDevice(videoDevices[0].value);
      }
    } catch (err) {
      console.error("Error getting video devices:", err);
      setError("Failed to get camera list. Please check camera permissions.");
    }
  };

  useEffect(() => {
    const fetchData = async () => {
      try {
        const orgs = await getOrganizations();
        setOrgList(orgs);
      } catch (err) {
        console.error("Failed to fetch organizations:", err);
      }

      try {
        const response = await getTicketItems();
        const activeTickets: Array<{ value: string; label: string }> = [];
        const inactiveTickets: Array<{ value: string; label: string }> = [];
        const activeMerch: Array<{ value: string; label: string }> = [];
        const inactiveMerch: Array<{ value: string; label: string }> = [];

        const now = new Date();

        // Process all tickets
        if (response.tickets) {
          response.tickets.forEach((ticket: TicketItem) => {
            const isActive =
              ticket.itemSalesActive !== false &&
              (typeof ticket.itemSalesActive === "string"
                ? new Date(ticket.itemSalesActive) <= now
                : false);

            const item = {
              value: ticket.itemId,
              label: ticket.itemName,
            };

            if (isActive) {
              activeTickets.push(item);
            } else {
              inactiveTickets.push(item);
            }
          });
        }

        // Process all merch
        if (response.merch) {
          response.merch.forEach((merch: TicketItem) => {
            const isActive =
              merch.itemSalesActive !== false &&
              (typeof merch.itemSalesActive === "string"
                ? new Date(merch.itemSalesActive) <= now
                : false);

            const item = {
              value: merch.itemId,
              label: merch.itemName,
            };

            if (isActive) {
              activeMerch.push(item);
            } else {
              inactiveMerch.push(item);
            }
          });
        }

        // Build grouped data structure for Mantine Select
        const groups: Array<{
          group: string;
          items: Array<{ value: string; label: string }>;
        }> = [];
        if (activeMerch.length > 0) {
          groups.push({ group: "Active Merch", items: activeMerch });
        }
        if (activeTickets.length > 0) {
          groups.push({ group: "Active Events", items: activeTickets });
        }
        if (inactiveMerch.length > 0) {
          groups.push({ group: "Inactive Merch", items: inactiveMerch });
        }
        if (inactiveTickets.length > 0) {
          groups.push({ group: "Inactive Events", items: inactiveTickets });
        }

        setTicketItems(groups);
      } catch (err) {
        console.error("Failed to fetch ticket items:", err);
        setTicketItems([]);
      }
    };

    fetchData();

    // Initialize canvas
    canvasRef.current = document.createElement("canvas");
    getVideoDevices();
    return () => {
      stopScanning();
      if (animationFrameId.current) {
        cancelAnimationFrame(animationFrameId.current);
      }
    };
  }, []);

  const processVideoFrame = async (
    video: HTMLVideoElement,
  ): Promise<string | null> => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return null;
    }

    const width = video.videoWidth;
    const height = video.videoHeight;

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
    if (
      !isScanningRef.current ||
      !videoRef.current ||
      !streamRef.current ||
      showModal
    ) {
      return;
    }

    try {
      const qrCode = await processVideoFrame(videoRef.current);
      if (qrCode && qrCode !== lastScannedCode) {
        try {
          const parsedData = JSON.parse(qrCode);
          if (["merch", "ticket"].includes(parsedData.type)) {
            const now = Date.now();
            if (now - lastScanTime.current > 2000) {
              lastScanTime.current = now;
              setLastScannedCode(qrCode);
              setIsLoading(true);
              await handleSuccessfulScan(parsedData);
              setIsLoading(false);
            }
          }
        } catch (err) {
          console.warn("Invalid QR code format:", err);
        }
      }
    } catch (err) {
      console.error("Frame processing error:", err);
    }

    // Schedule next frame if still scanning
    if (isScanningRef.current) {
      animationFrameId.current = requestAnimationFrame(processFrame);
    }
  };

  const startScanning = async () => {
    try {
      setError("");
      setIsLoading(true);
      setIsScanning(true);
      isScanningRef.current = true;
      setLastScannedCode("");
      lastScanTime.current = 0;

      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }

      if (animationFrameId.current) {
        cancelAnimationFrame(animationFrameId.current);
      }

      const constraints = {
        video: selectedDevice
          ? { deviceId: { exact: selectedDevice } }
          : { facingMode: "environment" },
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);

      // After getting stream, refresh device list to get labels
      if (!videoDevices.some((device) => device.label)) {
        getVideoDevices();
      }

      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;

        await new Promise<void>((resolve) => {
          if (videoRef.current) {
            videoRef.current.onloadeddata = () => {
              resolve();
            };
          }
        });

        await videoRef.current.play();
        setIsLoading(false);

        animationFrameId.current = requestAnimationFrame(processFrame);
      }
    } catch (err) {
      console.error("Start scanning error:", err);
      setError(err instanceof Error ? err.message : "Failed to start camera");
      setIsScanning(false);
      isScanningRef.current = false;
      setIsLoading(false);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
    }
  };

  const stopScanning = () => {
    setIsScanning(false);
    isScanningRef.current = false; // Immediate update
    setIsLoading(false);

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
  };

  const handleSuccessfulScan = async (parsedData: QRData) => {
    try {
      const result = await checkInTicket(parsedData);
      if (!result.valid) {
        throw new Error("Ticket is invalid.");
      }
      setScanResult(result);
      setShowModal(true);
    } catch (err: any) {
      if (err.response && err.response.data) {
        setError(
          err.response.data
            ? `Error ${err.response.data.id} (${err.response.data.name}): ${err.response.data.message}`
            : "System encountered a failure, please contact the ACM Infra Chairs.",
        );
      } else {
        setError(
          err instanceof Error ? err.message : "Failed to process ticket",
        );
      }
      setShowModal(true);
    }
  };

  const handleNextScan = () => {
    setScanResult(null);
    setError("");
    setShowModal(false);
    setManualInput("");
  };

  const handleManualInputSubmit = async () => {
    if (!manualInput.trim() || !selectedItemFilter) {
      return;
    }

    try {
      setIsLoading(true);
      setError("");

      let email = manualInput.trim();

      // Check if input is UIN (all digits)
      if (/^\d+$/.test(email)) {
        try {
          const netId = await getNetIdFromUINProp(email);
          email = `${netId}@illinois.edu`;
        } catch (err) {
          setError(
            "Failed to convert UIN to NetID. Please enter NetID or email instead.",
          );
          setIsLoading(false);
          return;
        }
      }
      // Check if input is NetID (no @ symbol)
      else if (!email.includes("@")) {
        email = `${email}@illinois.edu`;
      }

      // Fetch purchases for this email
      const response = await getPurchasesByEmail(email);

      // Combine all valid tickets (both merch and tickets) and filter by selected item
      const allValidTickets = [
        ...response.tickets.filter(
          (t) =>
            t.valid &&
            !t.refunded &&
            t.purchaserData.productId === selectedItemFilter,
        ),
        ...response.merch.filter(
          (m) =>
            m.valid &&
            !m.refunded &&
            m.purchaserData.productId === selectedItemFilter,
        ),
      ];

      if (allValidTickets.length === 0) {
        setError(
          "No valid tickets found for this user and selected event/item.",
        );
        setShowModal(true);
        setIsLoading(false);
        return;
      }

      if (allValidTickets.length === 1) {
        // Only one valid ticket, mark it automatically
        await markTicket(allValidTickets[0]);
      } else {
        // Multiple valid tickets, show selection modal
        setAvailableTickets(allValidTickets);
        setShowTicketSelection(true);
      }

      setIsLoading(false);
    } catch (err: any) {
      setIsLoading(false);
      if (err.response && err.response.data) {
        setError(
          err.response.data
            ? `Error ${err.response.data.id} (${err.response.data.name}): ${err.response.data.message}`
            : "System encountered a failure, please contact the ACM Infra Chairs.",
        );
      } else {
        setError(
          "Failed to fetch ticket information. Please check your connection and try again.",
        );
      }
      setShowModal(true);
    }
  };

  const markTicket = async (ticket: APIResponseSchema) => {
    try {
      setIsLoading(true);
      const qrData =
        ticket.type === ProductType.Ticket
          ? { type: "ticket", ticketId: ticket.ticketId }
          : {
              type: "merch",
              stripePi: ticket.ticketId,
              email: ticket.purchaserData.email,
            };

      const result = await checkInTicket(qrData);

      if (!result.valid) {
        throw new Error("Ticket is invalid.");
      }

      setScanResult(result);
      setShowModal(true);
      setShowTicketSelection(false);
      setIsLoading(false);
    } catch (err: any) {
      setIsLoading(false);
      setShowTicketSelection(false);
      if (err.response && err.response.data) {
        setError(
          err.response.data
            ? `Error ${err.response.data.id} (${err.response.data.name}): ${err.response.data.message}`
            : "System encountered a failure, please contact the ACM Infra Chairs.",
        );
      } else {
        setError(
          err instanceof Error ? err.message : "Failed to process ticket",
        );
      }
      setShowModal(true);
    }
  };

  if (orgList === null || ticketItems === null) {
    return <FullScreenLoader />;
  }

  return (
    <AuthGuard
      resourceDef={{ service: "core", validRoles: [AppRoles.TICKETS_SCANNER] }}
    >
      <Box p="md">
        <Title order={2}>Scan Tickets</Title>
        <Paper shadow="sm" p="md" withBorder maw={600} mx="auto" w="100%">
          <Stack align="center" w="100%">
            {ticketItems !== null && (
              <Select
                label="Select Event/Item"
                placeholder="Select an event or item to begin"
                data={ticketItems}
                value={selectedItemFilter}
                onChange={setSelectedItemFilter}
                searchable
                disabled={isLoading}
                w="100%"
                required
              />
            )}

            {selectedItemFilter && (
              <>
                <TextInput
                  label="Manual Entry (UIN, NetID, or Email)"
                  placeholder="Enter UIN, NetID, or Email"
                  value={manualInput}
                  onChange={(e) => setManualInput(e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      handleManualInputSubmit();
                    }
                  }}
                  disabled={isLoading}
                  w="100%"
                />

                <Button
                  onClick={handleManualInputSubmit}
                  disabled={isLoading || !manualInput.trim()}
                  fullWidth
                >
                  Submit Manual Entry
                </Button>

                <div
                  style={{
                    width: "100%",
                    minHeight: "400px",
                    maxHeight: "70vh",
                    height: "100%",
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
                    }}
                    playsInline
                    muted
                  />
                  <LoadingOverlay visible={isLoading} />
                </div>

                <Select
                  label="Select Camera"
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
                  disabled={isLoading || isScanning}
                  mb="md"
                />

                <Button
                  onClick={isScanning ? stopScanning : startScanning}
                  leftSection={<IconCamera size={16} />}
                  color={isScanning ? "red" : "blue"}
                  fullWidth
                >
                  {isScanning ? "Stop Camera" : "Start Camera"}
                </Button>

                {error && !showModal && (
                  <Alert
                    icon={<IconAlertCircle size={16} />}
                    title="Error"
                    color="red"
                    variant="filled"
                  >
                    {error}
                  </Alert>
                )}
              </>
            )}
          </Stack>
        </Paper>

        <Modal
          opened={showModal}
          onClose={handleNextScan}
          title={error ? "Scan Error - DO NOT HONOR" : "Scan Result"}
          size="lg"
          centered
        >
          {error ? (
            <Alert
              icon={<IconAlertCircle size={16} />}
              title={<Text fw={900}>Error</Text>}
              color="red"
              variant="filled"
            >
              {error}
            </Alert>
          ) : (
            scanResult && (
              <Stack>
                <Alert
                  icon={<IconCheck size={16} />}
                  title={<Text fw={900}>Success</Text>}
                  color="green"
                  variant="filled"
                >
                  <Text fw={700}>Ticket verified successfully!</Text>
                </Alert>

                <Paper p="md" withBorder>
                  <Stack>
                    <Text fw={700}>Ticket Details:</Text>
                    <Text>Type: {scanResult?.type.toLocaleUpperCase()}</Text>
                    {scanResult.purchaserData.productId && (
                      <Text>Product: {scanResult.purchaserData.productId}</Text>
                    )}
                    <Text>
                      Token ID: <code>{scanResult?.ticketId}</code>
                    </Text>
                    <Text>Email: {scanResult?.purchaserData.email}</Text>
                    {scanResult.purchaserData.quantity && (
                      <Text>Quantity: {scanResult.purchaserData.quantity}</Text>
                    )}
                    {scanResult.purchaserData.size && (
                      <Text>Size: {scanResult.purchaserData.size}</Text>
                    )}
                  </Stack>
                </Paper>

                <Group justify="flex-end" mt="md">
                  <Button onClick={handleNextScan}>Close</Button>
                </Group>
              </Stack>
            )
          )}
        </Modal>

        <Modal
          opened={showTicketSelection}
          onClose={() => {
            setShowTicketSelection(false);
            setManualInput("");
          }}
          title="Select a Ticket"
          size="lg"
          centered
        >
          <Stack>
            <Text>
              Multiple valid tickets found. Please select which one to mark:
            </Text>
            {availableTickets.map((ticket, index) => (
              <Paper
                key={`${ticket.ticketId}-${index}`}
                p="md"
                withBorder
                style={{ cursor: "pointer" }}
                onClick={() => markTicket(ticket)}
              >
                <Stack gap="xs">
                  <Text fw={700}>
                    {ticket.type.toUpperCase()} -{" "}
                    {ticket.purchaserData.productId}
                  </Text>
                  <Text size="sm">Email: {ticket.purchaserData.email}</Text>
                  {ticket.purchaserData.quantity && (
                    <Text size="sm">
                      Quantity: {ticket.purchaserData.quantity}
                    </Text>
                  )}
                  {ticket.purchaserData.size && (
                    <Text size="sm">Size: {ticket.purchaserData.size}</Text>
                  )}
                  <Text size="xs" c="dimmed">
                    Ticket ID: {ticket.ticketId}
                  </Text>
                </Stack>
              </Paper>
            ))}
            <Group justify="flex-end" mt="md">
              <Button
                variant="subtle"
                onClick={() => {
                  setShowTicketSelection(false);
                  setManualInput("");
                }}
              >
                Cancel
              </Button>
            </Group>
          </Stack>
        </Modal>
      </Box>
    </AuthGuard>
  );
};
