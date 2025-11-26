import { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";

const bucket = process.env.S3_BUCKET;
const region = process.env.S3_REGION || "us-east-1";

export const s3Enabled = !!bucket;

type PutParams = {
  key: string;
  body: Buffer;
  contentType?: string;
  tags?: Record<string, string>;
  metadata?: Record<string, string>;
};

export function getS3Client() {
  if (!s3Enabled) throw new Error("S3 not configured");
  return new S3Client({
    region,
    credentials: process.env.S3_ACCESS_KEY_ID
      ? {
          accessKeyId: process.env.S3_ACCESS_KEY_ID,
          secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || "",
        }
      : undefined,
  });
}

export async function getObjectBuffer(key: string): Promise<Buffer | null> {
  if (!s3Enabled) return null;
  const client = getS3Client();
  const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
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
  if (!s3Enabled) return;
  const client = getS3Client();
  const Tagging = buildTagging(params.tags);
  const Metadata = buildMetadata(params.metadata);
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: params.key,
      Body: params.body,
      ContentType: params.contentType,
      ...(Tagging ? { Tagging } : {}),
      ...(Metadata ? { Metadata } : {}),
    })
  );
}

export async function deleteObject(key: string) {
  if (!s3Enabled) return;
  const client = getS3Client();
  try {
    await client.send(
      new DeleteObjectCommand({
        Bucket: bucket,
        Key: key,
      })
    );
  } catch {
    // best-effort
  }
}
