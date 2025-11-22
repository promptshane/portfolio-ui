"use client";

import type { EvalResult, TrioSeries, FtvDocMeta } from "../shared";
import { computeFinancialScores } from "./financialScoreCalc";

export type ScoreEntry = {
  fin: number | null;
  mom: number | null;
  fair: number | null;
  lastPrice?: number | null;
  changePct?: number | null;
  historyDates?: string[];
  historyPrices?: number[];
};

export function clampScore(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(100, Math.round(value)));
}

const hasValues = (arr?: number[]) => Array.isArray(arr) && arr.some((v) => Number.isFinite(v));
const hasTrioData = (trio?: TrioSeries) =>
  !!trio && (hasValues(trio.good) || hasValues(trio.bad) || hasValues(trio.net));

export function extractFinancialScore(result: EvalResult): number | null {
  const dots = result?.finDots;
  if (!dots) return null;
  if (!hasTrioData(dots.is) && !hasTrioData(dots.bs) && !hasTrioData(dots.cfs)) return null;
  const bundle = computeFinancialScores(result);
  const latest = bundle?.overall?.latest;
  return Number.isFinite(latest) ? latest : null;
}

type FtvDocsResponse = { ok: boolean; latest?: FtvDocMeta | null };

export async function fetchFtvDotScore(
  sym: string,
  price: number | null | undefined
): Promise<number | null> {
  if (!Number.isFinite(price)) return null;
  try {
    const res = await fetch(`/api/ftv/docs?symbol=${encodeURIComponent(sym)}`, { cache: "no-store" });
    const data: FtvDocsResponse = await res.json();
    if (!res.ok || !data?.ok) return null;
    const latest = data.latest;
    if (!latest?.url) return null;
    const estimate =
      typeof latest.ftvEstimate === "number"
        ? latest.ftvEstimate
        : latest?.ftvEstimate != null
        ? Number(latest.ftvEstimate)
        : undefined;
    if (!Number.isFinite(estimate) || estimate === 0) return null;
    const ratio = (price as number) / estimate;
    if (!Number.isFinite(ratio)) return null;
    if (ratio < 0.95) return 85;
    if (ratio > 1.05) return 20;
    return 55;
  } catch {
    return null;
  }
}
