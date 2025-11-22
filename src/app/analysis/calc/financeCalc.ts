// src/app/analysis/calc/financeCalc.ts
"use client";

import { FSBlock, FSKind, FSRow, TrioSeries, EvalResult } from "../shared";
import { linRegStats, toPathXY } from "../shared";

export function calcRow(arr: number[], kind: FSRow["kind"], label: string): FSRow {
  const first = arr[0];
  const last = arr[arr.length - 1];
  const totalPct = first === 0 ? 0 : ((last - first) / Math.abs(first)) * 100;
  const yoyPct = totalPct / Math.max(1, arr.length - 1);
  const { r2 } = linRegStats(arr);
  return { label, kind, total: totalPct, yoy: yoyPct, conf: Math.round(r2 * 100) };
}

export function mkBlockFromTrio(
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

/* Geometry + paths for the financial scatter/regression panel
   NOTE: All values are scaled to thousands ($K) for display. */
export function buildFinScatter(
  result: EvalResult,
  activeFS: FSKind,
  opts?: { forecastYears?: number; w?: number; h?: number; pad?: number }
) {
  const raw = result.finDots[activeFS];
  const nAct = raw.good.length;

  // --- Display in thousands ($K)
  const DIVISOR = 1000;
  const toK = (a: number[]) => a.map((v) => v / DIVISOR);
  const trio: TrioSeries = {
    good: toK(raw.good),
    bad: toK(raw.bad),
    net: toK(raw.net),
  };

  // Forecast horizon: default 5Y (actuals should be 5Y from FMP; we forecast the next 5Y).
  const nFor = Math.max(0, Math.trunc(opts?.forecastYears ?? 5));
  const nTot = nAct + nFor;

  // Regress on $K-scaled series so predictions are also in $K
  const G = linRegStats(trio.good);
  const B = linRegStats(trio.bad);
  const N = linRegStats(trio.net);

  const reg = (slope: number, intercept: number) =>
    Array.from({ length: nTot }, (_, i) => intercept + slope * i);

  const gPred = reg(G.slope, G.intercept);
  const bPred = reg(B.slope, B.intercept);
  const nPred = reg(N.slope, N.intercept);

  // Keep solid (actual) vs dashed (forecast) separation
  const goodRegSolid = gPred.slice(0, nAct);
  const badRegSolid = bPred.slice(0, nAct);
  const netRegSolid = nPred.slice(0, nAct);

  // Mask forecast so path drawing can skip NaNs in the solid portion
  const maskForecast = (arr: number[]) => {
    const full = Array(nTot).fill(NaN);
    for (let i = Math.max(0, nAct - 1); i < nTot; i++) full[i] = arr[i];
    return full;
  };
  const goodRegForecast = maskForecast(gPred);
  const badRegForecast = maskForecast(bPred);
  const netRegForecast = maskForecast(nPred);

  // Scale domain
  const allVals = [
    ...trio.good,
    ...trio.bad,
    ...trio.net,
    ...(goodRegForecast.filter(Number.isFinite) as number[]),
    ...(badRegForecast.filter(Number.isFinite) as number[]),
    ...(netRegForecast.filter(Number.isFinite) as number[]),
  ];

  const pad = opts?.pad ?? 10;
  const w = opts?.w ?? 1000;
  const h = opts?.h ?? 200;

  const min = Math.min(...allVals);
  const max = Math.max(...allVals);
  const sx = (w - 2 * pad) / Math.max(1, nTot - 1);
  const sy = max === min ? 1 : (h - 2 * pad) / (max - min);
  const X = (i: number) => pad + i * sx;
  const Y = (v: number) => h - pad - (v - min) * sy;

  // Prefer explicit years from result (e.g., loaded from FMP), else infer.
  const yearsAct = result.finYears?.[activeFS];
  let years: string[];
  if (Array.isArray(yearsAct) && yearsAct.length === nAct) {
    const lastY = Number.parseInt(yearsAct[yearsAct.length - 1], 10);
    const fut = Number.isFinite(lastY)
      ? Array.from({ length: nFor }, (_, i) => String(lastY + i + 1))
      : Array.from({ length: nFor }, (_, i) => String(new Date().getFullYear() + i + 1));
    years = [...yearsAct.map(String), ...fut];
  } else {
    const thisYear = new Date().getFullYear();
    const startYear = thisYear - (nAct - 1);
    years = Array.from({ length: nTot }, (_, i) => `${startYear + i}`);
  }

  return {
    trio,               // already scaled to $K
    nAct,
    nFor,
    nTot,
    X,
    Y,
    w,
    h,
    pad,
    years,
    r2: { good: G.r2, bad: B.r2, net: N.r2 },
    gPred,
    bPred,
    nPred,
    goodRegSolidPath: toPathXY(goodRegSolid, X, Y),
    badRegSolidPath: toPathXY(badRegSolid, X, Y),
    netRegSolidPath: toPathXY(netRegSolid, X, Y),
    goodRegForecastPath: toPathXY(goodRegForecast, X, Y),
    badRegForecastPath: toPathXY(badRegForecast, X, Y),
    netRegForecastPath: toPathXY(netRegForecast, X, Y),
  };
}
