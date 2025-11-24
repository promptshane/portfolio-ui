// Lightweight env probe to verify runtime variable injection on Amplify
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const keys = [
  "DATABASE_URL",
  "NEXTAUTH_SECRET",
  "AUTH_SECRET",
  "NEXTAUTH_URL",
  "FMP_API_KEY",
  "OPENAI_API_KEY",
];

export async function GET() {
  const report = Object.fromEntries(
    keys.map((k) => {
      const val = process.env[k];
      return [
        k,
        {
          present: !!val,
          length: val?.length ?? 0,
        },
      ];
    })
  );
  return NextResponse.json({ env: report });
}
