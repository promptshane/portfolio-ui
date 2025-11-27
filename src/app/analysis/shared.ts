// src/app/analysis/shared.ts
"use client";

import { useEffect, useRef, useState } from "react";

/* ---------- types shared across the analysis page ---------- */

export type FSRow = {
  label: string;
  kind: "good" | "bad" | "net";
  total: number;
  yoy: number;
  conf: number;
};

export type FSBlock = { title: string; rows: FSRow[] };
export type TrioSeries = { good: number[]; bad: number[]; net: number[] };

/* NEW: Trio with aligned year labels (used when loading real FMP data) */
export type TrioWithYears = { years: string[]; good: number[]; bad: number[]; net: number[] };

export type HistPoint = { date: string; close: number };
export type IndicKey = "band" | "rsi" | "macd";
export type RangeKey = "1D" | "1W" | "1M" | "3M" | "6M" | "YTD" | "1Y" | "2Y" | "5Y";
export type FSKind = "is" | "bs" | "cfs";

export type KeyStats = {
  marketCap?: number | null;
  peRatio?: number | null;
  dividendYield?: number | null; // percent
  beta?: number | null;
  high52w?: number | null;
  low52w?: number | null;
  avgVolume?: number | null;
};

/* ====== FTV doc types for dev upload/confirm UI ====== */
export type FtvDocMeta = {
  symbol: string;
  url: string;
  uploadedAt: string;
  confirmedAt?: string;

  // Optional fields parsed from the PDF (first page)
  ftvEstimate?: number;
  ftvAsOf?: string;
  moat?: "Wide" | "Narrow" | "None" | string;
  styleBox?: string;
  uncertainty?: "Low" | "Medium" | "High" | "Very High" | "Extreme" | string;
  capitalAllocation?: "Poor" | "Standard" | "Exemplary" | string;
  esgRisk?: number;
  esgAsOf?: string;
  esgCategory?: "Negligible" | "Low" | "Medium" | "High" | "Severe" | string;

  // Parse metadata (for auto-reparse/versioning)
  parseVersion?: string;
  parsedAt?: string;
};
export type FtvDocsResponse = {
  latest?: FtvDocMeta;
  all: FtvDocMeta[];
};
/* ======================================================= */

/* NEW: Optional real-year labels per FS section, populated when FMP data is used */
export type FinYears = { is: string[]; bs: string[]; cfs: string[] };

export type EvalResult = {
  sym: string;
  name: string;
  price: number;
  changeAbs: number;
  changePct: number;
  indicators: { band: number; rsi: number; macd: number };
  overallScore: number;
  financialScore: number;
  ftvScore: number;
  dataSource?: "real" | "mock";
  strength: number;
  stability: number;
  keyStats?: KeyStats;
  series: {
    price: number[];
    dates: string[];
    financial: { is: number[]; bs: number[]; cfs: number[] };
    ftv: number[];
  };
  finDots: { is: TrioSeries; bs: TrioSeries; cfs: TrioSeries };

  /* NEW: when present, drives x-axis labels in FinancialDisplay via buildFinScatter */
  finYears?: FinYears;

  summaries: { is: string; bs: string; cfs: string; research: string };
  details: { is: FSBlock; bs: FSBlock; cfs: FSBlock };
  momentum: {
    scoreBB: number[];
    scoreRSI: number[];
    scoreMACD: number[];
    scoreMomentum: number[];
    scoreCompositeML?: number[];
    bbUpper: number[]; bbMid: number[]; bbLower: number[];
    macd: number[]; macdSignal: number[]; macdHist: number[];
    emaFast: number[]; emaSlow: number[];
    mlWeights?: { band: number; rsi: number; macd: number };
  };
};

/* ------------------------ pure helpers (unchanged) ------------------------ */

export function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, n));
}
export function dotClass(x: number) {
  return x >= 67 ? "bg-[var(--good-500)]" : x >= 34 ? "bg-[var(--mid-400)]" : "bg-[var(--bad-500)]";
}
export function fmtPct(n: number) {
  const s = n >= 0 ? "+" : "";
  return `${s}${n.toFixed(2)}%`;
}
export function fmtPct0(n: number) {
  const s = n >= 0 ? "+" : "";
  return `${s}${Math.round(n)}%`;
}

export function seeded(seedStr: string) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seedStr.length; i++) {
    h ^= seedStr.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    return (h >>> 0) / 4294967295;
  };
}

export function genSeries(n: number, base: number, vol: number, rnd: () => number) {
  const arr: number[] = [];
  let v = base;
  for (let i = 0; i < n; i++) {
    const step = (rnd() - 0.5) * vol + (i / n) * (vol * 0.15) * (rnd() - 0.5);
    v = Math.max(1, v + step);
    arr.push(v);
  }
  return arr;
}

export function toPath(values: number[], w = 1000, h = 280, pad = 10) {
  if (!values.length) return "";
  const min = Math.min(...values);
  const max = Math.max(...values);
  const sx = (w - 2 * pad) / Math.max(1, values.length - 1);
  const sy = max === min ? 1 : (h - 2 * pad) / (max - min);
  const x = (i: number) => pad + i * sx;
  const y = (v: number) => h - pad - (v - min) * sy;

  let d = `M ${x(0)} ${y(values[0])}`;
  for (let i = 1; i < values.length; i++) d += ` L ${x(i)} ${y(values[i])}`;
  return d;
}

export function toPathXY(values: number[], X: (i: number)=>number, Y: (v: number)=>number) {
  if (!values.length) return "";
  let started = false;
  let d = "";
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (!Number.isFinite(v)) continue;
    const xi = X(i);
    const yi = Y(v);
    if (!started) {
      d = `M ${xi} ${yi}`;
      started = true;
    } else {
      d += ` L ${xi} ${yi}`;
    }
  }
  return d;
}

/* Wilder RSI for display (0..100) */
export function rsiWilder(close: number[], period = 14): number[] {
  const n = close.length;
  const out = new Array<number>(n).fill(NaN);
  if (n < 2) return out;

  const gains = new Array<number>(n).fill(0);
  const losses = new Array<number>(n).fill(0);
  for (let i = 1; i < n; i++) {
    const diff = close[i] - close[i - 1];
    gains[i] = diff > 0 ? diff : 0;
    losses[i] = diff < 0 ? -diff : 0;
  }

  let avgGain = 0;
  let avgLoss = 0;
  const initEnd = Math.min(period, n - 1);
  for (let i = 1; i <= initEnd; i++) {
    avgGain += gains[i];
    avgLoss += losses[i];
  }
  avgGain /= period;
  avgLoss /= period;
  if (n > period) {
    const denom = avgGain + avgLoss;
    out[period] = denom === 0 ? 50 : 100 * (avgGain / denom);
  }

  for (let i = period + 1; i < n; i++) {
    avgGain = (avgGain * (period - 1) + gains[i]) / period;
    avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
    const denom = avgGain + avgLoss;
    out[i] = denom === 0 ? 50 : 100 * (avgGain / denom);
  }
  return out;
}

/* Derivative helpers + colors */
export const DERIV_COLORS: Record<IndicKey, { d1: string; d2: string }> = {
  band: { d1: "#60a5fa", d2: "#93c5fd" },
  rsi:  { d1: "#f59e0b", d2: "#fbbf24" },
  macd: { d1: "var(--good-400)", d2: "var(--good-500)" },
};

export function derivative01(series: number[], order: 1 | 2): number[] {
  const n = series.length;
  const d1 = new Array<number>(n).fill(0);
  for (let i = 1; i < n; i++) d1[i] = series[i] - series[i - 1];
  const base = order === 1 ? d1 : (() => {
    const d2 = new Array<number>(n).fill(0);
    for (let i = 1; i < n; i++) d2[i] = d1[i] - d1[i - 1];
    return d2;
  })();
  const maxAbs = Math.max(1e-6, ...base.map((v) => Math.abs(v)));
  const scale = 0.35 * maxAbs || 1;
  return base.map((v) => 0.5 + 0.5 * Math.tanh(v / scale));
}

/* Regression / R² */
export function linRegStats(y: number[]) {
  const n = y.length;
  const x = Array.from({ length: n }, (_, i) => i);
  const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
  const xBar = mean(x);
  const yBar = mean(y);
  const sxx = x.reduce((s, xi) => s + (xi - xBar) * (xi - xBar), 0);
  const sxy = x.reduce((s, xi, i) => s + (xi - xBar) * (y[i] - yBar), 0);
  const slope = sxx === 0 ? 0 : sxy / sxx;
  const intercept = yBar - slope * xBar;
  const yHat = x.map((xi) => intercept + slope * xi);
  const sst = y.reduce((s, yi) => s + (yi - yBar) * (yi - yBar), 0);
  const sse = y.reduce((s, yi, i) => s + (yi - yHat[i]) * (yi - yHat[i]), 0);
  const r2raw = sst === 0 ? (sse === 0 ? 1 : 0) : 1 - sse / sst;
  const r2 = Math.max(0, Math.min(1, r2raw));
  return { slope, intercept, r2, yHat };
}

/* 10y trio generator */
export function genTrio10(rnd: () => number, goodBase = 100, badBase = 60): TrioSeries {
  const n = 10;
  let g = goodBase * (0.85 + rnd() * 0.3);
  let b = badBase * (0.85 + rnd() * 0.3);
  const good: number[] = [];
  const bad: number[] = [];
  const net: number[] = [];
  for (let i = 0; i < n; i++) {
    g = Math.max(5, g + (rnd() - 0.5) * goodBase * 0.18);
    b = Math.max(3, b + (rnd() - 0.5) * badBase * 0.20);
    good.push(+g.toFixed(2));
    bad.push(+b.toFixed(2));
    net.push(+(g - b).toFixed(2));
  }
  return { good, bad, net };
}

/* date helpers */
export function addMonths(d: Date, months: number) {
  const dt = new Date(d);
  dt.setMonth(dt.getMonth() - months);
  return dt;
}
export function startOfYear(d: Date) {
  return new Date(d.getFullYear(), 0, 1);
}

/* small tween hook */
export function useAnimatedNumber(value: number, duration = 180) {
  const [animated, setAnimated] = useState(value);
  const fromRef = useRef(value);

  useEffect(() => {
    const from = fromRef.current;
    const to = value;
    if (from === to) return;

    let raf = 0;
    const start = performance.now();

    const step = (t: number) => {
      const p = Math.min(1, (t - start) / duration);
      setAnimated(from + (to - from) * p);
      if (p < 1) raf = requestAnimationFrame(step);
      else fromRef.current = to;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);

  return animated;
}
