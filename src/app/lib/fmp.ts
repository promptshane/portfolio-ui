// src/app/lib/fmp.ts
// FMP moved live-quote access to the /stable endpoints (v3/quote is now legacy/403).
const FMP_BASE = "https://financialmodelingprep.com/stable";

export type QuoteMini = {
  price: number | null;
  changesPercentage: number | null;
};

type QuoteRow = {
  symbol?: string;
  price?: number;
  changePercentage?: number;
  changesPercentage?: number;
  change?: number;
};

function parseQuoteRows(rows: QuoteRow[] | undefined, out: Record<string, QuoteMini>) {
  if (!Array.isArray(rows)) return;
  for (const q of rows) {
    const sym = q?.symbol?.toUpperCase?.();
    if (!sym) continue;
    const price = Number.isFinite((q as any)?.price) ? Number((q as any).price) : null;
    const pctField =
      Number.isFinite((q as any)?.changesPercentage) && (q as any).changesPercentage !== null
        ? Number((q as any).changesPercentage)
        : Number.isFinite((q as any)?.changePercentage) && (q as any).changePercentage !== null
        ? Number((q as any).changePercentage)
        : null;

    out[sym] = {
      price,
      changesPercentage: pctField,
    };
  }
}

async function fetchBatchQuotes(
  symbols: string[],
  key: string,
  out: Record<string, QuoteMini>
): Promise<boolean> {
  if (!symbols.length) return true;
  const endpoints = ["batch-quote-short", "batch-quote"];
  for (const ep of endpoints) {
    const url = `${FMP_BASE}/${ep}?symbols=${encodeURIComponent(symbols.join(","))}&apikey=${key}`;
    const res = await fetch(url, { cache: "no-store" });
    const text = await res.text();
    if (!res.ok) {
      // 402 indicates plan restriction; try next or fallback to per-symbol
      if (res.status === 402) continue;
      // Other errors: try next endpoint
      continue;
    }
    try {
      const data = JSON.parse(text);
      if (!Array.isArray(data)) continue;
      parseQuoteRows(data as any[], out);
      return true;
    } catch {
      continue;
    }
  }
  return false;
}

async function fetchSingleQuote(sym: string, key: string): Promise<QuoteMini | null> {
  const url = `${FMP_BASE}/quote?symbol=${encodeURIComponent(sym)}&apikey=${key}`;
  const res = await fetch(url, { cache: "no-store" });
  const text = await res.text();
  if (!res.ok) return null;
  try {
    const arr = JSON.parse(text);
    if (!Array.isArray(arr) || !arr.length) return null;
    const out: Record<string, QuoteMini> = {};
    parseQuoteRows(arr as any[], out);
    return out[sym] ?? null;
  } catch {
    return null;
  }
}

export async function fetchQuotes(symbols: string[]): Promise<Record<string, QuoteMini>> {
  const key = process.env.FMP_API_KEY;
  if (!key) throw new Error("FMP_API_KEY missing");
  if (!symbols?.length) throw new Error("No symbols provided");

  const uniq = Array.from(new Set(symbols.map((s) => (s || "").toUpperCase()).filter(Boolean)));
  const out: Record<string, QuoteMini> = {};

  // Try batch first (if plan allows)
  const batchSize = 120; // keep URL size reasonable
  const leftover: string[] = [];
  for (let i = 0; i < uniq.length; i += batchSize) {
    const chunk = uniq.slice(i, i + batchSize);
    const ok = await fetchBatchQuotes(chunk, key, out);
    if (!ok) {
      leftover.push(...chunk.filter((s) => !(s in out)));
    }
  }

  // Fallback: per-symbol queries (plan-friendly)
  const singleChunkSize = 15;
  for (let i = 0; i < leftover.length; i += singleChunkSize) {
    const chunk = leftover.slice(i, i + singleChunkSize);
    await Promise.all(
      chunk.map(async (sym) => {
        if (out[sym]) return;
        const q = await fetchSingleQuote(sym, key);
        if (q) out[sym] = q;
      })
    );
  }

  return out;
}
