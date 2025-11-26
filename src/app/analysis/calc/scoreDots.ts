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
type DiscountResponse = {
  ok: boolean;
  latest?: {
    fairValue?: number | null;
    asOf?: string | null;
    createdAt?: string | null;
    priceUsed?: number | null;
    livePrice?: number | null;
    currentPrice?: number | null;
  } | null;
};

function parseDate(val?: string | null): number | null {
  if (!val) return null;
  const t = Date.parse(val);
  return Number.isNaN(t) ? null : t;
}

export async function fetchFtvDotScore(
  sym: string,
  price: number | null | undefined
): Promise<number | null> {
  try {
    const [ftvRes, discountRes] = await Promise.all([
      fetch(`/api/ftv/docs?symbol=${encodeURIComponent(sym)}`, { cache: "no-store" }),
      fetch(`/api/discounts/${encodeURIComponent(sym)}`, { cache: "no-store" }),
    ]);

    const ftvData: FtvDocsResponse = await ftvRes.json().catch(() => ({ ok: false }));
    const discountData: DiscountResponse = await discountRes.json().catch(() => ({ ok: false }));

    const ftv = ftvRes.ok && ftvData?.ok ? ftvData.latest ?? null : null;
    const disc = discountRes.ok && discountData?.ok ? discountData.latest ?? null : null;

    const ftvEstimate =
      ftv && typeof ftv.ftvEstimate === "number" && Number.isFinite(ftv.ftvEstimate)
        ? ftv.ftvEstimate
        : null;
    const ftvAsOf = ftv ? parseDate(ftv.ftvAsOf ?? ftv.confirmedAt ?? ftv.uploadedAt ?? null) : null;

    const discEstimate =
      disc && typeof disc.fairValue === "number" && Number.isFinite(disc.fairValue)
        ? disc.fairValue
        : null;
    const discAsOf = disc ? parseDate(disc.asOf ?? disc.createdAt ?? null) : null;

    const useDiscount =
      discEstimate !== null &&
      (!ftvEstimate || (discAsOf !== null && ftvAsOf !== null && discAsOf > ftvAsOf));

    const estimate = useDiscount ? discEstimate : ftvEstimate;
    const priceInput =
      (useDiscount && (disc?.priceUsed ?? disc?.livePrice ?? disc?.currentPrice)) ??
      price;

    if (typeof estimate !== "number" || !Number.isFinite(estimate) || estimate === 0) return null;
    if (typeof priceInput !== "number" || !Number.isFinite(priceInput)) return null;

    const ratio = priceInput / estimate;
    if (!Number.isFinite(ratio)) return null;
    if (ratio < 0.95) return 85;
    if (ratio > 1.05) return 20;
    return 55;
  } catch {
    return null;
  }
}
