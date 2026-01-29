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
import React, { useEffect, useState, useRef, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
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

interface TicketItem {
  itemId: string;
  itemName: string;
  itemSalesActive: string | false;
}

interface TicketItemsResponse {
  tickets: TicketItem[];
  merch: TicketItem[];
}

interface FulfillStorePurchasesPageProps {
  getOrganizations?: () => Promise<string[]>;
  getTicketItems?: () => Promise<TicketItemsResponse>;
  getPurchasesByUin?: (email: string) => Promise<PurchasesByEmailResponse>;
  checkInTicket?: (
    data:
      | QRData
      | { type: string; ticketId?: string; email?: string; stripePi?: string },
  ) => Promise<APIResponseSchema>;
}

const FulfillStorePurchasesInternal: React.FC<
  FulfillStorePurchasesPageProps
> = ({
  getOrganizations: getOrganizationsProp,
  getTicketItems: getTicketItemsProp,
  getPurchasesByUin: getPurchasesByUinProp,
  checkInTicket: checkInTicketProp,
}) => {
  const [searchParams, setSearchParams] = useSearchParams();
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
  const [selectedTicketsToClaim, setSelectedTicketsToClaim] = useState(
    new Set<string>(),
  );
  const [bulkScanResults, setBulkScanResults] = useState<APIResponseSchema[]>(
    [],
  );
  const [ticketItems, setTicketItems] = useState<Array<{
    group: string;
    items: Array<{ value: string; label: string }>;
  }> | null>(null);
  const [selectedItemFilter, setSelectedItemFilter] = useState<string | null>(
    searchParams.get("itemId") || null,
  );
  const [productNameMap, setProductNameMap] = useState<Map<string, string>>(
    new Map(),
  );

  const api = useApi("core");
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationFrameId = useRef<number>(0);
  const lastScanTime = useRef<number>(0);
  const isScanningRef = useRef(false);
  const manualInputRef = useRef<HTMLInputElement | null>(null);

  const getOrganizations =
    getOrganizationsProp ||
    useCallback(async () => {
      const response = await api.get("/api/v1/organizations");
      return response.data;
    }, [api]);

  const getTicketItems =
    getTicketItemsProp ||
    useCallback(async () => {
      const response = await api.get("/api/v1/tickets");
      return response.data;
    }, [api]);

  const getPurchasesByUin =
    getPurchasesByUinProp ||
    useCallback(
      async (uin: string, productId: string) => {
        const response = await api.post<PurchasesByEmailResponse>(
          `/api/v1/tickets/getPurchasesByUser`,
          { uin, productId },
        );
        return response.data;
      },
      [api],
    );

  const checkInTicket =
    checkInTicketProp ||
    useCallback(
      async (data: any) => {
        const response = await api.post(
          `/api/v1/store/checkIn`,
          recursiveToCamel(data),
        );
        return response.data as APIResponseSchema;
      },
      [api],
    );

  const getFriendlyName = (productId: string): string => {
    return productNameMap.get(productId) || productId;
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

        const newProductMap = new Map<string, string>();
        const now = new Date();

        if (response.tickets) {
          response.tickets.forEach((ticket: TicketItem) => {
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

        if (response.merch) {
          response.merch.forEach((merch: TicketItem) => {
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

        setProductNameMap(newProductMap);

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

        const itemIdFromUrl = searchParams.get("itemId");
        if (itemIdFromUrl) {
          const allItems = groups.flatMap((g) => g.items);
          if (allItems.some((item) => item.value === itemIdFromUrl)) {
            setSelectedItemFilter(itemIdFromUrl);
          } else {
            setSelectedItemFilter(null);
            setSearchParams({}, { replace: true });
          }
        }
      } catch (err) {
        console.error("Failed to fetch ticket items:", err);
        setTicketItems([]);
      }
    };

    fetchData();
    canvasRef.current = document.createElement("canvas");
    getVideoDevices();

    return () => {
      stopScanning();
      if (animationFrameId.current) {
        cancelAnimationFrame(animationFrameId.current);
      }
    };
  }, [getOrganizations, getTicketItems, searchParams, setSearchParams]);

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

  /**
   * Reusable function to handle UIN-based ticket lookup and claiming
   */
  const handleUinLookup = async (uin: string) => {
    if (!selectedItemFilter) {
      setError("Please select an event/item before scanning.");
      setShowModal(true);
      return;
    }

    if (!/^\d{9}$/.test(uin)) {
      setError("Invalid input - UIN must be exactly 9 digits.");
      setShowModal(true);
      return;
    }

    setIsLoading(true);
    setError("");

    try {
      const response = await getPurchasesByUin(uin, selectedItemFilter);

      const allPurchasesForItem = [
        ...response.tickets.filter(
          (t) => t.purchaserData.productId === selectedItemFilter,
        ),
        ...response.merch.filter(
          (m) => m.purchaserData.productId === selectedItemFilter,
        ),
      ];

      if (allPurchasesForItem.length === 0) {
        setError("No purchases found for this user and selected event/item.");
        setShowModal(true);
        setIsLoading(false);
        return;
      }

      const claimableTickets = allPurchasesForItem.filter(
        (p) => p.valid && !p.refunded && !p.fulfilled,
      );

      const unclaimableTickets = allPurchasesForItem.filter(
        (p) => !p.valid || p.refunded || p.fulfilled,
      );

      if (claimableTickets.length === 0) {
        let errorMessage = "No valid, unclaimed tickets found for this user.";
        if (unclaimableTickets.length > 0) {
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

      if (claimableTickets.length === 1 && unclaimableTickets.length === 0) {
        await markTicket(claimableTickets[0]);
      } else {
        setAvailableTickets(claimableTickets);
        setUnclaimableTicketsForSelection(unclaimableTickets);
        setSelectedTicketsToClaim(new Set());
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
        // Check if it's an iCard QR code (4 digits, UIN, 3 digits digits followed by =)
        const isICardQR = /^\d{16}=/.test(qrCode);

        if (isICardQR) {
          const now = Date.now();
          if (now - lastScanTime.current > 2000) {
            lastScanTime.current = now;
            setLastScannedCode(qrCode);
            setIsLoading(true);
            await handleSuccessfulScan(qrCode);
            setIsLoading(false);
          }
        } else {
          // Try to parse as JSON for pickup QR codes
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
      }
    } catch (err) {
      console.error("Frame processing error:", err);
    }

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
    isScanningRef.current = false;
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

  const handleSuccessfulScan = async (parsedData: QRData | string) => {
    try {
      // Check if this is an iCard QR scan (16 digits followed by =)
      if (typeof parsedData === "string" && /^\d{16}=/.test(parsedData)) {
        // Extract UIN (digits 5-13, which is positions 4-12 in 0-indexed)
        const uin = parsedData.substring(4, 13);
        await handleUinLookup(uin);
        return;
      }

      // Original logic for pickup QR codes
      if (typeof parsedData === "object") {
        const result = await checkInTicket(parsedData);
        if (!result.valid) {
          throw new Error("Ticket is invalid.");
        }
        setScanResult(result);
        setShowModal(true);
      } else {
        throw new Error("Invalid QR code format.");
      }
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
    setBulkScanResults([]);
    setSelectedTicketsToClaim(new Set());

    setTimeout(() => {
      manualInputRef.current?.focus();
    }, 100);
  };

  const handleManualInputSubmit = async () => {
    if (!manualInput.trim() || !selectedItemFilter) {
      return;
    }

    const inputValue = manualInput.trim();
    setManualInput("");

    try {
      setIsLoading(true);
      setError("");

      let inp = inputValue;

      // Check if input is from ACM card swiper
      if (inp.startsWith("ACMCARD")) {
        const uinMatch = inp.match(/^ACMCARD(\d{4})(\d{9})/);
        if (!uinMatch) {
          setError("Invalid card swipe. Please try again.");
          setIsLoading(false);
          setShowModal(true);
          return;
        }
        inp = uinMatch[2];
      }

      // Use the reusable function
      await handleUinLookup(inp);
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

  const markTicket = async (ticket: APIResponseSchema) => {
    setIsLoading(true);
    setShowTicketSelection(false);

    const { success, result, error } = await processTicketCheckIn(ticket);

    if (success && result) {
      setScanResult(result);
      setShowModal(true);
    } else {
      setError(error || "Failed to process ticket");
      setShowModal(true);
    }

    setAvailableTickets([]);
    setUnclaimableTicketsForSelection([]);
    setSelectedTicketsToClaim(new Set());
    setIsLoading(false);
  };

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

    setShowTicketSelection(false);
    setAvailableTickets([]);
    setUnclaimableTicketsForSelection([]);
    setSelectedTicketsToClaim(new Set());
    setIsLoading(false);

    if (failedClaims.length > 0) {
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
      setBulkScanResults(successfulClaims.map((r) => r.value.result));
    }

    setShowModal(true);
  };

  const handleItemFilterChange = useCallback(
    (value: string | null) => {
      setSelectedItemFilter(value);
      if (value) {
        setSearchParams({ itemId: value }, { replace: true });
      } else {
        setSearchParams({}, { replace: true });
      }
    },
    [setSearchParams],
  );

  if (orgList === null || ticketItems === null) {
    return <FullScreenLoader />;
  }

  return (
    <AuthGuard
      resourceDef={{
        service: "core",
        validRoles: [AppRoles.STORE_FULFILLMENT, AppRoles.STORE_MANAGER],
      }}
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
                onChange={handleItemFilterChange}
                searchable
                disabled={isLoading}
                w="100%"
                required
              />
            )}

            {selectedItemFilter && (
              <>
                <TextInput
                  label="Enter UIN or Swipe iCard"
                  placeholder="Enter UIN or Swipe iCard"
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
                  Submit UIN
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

                <Text c="dimmed" size="xs" ta="center" mb="xs">
                  Scan the <strong>Pickup QR Code</strong> from their pickup
                  email, or their <strong>iCard QR Code</strong> from the
                  Illinois app.
                </Text>

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
                        Product:{" "}
                        {getFriendlyName(scanResult.purchaserData.productId)}
                      </Text>
                    )}
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

        {/* Ticket Selection Modal */}
        <Modal
          opened={showTicketSelection}
          onClose={() => {
            setShowTicketSelection(false);
            setAvailableTickets([]);
            setUnclaimableTicketsForSelection([]);
            setSelectedTicketsToClaim(new Set());
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

            {availableTickets.map((ticket, index) => (
              <Paper
                key={`${ticket.ticketId}-${index}`}
                p="md"
                withBorder
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
                    tabIndex={-1}
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
                  </Stack>
                </Group>
              </Paper>
            ))}

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

export const FulfillStorePurchasesPage: React.FC<
  FulfillStorePurchasesPageProps
> = (props) => {
  return <FulfillStorePurchasesInternal {...props} />;
};
