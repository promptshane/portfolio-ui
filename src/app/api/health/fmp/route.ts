// src/app/api/health/fmp/route.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  const key = process.env.FMP_API_KEY;
  const hasKey = Boolean(key);
  const keyLen = key?.length ?? 0;

  let probeStatus: number | null = null;
  let probeOk = false;
  let probeError: string | null = null;

  if (hasKey) {
    try {
      const res = await fetch(
        `https://financialmodelingprep.com/api/v3/quote/AAPL?apikey=${key}`,
        { cache: "no-store" }
      );
      probeStatus = res.status;
      probeOk = res.ok;
      if (!res.ok) {
        const t = await res.text();
        probeError = `HTTP ${res.status}: ${t.slice(0, 200)}`;
      }
    } catch (e: any) {
      probeError = String(e?.message || e);
    }
  }

  return NextResponse.json({
    env: { hasKey, keyLen },
    probe: { probeOk, probeStatus, probeError },
  });
}
