import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BASE = "https://financialmodelingprep.com/api/v3";

function getApiKey(): string {
  const key = process.env.FMP_API_KEY || process.env.NEXT_PUBLIC_FMP_API_KEY;
  if (!key) throw new Error("Missing FMP_API_KEY");
  return key;
}

function normSym(sym: string | null): string {
  return (sym || "").trim().toUpperCase();
}

async function proxyJson(url: string) {
  const res = await fetch(url, { cache: "no-store" });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`FMP HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("FMP returned non-JSON payload");
  }
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const symbol = normSym(searchParams.get("symbol"));
    if (!symbol) {
      return NextResponse.json({ error: "Missing symbol" }, { status: 400 });
    }
    const data = await proxyJson(
      `${BASE}/key-metrics/${encodeURIComponent(symbol)}?period=annual&limit=1&apikey=${getApiKey()}`
    );
    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "FMP key-stats error" }, { status: 500 });
  }
}
