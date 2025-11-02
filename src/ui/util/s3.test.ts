import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { uploadToS3PresignedUrl, downloadFromS3PresignedUrl } from "./s3";

// Mock global fetch
global.fetch = vi.fn();

describe("S3 Utility Functions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("uploadToS3PresignedUrl", () => {
    test("successfully uploads a file to S3", async () => {
      const mockFile = new File(["test content"], "test.pdf", {
        type: "application/pdf",
      });
      const mockUrl = "https://s3.amazonaws.com/bucket/key?signature=xyz";
      const mockContentType = "application/pdf";

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
      } as Response);

      await uploadToS3PresignedUrl(mockUrl, mockFile, mockContentType);

      expect(fetch).toHaveBeenCalledWith(mockUrl, {
        method: "PUT",
        headers: {
          "Content-Type": mockContentType,
        },
        body: mockFile,
      });
    });

    test("throws error when upload fails with non-ok response", async () => {
      const mockFile = new File(["test content"], "test.pdf", {
        type: "application/pdf",
      });
      const mockUrl = "https://s3.amazonaws.com/bucket/key?signature=xyz";
      const mockContentType = "application/pdf";

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: "Forbidden",
      } as Response);

      await expect(
        uploadToS3PresignedUrl(mockUrl, mockFile, mockContentType),
      ).rejects.toThrow("Failed to upload file to S3: 403 Forbidden");
    });

    test("throws error when upload fails with network error", async () => {
      const mockFile = new File(["test content"], "test.pdf", {
        type: "application/pdf",
      });
      const mockUrl = "https://s3.amazonaws.com/bucket/key?signature=xyz";
      const mockContentType = "application/pdf";

      vi.mocked(fetch).mockRejectedValueOnce(new Error("Network error"));

      await expect(
        uploadToS3PresignedUrl(mockUrl, mockFile, mockContentType),
      ).rejects.toThrow("Network error");
    });

    test("uses correct content type header", async () => {
      const mockFile = new File(["image data"], "image.png", {
        type: "image/png",
      });
      const mockUrl = "https://s3.amazonaws.com/bucket/key?signature=abc";
      const mockContentType = "image/png";

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
      } as Response);

      await uploadToS3PresignedUrl(mockUrl, mockFile, mockContentType);

      expect(fetch).toHaveBeenCalledWith(mockUrl, {
        method: "PUT",
        headers: {
          "Content-Type": "image/png",
        },
        body: mockFile,
      });
    });
  });

  describe("downloadFromS3PresignedUrl", () => {
    test("successfully downloads a file and triggers browser download", async () => {
      const mockBlob = new Blob(["file content"], { type: "application/pdf" });
      const mockUrl = "https://s3.amazonaws.com/bucket/key?signature=xyz";
      const mockFilename = "downloaded-file.pdf";

      // Mock fetch response
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
        blob: vi.fn().mockResolvedValue(mockBlob),
      } as unknown as Response);

      // Mock DOM APIs
      const mockAnchor = {
        href: "",
        download: "",
        style: { display: "" },
        click: vi.fn(),
      };
      const createElementSpy = vi
        .spyOn(document, "createElement")
        .mockReturnValue(mockAnchor as unknown as HTMLElement);
      const appendChildSpy = vi
        .spyOn(document.body, "appendChild")
        .mockImplementation(() => mockAnchor as unknown as Node);
      const removeChildSpy = vi
        .spyOn(document.body, "removeChild")
        .mockImplementation(() => mockAnchor as unknown as Node);

      const createObjectURLSpy = vi
        .spyOn(window.URL, "createObjectURL")
        .mockReturnValue("blob:mock-url");
      const revokeObjectURLSpy = vi.spyOn(window.URL, "revokeObjectURL");

      await downloadFromS3PresignedUrl(mockUrl, mockFilename);

      // Verify fetch was called correctly
      expect(fetch).toHaveBeenCalledWith(mockUrl, { method: "GET" });

      // Verify DOM manipulation
      expect(createElementSpy).toHaveBeenCalledWith("a");
      expect(mockAnchor.href).toBe("blob:mock-url");
      expect(mockAnchor.download).toBe(mockFilename);
      expect(mockAnchor.style.display).toBe("none");
      expect(appendChildSpy).toHaveBeenCalledWith(mockAnchor);
      expect(mockAnchor.click).toHaveBeenCalled();
      expect(removeChildSpy).toHaveBeenCalledWith(mockAnchor);
      expect(revokeObjectURLSpy).toHaveBeenCalledWith("blob:mock-url");
    });

    test("throws error when download fails with non-ok response", async () => {
      const mockUrl = "https://s3.amazonaws.com/bucket/key?signature=xyz";
      const mockFilename = "file.pdf";

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: "Not Found",
      } as Response);

      await expect(
        downloadFromS3PresignedUrl(mockUrl, mockFilename),
      ).rejects.toThrow("Failed to download file from S3: 404 Not Found");
    });

    test("throws error when download fails with network error", async () => {
      const mockUrl = "https://s3.amazonaws.com/bucket/key?signature=xyz";
      const mockFilename = "file.pdf";

      vi.mocked(fetch).mockRejectedValueOnce(new Error("Network error"));

      await expect(
        downloadFromS3PresignedUrl(mockUrl, mockFilename),
      ).rejects.toThrow("Network error");
    });

    test("handles different file types correctly", async () => {
      const mockBlob = new Blob(["image data"], { type: "image/jpeg" });
      const mockUrl = "https://s3.amazonaws.com/bucket/key?signature=abc";
      const mockFilename = "photo.jpg";

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
        blob: vi.fn().mockResolvedValue(mockBlob),
      } as unknown as Response);

      const mockAnchor = {
        href: "",
        download: "",
        style: { display: "" },
        click: vi.fn(),
      };
      vi.spyOn(document, "createElement").mockReturnValue(
        mockAnchor as unknown as HTMLElement,
      );
      vi.spyOn(document.body, "appendChild").mockImplementation(
        () => mockAnchor as unknown as Node,
      );
      vi.spyOn(document.body, "removeChild").mockImplementation(
        () => mockAnchor as unknown as Node,
      );
      vi.spyOn(window.URL, "createObjectURL").mockReturnValue("blob:mock-url");
      vi.spyOn(window.URL, "revokeObjectURL");

      await downloadFromS3PresignedUrl(mockUrl, mockFilename);

      expect(mockAnchor.download).toBe("photo.jpg");
      expect(fetch).toHaveBeenCalledWith(mockUrl, { method: "GET" });
    });
  });
});
