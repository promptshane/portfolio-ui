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
  if (lower === "priceearningsratio") return "priceEarningsRatio";
  if (lower === "roe") return "returnOnEquity";
  if (lower === "roa") return "returnOnAssets";
  if (lower === "roic") return "returnOnInvestedCapital";
  if (lower === "netdebttoebitda") return "netDebtToEbitda";
  if (lower === "evtoebit") return "evToEbit";
  if (lower === "evtoebitda") return "evToEbitda";
  if (lower === "evtosales") return "evToSales";
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
    const ratioUrl = `${BASE}/ratios-ttm?symbol=${encodeURIComponent(symbol)}&apikey=${key}`;
    const keyMetricsUrl = `${BASE}/key-metrics-ttm?symbol=${encodeURIComponent(symbol)}&apikey=${key}`;

    const [ratioRes, keyMetricsRes] = await Promise.allSettled([
      fetch(ratioUrl, { cache: "no-store" }),
      fetch(keyMetricsUrl, { cache: "no-store" }),
    ]);

    const readJson = async (res: PromiseSettledResult<Response>) => {
      if (res.status !== "fulfilled") return null;
      const text = await res.value.text();
      if (!res.value.ok) throw new Error(`FMP HTTP ${res.value.status}: ${text.slice(0, 200)}`);
      const json = JSON.parse(text);
      if (json && typeof json === "object" && json["Error Message"]) {
        throw new Error(String(json["Error Message"]));
      }
      return json;
    };

    const [ratioJson, keyMetricsJson] = await Promise.all([
      readJson(ratioRes),
      readJson(keyMetricsRes).catch(() => null),
    ]);

    const pickRows = (json: any): any[] => {
      if (!json) return [];
      if (Array.isArray(json?.ratios)) return json.ratios;
      if (Array.isArray(json?.rows)) return json.rows;
      if (Array.isArray(json)) return json;
      return [];
    };

    const ratioRows = pickRows(ratioJson);
    if (!ratioRows.length) throw new Error("No ratios returned from FMP.");
    const keyMetricRows = pickRows(keyMetricsJson);

    const normalizedRatios = ratioRows.map((row) => normalizeRatioRow(row));
    const normalizedKeyMetrics = keyMetricRows.map((row) => normalizeRatioRow(row));

    const merged =
      normalizedRatios.length || normalizedKeyMetrics.length
        ? [{ ...(normalizedRatios[0] ?? {}), ...(normalizedKeyMetrics[0] ?? {}) }]
        : [];

    return NextResponse.json({
      ok: true,
      ratios: merged,
      ratiosRaw: normalizedRatios,
      keyMetrics: normalizedKeyMetrics,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "FMP ratios-ttm error" }, { status: 500 });
  }
}
