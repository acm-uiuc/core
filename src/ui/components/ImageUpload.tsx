import React, { useState, useCallback, useRef, useEffect } from "react";
import { Button, Group, Image, Slider, Stack, Text } from "@mantine/core";
import { Dropzone } from "@mantine/dropzone";
import { IconPhoto, IconUpload, IconX } from "@tabler/icons-react";
import SparkMD5 from "spark-md5";
import Cropper, { type Area } from "react-easy-crop";

export interface ImageUploadResult {
  blob: Blob;
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  fileSize: number;
  contentMd5Hash: string;
  width: number;
  height: number;
}

interface ImageUploadProps {
  existingImageUrl?: string;
  onChange: (result: ImageUploadResult | null) => void;
  disabled?: boolean;
  label?: string;
}

type State = "IDLE" | "CROPPING" | "READY";

const ACCEPTED_MIME_TYPES = ["image/png", "image/jpeg", "image/webp"];
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const OUTPUT_MIME_TYPE = "image/webp" as const;
const MAX_OUTPUT_DIMENSION = 1200;

function getCroppedCanvas(imageSrc: string, pixelCrop: Area): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const image = new window.Image();
    image.crossOrigin = "anonymous";
    image.onload = () => {
      const scale = Math.min(
        1,
        MAX_OUTPUT_DIMENSION / Math.max(pixelCrop.width, pixelCrop.height),
      );
      const outputWidth = Math.round(pixelCrop.width * scale);
      const outputHeight = Math.round(pixelCrop.height * scale);

      const canvas = document.createElement("canvas");
      canvas.width = outputWidth;
      canvas.height = outputHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("Could not get canvas context"));
        return;
      }
      ctx.drawImage(
        image,
        pixelCrop.x,
        pixelCrop.y,
        pixelCrop.width,
        pixelCrop.height,
        0,
        0,
        outputWidth,
        outputHeight,
      );
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error("Canvas toBlob failed"));
          return;
        }
        resolve(blob);
      }, OUTPUT_MIME_TYPE);
    };
    image.onerror = () => reject(new Error("Failed to load image"));
    image.src = imageSrc;
  });
}

async function computeMd5Base64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const rawHash = SparkMD5.ArrayBuffer.hash(buffer, true);
  return btoa(rawHash);
}

export const ImageUpload: React.FC<ImageUploadProps> = ({
  existingImageUrl,
  onChange,
  disabled = false,
  label = "Product Image",
}) => {
  const [state, setState] = useState<State>("IDLE");
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const previewUrlRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current);
      }
    };
  }, []);

  const onCropComplete = useCallback((_: Area, croppedPixels: Area) => {
    setCroppedAreaPixels(croppedPixels);
  }, []);

  const handleFileDrop = useCallback((files: File[]) => {
    if (files.length === 0) {
      return;
    }
    const file = files[0];
    const reader = new FileReader();
    reader.onload = () => {
      setImageSrc(reader.result as string);
      setCrop({ x: 0, y: 0 });
      setZoom(1);
      setState("CROPPING");
    };
    reader.readAsDataURL(file);
  }, []);

  const handleConfirmCrop = useCallback(async () => {
    if (!imageSrc || !croppedAreaPixels) {
      return;
    }
    setProcessing(true);
    try {
      const blob = await getCroppedCanvas(imageSrc, croppedAreaPixels);

      if (blob.size > MAX_FILE_SIZE) {
        throw new Error(
          `Cropped image is too large (${(blob.size / 1024 / 1024).toFixed(1)}MB). Max is 5MB.`,
        );
      }

      const contentMd5Hash = await computeMd5Base64(blob);

      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current);
      }
      const newPreviewUrl = URL.createObjectURL(blob);
      previewUrlRef.current = newPreviewUrl;
      setPreviewUrl(newPreviewUrl);

      const scale = Math.min(
        1,
        MAX_OUTPUT_DIMENSION /
          Math.max(croppedAreaPixels.width, croppedAreaPixels.height),
      );
      onChange({
        blob,
        mimeType: OUTPUT_MIME_TYPE,
        fileSize: blob.size,
        contentMd5Hash,
        width: Math.round(croppedAreaPixels.width * scale),
        height: Math.round(croppedAreaPixels.height * scale),
      });

      setState("READY");
    } catch (e) {
      console.error("Crop failed:", e);
    } finally {
      setProcessing(false);
    }
  }, [imageSrc, croppedAreaPixels, onChange]);

  const handleCancelCrop = useCallback(() => {
    setImageSrc(null);
    setCroppedAreaPixels(null);
    setState("IDLE");
  }, []);

  const handleRemove = useCallback(() => {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
    setPreviewUrl(null);
    setImageSrc(null);
    setCroppedAreaPixels(null);
    onChange(null);
    setState("IDLE");
  }, [onChange]);

  const handleChange = useCallback(() => {
    handleRemove();
  }, [handleRemove]);

  return (
    <Stack gap="xs">
      <Text size="sm" fw={500}>
        {label}
      </Text>

      {state === "IDLE" && (
        <>
          {existingImageUrl && !previewUrl && (
            <Group>
              <Image
                src={existingImageUrl}
                alt="Current product image"
                w={80}
                h={80}
                fit="cover"
                radius="sm"
              />
              <Text size="xs" c="dimmed">
                Current image
              </Text>
            </Group>
          )}
          <Dropzone
            onDrop={handleFileDrop}
            accept={ACCEPTED_MIME_TYPES}
            maxSize={MAX_FILE_SIZE}
            maxFiles={1}
            disabled={disabled}
          >
            <Group
              justify="center"
              gap="xl"
              mih={120}
              style={{ pointerEvents: "none" }}
            >
              <Dropzone.Accept>
                <IconUpload size={40} stroke={1.5} />
              </Dropzone.Accept>
              <Dropzone.Reject>
                <IconX size={40} stroke={1.5} />
              </Dropzone.Reject>
              <Dropzone.Idle>
                <IconPhoto size={40} stroke={1.5} />
              </Dropzone.Idle>
              <div>
                <Text size="sm" inline>
                  Drag an image here or click to select
                </Text>
                <Text size="xs" c="dimmed" inline mt={7}>
                  PNG, JPEG, or WebP. Max 5MB. Will be cropped to square.
                </Text>
              </div>
            </Group>
          </Dropzone>
        </>
      )}

      {state === "CROPPING" && imageSrc && (
        <Stack gap="sm">
          <div style={{ position: "relative", width: "100%", height: 300 }}>
            <Cropper
              image={imageSrc}
              crop={crop}
              zoom={zoom}
              aspect={1}
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onCropComplete={onCropComplete}
            />
          </div>
          <Text size="xs">Zoom</Text>
          <Slider
            value={zoom}
            onChange={setZoom}
            min={1}
            max={3}
            step={0.01}
            label={(v) => `${v.toFixed(2)}x`}
          />
          <Group>
            <Button onClick={handleConfirmCrop} loading={processing}>
              Confirm Crop
            </Button>
            <Button
              variant="outline"
              onClick={handleCancelCrop}
              disabled={processing}
            >
              Cancel
            </Button>
          </Group>
        </Stack>
      )}

      {state === "READY" && previewUrl && (
        <Stack gap="xs">
          <Image
            src={previewUrl}
            alt="Cropped preview"
            w={120}
            h={120}
            fit="cover"
            radius="sm"
          />
          <Group>
            <Button
              variant="outline"
              size="xs"
              onClick={handleChange}
              disabled={disabled}
            >
              Change Image
            </Button>
            <Button
              variant="outline"
              size="xs"
              color="red"
              onClick={handleRemove}
              disabled={disabled}
            >
              Remove
            </Button>
          </Group>
        </Stack>
      )}
    </Stack>
  );
};
