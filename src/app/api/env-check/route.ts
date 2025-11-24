import { NextResponse } from "next/server";

// Explicitly run on Node.js to guarantee server-side env access
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const keys = [
  "NEXTAUTH_SECRET",
  "AUTH_SECRET",
  "DATABASE_URL",
  "NEXTAUTH_URL",
  "FMP_API_KEY",
  "OPENAI_API_KEY",
  "FTV_DEV_PASSWORD",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
  "S3_BUCKET",
  "S3_REGION",
] as const;

export async function GET() {
  const payload = Object.fromEntries(
    keys.map((key) => [
      key,
      {
        present: Boolean(process.env[key]),
        length: process.env[key]?.length ?? 0,
      },
    ])
  );

  return NextResponse.json({ env: payload });
}
