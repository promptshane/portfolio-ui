// src/app/analysis/calc/momentumCalc.tsx
"use client";

import { computeMomentum } from "../../../lib/momentum"; // keep path fixed

import {
  EvalResult,
  HistPoint,
  FSRow,
  FSBlock,
  TrioSeries,
  seeded,
  genSeries,
  genTrio10,
  linRegStats,
  KeyStats,
} from "../shared";

/** Optional ML config */
type MLConfig = {
  asOf?: string;
  confidence?: number;
  minConfidence?: number;
  indicator?: { [bucket: string]: { band: number; rsi: number; macd: number } };
  horizon?: { [h: string]: number };
  applyPerBar?: boolean;
  bucketFallback?: string;
};

/* -------------------- helpers for daily detection -------------------- */

function parseSeriesShape(data: any): HistPoint[] {
  let series: HistPoint[] = [];

  if (Array.isArray(data?.series)) {
    series = data.series.map((p: any) => ({ date: p.date, close: +p.close }));
  } else if (Array.isArray(data?.historical)) {
    series = data.historical.map((p: any) => ({ date: p.date, close: +p.close }));
  } else if (Array.isArray(data)) {
    series = data.map((p: any) => ({ date: p.date, close: +p.close }));
  }

  // de-dupe & sort ascending
  const byDate = new Map<string, number>();
  for (const p of series) {
    if (p?.date && Number.isFinite(p?.close)) byDate.set(p.date, p.close);
  }
  const sorted = Array.from(byDate.keys()).sort();
  return sorted.map((d) => ({ date: d, close: byDate.get(d)! }));
}

function median(nums: number[]) {
  if (!nums.length) return 0;
  const a = nums.slice().sort((x, y) => x - y);
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

function daysBetweenISO(a: string, b: string) {
  const da = new Date(a);
  const db = new Date(b);
  return Math.round((+db - +da) / 86400000); // ms per day
}

/**
 * Heuristic: "daily-ish" if median gap between adjacent points <= 2 days
 * (trading days will usually be 1, occasionally 2 because of weekends/holidays).
 */
function looksDaily(series: HistPoint[]): boolean {
  if (series.length < 15) return false; // not enough to judge; be conservative
  const gaps: number[] = [];
  for (let i = 1; i < series.length; i++) {
    gaps.push(daysBetweenISO(series[i - 1].date, series[i].date));
  }
  return median(gaps) <= 2;
}

function sliceRecentYears(series: HistPoint[], years = 5): HistPoint[] {
  if (!Array.isArray(series) || !series.length || years <= 0) return series.slice();
  const lastDate = series[series.length - 1]?.date;
  if (!lastDate) return series.slice();
  const last = new Date(lastDate);
  if (Number.isNaN(last.getTime())) return series.slice();
  const start = new Date(last);
  start.setFullYear(start.getFullYear() - years);
  const cutoff = start.toISOString().slice(0, 10);
  let startIdx = 0;
  for (let i = 0; i < series.length; i++) {
    if (series[i].date >= cutoff) {
      startIdx = i;
      break;
    }
  }
  return series.slice(startIdx);
}

/* -------------------------- server calls -------------------------- */

export async function fetchHistory(sym: string): Promise<HistPoint[]> {
  // Try several query variants that different backends may accept for DAILY data.
  // Stop at the first response that "looks daily".
  const attempts = [
    `?range=max&interval=1d`,
    `?range=max&granularity=daily`,
    `?range=max&resolution=daily`,
    `?range=max&serietype=line`,
    `?range=daily`,
    `?range=max`,
  ];

  for (let i = 0; i < attempts.length; i++) {
    const qs = attempts[i];
    const res = await fetch(`/api/market/history/${sym}${qs}`, { cache: "no-store" });
    if (!res.ok) continue;
    const data = await res.json();
    const parsed = parseSeriesShape(data);
    if (looksDaily(parsed)) return parsed;

    if (i === attempts.length - 1) return parsed;
  }

  return [];
}

type IntradayInterval = "5min" | "1hour";

async function fetchIntradayHistory(
  sym: string,
  interval: IntradayInterval,
  limit?: number
): Promise<HistPoint[]> {
  const qs = new URLSearchParams();
  qs.set("interval", interval);
  if (typeof limit === "number" && Number.isFinite(limit) && limit > 0) {
    qs.set("limit", String(limit));
  }

  const res = await fetch(`/api/market/history/${sym}?${qs.toString()}`, {
    cache: "no-store",
  });
  if (!res.ok) return [];
  const data = await res.json();
  return parseSeriesShape(data);
}

export async function fetchIntraday1D(sym: string): Promise<HistPoint[]> {
  // 5min bars; request a bit more than a full trading day to be safe.
  return fetchIntradayHistory(sym, "5min", 220);
}

export async function fetchIntraday1W(sym: string): Promise<HistPoint[]> {
  // 1hour bars; request a bit more than a trading week to be safe.
  return fetchIntradayHistory(sym, "1hour", 220);
}

export async function fetchIntraday1MHour(sym: string): Promise<HistPoint[]> {
  // 1hour bars; request extra for safety, then trim to last ~1 calendar month.
  const raw = await fetchIntradayHistory(sym, "1hour", 1200);
  if (raw.length <= 0) return raw;

  const last = raw[raw.length - 1];
  if (!last?.date) return raw;

  const lastISO = last.date.replace(" ", "T");
  const lastDate = new Date(lastISO.endsWith("Z") ? lastISO : `${lastISO}Z`);
  if (Number.isNaN(lastDate.getTime())) return raw;

  const cutoff = new Date(lastDate);
  cutoff.setDate(cutoff.getDate() - 32); // ~1 month buffer
  const cutoffStr = cutoff.toISOString().slice(0, 19).replace("T", " ");

  let start = 0;
  for (let i = 0; i < raw.length; i++) {
    if (raw[i].date >= cutoffStr) {
      start = i;
      break;
    }
  }
  return raw.slice(start);
}

export async function fetchMLConfig(sym: string): Promise<MLConfig | undefined> {
  try {
    const res = await fetch(`/api/momentum/weights/${sym}`, { cache: "no-store" });
    if (!res.ok) return undefined;
    const data = (await res.json()) as MLConfig;
    return data;
  } catch {
    return undefined;
  }
}

/* -------------------------- profile / key stats (FMP) -------------------------- */

type FmpProfileRow = {
  companyName?: string;
  name?: string;

  marketCap?: number | string;
  mktCap?: number | string;

  pe?: number | string;
  peRatio?: number | string;
  priceEarningsRatio?: number | string;

  dividendYield?: number | string;
  lastDiv?: number | string;

  beta?: number | string;

  yearHigh?: number | string;
  yearLow?: number | string;
  high52w?: number | string;
  low52w?: number | string;
  range?: string; // sometimes "low-high"

  volAvg?: number | string;
  avgVolume?: number | string;
  averageVolume?: number | string;

  price?: number | string;
};

function parseRangeTo52w(range?: string): { low?: number; high?: number } {
  if (!range) return {};
  const nums =
    range.match(/[\d.]+/g)?.map((x) => Number(x)).filter((n) => Number.isFinite(n)) ?? [];
  if (nums.length >= 2) {
    const low = Math.min(nums[0], nums[1]);
    const high = Math.max(nums[0], nums[1]);
    return { low, high };
  }
  return {};
}

async function fetchFmpProfileAndStats(sym: string): Promise<{ name?: string; stats?: KeyStats }> {
  const attempts = [
    `/api/fmp/profile?symbol=${encodeURIComponent(sym)}`,
    `/api/fmp/quote?symbol=${encodeURIComponent(sym)}`,
    `/api/fmp/key-stats?symbol=${encodeURIComponent(sym)}`,
  ];

  let name: string | undefined;
  let stats: KeyStats | undefined;

  for (const url of attempts) {
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) continue;
      const data = await res.json();

      let row: FmpProfileRow | undefined;

      if (Array.isArray(data) && data.length) row = data[0];
      else if (Array.isArray(data?.profile) && data.profile.length) row = data.profile[0];
      else if (Array.isArray(data?.quote) && data.quote.length) row = data.quote[0];
      else if (data && typeof data === "object") row = data as FmpProfileRow;

      if (!row) continue;

      const price = num((row as any).price);
      const marketCap = num((row as any).marketCap ?? (row as any).mktCap);
      const peRatio = num(
        (row as any).peRatio ?? (row as any).pe ?? (row as any).priceEarningsRatio
      );
      const beta = num((row as any).beta);

      const yearHigh =
        num((row as any).yearHigh ?? (row as any).high52w ?? (row as any).high52Week) ??
        parseRangeTo52w((row as any).range).high;

      const yearLow =
        num((row as any).yearLow ?? (row as any).low52w ?? (row as any).low52Week) ??
        parseRangeTo52w((row as any).range).low;

      const avgVolume = num(
        (row as any).volAvg ?? (row as any).avgVolume ?? (row as any).averageVolume
      );

      let dividendYield = num((row as any).dividendYield);
      if (!Number.isFinite(dividendYield)) {
        const lastDiv = num((row as any).lastDiv);
        if (Number.isFinite(lastDiv) && Number.isFinite(price) && price! > 0) {
          dividendYield = (lastDiv! / price!) * 100;
        }
      }

      const parsedName = (row as any).companyName ?? (row as any).name;

      name = typeof parsedName === "string" && parsedName.trim() ? parsedName.trim() : name;
      stats = {
        ...(stats ?? {}),
        marketCap: Number.isFinite(marketCap) ? marketCap! : (stats?.marketCap ?? undefined),
        peRatio: Number.isFinite(peRatio) ? peRatio! : stats?.peRatio,
        dividendYield: Number.isFinite(dividendYield) ? dividendYield! : stats?.dividendYield,
        beta: Number.isFinite(beta) ? beta! : stats?.beta,
        high52w: Number.isFinite(yearHigh) ? yearHigh! : stats?.high52w,
        low52w: Number.isFinite(yearLow) ? yearLow! : stats?.low52w,
        avgVolume: Number.isFinite(avgVolume) ? avgVolume! : stats?.avgVolume,
      };
      break;
    } catch {
      // try next
    }
  }

  const ratios = await fetchFmpRatiosTTM(sym);
  if (ratios) {
    stats = {
      ...(stats ?? {}),
      peRatio: Number.isFinite(ratios.peRatio ?? NaN) ? ratios.peRatio : stats?.peRatio,
      dividendYield:
        Number.isFinite(ratios.dividendYieldPct ?? NaN) ? ratios.dividendYieldPct : stats?.dividendYield,
    };
  }

  if (stats && !Object.values(stats).some((v) => v != null)) {
    stats = undefined;
  }

  return { name, stats };
}

async function fetchFmpRatiosTTM(
  sym: string
): Promise<{ peRatio?: number; dividendYieldPct?: number } | undefined> {
  try {
    const res = await fetch(`/api/fmp/ratios-ttm?symbol=${encodeURIComponent(sym)}`, {
      cache: "no-store",
    });
    if (!res.ok) return undefined;
    const data = await res.json();
    const rows = Array.isArray(data?.ratios)
      ? data.ratios
      : Array.isArray(data?.rows)
      ? data.rows
      : Array.isArray(data)
      ? data
      : [];
    const row = rows.length ? rows[0] : undefined;
    if (!row) return undefined;
    const peRatio =
      num(row?.priceToEarningsRatioTTM) ??
      num(row?.priceToEarningsRatio) ??
      num(row?.priceEarningsRatioTTM) ??
      num(row?.priceEarningsRatio);
    const divRaw = num(
      row?.dividendYieldTTM ??
        row?.dividendYield ??
        row?.dividendYieldPercentageTTM ??
        row?.dividendYieldPercentage
    );
    const dividendYieldPct =
      divRaw == null
        ? undefined
        : divRaw < 0
        ? undefined
        : divRaw < 1
        ? divRaw * 100
        : divRaw;
    return {
      peRatio: Number.isFinite(peRatio) ? peRatio! : undefined,
      dividendYieldPct: Number.isFinite(dividendYieldPct) ? dividendYieldPct! : undefined,
    };
  } catch {
    return undefined;
  }
}

/* -------------------------- financials (FMP) -------------------------- */

type FmpYear = string | number;

type FmpIncomeRow = {
  date?: string;
  calendarYear?: string | number;
  period?: string;
  revenue?: number | string;
  costOfRevenue?: number | string;
  grossProfit?: number | string;
  netIncome?: number | string;
  netIncomeApplicableToCommonShares?: number | string;
};

type FmpBalanceRow = {
  date?: string;
  calendarYear?: string | number;
  totalAssets?: number | string;
  totalLiabilities?: number | string;
  totalStockholdersEquity?: number | string;
};

type FmpCashRow = {
  date?: string;
  calendarYear?: string | number;
  operatingCashFlow?: number | string;
  netCashProvidedByOperatingActivities?: number | string;
  capitalExpenditure?: number | string; // often negative
  freeCashFlow?: number | string;
};

type FmpFinancialsResponse =
  | {
      ok?: boolean;
      income?: FmpIncomeRow[];
      balance?: FmpBalanceRow[];
      cashflow?: FmpCashRow[];
    }
  | {
      ok?: boolean;
      is?: { revenue?: number[]; cost?: number[]; net?: number[]; years?: FmpYear[] };
      bs?: { assets?: number[]; liabilities?: number[]; equity?: number[]; years?: FmpYear[] };
      cfs?: { op?: number[]; capex?: number[]; fcf?: number[]; years?: FmpYear[] };
    }
  | any;

function num(v: any): number | undefined {
  const n = typeof v === "string" ? Number(v.replace(/,/g, "")) : Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function pickYear(row: { date?: string; calendarYear?: FmpYear }): string {
  if (row?.calendarYear != null) return String(row.calendarYear);
  if (row?.date) return String(row.date).slice(0, 4);
  return "";
}

function sortTakeLast<T extends { date?: string; calendarYear?: FmpYear }>(arr: T[], n = 5): T[] {
  const withKey = arr
    .map((r) => ({ r, y: pickYear(r) }))
    .filter((x) => x.y && x.y.length >= 4);
  withKey.sort((a, b) => (a.y < b.y ? -1 : a.y > b.y ? 1 : 0));
  const last = withKey.slice(-n).map((x) => x.r);
  return last;
}

async function fetchFmpFinancials(sym: string): Promise<{
  is: TrioSeries & { years: string[] };
  bs: TrioSeries & { years: string[] };
  cfs: TrioSeries & { years: string[] };
}> {
  const res = await fetch(`/api/fmp/financials?symbol=${encodeURIComponent(sym)}`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`financials HTTP ${res.status}`);
  const data: FmpFinancialsResponse = await res.json();

  // Path A: normalized shape already present
  if (data?.is && data?.bs && data?.cfs) {
    const isYears = (data.is.years ?? []).map(String);
    const bsYears = (data.bs.years ?? []).map(String);
    const cfsYears = (data.cfs.years ?? []).map(String);
    return {
      is: {
        good: (data.is.revenue ?? []).map(Number),
        bad: (data.is.cost ?? []).map((v: number) => Math.abs(Number(v))),
        net: (data.is.net ?? []).map(Number),
        years: isYears,
      },
      bs: {
        good: (data.bs.assets ?? []).map(Number),
        bad: (data.bs.liabilities ?? []).map(Number),
        net: (data.bs.equity ?? []).map(Number),
        years: bsYears,
      },
      cfs: {
        good: (data.cfs.op ?? []).map(Number),
        bad: (data.cfs.capex ?? []).map((v: number) => Math.abs(Number(v))),
        net: (data.cfs.fcf ?? []).map(Number),
        years: cfsYears,
      },
    };
  }

  // Path B: raw FMP rows; normalize to last 5 FY
  const incomeRows: FmpIncomeRow[] = Array.isArray((data as any)?.income)
    ? (data as any).income
    : [];
  const balanceRows: FmpBalanceRow[] = Array.isArray((data as any)?.balance)
    ? (data as any).balance
    : [];
  const cashRows: FmpCashRow[] = Array.isArray((data as any)?.cashflow)
    ? (data as any).cashflow
    : [];

  const isRows = sortTakeLast(incomeRows, 5);
  const bsRows = sortTakeLast(balanceRows, 5);
  const cfRows = sortTakeLast(cashRows, 5);

  const isYears = isRows.map(pickYear);
  const bsYears = bsRows.map(pickYear);
  const cfYears = cfRows.map(pickYear);

  const rev = isRows.map((r) => num(r.revenue) ?? NaN);
  const cost = isRows.map((r) => {
    const c = num(r.costOfRevenue);
    if (Number.isFinite(c)) return Math.abs(c!);
    const gp = num(r.grossProfit);
    const rr = num(r.revenue);
    if (Number.isFinite(gp) && Number.isFinite(rr)) return Math.max(0, rr! - gp!);
    return NaN;
  });
  const net = isRows.map(
    (r) => num(r.netIncome) ?? num(r.netIncomeApplicableToCommonShares) ?? NaN
  );

  const assets = bsRows.map((r) => num(r.totalAssets) ?? NaN);
  const liabilities = bsRows.map((r) => num(r.totalLiabilities) ?? NaN);
  const equity = bsRows.map((r, i) => {
    const e = num(r.totalStockholdersEquity);
    if (Number.isFinite(e)) return e!;
    const a = assets[i],
      l = liabilities[i];
    if (Number.isFinite(a) && Number.isFinite(l)) return a! - l!;
    return NaN;
  });

  const op = cfRows.map(
    (r) => num(r.operatingCashFlow) ?? num(r.netCashProvidedByOperatingActivities) ?? NaN
  );
  const capex = cfRows.map((r) => Math.abs(num(r.capitalExpenditure) ?? 0)); // outflow magnitude
  const fcf = cfRows.map((r, i) => {
    const f = num(r.freeCashFlow);
    if (Number.isFinite(f)) return f!;
    const o = op[i];
    const c = capex[i];
    if (Number.isFinite(o) && Number.isFinite(c)) return o! - c!;
    return NaN;
  });

  const clean = (arr: number[]) =>
    arr.map((v) => (Number.isFinite(v) ? +(+v).toFixed(2) : 0));

  return {
    is: { good: clean(rev), bad: clean(cost), net: clean(net), years: isYears },
    bs: { good: clean(assets), bad: clean(liabilities), net: clean(equity), years: bsYears },
    cfs: { good: clean(op), bad: clean(capex), net: clean(fcf), years: cfYears },
  };
}

/* --------------------- FS row helpers (shared) --------------------- */

function calcRow(arr: number[], kind: FSRow["kind"], label: string): FSRow {
  const first = arr[0];
  const last = arr[arr.length - 1];
  const totalPct = first === 0 ? 0 : ((last - first) / Math.abs(first)) * 100;
  const yoyPct = totalPct / Math.max(1, arr.length - 1);
  const { r2 } = linRegStats(arr);
  return { label, kind, total: totalPct, yoy: yoyPct, conf: Math.round(r2 * 100) };
}
function mkBlockFromTrio(
  title: string,
  trio: TrioSeries,
  labels: [string, string, string]
): FSBlock {
  return {
    title,
    rows: [
      calcRow(trio.good, "good", labels[0]),
      calcRow(trio.bad, "bad", labels[1]),
      calcRow(trio.net, "net", labels[2]),
    ],
  };
}

/* ------------------------------ main ------------------------------ */

/**
 * evaluateStock:
 * - pulls history (real or mock)
 * - computes momentum (RB or ML-weighted if config exists)
 * - loads 5y financials from FMP and **uses FMP fiscal years** for labels (no TTM / no "current year" fill-ins)
 *
 * NEW:
 * - also pulls intraday series:
 *    - 1D => 5min bars
 *    - 1W => 1hour bars
 *   stored on result.intraday["1D"/"1W"] for short-range charting.
 *
 * NEW:
 * - pulls company name + key stats (market cap, PE, div yield, etc.)
 *   stored on result.name and result.keyStats.
 */
export async function evaluateStock(symIn: string, useReal: boolean): Promise<EvalResult> {
  const sym = symIn.trim().toUpperCase();
  if (!sym) throw new Error("empty symbol");

  async function runReal(): Promise<EvalResult> {
    // 0) Profile + stats (best-effort)
    const prof = await fetchFmpProfileAndStats(sym).catch(() => ({} as any));
    const companyName = prof?.name ?? sym;

    // 0b) Live quote (best-effort, shared with other screens)
    let livePrice: number | null = null;
    try {
      const qRes = await fetch(`/api/market/quotes?symbols=${encodeURIComponent(sym)}`, { cache: "no-store" });
      if (qRes.ok) {
        const qData = await qRes.json();
        const px = qData?.data?.[sym]?.price;
        if (Number.isFinite(px)) livePrice = Number(px);
      }
    } catch {
      /* ignore live quote miss */
    }

    // 1) MAX history (enforced daily via fetchHistory)
    const hist = await fetchHistory(sym);
    if (hist.length < 10) throw new Error("not enough history");

    const hist5y = sliceRecentYears(hist, 5);
    const dates = hist5y.map((p) => p.date);
    const prices = hist5y.map((p) => p.close);

    // 1b) Intraday series for 1D / 1W (best-effort; don't fail eval if these miss)
    const [intraday1D, intraday1W, intraday1M1H] = await Promise.all([
      fetchIntraday1D(sym).catch(() => []),
      fetchIntraday1W(sym).catch(() => []),
      fetchIntraday1MHour(sym).catch(() => []),
    ]);

    const intraday: any = {};
    if (intraday1D.length > 1) {
      intraday["1D"] = {
        dates: intraday1D.map((p) => p.date),
        price: intraday1D.map((p) => p.close),
      };
    }
    if (intraday1W.length > 1) {
      intraday["1W"] = {
        dates: intraday1W.map((p) => p.date),
        price: intraday1W.map((p) => p.close),
      };
    }
    if (intraday1M1H.length > 1) {
      intraday["1M_1H"] = {
        dates: intraday1M1H.map((p) => p.date),
        price: intraday1M1H.map((p) => p.close),
      };
    }

    // 2) Optional ML configuration
    const mlCfg = await fetchMLConfig(sym);

    // 3) Momentum engine (applies ML if provided)
    const momo = computeMomentum({ close: prices }, { ml: mlCfg ?? null });

    // 4) UI weights (pick a reasonable set if present)
    let w: { band: number; rsi: number; macd: number } | undefined = undefined;
    if (mlCfg?.indicator) {
      const b = mlCfg.indicator;
      w = b["default"] ?? b["trend"] ?? b["range"] ?? b["extreme"];
    }
    if (!w) w = { band: 1 / 3, rsi: 1 / 3, macd: 1 / 3 };

    // 5) ML composite (engine returns −100..100)
    const compML = momo.scoreMomentum;

    // 6) Header stats
    const last = livePrice ?? prices[prices.length - 1];
    const prev = prices[Math.max(0, prices.length - 2)];
    const changeAbs = last - prev;
    const changePct = prev === 0 ? 0 : (changeAbs / prev) * 100;

    // 7) Real financials (5y actual) + correct fiscal **years**
    let trioIS: TrioSeries,
      trioBS: TrioSeries,
      trioCFS: TrioSeries,
      yearsIS: string[] = [],
      yearsBS: string[] = [],
      yearsCFS: string[] = [];
    try {
      const fin = await fetchFmpFinancials(sym);
      trioIS = { good: fin.is.good, bad: fin.is.bad, net: fin.is.net };
      trioBS = { good: fin.bs.good, bad: fin.bs.bad, net: fin.bs.net };
      trioCFS = { good: fin.cfs.good, bad: fin.cfs.bad, net: fin.cfs.net };
      yearsIS = fin.is.years;
      yearsBS = fin.bs.years;
      yearsCFS = fin.cfs.years;
    } catch {
      // Fallback to mock if API not wired yet
      const rnd = seeded(sym + "_fin_fallback");
      trioIS = genTrio10(rnd, 120, 70);
      trioBS = genTrio10(rnd, 150, 90);
      trioCFS = genTrio10(rnd, 80, 50);
    }

    // 8) Summaries/blocks derived from real (or fallback) trios, titles from actual year ranges
    const detailsIS = mkBlockFromTrio(
      yearsIS.length ? `IS (${yearsIS[0]}–${yearsIS[yearsIS.length - 1]})` : "IS (last 5y)",
      trioIS,
      ["Rev", "Cost", "Net"]
    );
    const detailsBS = mkBlockFromTrio(
      yearsBS.length ? `BS (${yearsBS[0]}–${yearsBS[yearsBS.length - 1]})` : "BS (last 5y)",
      trioBS,
      ["Assets", "Liabilities", "Equity"]
    );
    const detailsCFS = mkBlockFromTrio(
      yearsCFS.length ? `CFS (${yearsCFS[0]}–${yearsCFS[yearsCFS.length - 1]})` : "CFS (last 5y)",
      trioCFS,
      ["Op", "CapEx", "FCF"]
    );

    // 9) Keep other sections as before (FTV remains mock for now)
    const rnd = seeded(sym);
    const financialScore = Math.round(40 + rnd() * 60);
    const ftvScore = Number.NaN; // real mode: avoid mock FTV
    const strength = Math.round(30 + rnd() * 70);
    const stability = Math.round(30 + rnd() * 70);
    const seriesIS = trioIS.good.slice(); // placeholder mini-series
    const seriesBS = trioBS.good.slice();
    const seriesCFS = trioCFS.good.slice();
    const seriesFtv: number[] = [];

    return {
      sym,
      name: companyName,
      keyStats: prof?.stats,
      price: last,
      changeAbs,
      changePct,
      indicators: {
        band: Math.round(momo.scoreBB[momo.scoreBB.length - 1] ?? 0),
        rsi: Math.round(-(momo.scoreRSI[momo.scoreRSI.length - 1] ?? 0)),
        macd: Math.round(momo.scoreMACD[momo.scoreMACD.length - 1] ?? 0),
      },
      overallScore: Math.round(((compML[compML.length - 1] ?? 0) + 100) / 2),
      financialScore,
      ftvScore,
      strength,
      stability,
      series: {
        price: prices,
        dates,
        financial: { is: seriesIS, bs: seriesBS, cfs: seriesCFS },
        ftv: seriesFtv,
      },
      // NEW: intraday short-range series for charting
      intraday,
      // NEW: exact fiscal year labels from FMP (drives chart x-axis & titles)
      finYears: {
        is: yearsIS,
        bs: yearsBS,
        cfs: yearsCFS,
      },
      finDots: { is: trioIS, bs: trioBS, cfs: trioCFS },
      summaries: {
        is: "Real 5y financials loaded. Forecast shown as dashed trend.",
        bs: "Balance sheet trend based on last 5 fiscal years.",
        cfs: "Cash flow trend based on last 5 fiscal years.",
        research:
          "Neutral to positive near term. Watch margins, inventory turns, and capex discipline. Valuation fair vs. peers.",
      },
      details: {
        is: detailsIS,
        bs: detailsBS,
        cfs: detailsCFS,
      },
      momentum: {
        scoreBB: momo.scoreBB,
        scoreRSI: momo.scoreRSI,
        scoreMACD: momo.scoreMACD,
        scoreMomentum: momo.scoreMomentum,
        scoreCompositeML: compML,
        bbUpper: momo.bbUpper,
        bbMid: momo.bbMid,
        bbLower: momo.bbLower,
        macd: momo.macd,
        macdSignal: momo.macdSignal,
        macdHist: momo.macdHist,
        emaFast: momo.emaFast,
        emaSlow: momo.emaSlow,
        mlWeights: w,
      },
      dataSource: "real",
    } as EvalResult;
  }

  if (useReal) {
    return runReal();
  }

  // ---------- mock mode ----------
  const rnd = seeded(sym);
  const price = 120 + Math.round(rnd() * 180);
  const changePct = (rnd() - 0.5) * 2;
  const changeAbs = (price * changePct) / 100;

  const financialScore = Math.round(40 + rnd() * 60);
  const ftvScore = Math.round(40 + rnd() * 60);
  const strength = Math.round(30 + rnd() * 70);
  const stability = Math.round(30 + rnd() * 70);

  const seriesPrice = genSeries(1260, price, Math.max(2, price * 0.012), rnd);
  const today = new Date();
  const dates = seriesPrice.map((_, i) => {
    const d = new Date(today);
    d.setDate(d.getDate() - (seriesPrice.length - 1 - i));
    return d.toISOString().slice(0, 10);
  });

  const seriesIS = genSeries(80, financialScore, 3, rnd);
  const seriesBS = genSeries(80, Math.max(5, financialScore - 8), 2.4, rnd);
  const seriesCFS = genSeries(80, Math.max(5, financialScore - 3), 3.6, rnd);
  const seriesFtv = genSeries(80, ftvScore, 3, rnd);

  const momo = computeMomentum({ close: seriesPrice });
  const lastIdx = seriesPrice.length - 1;
  const band = Math.round(momo.scoreBB[lastIdx]);
  const rsi = Math.round(-momo.scoreRSI[lastIdx]);
  const macd = Math.round(momo.scoreMACD[lastIdx]);
  const compositeRB = momo.scoreMomentum[lastIdx];
  const overallScore = Math.round((compositeRB + 100) / 2);

  const trioIS = genTrio10(rnd, 120, 70);
  const trioBS = genTrio10(rnd, 150, 90);
  const trioCFS = genTrio10(rnd, 80, 50);

  const mkBlock = (title: string, trio: TrioSeries, labels: [string, string, string]): FSBlock => ({
    title,
    rows: [
      calcRow(trio.good, "good", labels[0]),
      calcRow(trio.bad, "bad", labels[1]),
      calcRow(trio.net, "net", labels[2]),
    ],
  });

  // Mock intraday (best-effort so 1D/1W ranges have something to show in mock mode)
  const rnd1d = seeded(sym + "_intraday_1d");
  const rnd1w = seeded(sym + "_intraday_1w");
  const intraday1DPrices = genSeries(
    78,
    seriesPrice[lastIdx],
    Math.max(0.5, seriesPrice[lastIdx] * 0.003),
    rnd1d
  );
  const intraday1DDates = intraday1DPrices.map((_, i) => {
    const d = new Date();
    d.setMinutes(d.getMinutes() - (intraday1DPrices.length - 1 - i) * 5);
    return d.toISOString().replace("T", " ").slice(0, 19);
  });
  const intraday1WPrices = genSeries(
    35,
    seriesPrice[lastIdx],
    Math.max(0.5, seriesPrice[lastIdx] * 0.004),
    rnd1w
  );
  const intraday1WDates = intraday1WPrices.map((_, i) => {
    const d = new Date();
    d.setHours(d.getHours() - (intraday1WPrices.length - 1 - i));
    return d.toISOString().replace("T", " ").slice(0, 19);
  });
  const rnd1m = seeded(sym + "_intraday_1m");
  const intraday1MHourPrices = genSeries(
    180,
    seriesPrice[lastIdx],
    Math.max(0.5, seriesPrice[lastIdx] * 0.005),
    rnd1m
  );
  const intraday1MHourDates = intraday1MHourPrices.map((_, i) => {
    const d = new Date();
    d.setHours(d.getHours() - (intraday1MHourPrices.length - 1 - i));
    return d.toISOString().replace("T", " ").slice(0, 19);
  });

  // Mock key stats (so expandable has content in mock mode)
  const mockMarketCap = Math.round(5e9 + rnd() * 350e9);
  const mockPe = +(8 + rnd() * 30).toFixed(2);
  const mockDiv = +(rnd() * 3.5).toFixed(2);
  const mockBeta = +(0.6 + rnd() * 1.2).toFixed(2);
  const mockHigh52 = +(price * (1.05 + rnd() * 0.6)).toFixed(2);
  const mockLow52 = +(price * (0.45 + rnd() * 0.45)).toFixed(2);
  const mockAvgVol = Math.round(5e5 + rnd() * 8e7);

  return {
    sym,
    name: `${sym} Corp.`,
    keyStats: {
      marketCap: mockMarketCap,
      peRatio: mockPe,
      dividendYield: mockDiv,
      beta: mockBeta,
      high52w: mockHigh52,
      low52w: mockLow52,
      avgVolume: mockAvgVol,
    },
    price,
    changeAbs,
    changePct,
    indicators: { band, rsi, macd },
    overallScore,
    financialScore,
    ftvScore,
    strength,
    stability,
    series: {
      price: seriesPrice,
      dates,
      financial: { is: seriesIS, bs: seriesBS, cfs: seriesCFS },
      ftv: seriesFtv,
    },
    // NEW: intraday short-range series for charting
    intraday: {
      "1D": { dates: intraday1DDates, price: intraday1DPrices },
      "1W": { dates: intraday1WDates, price: intraday1WPrices },
      "1M_1H": { dates: intraday1MHourDates, price: intraday1MHourPrices },
    },
    finDots: { is: trioIS, bs: trioBS, cfs: trioCFS },
    summaries: {
      is: "Revenue +7% YoY, GM 48%, OpMargin 22%.",
      bs: "Low leverage, Cash > ST liabilities.",
      cfs: "FCF positive, reinvestment trending up.",
      research:
        "Neutral to positive near term. Watch margins, inventory turns, and capex discipline. Valuation fair vs. peers.",
    },
    details: {
      is: mkBlock("IS (2015–2025)", genTrio10(seeded(sym + "is")), ["Rev", "Cost", "Net"]),
      bs: mkBlock("BS (2015–2025)", genTrio10(seeded(sym + "bs")), ["Assets", "Liabilities", "Equity"]),
      cfs: mkBlock("CFS (2015–2025)", genTrio10(seeded(sym + "cfs")), ["Op", "CapEx", "FCF"]),
    },
    momentum: {
      scoreBB: momo.scoreBB,
      scoreRSI: momo.scoreRSI,
      scoreMACD: momo.scoreMACD,
      scoreMomentum: momo.scoreMomentum,
      bbUpper: momo.bbUpper,
      bbMid: momo.bbMid,
      bbLower: momo.bbLower,
      macd: momo.macd,
      macdSignal: momo.macdSignal,
      macdHist: momo.macdHist,
      emaFast: momo.emaFast,
      emaSlow: momo.emaSlow,
    },
    dataSource: "mock",
  } as EvalResult;
}
