import { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";

const DEFAULT_REGION = "us-east-1";

function getBucket() {
  const bucket = process.env.S3_BUCKET;
  s3Enabled = !!bucket;
  return bucket;
}

function getRegion() {
  return process.env.S3_REGION || DEFAULT_REGION;
}

function getConfig() {
  const bucket = getBucket();
  return {
    bucket,
    region: getRegion(),
  };
}

export let s3Enabled = false;

function refreshS3Enabled() {
  s3Enabled = !!getBucket();
  return s3Enabled;
}

refreshS3Enabled();

if (!s3Enabled) {
  // In Next dev/turbopack env vars may land after module import; re-check briefly.
  let refreshAttempts = 0;
  const refreshTimer = setInterval(() => {
    refreshAttempts += 1;
    if (refreshS3Enabled() || refreshAttempts > 50) {
      clearInterval(refreshTimer);
    }
  }, 200);
  refreshTimer.unref?.();
}

type PutParams = {
  key: string;
  body: Buffer;
  contentType?: string;
  tags?: Record<string, string>;
  metadata?: Record<string, string>;
};

export function getS3Client(config = getConfig()) {
  if (!config.bucket) throw new Error("S3 not configured");
  return new S3Client({
    region: config.region,
    credentials: process.env.S3_ACCESS_KEY_ID
      ? {
          accessKeyId: process.env.S3_ACCESS_KEY_ID,
          secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || "",
        }
      : undefined,
  });
}

export async function getObjectBuffer(key: string): Promise<Buffer | null> {
  const config = getConfig();
  if (!config.bucket) return null;
  const client = getS3Client(config);
  const res = await client.send(new GetObjectCommand({ Bucket: config.bucket, Key: key }));
  const chunks: Uint8Array[] = [];
  const stream = res.Body;
  if (!stream) return null;
  for await (const chunk of stream as any) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

function buildTagging(tags?: Record<string, string>) {
  if (!tags) return undefined;
  const entries = Object.entries(tags)
    .map(([k, v]) => [k?.trim(), v?.trim()] as const)
    .filter(([k, v]) => !!k && !!v);
  if (!entries.length) return undefined;
  return entries
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
}

function buildMetadata(meta?: Record<string, string>) {
  if (!meta) return undefined;
  const entries = Object.entries(meta)
    .map(([k, v]) => [k?.trim(), v?.trim()] as const)
    .filter(([k, v]) => !!k && !!v);
  if (!entries.length) return undefined;
  return Object.fromEntries(entries);
}

export async function putObjectBuffer(params: PutParams) {
  const config = getConfig();
  if (!config.bucket) return;
  const client = getS3Client(config);
  const Tagging = buildTagging(params.tags);
  const Metadata = buildMetadata(params.metadata);
  await client.send(
    new PutObjectCommand({
      Bucket: config.bucket,
      Key: params.key,
      Body: params.body,
      ContentType: params.contentType,
      ...(Tagging ? { Tagging } : {}),
      ...(Metadata ? { Metadata } : {}),
    })
  );
}

export async function deleteObject(key: string) {
  const config = getConfig();
  if (!config.bucket) return;
  const client = getS3Client(config);
  try {
    await client.send(
      new DeleteObjectCommand({
        Bucket: config.bucket,
        Key: key,
      })
    );
  } catch {
    // best-effort
  }
}
