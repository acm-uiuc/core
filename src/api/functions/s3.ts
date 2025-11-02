import { PutObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { InternalServerError } from "common/errors/index.js";

export type CreatePresignedPutInputs = {
  s3client: S3Client;
  bucketName: string;
  key: string;
  length: number;
  mimeType: string;
  md5hash: string; // Must be a base64-encoded MD5 hash
  urlExpiresIn?: number;
};

export async function createPresignedPut({
  s3client,
  bucketName,
  key,
  length,
  mimeType,
  md5hash,
  urlExpiresIn,
}: CreatePresignedPutInputs) {
  const command = new PutObjectCommand({
    Bucket: bucketName,
    Key: key,
    ContentLength: length,
    ContentType: mimeType,
    ContentMD5: md5hash,
  });

  const expiresIn = urlExpiresIn || 900;

  try {
    return await getSignedUrl(s3client, command, { expiresIn });
  } catch (err) {
    throw new InternalServerError({
      message: "Could not create S3 upload presigned url.",
    });
  }
}
