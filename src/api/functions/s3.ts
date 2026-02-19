import {
  GetObjectCommand,
  PutObjectCommand,
  type S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { ValidLoggers } from "api/types.js";
import { InternalServerError } from "common/errors/index.js";

export type CreatePresignedPutInputs = {
  s3client: S3Client;
  bucketName: string;
  key: string;
  length: number;
  mimeType: string;
  md5hash?: string; // Must be a base64-encoded MD5 hash
  urlExpiresIn?: number;
  logger: ValidLoggers;
};

export async function createPresignedPut({
  s3client,
  bucketName,
  key,
  length,
  mimeType,
  md5hash,
  urlExpiresIn,
  logger,
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
    logger.error(err, "Failed to create S3 upload presigned URL.");
    throw new InternalServerError({
      message: "Could not create S3 upload presigned url.",
    });
  }
}

export type CreatePresignedGetInputs = {
  s3client: S3Client;
  bucketName: string;
  key: string;
  urlExpiresIn?: number;
  logger: ValidLoggers;
};

export async function createPresignedGet({
  s3client,
  bucketName,
  key,
  urlExpiresIn,
  logger,
}: CreatePresignedGetInputs) {
  const command = new GetObjectCommand({
    Bucket: bucketName,
    Key: key,
  });

  const expiresIn = urlExpiresIn || 900;

  try {
    return await getSignedUrl(s3client, command, { expiresIn });
  } catch (err) {
    logger.error(err, "Failed to create S3 download presigned URL.");
    throw new InternalServerError({
      message: "Could not create S3 download presigned url.",
    });
  }
}
