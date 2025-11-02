import { describe, expect, test, vi, beforeEach } from "vitest";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  createPresignedPut,
  createPresignedGet,
} from "../../src/api/functions/s3.js";
import { InternalServerError } from "../../src/common/errors/index.js";

// Mock the getSignedUrl function from AWS SDK
// Note: We use vi.mock here instead of aws-sdk-client-mock because
// getSignedUrl is a standalone function, not an S3Client command
vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: vi.fn(),
}));

describe("S3 Presigned URL Functions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("createPresignedPut", () => {
    test("creates a presigned PUT URL successfully", async () => {
      const mockUrl = "https://s3.amazonaws.com/bucket/key?signature=xyz";
      const mockS3Client = new S3Client({ region: "us-east-1" });

      vi.mocked(getSignedUrl).mockResolvedValueOnce(mockUrl);

      const result = await createPresignedPut({
        s3client: mockS3Client,
        bucketName: "test-bucket",
        key: "test-key",
        length: 1024,
        mimeType: "application/pdf",
      });

      expect(result).toBe(mockUrl);
      expect(getSignedUrl).toHaveBeenCalledWith(
        mockS3Client,
        expect.any(PutObjectCommand),
        { expiresIn: 900 },
      );
      expect(getSignedUrl).toHaveBeenCalledTimes(1);
    });

    test("creates a presigned PUT URL with custom expiration", async () => {
      const mockUrl = "https://s3.amazonaws.com/bucket/key?signature=abc";
      const mockS3Client = new S3Client({ region: "us-east-1" });

      vi.mocked(getSignedUrl).mockResolvedValueOnce(mockUrl);

      const result = await createPresignedPut({
        s3client: mockS3Client,
        bucketName: "test-bucket",
        key: "test-key",
        length: 2048,
        mimeType: "image/png",
        urlExpiresIn: 3600,
      });

      expect(result).toBe(mockUrl);
      expect(getSignedUrl).toHaveBeenCalledWith(
        mockS3Client,
        expect.any(PutObjectCommand),
        { expiresIn: 3600 },
      );
    });

    test("creates a presigned PUT URL with MD5 hash", async () => {
      const mockUrl = "https://s3.amazonaws.com/bucket/key?signature=def";
      const mockS3Client = new S3Client({ region: "us-east-1" });

      vi.mocked(getSignedUrl).mockResolvedValueOnce(mockUrl);

      const result = await createPresignedPut({
        s3client: mockS3Client,
        bucketName: "test-bucket",
        key: "test-key",
        length: 512,
        mimeType: "application/pdf",
        md5hash: "base64-encoded-hash",
      });

      expect(result).toBe(mockUrl);
      expect(getSignedUrl).toHaveBeenCalled();
    });

    test("throws InternalServerError when URL generation fails", async () => {
      const mockS3Client = new S3Client({ region: "us-east-1" });

      vi.mocked(getSignedUrl).mockRejectedValueOnce(new Error("AWS Error"));

      await expect(
        createPresignedPut({
          s3client: mockS3Client,
          bucketName: "test-bucket",
          key: "test-key",
          length: 1024,
          mimeType: "application/pdf",
        }),
      ).rejects.toThrow(InternalServerError);

      vi.mocked(getSignedUrl).mockRejectedValueOnce(new Error("AWS Error"));

      await expect(
        createPresignedPut({
          s3client: mockS3Client,
          bucketName: "test-bucket",
          key: "test-key",
          length: 1024,
          mimeType: "application/pdf",
        }),
      ).rejects.toThrow("Could not create S3 upload presigned url.");
    });
  });

  describe("createPresignedGet", () => {
    test("creates a presigned GET URL successfully", async () => {
      const mockUrl = "https://s3.amazonaws.com/bucket/key?signature=ghi";
      const mockS3Client = new S3Client({ region: "us-east-1" });

      vi.mocked(getSignedUrl).mockResolvedValueOnce(mockUrl);

      const result = await createPresignedGet({
        s3client: mockS3Client,
        bucketName: "test-bucket",
        key: "test-key",
      });

      expect(result).toBe(mockUrl);
      expect(getSignedUrl).toHaveBeenCalledWith(
        mockS3Client,
        expect.any(GetObjectCommand),
        { expiresIn: 900 },
      );
    });

    test("creates a presigned GET URL with custom expiration", async () => {
      const mockUrl = "https://s3.amazonaws.com/bucket/key?signature=jkl";
      const mockS3Client = new S3Client({ region: "us-east-1" });

      vi.mocked(getSignedUrl).mockResolvedValueOnce(mockUrl);

      const result = await createPresignedGet({
        s3client: mockS3Client,
        bucketName: "test-bucket",
        key: "test-key",
        urlExpiresIn: 1800,
      });

      expect(result).toBe(mockUrl);
      expect(getSignedUrl).toHaveBeenCalledWith(
        mockS3Client,
        expect.any(GetObjectCommand),
        { expiresIn: 1800 },
      );
    });

    test("throws InternalServerError when URL generation fails", async () => {
      const mockS3Client = new S3Client({ region: "us-east-1" });

      vi.mocked(getSignedUrl).mockRejectedValueOnce(new Error("AWS Error"));

      await expect(
        createPresignedGet({
          s3client: mockS3Client,
          bucketName: "test-bucket",
          key: "test-key",
        }),
      ).rejects.toThrow(InternalServerError);

      vi.mocked(getSignedUrl).mockRejectedValueOnce(new Error("AWS Error"));

      await expect(
        createPresignedGet({
          s3client: mockS3Client,
          bucketName: "test-bucket",
          key: "test-key",
        }),
      ).rejects.toThrow("Could not create S3 download presigned url.");
    });
  });
});
