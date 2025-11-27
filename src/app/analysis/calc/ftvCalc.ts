"use client";

import { EvalResult } from "../shared";

export function getFTVData(result: EvalResult) {
  const rawFv = Array.isArray(result.series.ftv) ? result.series.ftv : [];
  const fv = rawFv.filter((v) => Number.isFinite(v)) as number[];
  const n = fv.length;
  const priceTail = n ? result.series.price.slice(-n) : [];
  const confRaw = Number.isFinite(result.ftvScore) ? result.ftvScore : 0;
  const conf = Math.max(0, Math.min(100, confRaw));
  const bandPct = n ? 0.25 - (conf / 100) * 0.18 : 0;
  const upper = fv.map((v) => v * (1 + bandPct));
  const lower = fv.map((v) => v * (1 - bandPct));

  const pad = 10,
    w = 1000,
    h = 200,
    topY = pad,
    botY = h - pad;

  return { fv, n, priceTail, conf, bandPct, upper, lower, pad, w, h, topY, botY };
}
