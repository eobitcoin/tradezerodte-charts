import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomBytes } from "node:crypto";
import { nyTradingDay } from "./trading-day";

const endpoint = process.env.BUCKET_ENDPOINT;
const region = process.env.BUCKET_REGION || "auto";
const bucket = process.env.BUCKET_NAME;
const accessKeyId = process.env.BUCKET_ACCESS_KEY_ID;
const secretAccessKey = process.env.BUCKET_SECRET_ACCESS_KEY;
const forcePathStyle = process.env.BUCKET_FORCE_PATH_STYLE === "true";

let _client: S3Client | null = null;

export function s3Client(): S3Client {
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
    throw new Error("Bucket env vars missing (BUCKET_ENDPOINT/NAME/ACCESS_KEY_ID/SECRET_ACCESS_KEY)");
  }
  if (!_client) {
    _client = new S3Client({
      endpoint,
      region,
      forcePathStyle,
      credentials: { accessKeyId, secretAccessKey },
    });
  }
  return _client;
}

export function bucketName(): string {
  if (!bucket) throw new Error("BUCKET_NAME not set");
  return bucket;
}

export function buildKey(filename: string): string {
  const ext = filename.includes(".") ? filename.split(".").pop()!.toLowerCase() : "bin";
  const day = nyTradingDay();
  const [yyyy, mm, dd] = day.split("-");
  const rand = randomBytes(8).toString("hex");
  return `${yyyy}/${mm}/${dd}/${rand}.${ext}`;
}

/**
 * Build a research-image key under research/<scan_day>/<TICKER>/<slot>-<rand>.<ext>.
 * Stable layout makes manual bucket inspection easy and groups everything per scan.
 */
export function buildResearchImageKey(params: {
  ticker: string;
  scanDay: string;
  slot: string;
  contentType: string;
}): string {
  const { ticker, scanDay, slot, contentType } = params;
  const ext =
    contentType === "image/png"
      ? "png"
      : contentType === "image/jpeg" || contentType === "image/jpg"
      ? "jpg"
      : contentType === "image/webp"
      ? "webp"
      : contentType === "image/svg+xml"
      ? "svg"
      : "bin";
  const safeSlot = slot.replace(/[^a-z0-9_-]/gi, "_").toLowerCase().slice(0, 32) || "img";
  const safeTicker = ticker.replace(/[^A-Za-z0-9_-]/g, "").toUpperCase().slice(0, 16) || "X";
  const rand = randomBytes(6).toString("hex");
  return `research/${scanDay}/${safeTicker}/${safeSlot}-${rand}.${ext}`;
}

/**
 * Direct upload of bytes (used by the MCP `upload_research_image` tool, since
 * the routine sandbox cannot reach the bucket directly).
 */
export async function putObject(
  key: string,
  body: Uint8Array,
  contentType: string,
): Promise<{ key: string; url: string; size: number }> {
  await s3Client().send(
    new PutObjectCommand({
      Bucket: bucketName(),
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );
  return { key, url: publicUrlFor(key), size: body.byteLength };
}

export async function presignPut(
  key: string,
  contentType: string,
  expiresInSec = 300,
): Promise<{ uploadUrl: string; publicUrl: string; expiresIn: number }> {
  const cmd = new PutObjectCommand({ Bucket: bucketName(), Key: key, ContentType: contentType });
  const uploadUrl = await getSignedUrl(s3Client(), cmd, { expiresIn: expiresInSec });
  return { uploadUrl, publicUrl: publicUrlFor(key), expiresIn: expiresInSec };
}

export function publicUrlFor(key: string): string {
  return `/api/images/${key}`;
}

export async function getObjectStream(
  key: string,
): Promise<{ body: ReadableStream; contentType: string | undefined; contentLength: number | undefined } | null> {
  try {
    const out = await s3Client().send(new GetObjectCommand({ Bucket: bucketName(), Key: key }));
    if (!out.Body) return null;
    return {
      body: out.Body.transformToWebStream(),
      contentType: out.ContentType,
      contentLength: out.ContentLength,
    };
  } catch (err) {
    const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
    if (e.name === "NoSuchKey" || e.$metadata?.httpStatusCode === 404) return null;
    throw err;
  }
}
