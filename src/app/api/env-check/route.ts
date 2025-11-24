import { NextResponse } from "next/server";

// Explicitly run on Node.js to guarantee server-side env access
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const keys = ["NEXTAUTH_SECRET", "AUTH_SECRET"] as const;

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
