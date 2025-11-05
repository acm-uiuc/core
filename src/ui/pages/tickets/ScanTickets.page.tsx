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
  Checkbox,
  MantineColor,
  MantineTheme,
} from "@mantine/core";
import { IconAlertCircle, IconCheck, IconCamera } from "@tabler/icons-react";
import jsQR from "jsqr";
import React, { useEffect, useState, useRef } from "react";

import FullScreenLoader from "@ui/components/AuthContext/LoadingScreen";
import { AuthGuard } from "@ui/components/AuthGuard";
import { useApi } from "@ui/util/api";
import { AppRoles } from "@common/roles";
import { ValidationError } from "@common/errors";

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
  getEmailFromUIN?: (uin: string) => Promise<string>;
}

const ScanTicketsPageInternal: React.FC<ScanTicketsPageProps> = ({
  getOrganizations: getOrganizationsProp,
  getTicketItems: getTicketItemsProp,
  getPurchasesByEmail: getPurchasesByEmailProp,
  checkInTicket: checkInTicketProp,
  getEmailFromUIN: getEmailFromUINProp,
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
  const [unclaimableTicketsForSelection, setUnclaimableTicketsForSelection] =
    useState<APIResponseSchema[]>([]);
  // State for multi-select
  const [selectedTicketsToClaim, setSelectedTicketsToClaim] = useState(
    new Set<string>(),
  );
  // State for bulk success results
  const [bulkScanResults, setBulkScanResults] = useState<APIResponseSchema[]>(
    [],
  );
  const [ticketItems, setTicketItems] = useState<Array<{
    group: string;
    items: Array<{ value: string; label: string }>;
  }> | null>(null);
  const [selectedItemFilter, setSelectedItemFilter] = useState<string | null>(
    null,
  );
  // **NEW**: State to hold the mapping of productId to friendly name
  const [productNameMap, setProductNameMap] = useState<Map<string, string>>(
    new Map(),
  );

  const api = useApi("core");
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationFrameId = useRef<number>(0);
  const lastScanTime = useRef<number>(0);
  const isScanningRef = useRef(false); // Use ref for immediate updates
  const manualInputRef = useRef<HTMLInputElement | null>(null);

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

  const getEmailFromUINDefault = async (uin: string): Promise<string> => {
    try {
      const response = await api.post(`/api/v1/users/findUserByUin`, { uin });
      return response.data.email;
    } catch (error: any) {
      const samp = new ValidationError({
        message: "Failed to convert UIN to email.",
      });
      if (
        error.response?.status === samp.httpStatusCode &&
        error.response?.data.id === samp.id
      ) {
        const validationData = error.response.data;
        throw new ValidationError(validationData.message || samp.message);
      }
      throw error;
    }
  };

  const getEmailFromUIN = getEmailFromUINProp || getEmailFromUINDefault;

  // **NEW**: Helper function to get the friendly name
  const getFriendlyName = (productId: string): string => {
    return productNameMap.get(productId) || productId; // Fallback to the ID if not found
  };

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

        // **NEW**: Create the product name map
        const newProductMap = new Map<string, string>();

        const now = new Date();

        // Process all tickets
        if (response.tickets) {
          response.tickets.forEach((ticket: TicketItem) => {
            // **NEW**: Add to map
            newProductMap.set(ticket.itemId, ticket.itemName);

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
            // **NEW**: Add to map
            newProductMap.set(merch.itemId, merch.itemName);

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

        // **NEW**: Set the product map state
        setProductNameMap(newProductMap);

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
    setBulkScanResults([]); // Clear bulk results
    setSelectedTicketsToClaim(new Set()); // Clear selection
    // Refocus the manual input field for easy card swiping
    setTimeout(() => {
      manualInputRef.current?.focus();
    }, 100);
  };

  const handleManualInputSubmit = async () => {
    if (!manualInput.trim() || !selectedItemFilter) {
      return;
    }

    const inputValue = manualInput.trim();
    setManualInput(""); // Clear input immediately

    try {
      setIsLoading(true);
      setError("");

      let email = inputValue;

      // Check if input is UIN (all digits)
      if (/^\d+$/.test(email)) {
        try {
          email = await getEmailFromUIN(email);
        } catch (err) {
          let errorMessage =
            "Failed to convert UIN to email. Please enter NetID or email instead.";
          if (err instanceof ValidationError) {
            errorMessage = err.message;
          }
          setError(errorMessage);
          setIsLoading(false);
          setShowModal(true);
          return;
        }
      }
      // Check if input is NetID (no @ symbol)
      else if (!email.includes("@")) {
        email = `${email}@illinois.edu`;
      }

      // Fetch purchases for this email
      const response = await getPurchasesByEmail(email);

      // --- REFACTORED LOGIC ---

      // 1. Get ALL purchases for the selected item, regardless of status.
      const allPurchasesForItem = [
        ...response.tickets.filter(
          (t) => t.purchaserData.productId === selectedItemFilter,
        ),
        ...response.merch.filter(
          (m) => m.purchaserData.productId === selectedItemFilter,
        ),
      ];

      // 2. Check if we found anything at all.
      if (allPurchasesForItem.length === 0) {
        setError("No purchases found for this user and selected event/item.");
        setShowModal(true);
        setIsLoading(false);
        return;
      }

      // 3. Partition these purchases.
      // A "claimable" ticket is valid, not refunded, and not already fulfilled.
      const claimableTickets = allPurchasesForItem.filter(
        (p) => p.valid && !p.refunded && !p.fulfilled,
      );

      // An "unclaimable" ticket is everything else.
      const unclaimableTickets = allPurchasesForItem.filter(
        (p) => !p.valid || p.refunded || p.fulfilled,
      );

      // 4. Apply new logic based on the user's request.

      // Case 1: No claimable tickets.
      if (claimableTickets.length === 0) {
        let errorMessage = "No valid, unclaimed tickets found for this user.";
        if (unclaimableTickets.length > 0) {
          // Provide a more specific error based on the first unclaimable ticket.
          const firstReason = unclaimableTickets[0];
          if (firstReason.fulfilled) {
            errorMessage =
              "All tickets for this event have already been claimed.";
          } else if (firstReason.refunded) {
            errorMessage = "This user's ticket has been refunded.";
          } else if (!firstReason.valid) {
            errorMessage = "This user's ticket is invalid.";
          }
        }
        setError(errorMessage);
        setShowModal(true);
        setIsLoading(false);
        return;
      }

      // Case 2: Exactly one claimable ticket AND no other context (unclaimable tickets) to show.
      // We can auto-mark this one.
      if (claimableTickets.length === 1 && unclaimableTickets.length === 0) {
        await markTicket(claimableTickets[0]);
      } else {
        // Case 3: Multiple claimable tickets OR a mix of claimable/unclaimable tickets.
        // Show the selection modal to provide full context.
        setAvailableTickets(claimableTickets);
        setUnclaimableTicketsForSelection(unclaimableTickets);
        setSelectedTicketsToClaim(new Set()); // Ensure selection is clear
        setShowTicketSelection(true);
      }
      // --- END REFACTORED LOGIC ---

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

  /**
   * Extracted helper function to just process the API call for a single ticket.
   * Returns a success or error object. Does not set state.
   */
  const processTicketCheckIn = async (ticket: APIResponseSchema) => {
    try {
      const checkInData =
        ticket.type === ProductType.Merch
          ? {
              type: "merch",
              stripePi: ticket.ticketId,
              email: ticket.purchaserData.email,
            }
          : { type: "ticket", ticketId: ticket.ticketId };

      const result = await checkInTicket(checkInData);

      if (!result.valid) {
        throw new Error("Ticket is invalid.");
      }
      return { success: true, result };
    } catch (err: any) {
      let errorMessage = "Failed to process ticket";
      if (err.response && err.response.data) {
        errorMessage = err.response.data
          ? `Error ${err.response.data.id} (${err.response.data.name}): ${err.response.data.message}`
          : "System encountered a failure, please contact the ACM Infra Chairs.";
      } else if (err instanceof Error) {
        errorMessage = err.message;
      }
      return { success: false, error: errorMessage, ticketId: ticket.ticketId };
    }
  };

  /**
   * Handles claiming a *single* ticket (e.g., from auto-claim).
   * This function calls the helper and then sets state to show the modal.
   */
  const markTicket = async (ticket: APIResponseSchema) => {
    setIsLoading(true);
    setShowTicketSelection(false); // Close selection modal if open

    const { success, result, error } = await processTicketCheckIn(ticket);

    if (success && result) {
      setScanResult(result);
      setShowModal(true);
    } else {
      setError(error || "Failed to process ticket");
      setShowModal(true);
    }

    // Clear selection state regardless
    setAvailableTickets([]);
    setUnclaimableTicketsForSelection([]);
    setSelectedTicketsToClaim(new Set());
    setIsLoading(false);
  };

  /**
   * Handles claiming all *selected* tickets from the multi-select modal.
   */
  const handleClaimSelectedTickets = async () => {
    setIsLoading(true);

    const ticketsToClaim = availableTickets.filter((t) =>
      selectedTicketsToClaim.has(t.ticketId),
    );

    const results = await Promise.allSettled(
      ticketsToClaim.map(processTicketCheckIn),
    );

    const successfulClaims = results.filter(
      (r) => r.status === "fulfilled" && r.value.success,
    ) as PromiseFulfilledResult<{ success: true; result: APIResponseSchema }>[];

    const failedClaims = results.filter(
      (r) =>
        r.status === "rejected" ||
        (r.status === "fulfilled" && !r.value.success),
    );

    // Close the selection modal and clear state
    setShowTicketSelection(false);
    setAvailableTickets([]);
    setUnclaimableTicketsForSelection([]);
    setSelectedTicketsToClaim(new Set());
    setIsLoading(false);

    if (failedClaims.length > 0) {
      // Show the first error
      let firstError = "An unknown error occurred.";
      const firstFailure = failedClaims[0];
      if (firstFailure.status === "rejected") {
        firstError =
          firstFailure.reason instanceof Error
            ? firstFailure.reason.message
            : String(firstFailure.reason);
      } else if (firstFailure.status === "fulfilled") {
        firstError = (firstFailure.value as { success: false; error: string })
          .error;
      }
      setError(
        `Failed to claim ${failedClaims.length} ticket(s). First error: ${firstError}`,
      );
    } else if (successfulClaims.length > 0) {
      // All succeeded - store results for detailed display
      setBulkScanResults(successfulClaims.map((r) => r.value.result));
    }
    // (If successfulClaims.length === 0 and failedClaims.length === 0, nothing was selected, do nothing)

    setShowModal(true); // Show the main modal with results
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
                  ref={manualInputRef}
                  disabled={isLoading}
                  autoComplete="off"
                  autoCapitalize="off"
                  autoFocus
                  autoCorrect="off"
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

        {/* Main Result Modal */}
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
          ) : bulkScanResults.length > 0 ? (
            // Bulk Success Message with Details
            <Stack>
              <Alert
                icon={<IconCheck size={16} />}
                title={<Text fw={900}>Success</Text>}
                color="green"
                variant="filled"
              >
                <Text fw={700}>
                  Successfully claimed {bulkScanResults.length} ticket(s)!
                </Text>
              </Alert>

              {bulkScanResults.map((result, index) => (
                <Paper p="md" withBorder key={`${result.ticketId}-${index}`}>
                  <Stack>
                    <Text fw={700}>
                      Ticket {index + 1} of {bulkScanResults.length} Details:
                    </Text>
                    <Text>Type: {result.type.toLocaleUpperCase()}</Text>
                    {result.purchaserData.productId && (
                      <Text>
                        Product:{" "}
                        {getFriendlyName(result.purchaserData.productId)}
                      </Text>
                    )}
                    <Text>Email: {result.purchaserData.email}</Text>
                    {result.purchaserData.quantity && (
                      <Text>Quantity: {result.purchaserData.quantity}</Text>
                    )}
                    {result.purchaserData.size && (
                      <Text>Size: {result.purchaserData.size}</Text>
                    )}
                  </Stack>
                </Paper>
              ))}

              <Group justify="flex-end" mt="md">
                <Button onClick={handleNextScan}>Close</Button>
              </Group>
            </Stack>
          ) : (
            // Single Scan Result
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
                      <Text>
                        {/* **MODIFIED** */}
                        Product:{" "}
                        {getFriendlyName(scanResult.purchaserData.productId)}
                      </Text>
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

        {/* Ticket Selection Modal (for multi-select) */}
        <Modal
          opened={showTicketSelection}
          onClose={() => {
            setShowTicketSelection(false);
            setAvailableTickets([]);
            setUnclaimableTicketsForSelection([]);
            setSelectedTicketsToClaim(new Set()); // Clear selection
            setManualInput("");
          }}
          title="Select Ticket(s) to Claim"
          size="lg"
          centered
          withCloseButton={!isLoading}
          closeOnClickOutside={!isLoading}
          closeOnEscape={!isLoading}
        >
          <LoadingOverlay visible={isLoading} />
          <Stack>
            <Text>
              Multiple purchases found. Please select which one(s) to claim:
            </Text>
            {/* Render Claimable Tickets with Checkboxes */}
            {availableTickets.map((ticket, index) => (
              <Paper
                key={`${ticket.ticketId}-${index}`}
                p="md"
                withBorder
                // --- CLICKABLE CARD LOGIC ---
                onClick={() => {
                  const newSet = new Set(selectedTicketsToClaim);
                  if (newSet.has(ticket.ticketId)) {
                    newSet.delete(ticket.ticketId);
                  } else {
                    newSet.add(ticket.ticketId);
                  }
                  setSelectedTicketsToClaim(newSet);
                }}
                style={(theme: MantineTheme) => ({
                  borderLeft: `5px solid ${theme.colors.green[6]}`,
                  cursor: "pointer",
                  "&:hover": {
                    backgroundColor: theme.colors.gray[0],
                  },
                })}
              >
                <Group>
                  <Checkbox
                    checked={selectedTicketsToClaim.has(ticket.ticketId)}
                    readOnly
                    tabIndex={-1} // Removed from tab order, card is the control
                    aria-label={`Select ticket ${ticket.ticketId}`}
                  />
                  <Stack gap="xs" style={{ flex: 1 }}>
                    <Text fw={700}>
                      {getFriendlyName(ticket.purchaserData.productId)}
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
                    <Text size="xs" c="green" fw={700}>
                      Status: AVAILABLE
                    </Text>
                    <Text size="xs" c="dimmed">
                      Ticket ID: {ticket.ticketId}
                    </Text>
                  </Stack>
                </Group>
              </Paper>
            ))}

            {/* Render Unclaimable Tickets */}
            {unclaimableTicketsForSelection.map((ticket, index) => {
              let status = "Unknown";
              let color: MantineColor = "gray";
              if (ticket.fulfilled) {
                status = "ALREADY CLAIMED";
                color = "orange";
              } else if (ticket.refunded) {
                status = "REFUNDED";
                color = "red";
              } else if (!ticket.valid) {
                status = "INVALID";
                color = "red";
              }

              return (
                <Paper
                  key={`${ticket.ticketId}-${index}`}
                  p="md"
                  withBorder
                  style={(theme: MantineTheme) => ({
                    cursor: "not-allowed",
                    opacity: 0.6,
                    borderLeft: `5px solid ${theme.colors[color][6]}`,
                  })}
                >
                  <Stack gap="xs">
                    <Text fw={700} c="dimmed">
                      {/* **MODIFIED** */}
                      {ticket.type.toUpperCase()} -{" "}
                      {getFriendlyName(ticket.purchaserData.productId)}
                    </Text>
                    <Text size="sm" c="dimmed">
                      Email: {ticket.purchaserData.email}
                    </Text>
                    {ticket.purchaserData.quantity && (
                      <Text size="sm" c="dimmed">
                        Quantity: {ticket.purchaserData.quantity}
                      </Text>
                    )}
                    {ticket.purchaserData.size && (
                      <Text size="sm" c="dimmed">
                        Size: {ticket.purchaserData.size}
                      </Text>
                    )}
                    <Text size="xs" c={color} fw={700}>
                      Status: {status}
                    </Text>
                    <Text size="xs" c="dimmed">
                      Ticket ID: {ticket.ticketId}
                    </Text>
                  </Stack>
                </Paper>
              );
            })}
            <Group justify="flex-end" mt="md">
              <Button
                variant="subtle"
                disabled={isLoading}
                onClick={() => {
                  setShowTicketSelection(false);
                  setAvailableTickets([]);
                  setUnclaimableTicketsForSelection([]);
                  setSelectedTicketsToClaim(new Set());
                  setManualInput("");
                }}
              >
                Cancel
              </Button>
              <Button
                onClick={handleClaimSelectedTickets}
                disabled={selectedTicketsToClaim.size === 0 || isLoading}
                loading={isLoading}
              >
                Claim Selected ({selectedTicketsToClaim.size})
              </Button>
            </Group>
          </Stack>
        </Modal>
      </Box>
    </AuthGuard>
  );
};

// Wrapper component that provides the default implementation
export const ScanTicketsPage: React.FC<ScanTicketsPageProps> = (props) => {
  return <ScanTicketsPageInternal {...props} />;
};
