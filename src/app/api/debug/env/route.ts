// Lightweight env probe to verify runtime variable injection on Amplify
import { NextResponse } from "next/server";
import { envSummary } from "@/lib/serverEnv";

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
  return NextResponse.json({ env: envSummary(keys) });
}
