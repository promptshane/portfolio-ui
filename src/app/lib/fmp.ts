// src/app/lib/fmp.ts
const FMP_BASE = "https://financialmodelingprep.com/api/v3";

export type QuoteMini = {
  price: number | null;
  changesPercentage: number | null;
};

export async function fetchQuotes(symbols: string[]): Promise<Record<string, QuoteMini>> {
  const key = process.env.FMP_API_KEY;
  if (!key) throw new Error("FMP_API_KEY missing");
  if (!symbols?.length) throw new Error("No symbols provided");

  const url = `${FMP_BASE}/quote/${encodeURIComponent(symbols.join(","))}?apikey=${key}`;

  const res = await fetch(url, { cache: "no-store" });
  const text = await res.text();
  if (!res.ok) throw new Error(`FMP HTTP ${res.status}: ${text.slice(0, 200)}`);

  let arr: any;
  try {
    arr = JSON.parse(text);
  } catch {
    throw new Error("FMP returned non-JSON");
  }
  if (!Array.isArray(arr)) throw new Error("Unexpected FMP payload shape");

  const out: Record<string, QuoteMini> = {};
  for (const q of arr) {
    const sym = q?.symbol?.toUpperCase?.();
    if (!sym) continue;
    out[sym] = {
      price: Number.isFinite(q?.price) ? Number(q.price) : null,
      changesPercentage: Number.isFinite(q?.changesPercentage) ? Number(q.changesPercentage) : null,
    };
  }
  return out;
}