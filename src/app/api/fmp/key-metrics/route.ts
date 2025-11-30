import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BASE = "https://financialmodelingprep.com/stable";

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
    const url = `${BASE}/key-metrics?symbol=${encodeURIComponent(symbol)}&limit=5&apikey=${key}`;

    const res = await fetch(url, { cache: "no-store" });
    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);

    const json = JSON.parse(text);
    if (json && typeof json === "object" && json["Error Message"]) {
      throw new Error(String(json["Error Message"]));
    }

    const rows = Array.isArray((json as any)?.metrics)
      ? (json as any).metrics
      : Array.isArray((json as any)?.rows)
      ? (json as any).rows
      : Array.isArray(json)
      ? json
      : [];

    if (!rows.length) throw new Error("No key metrics returned from FMP.");

    return NextResponse.json({ ok: true, rows });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "FMP key-metrics error" },
      { status: 500 }
    );
  }
}
