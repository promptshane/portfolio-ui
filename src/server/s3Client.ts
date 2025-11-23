import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";

const bucket = process.env.AWS_S3_BUCKET;
const region = process.env.AWS_REGION || "us-east-1";

export const s3Enabled = !!bucket;

export function getS3Client() {
  if (!s3Enabled) throw new Error("S3 not configured");
  return new S3Client({
    region,
    credentials: process.env.AWS_ACCESS_KEY_ID
      ? {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "",
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

export async function putObjectBuffer(params: { key: string; body: Buffer; contentType?: string }) {
  if (!s3Enabled) return;
  const client = getS3Client();
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: params.key,
      Body: params.body,
      ContentType: params.contentType,
    })
  );
}
