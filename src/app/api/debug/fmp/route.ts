// src/app/api/debug/fmp/route.ts
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const log: Record<string, any> = {};

  // 1️⃣ check env
  const key = process.env.FMP_API_KEY;
  log.envLoaded = !!key;
  log.keyLength = key?.length ?? 0;
  if (!key) return NextResponse.json({ step: "env", ok: false, log });

  // 2️⃣ build URL
  const url = `https://financialmodelingprep.com/api/v3/quote/AAPL?apikey=${key}`;
  log.url = url;

  try {
    // 3️⃣ make fetch call
    const res = await fetch(url, { cache: "no-store" });
    log.status = res.status;
    log.ok = res.ok;

    const text = await res.text();
    log.raw = text.slice(0, 400);

    try {
      log.json = JSON.parse(text);
    } catch {
      log.jsonParseError = true;
    }

    return NextResponse.json({ step: "done", ok: res.ok, log });
  } catch (err: any) {
    log.error = String(err?.message || err);
    return NextResponse.json({ step: "fetch", ok: false, log });
  }
}