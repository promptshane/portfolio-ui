// src/app/api/portfolio/series/route.ts
import { NextRequest, NextResponse } from "next/server";
import {
  fetchIntraday5MinHistory,
  fetchIntraday1HourHistory,
  type IntradayBar,
} from "@/app/lib/fmp-history";

const FMP_API_KEY = process.env.FMP_API_KEY || process.env.NEXT_PUBLIC_FMP_API_KEY || "";

/**
 * POST /api/portfolio/series
 * Body: { items: { sym: string; shares: number; avgCost?: number }[], interval?: "1min"|"5min" }
 * Returns:
 * {
 *   times: string[];
 *   values: number[];
 *   baseline: number;
 *   bySymbol?: Record<string, { values: number[]; baseline?: number }>; // aligned to `times`
 * }
 *
 * Builds a REAL intraday portfolio series by summing shares * price across symbols at each bar time.
 * Uses FMP historical-chart endpoint. Requires env FMP_API_KEY.
 */
type Holding = { sym: string; shares: number; avgCost?: number };
type RangeHint = "1D" | "1W" | "1M";
type ReqBody = { items: Holding[]; interval?: "1min" | "5min" | "1hour"; range?: RangeHint };

// Force dynamic so the series is regenerated after holdings change (no Next cache).
export const dynamic = "force-dynamic";

function trimBarsForRange(bars: IntradayBar[], range: RangeHint): IntradayBar[] {
  if (!Array.isArray(bars) || bars.length === 0) return [];

  if (range === "1D") {
    const latestDay = bars[bars.length - 1].date.slice(0, 10);
    return bars.filter((b) => b.date.slice(0, 10) === latestDay);
  }

  const last = bars[bars.length - 1];
  const lastDate = new Date(last.date.replace(" ", "T") + "Z");
  if (Number.isNaN(lastDate.getTime())) return bars;

  const cutoff = new Date(lastDate);
  cutoff.setDate(cutoff.getDate() - (range === "1M" ? 32 : 7));
  const cutoffStr = cutoff.toISOString().slice(0, 19).replace("T", " ");
  return bars.filter((b) => b.date >= cutoffStr);
}

async function loadBarsForRange(sym: string, range: RangeHint): Promise<{ time: string; close: number }[]> {
  const interval = range === "1D" ? "5min" : "1hour";
  const limit =
    interval === "5min"
      ? 220
      : range === "1M"
        ? 1200
        : 320;

  const raw =
    interval === "5min"
      ? await fetchIntraday5MinHistory(sym, { limit })
      : await fetchIntraday1HourHistory(sym, { limit });
  const trimmed = trimBarsForRange(raw, range);
  return trimmed.map((bar) => ({ time: bar.date, close: bar.close }));
}

function buildPortfolioSeriesAndAlign(
  holdings: Holding[],
  bySymbolRaw: Record<string, { time: string; close: number }[]>
) {
  // Union all timestamps
  const allTimes = new Set<string>();
  Object.values(bySymbolRaw).forEach((arr) => {
    arr.forEach((b) => allTimes.add(b.time));
  });

  const timesAsc = Array.from(allTimes).sort(
    (a, b) => new Date(a).getTime() - new Date(b).getTime()
  );
  if (timesAsc.length === 0) {
    return {
      times: [] as string[],
      values: [] as number[],
      bySymbolAligned: {} as Record<string, number[]>,
    };
  }

  // For each symbol, prepare a map time->price and forward-fill along timesAsc
  const maps: Record<string, Map<string, number>> = {};
  for (const [sym, arr] of Object.entries(bySymbolRaw)) {
    const m = new Map<string, number>();
    arr.forEach((b) => m.set(b.time, b.close));
    maps[sym] = m;
  }

  const values: number[] = [];
  const bySymbolAligned: Record<string, number[]> = {};
  const lastSeen: Record<string, number | undefined> = {};

  // Init aligned arrays for only symbols that have at least one bar
  for (const [sym, arr] of Object.entries(bySymbolRaw)) {
    if (arr.length > 0) bySymbolAligned[sym] = [];
  }

  for (const t of timesAsc) {
    // forward fill each symbol that we are aligning
    for (const sym of Object.keys(bySymbolAligned)) {
      const px = maps[sym].get(t);
      if (px !== undefined) lastSeen[sym] = px;
      bySymbolAligned[sym].push(
        lastSeen[sym] !== undefined ? (lastSeen[sym] as number) : (maps[sym].get(t) ?? NaN)
      );
    }

    // portfolio total
    let total = 0;
    for (const h of holdings) {
      const sym = (h.sym || "").toUpperCase();
      if (!(sym in bySymbolAligned)) continue; // skip if no data for this sym
      const arr = bySymbolAligned[sym];
      const latest = arr[arr.length - 1];
      if (!Number.isNaN(latest)) total += latest * (Number(h.shares) || 0);
    }
    values.push(total);
  }

  return { times: timesAsc, values, bySymbolAligned };
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as ReqBody;
    const items = Array.isArray(body.items) ? body.items : [];
    const range: RangeHint = body.range === "1W" ? "1W" : body.range === "1M" ? "1M" : "1D";

    const syms = Array.from(
      new Set(
        items
          .map((i) => (i.sym || "").toUpperCase().trim())
          .filter(Boolean)
      )
    );

    if (syms.length === 0) {
      return NextResponse.json(
        { times: [], values: [], baseline: 0 },
        { headers: { "Cache-Control": "no-store" } }
      );
    }

    // ---- Baseline vs previous close (so the client can plot day P/L) ----
    let baseline = 0;
    const prevBySym = new Map<string, number>();
    try {
      if (FMP_API_KEY) {
        const quoteUrl = `https://financialmodelingprep.com/api/v3/quote/${syms.join(",")}?apikey=${FMP_API_KEY}`;
        const qr = await fetch(quoteUrl, { cache: "no-store" });
        if (qr.ok) {
          const quotes = (await qr.json()) as Array<{ symbol: string; previousClose?: number; price?: number }>;
          for (const q of quotes || []) {
            if (q?.symbol) {
              const prev = Number(q.previousClose ?? q.price ?? 0);
              prevBySym.set(q.symbol.toUpperCase(), prev);
            }
          }
          baseline = items.reduce((sum, h) => {
            const s = (h.sym || "").toUpperCase();
            const prev = prevBySym.get(s) ?? 0;
            return sum + (Number(h.shares) || 0) * prev;
          }, 0);
        }
      }
    } catch {
      // tolerate baseline failure; client can still render absolute series
      baseline = 0;
    }

    // Fetch each symbol's intraday bars
    const bySymbolRaw: Record<string, { time: string; close: number }[]> = {};
    for (const s of syms) {
      try {
        bySymbolRaw[s] = await loadBarsForRange(s, range);
      } catch {
        bySymbolRaw[s] = []; // tolerate a miss; portfolio can still render if others exist
      }
    }

    const { times, values, bySymbolAligned } = buildPortfolioSeriesAndAlign(
      items,
      bySymbolRaw
    );

    // If nothing came back, keep backward compatibility
    if (values.length === 1) {
      const t0 = times[0];
      const v0 = values[0];
      const t1 = new Date(new Date(t0.replace(" ", "T") + "Z").getTime() + 5 * 60 * 1000)
        .toISOString()
        .slice(0, 19)
        .replace("T", " ");
      return NextResponse.json(
        { times: [t0, t1], values: [v0, v0], baseline },
        { headers: { "Cache-Control": "no-store" } }
      );
    }

    // Attach per-symbol aligned arrays + their baselines (previous close when available)
    const bySymbol: Record<string, { values: number[]; baseline?: number }> = {};
    for (const [sym, arr] of Object.entries(bySymbolAligned)) {
      // Only include symbols that actually have data
      if (arr.length > 0 && arr.some((n) => Number.isFinite(n))) {
        bySymbol[sym] = {
          values: arr,
          baseline: prevBySym.get(sym), // undefined if unknown
        };
      }
    }

    return NextResponse.json(
      { times, values, baseline, bySymbol },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch {
    return NextResponse.json(
      { times: [], values: [], baseline: 0 },
      { headers: { "Cache-Control": "no-store" } }
    );
  }
}
