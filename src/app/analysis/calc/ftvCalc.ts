"use client";

import { EvalResult } from "../shared";

export function getFTVData(result: EvalResult) {
  const fv = result.series.ftv;
  const n = fv.length;
  const priceTail = result.series.price.slice(-n);
  const conf = Math.max(0, Math.min(100, result.ftvScore));
  const bandPct = 0.25 - (conf / 100) * 0.18;
  const upper = fv.map((v) => v * (1 + bandPct));
  const lower = fv.map((v) => v * (1 - bandPct));

  const pad = 10,
    w = 1000,
    h = 200,
    topY = pad,
    botY = h - pad;

  return { fv, n, priceTail, conf, bandPct, upper, lower, pad, w, h, topY, botY };
}
