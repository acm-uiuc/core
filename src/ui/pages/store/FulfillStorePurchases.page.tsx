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

export interface PurchaseData {
  email: string;
  productId: string;
  quantity: number;
  variantId?: string;
}

export interface APIResponseSchema {
  valid: boolean;
  itemId: string;
  purchaserData: PurchaseData;
  refunded: boolean;
  fulfilled: boolean;
}

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

interface FulfillStorePurchasesPageProps {
  getOrganizations?: () => Promise<string[]>;
}

const FulfillStorePurchasesInternal: React.FC<
  FulfillStorePurchasesPageProps
> = ({ getOrganizations: getOrganizationsProp }) => {
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
  const [showItemSelection, setShowItemSelection] = useState(false);
  const [availableItems, setAvailableItems] = useState<APIResponseSchema[]>([]);
  const [unclaimableItems, setUnclaimableItems] = useState<APIResponseSchema[]>(
    [],
  );
  const [selectedItemsToFulfill, setSelectedItemsToFulfill] = useState(
    new Set<string>(),
  );
  const [bulkScanResults, setBulkScanResults] = useState<APIResponseSchema[]>(
    [],
  );
  // Maps itemId → { orderId, lineItemId } for order-based fulfillment
  const [pendingFulfillments, setPendingFulfillments] = useState<
    Map<string, { orderId: string; lineItemId: string }>
  >(new Map());
  const [productItems, setProductItems] = useState<Array<{
    group: string;
    items: Array<{ value: string; label: string }>;
  }> | null>(null);
  const [selectedItemFilter, setSelectedItemFilter] = useState<string | null>(
    searchParams.get("itemId") || null,
  );
  const [productNameMap, setProductNameMap] = useState<Map<string, string>>(
    new Map(),
  );
  // Maps productId → variantFriendlyName (e.g. "Size", "Color")
  const [variantFriendlyNameMap, setVariantFriendlyNameMap] = useState<
    Map<string, string>
  >(new Map());
  // Maps productId#variantId → variant display name (e.g. "Large", "Red")
  const [variantNameMap, setVariantNameMap] = useState<Map<string, string>>(
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

  const getFriendlyName = (productId: string): string => {
    return productNameMap.get(productId) || productId;
  };

  const getVariantLabel = (productId: string): string => {
    return variantFriendlyNameMap.get(productId) || "Variant";
  };

  const getVariantName = (productId: string, variantId: string): string => {
    return variantNameMap.get(`${productId}#${variantId}`) || variantId;
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
        const response = await api.get("/api/v1/store/admin/products");
        const products = response.data.products as Array<{
          productId: string;
          name: string;
          isOpen?: boolean;
          variantFriendlyName?: string;
          variants: Array<{ variantId: string; name: string }>;
        }>;

        const newProductMap = new Map<string, string>();
        const newVariantFriendlyNameMap = new Map<string, string>();
        const newVariantNameMap = new Map<string, string>();
        const openProducts: Array<{ value: string; label: string }> = [];
        const closedProducts: Array<{ value: string; label: string }> = [];

        for (const product of products) {
          newProductMap.set(product.productId, product.name);
          newVariantFriendlyNameMap.set(
            product.productId,
            product.variantFriendlyName || "Size",
          );
          for (const variant of product.variants) {
            newVariantNameMap.set(
              `${product.productId}#${variant.variantId}`,
              variant.name,
            );
          }
          const item = { value: product.productId, label: product.name };
          if (product.isOpen !== false) {
            openProducts.push(item);
          } else {
            closedProducts.push(item);
          }
        }

        setProductNameMap(newProductMap);
        setVariantFriendlyNameMap(newVariantFriendlyNameMap);
        setVariantNameMap(newVariantNameMap);

        const groups: Array<{
          group: string;
          items: Array<{ value: string; label: string }>;
        }> = [];

        if (openProducts.length > 0) {
          groups.push({ group: "Open", items: openProducts });
        }
        if (closedProducts.length > 0) {
          groups.push({ group: "Closed", items: closedProducts });
        }

        setProductItems(groups);

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
        console.error("Failed to fetch products:", err);
        setProductItems([]);
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
  }, [getOrganizations, api, searchParams, setSearchParams]);

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
   * Convert orders into the item selection format and populate pendingFulfillments map.
   */
  const presentOrdersForFulfillment = async (
    orders: Array<{
      orderId: string;
      userId: string;
      lineItems: Array<{
        lineItemId: string;
        productId: string;
        variantId: string;
        quantity: number;
        isFulfilled: boolean;
      }>;
    }>,
  ) => {
    const fulfillmentMap = new Map<
      string,
      { orderId: string; lineItemId: string }
    >();
    const claimable: APIResponseSchema[] = [];
    const unclaimable: APIResponseSchema[] = [];

    for (const order of orders) {
      for (const li of order.lineItems) {
        const itemId = `${order.orderId}#${li.lineItemId}`;
        fulfillmentMap.set(itemId, {
          orderId: order.orderId,
          lineItemId: li.lineItemId,
        });

        const entry: APIResponseSchema = {
          valid: true,
          itemId,
          purchaserData: {
            email: order.userId,
            productId: li.productId,
            quantity: li.quantity,
            variantId: li.variantId,
          },
          refunded: false,
          fulfilled: li.isFulfilled,
        };

        if (li.isFulfilled) {
          unclaimable.push(entry);
        } else {
          claimable.push(entry);
        }
      }
    }

    setPendingFulfillments(fulfillmentMap);

    if (claimable.length === 0) {
      setError("All line items have already been fulfilled.");
      setShowModal(true);
      return;
    }

    if (claimable.length === 1 && unclaimable.length === 0) {
      // Auto-fulfill single item
      const item = claimable[0];
      const fulfillment = fulfillmentMap.get(item.itemId)!;
      await api.post(
        `/api/v1/store/admin/orders/${fulfillment.orderId}/fulfill`,
        { lineItemIds: [fulfillment.lineItemId] },
      );
      setScanResult(item);
      setShowModal(true);
    } else {
      setAvailableItems(claimable);
      setUnclaimableItems(unclaimable);
      setSelectedItemsToFulfill(new Set());
      setShowItemSelection(true);
    }
  };

  /**
   * Handle order ID lookup (scanned from QR code or typed in)
   */
  const handleOrderIdLookup = async (orderId: string) => {
    setIsLoading(true);
    setError("");

    try {
      const response = await api.get(`/api/v1/store/admin/order/${orderId}`);
      const order = response.data;

      if (order.status !== "ACTIVE") {
        setError(`Order is in ${order.status} state and cannot be fulfilled.`);
        setShowModal(true);
        setIsLoading(false);
        return;
      }

      // Filter line items to the selected product if one is selected
      const lineItems = selectedItemFilter
        ? order.lineItems.filter(
            (li: any) => li.productId === selectedItemFilter,
          )
        : order.lineItems;

      if (lineItems.length === 0) {
        setError(
          selectedItemFilter
            ? "This order has no line items for the selected product."
            : "This order has no line items.",
        );
        setShowModal(true);
        setIsLoading(false);
        return;
      }

      await presentOrdersForFulfillment([
        { orderId: order.orderId, userId: order.userId, lineItems },
      ]);

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
          "Failed to fetch order information. Please check your connection and try again.",
        );
      }
      setShowModal(true);
    }
  };

  /**
   * Reusable function to handle UIN-based order lookup
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
      const response = await api.post(
        `/api/v1/store/admin/orders/fetchUserOrders?productId=${encodeURIComponent(selectedItemFilter)}&orderStatus=ACTIVE`,
        { type: "UIN", uin },
      );

      const orders = response.data as Array<{
        orderId: string;
        userId: string;
        lineItems: Array<{
          lineItemId: string;
          productId: string;
          variantId: string;
          quantity: number;
          isFulfilled: boolean;
        }>;
      }>;

      if (orders.length === 0) {
        setError("No active purchases found for this user and selected item.");
        setShowModal(true);
        setIsLoading(false);
        return;
      }

      await presentOrdersForFulfillment(orders);

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
          "Failed to fetch order information. Please check your connection and try again.",
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
        const now = Date.now();
        if (now - lastScanTime.current > 2000) {
          // Check if it's an order ID QR code
          if (qrCode.startsWith("ord_")) {
            lastScanTime.current = now;
            setLastScannedCode(qrCode);
            setIsLoading(true);
            await handleOrderIdLookup(qrCode);
            setIsLoading(false);
          }
          // Check if it's an iCard QR code (4 digits, UIN, 3 digits digits followed by =)
          else if (/^\d{16}=/.test(qrCode)) {
            lastScanTime.current = now;
            setLastScannedCode(qrCode);
            setIsLoading(true);
            const uin = qrCode.substring(4, 13);
            await handleUinLookup(uin);
            setIsLoading(false);
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

  const handleNextScan = () => {
    setScanResult(null);
    setError("");
    setShowModal(false);
    setManualInput("");
    setBulkScanResults([]);
    setSelectedItemsToFulfill(new Set());
    setPendingFulfillments(new Map());

    setTimeout(() => {
      manualInputRef.current?.focus();
    }, 100);
  };

  const handleManualInputSubmit = async () => {
    if (!manualInput.trim()) {
      return;
    }

    const inputValue = manualInput.trim();
    setManualInput("");

    try {
      setIsLoading(true);
      setError("");

      // Check if input is an order ID
      if (inputValue.startsWith("ord_")) {
        await handleOrderIdLookup(inputValue);
        return;
      }

      // Everything below requires a selected item
      if (!selectedItemFilter) {
        setError("Please select an event/item before scanning.");
        setIsLoading(false);
        setShowModal(true);
        return;
      }

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
          "Failed to fetch order information. Please check your connection and try again.",
        );
      }
      setShowModal(true);
    }
  };

  const processFulfillment = async (item: APIResponseSchema) => {
    try {
      const fulfillment = pendingFulfillments.get(item.itemId);
      if (!fulfillment) {
        throw new Error("No fulfillment data found for this item.");
      }
      await api.post(
        `/api/v1/store/admin/orders/${fulfillment.orderId}/fulfill`,
        { lineItemIds: [fulfillment.lineItemId] },
      );
      return { success: true, result: { ...item, fulfilled: true } };
    } catch (err: any) {
      let errorMessage = "Failed to fulfill item";
      if (err.response && err.response.data) {
        errorMessage = err.response.data
          ? `Error ${err.response.data.id} (${err.response.data.name}): ${err.response.data.message}`
          : "System encountered a failure, please contact the ACM Infra Chairs.";
      } else if (err instanceof Error) {
        errorMessage = err.message;
      }
      return { success: false, error: errorMessage, itemId: item.itemId };
    }
  };

  const handleFulfillSelected = async () => {
    setIsLoading(true);

    const itemsToFulfill = availableItems.filter((item) =>
      selectedItemsToFulfill.has(item.itemId),
    );

    const results = await Promise.allSettled(
      itemsToFulfill.map(processFulfillment),
    );

    const successfulClaims = results.filter(
      (r) => r.status === "fulfilled" && r.value.success,
    ) as PromiseFulfilledResult<{ success: true; result: APIResponseSchema }>[];

    const failedClaims = results.filter(
      (r) =>
        r.status === "rejected" ||
        (r.status === "fulfilled" && !r.value.success),
    );

    setShowItemSelection(false);
    setAvailableItems([]);
    setUnclaimableItems([]);
    setSelectedItemsToFulfill(new Set());
    setPendingFulfillments(new Map());
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
        `Failed to fulfill ${failedClaims.length} item(s). First error: ${firstError}`,
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

  if (orgList === null || productItems === null) {
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
        <Title order={1}>Fulfill Store Purchases</Title>
        <Paper shadow="sm" p="md" withBorder maw={600} mx="auto" w="100%">
          <Stack align="center" w="100%">
            {productItems !== null && (
              <Select
                label="Select Product"
                placeholder="Select a product to begin"
                data={productItems}
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
                  label="Enter Order ID, UIN, or Swipe iCard"
                  placeholder="Enter Order ID, UIN, or Swipe iCard"
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
                  disabled={
                    isLoading ||
                    !manualInput.trim() ||
                    (!selectedItemFilter &&
                      !manualInput.trim().startsWith("ord_"))
                  }
                  fullWidth
                >
                  Submit
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
                  Successfully fulfilled {bulkScanResults.length} item(s)!
                </Text>
              </Alert>
              {bulkScanResults.map((result, index) => (
                <Paper p="md" withBorder key={`${result.itemId}-${index}`}>
                  <Stack>
                    <Text fw={700}>
                      Item {index + 1} of {bulkScanResults.length} Details:
                    </Text>
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
                    {result.purchaserData.variantId && (
                      <Text>
                        {getVariantLabel(result.purchaserData.productId)}:{" "}
                        {getVariantName(
                          result.purchaserData.productId,
                          result.purchaserData.variantId,
                        )}
                      </Text>
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
                  <Text fw={700}>Item fulfilled successfully!</Text>
                </Alert>
                <Paper p="md" withBorder>
                  <Stack>
                    <Text fw={700}>Fulfillment Details:</Text>
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
                    {scanResult.purchaserData.variantId && (
                      <Text>
                        {getVariantLabel(scanResult.purchaserData.productId)}:{" "}
                        {getVariantName(
                          scanResult.purchaserData.productId,
                          scanResult.purchaserData.variantId,
                        )}
                      </Text>
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

        {/* Item Selection Modal */}
        <Modal
          opened={showItemSelection}
          onClose={() => {
            setShowItemSelection(false);
            setAvailableItems([]);
            setUnclaimableItems([]);
            setSelectedItemsToFulfill(new Set());
            setPendingFulfillments(new Map());
            setManualInput("");
          }}
          title="Select Item(s) to Fulfill"
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

            {availableItems.map((item, index) => (
              <Paper
                key={`${item.itemId}-${index}`}
                p="md"
                withBorder
                onClick={() => {
                  const newSet = new Set(selectedItemsToFulfill);
                  if (newSet.has(item.itemId)) {
                    newSet.delete(item.itemId);
                  } else {
                    newSet.add(item.itemId);
                  }
                  setSelectedItemsToFulfill(newSet);
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
                    checked={selectedItemsToFulfill.has(item.itemId)}
                    readOnly
                    tabIndex={-1}
                    aria-label={`Select item ${item.itemId}`}
                  />
                  <Stack gap="xs" style={{ flex: 1 }}>
                    <Text fw={700}>
                      {getFriendlyName(item.purchaserData.productId)}
                    </Text>
                    <Text size="sm">Email: {item.purchaserData.email}</Text>
                    {item.purchaserData.quantity && (
                      <Text size="sm">
                        Quantity: {item.purchaserData.quantity}
                      </Text>
                    )}
                    {item.purchaserData.variantId && (
                      <Text size="sm">
                        {getVariantLabel(item.purchaserData.productId)}:{" "}
                        {getVariantName(
                          item.purchaserData.productId,
                          item.purchaserData.variantId,
                        )}
                      </Text>
                    )}
                    <Text size="xs" c="green" fw={700}>
                      Status: AVAILABLE
                    </Text>
                  </Stack>
                </Group>
              </Paper>
            ))}

            {unclaimableItems.map((item, index) => {
              let status = "Unknown";
              let color: MantineColor = "gray";
              if (item.fulfilled) {
                status = "ALREADY FULFILLED";
                color = "orange";
              } else if (item.refunded) {
                status = "REFUNDED";
                color = "red";
              } else if (!item.valid) {
                status = "INVALID";
                color = "red";
              }

              return (
                <Paper
                  key={`${item.itemId}-${index}`}
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
                      {getFriendlyName(item.purchaserData.productId)}
                    </Text>
                    <Text size="sm" c="dimmed">
                      Email: {item.purchaserData.email}
                    </Text>
                    {item.purchaserData.quantity && (
                      <Text size="sm" c="dimmed">
                        Quantity: {item.purchaserData.quantity}
                      </Text>
                    )}
                    {item.purchaserData.variantId && (
                      <Text size="sm" c="dimmed">
                        {getVariantLabel(item.purchaserData.productId)}:{" "}
                        {getVariantName(
                          item.purchaserData.productId,
                          item.purchaserData.variantId,
                        )}
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
                  setShowItemSelection(false);
                  setAvailableItems([]);
                  setUnclaimableItems([]);
                  setSelectedItemsToFulfill(new Set());
                  setPendingFulfillments(new Map());
                  setManualInput("");
                }}
              >
                Cancel
              </Button>
              <Button
                onClick={handleFulfillSelected}
                disabled={selectedItemsToFulfill.size === 0 || isLoading}
                loading={isLoading}
              >
                Fulfill Selected ({selectedItemsToFulfill.size})
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
