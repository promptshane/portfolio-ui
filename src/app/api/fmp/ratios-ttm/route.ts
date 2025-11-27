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

function normalizeRatioKey(raw: string): string | null {
  if (!raw) return null;
  let key = raw.trim();
  key = key.replace(/[_\s-]*ttm$/i, "");
  if (!key) return null;
  key = key.replace(/[_-]([a-zA-Z0-9])/g, (_, c) => c.toUpperCase());
  if (key.toLowerCase() === "dividendyiel") key = "dividendYield";
  if (key.toLowerCase() === "dividendyieldpercentage")
    key = "dividendYield";
  return key;
}

function aliasRatioKey(key: string): string {
  const lower = key.toLowerCase();
  if (lower === "dividendyieldpercentage") return "dividendYield";
  if (lower === "pricetoearningsratio") return "priceEarningsRatio";
  return key;
}

function normalizeRatioRow(row: any): Record<string, any> {
  const out: Record<string, any> = {};
  if (!row || typeof row !== "object") return out;

  for (const [rawKey, rawVal] of Object.entries(row)) {
    const numVal = Number(rawVal);
    const isNumeric = Number.isFinite(numVal);

    if (isNumeric) {
      out[rawKey] = numVal;
      const normalized = normalizeRatioKey(rawKey);
      if (normalized) {
        const alias = aliasRatioKey(normalized);
        out[alias] = numVal;
      }
    } else if (rawKey === "symbol" && typeof rawVal === "string") {
      out[rawKey] = rawVal.trim().toUpperCase();
    } else {
      out[rawKey] = rawVal;
    }
  }

  return out;
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

        if (json && typeof json === "object" && json["Error Message"]) {
          lastErr = String(json["Error Message"]);
          continue;
        }

        const rows = Array.isArray((json as any)?.ratios)
          ? (json as any).ratios
          : Array.isArray((json as any)?.rows)
          ? (json as any).rows
          : Array.isArray(json)
          ? json
          : [];

        if (!Array.isArray(rows) || rows.length === 0) {
          lastErr = "No ratios returned from FMP.";
          continue;
        }

        const normalized = rows.map((row) => normalizeRatioRow(row));
        return NextResponse.json({ ok: true, ratios: normalized });
      } catch (err: any) {
        lastErr = err?.message || String(err);
      }
    }

    throw new Error(lastErr || "Failed to load ratios");
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "FMP ratios-ttm error" }, { status: 500 });
  }
}
