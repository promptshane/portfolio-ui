// src/app/lib/fmp-history.ts
// Helper utilities to fetch FMP daily history and resample to weekly bars.
// Uses adjClose when available; falls back to close.

// Use the standard v3 API base; the "stable" domain requires higher-tier plans.
const FMP_BASE = "https://financialmodelingprep.com/api/v3";

export type DailyBar = {
  date: string; // YYYY-MM-DD (UTC)
  adjClose: number; // adjusted close (preferred)
  close: number; // raw close (fallback)
  volume?: number | null;
};

export type WeeklyBar = {
  date: string; // week-ending date (UTC, last trading day of the week in data)
  close: number; // adjusted close if available, else raw close
  volume?: number | null; // sum of week volume if available (best-effort)
};

/**
 * Generic intraday bar shape for stable /historical-chart/* endpoints.
 * date includes time, e.g. "2025-02-14 09:35:00".
 */
export type IntradayBar = {
  date: string; // full timestamp from FMP
  close: number;
  volume?: number | null;
};

export type IntradayHistoryOptions = {
  /** If set, return only the last `limit` bars after sorting ascending. */
  limit?: number;
};

type IntradayInterval = "5min" | "1hour";

function parseNumber(x: any): number | null {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function ymd(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Return the UTC Monday (00:00) of the week for a given UTC date.
 * We use Monday-based weeks to group dailies, then select the last trading day as the week-end.
 */
function mondayOfWeekUTC(d: Date): Date {
  const day = d.getUTCDay(); // 0..6, 0=Sunday
  // Convert to Monday=0..Sunday=6
  const offset = (day + 6) % 7;
  const ms = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const mondayMs = ms - offset * 24 * 60 * 60 * 1000;
  return new Date(mondayMs);
}

/**
 * Fetch full daily history for a symbol from FMP (Stable API).
 * Endpoint: /stable/historical-price-eod/full?symbol=...
 * We prefer adjClose when present; otherwise use close.
 */
export async function fetchDailyHistory(symbol: string): Promise<DailyBar[]> {
  if (!symbol) throw new Error("fetchDailyHistory: symbol required");
  const key = process.env.FMP_API_KEY ?? process.env.NEXT_PUBLIC_FMP_API_KEY;
  if (!key) throw new Error("FMP_API_KEY missing");

  // v3 endpoint that works on free/standard keys; `serietype=line` returns close-only.
  const url = `${FMP_BASE}/historical-price-full/${encodeURIComponent(
    symbol
  )}?serietype=line&apikey=${key}`;
  const res = await fetch(url, { cache: "no-store" });
  const text = await res.text();
  if (!res.ok) throw new Error(`FMP HTTP ${res.status}: ${text.slice(0, 200)}`);

  let payload: any;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error("FMP returned non-JSON for historical-price-eod/full");
  }

  // Stable returns a direct array; legacy returned { historical: [...] }.
  const arr: any[] = Array.isArray(payload?.historical)
    ? payload.historical
    : Array.isArray(payload)
    ? payload
    : [];
  if (!Array.isArray(arr)) throw new Error("Unexpected FMP history payload shape");

  // Map to DailyBar, filter invalid rows, sort ascending by date.
  const out: DailyBar[] = arr
    .map((r) => {
      const date = typeof r?.date === "string" ? r.date : null;
      if (!date) return null;
      const adjClose = parseNumber(r?.adjClose);
      const close = parseNumber(r?.close);
      const volume = parseNumber(r?.volume);
      if (adjClose === null && close === null) return null;
      return {
        date,
        adjClose: adjClose ?? (close as number),
        close: (close ?? adjClose) as number,
        volume: volume ?? null,
      } as DailyBar;
    })
    .filter(Boolean) as DailyBar[];

  out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return out;
}

/**
 * Resample daily bars to weekly bars.
 * We group by Monday-based weeks and pick the *last trading day* in each group.
 * Volume is summed best-effort.
 */
export function toWeekly(daily: DailyBar[]): WeeklyBar[] {
  if (!Array.isArray(daily) || daily.length === 0) return [];

  // Group by Monday-of-week key
  const groups = new Map<string, DailyBar[]>();
  for (const row of daily) {
    const dt = new Date(`${row.date}T00:00:00Z`);
    if (isNaN(dt.getTime())) continue;
    const monday = mondayOfWeekUTC(dt);
    const key = ymd(monday);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(row);
  }

  // For each week, pick the last trading day (max date) and sum volume
  const weekly: WeeklyBar[] = [];
  for (const [, arr] of groups.entries()) {
    arr.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const last = arr[arr.length - 1];
    const volSum = arr.reduce(
      (s, r) => s + (Number.isFinite(r.volume || 0) ? (r.volume as number) : 0),
      0
    );
    weekly.push({
      date: last.date, // week-ending date = last trading day
      close: Number.isFinite(last.adjClose) ? last.adjClose : last.close,
      volume: Number.isFinite(volSum) ? volSum : null,
    });
  }

  weekly.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return weekly;
}

/**
 * Convenience helper: fetch daily then return weekly.
 */
export async function fetchWeeklyHistory(symbol: string): Promise<WeeklyBar[]> {
  const d = await fetchDailyHistory(symbol);
  return toWeekly(d);
}

/**
 * Core intraday fetcher using FMP Stable /historical-chart/{interval}.
 * Returns ascending time series.
 */
export async function fetchIntradayHistory(
  symbol: string,
  interval: IntradayInterval,
  opts: IntradayHistoryOptions = {}
): Promise<IntradayBar[]> {
  if (!symbol) throw new Error("fetchIntradayHistory: symbol required");
  const key = process.env.FMP_API_KEY ?? process.env.NEXT_PUBLIC_FMP_API_KEY;
  if (!key) throw new Error("FMP_API_KEY missing");

  const url = `${FMP_BASE}/historical-chart/${interval}/${encodeURIComponent(
    symbol
  )}?apikey=${key}`;
  const res = await fetch(url, { cache: "no-store" });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(
      `FMP intraday ${interval} HTTP ${res.status}: ${text.slice(0, 200)}`
    );
  }

  let payload: any;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(
      `FMP returned non-JSON for historical-chart/${interval}`
    );
  }

  const arr: any[] = Array.isArray(payload?.historical)
    ? payload.historical
    : Array.isArray(payload)
    ? payload
    : [];
  if (!Array.isArray(arr)) {
    throw new Error("Unexpected FMP intraday payload shape");
  }

  const out: IntradayBar[] = arr
    .map((r) => {
      const date = typeof r?.date === "string" ? r.date : null;
      const close = parseNumber(r?.close);
      const volume = parseNumber(r?.volume);
      if (!date || close === null) return null;
      return {
        date,
        close,
        volume: volume ?? null,
      } as IntradayBar;
    })
    .filter(Boolean) as IntradayBar[];

  // Sort ascending by timestamp string ("YYYY-MM-DD HH:MM:SS" sorts correctly)
  out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  const limit = opts.limit;
  if (
    typeof limit === "number" &&
    Number.isFinite(limit) &&
    limit > 0 &&
    out.length > limit
  ) {
    return out.slice(out.length - limit);
  }

  return out;
}

/**
 * Convenience wrappers for the two intraday granularities we care about:
 * - 5min: for 1D chart
 * - 1hour: for 1W chart
 */
export async function fetchIntraday5MinHistory(
  symbol: string,
  opts: IntradayHistoryOptions = {}
): Promise<IntradayBar[]> {
  return fetchIntradayHistory(symbol, "5min", opts);
}

export async function fetchIntraday1HourHistory(
  symbol: string,
  opts: IntradayHistoryOptions = {}
): Promise<IntradayBar[]> {
  return fetchIntradayHistory(symbol, "1hour", opts);
}
