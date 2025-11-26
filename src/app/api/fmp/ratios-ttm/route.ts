import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getApiKey(): string {
  const key = process.env.FMP_API_KEY || process.env.NEXT_PUBLIC_FMP_API_KEY;
  if (!key) throw new Error("Missing FMP_API_KEY");
  return key;
}

function normSym(sym: string | null): string {
  return (sym || "").trim().toUpperCase();
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const symbol = normSym(searchParams.get("symbol"));
    if (!symbol) {
      return NextResponse.json({ error: "Missing symbol" }, { status: 400 });
    }
    const key = getApiKey();
    const endpoints = [
      `https://financialmodelingprep.com/api/v3/ratios-ttm/${encodeURIComponent(symbol)}?apikey=${key}`,
      `https://financialmodelingprep.com/stable/ratios-ttm?symbol=${encodeURIComponent(symbol)}&apikey=${key}`,
    ];

    let lastErr: string | null = null;
    for (const url of endpoints) {
      try {
        const res = await fetch(url, { cache: "no-store" });
        const text = await res.text();
        if (!res.ok) {
          lastErr = `FMP HTTP ${res.status}: ${text.slice(0, 200)}`;
          continue;
        }
        const json = JSON.parse(text);
        return NextResponse.json(json);
      } catch (err: any) {
        lastErr = err?.message || String(err);
      }
    }

    throw new Error(lastErr || "Failed to load ratios");
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "FMP ratios-ttm error" }, { status: 500 });
  }
}
