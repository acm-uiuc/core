/**
 * Upload a file to S3 using a presigned URL
 * @param uploadUrl - The presigned URL from the server
 * @param file - The file to upload
 * @param contentType - The MIME type of the file
 * @throws Error if the upload fails
 */
export async function uploadToS3PresignedUrl(
  uploadUrl: string,
  file: File,
  contentType: string,
): Promise<void> {
  const headers: HeadersInit = {
    "Content-Type": contentType,
  };

  const response = await fetch(uploadUrl, {
    method: "PUT",
    headers,
    body: file,
  });

  if (!response.ok) {
    throw new Error(
      `Failed to upload file to S3: ${response.status} ${response.statusText}`,
    );
  }
}

/**
 * Download a file from S3 using a presigned URL and trigger browser download
 * @param downloadUrl - The presigned URL from the server
 * @param filename - The name to use when saving the file
 * @throws Error if the download fails
 */
export async function downloadFromS3PresignedUrl(
  downloadUrl: string,
  filename: string,
): Promise<void> {
  const response = await fetch(downloadUrl, {
    method: "GET",
  });

  if (!response.ok) {
    throw new Error(
      `Failed to download file from S3: ${response.status} ${response.statusText}`,
    );
  }

  // Get the blob from the response
  const blob = await response.blob();

  // Create a temporary URL for the blob
  const blobUrl = window.URL.createObjectURL(blob);

  // Create a temporary anchor element and trigger download
  const anchor = document.createElement("a");
  anchor.href = blobUrl;
  anchor.download = filename;
  anchor.style.display = "none";

  // Append to body, click, and clean up
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);

  // Revoke the blob URL to free up memory
  window.URL.revokeObjectURL(blobUrl);
}
