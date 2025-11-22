// src/app/analysis/calc/financialScoreCalc.ts
"use client";

import { clamp, EvalResult, FSKind, TrioSeries } from "../shared";

type ScoreSeries = { series: number[]; latest: number };

export type FinancialScoreBundle = {
  perStatement: Record<FSKind, ScoreSeries>;
  overall: ScoreSeries;
};

const SCORE_NEUTRAL = 50;

function winsorTrend(t: number) {
  return clamp(t, -0.5, 1.0);
}

function mapTrendToScore(rawTrend: number) {
  const t = winsorTrend(rawTrend);
  if (t <= -0.2) return 0;
  if (t <= 0) return ((t + 0.2) / 0.2) * 50;
  if (t <= 0.2) return 50 + (t / 0.2) * 30;
  if (t <= 0.6) return 80 + ((t - 0.2) / 0.4) * 20;
  return 100;
}

function computeTrendValue(values: number[]): number {
  const n = values.length;
  if (n < 2) return 0;
  const first = values[0];
  const last = values[n - 1];
  const intervals = Math.max(1, n - 1);
  const delta = first === 0 ? (last === 0 ? 0 : Math.sign(last)) : (last - first) / Math.abs(first);
  const adjDelta = clamp(delta, -0.99, 10);
  const cagr = Math.pow(1 + adjDelta, 1 / intervals) - 1;
  const prev = values[n - 2];
  const yoy =
    prev === 0
      ? last === 0
        ? 0
        : Math.sign(last)
      : (last - prev) / Math.abs(prev);
  return 0.6 * cagr + 0.4 * yoy;
}

function growthScore(values: number[]): number {
  if (values.length < 2) return SCORE_NEUTRAL;
  const first = values[0];
  const last = values[values.length - 1];
  if (first < 0 && last > 0) return 90;
  if (first > 0 && last < 0) return 10;
  if (first <= 0 && last <= 0) {
    const absTrend = computeTrendValue(values.map((v) => Math.abs(v)));
    return mapTrendToScore(-absTrend);
  }
  const trend = computeTrendValue(values);
  return mapTrendToScore(trend);
}

function costDiscipline(revenue: number[], cost: number[]) {
  const spread = computeTrendValue(cost) - computeTrendValue(revenue);
  return clamp(75 - 200 * spread, 0, 100);
}

function liabilityDiscipline(assets: number[], liabilities: number[]) {
  const spread = computeTrendValue(liabilities) - computeTrendValue(assets);
  return clamp(75 - 200 * spread, 0, 100);
}

function capexDiscipline(op: number[], capex: number[]) {
  const spread = computeTrendValue(capex) - computeTrendValue(op);
  return clamp(75 - 200 * spread, 0, 100);
}

function profitLeverage(revenue: number[], net: number[]) {
  const spread = computeTrendValue(net) - computeTrendValue(revenue);
  return clamp(70 + 150 * spread, 0, 100);
}

function equityBuild(assets: number[], equity: number[]) {
  const spread = computeTrendValue(equity) - computeTrendValue(assets);
  return clamp(70 + 150 * spread, 0, 100);
}

function fcfConversion(op: number[], fcf: number[]) {
  const spread = computeTrendValue(fcf) - computeTrendValue(op);
  return clamp(70 + 150 * spread, 0, 100);
}

function seriesScore(length: number, calcAt: (idx: number) => number) {
  const out: number[] = [];
  for (let i = 0; i < length; i++) {
    if (i === 0) {
      out.push(SCORE_NEUTRAL);
      continue;
    }
    out.push(calcAt(i));
  }
  return out;
}

function computeIncomeScores(trio: TrioSeries) {
  const len = Math.min(trio.good.length, trio.bad.length, trio.net.length);
  const series = seriesScore(len, (idx) => {
    const rev = trio.good.slice(0, idx + 1);
    const cost = trio.bad.slice(0, idx + 1);
    const net = trio.net.slice(0, idx + 1);
    const revScore = growthScore(rev);
    const netScore = growthScore(net);
    const costEff = costDiscipline(rev, cost);
    const leverage = profitLeverage(rev, net);
    return (
      0.35 * revScore +
      0.35 * netScore +
      0.15 * costEff +
      0.15 * leverage
    );
  });
  return { series, latest: series[series.length - 1] ?? SCORE_NEUTRAL };
}

function computeBalanceScores(trio: TrioSeries) {
  const len = Math.min(trio.good.length, trio.bad.length, trio.net.length);
  const series = seriesScore(len, (idx) => {
    const assets = trio.good.slice(0, idx + 1);
    const liab = trio.bad.slice(0, idx + 1);
    const equity = trio.net.slice(0, idx + 1);
    const assetScore = growthScore(assets);
    const equityScore = growthScore(equity);
    const liabEff = liabilityDiscipline(assets, liab);
    const eqBuildScore = equityBuild(assets, equity);
    return (
      0.25 * assetScore +
      0.35 * equityScore +
      0.25 * liabEff +
      0.15 * eqBuildScore
    );
  });
  return { series, latest: series[series.length - 1] ?? SCORE_NEUTRAL };
}

function computeCashflowScores(trio: TrioSeries) {
  const len = Math.min(trio.good.length, trio.bad.length, trio.net.length);
  const series = seriesScore(len, (idx) => {
    const op = trio.good.slice(0, idx + 1);
    const capex = trio.bad.slice(0, idx + 1);
    const fcf = trio.net.slice(0, idx + 1);
    const opScore = growthScore(op);
    const fcfScore = growthScore(fcf);
    const capEff = capexDiscipline(op, capex);
    const fcfConvScore = fcfConversion(op, fcf);
    return (
      0.30 * opScore +
      0.40 * fcfScore +
      0.15 * capEff +
      0.15 * fcfConvScore
    );
  });
  return { series, latest: series[series.length - 1] ?? SCORE_NEUTRAL };
}

export function computeFinancialScores(result: EvalResult): FinancialScoreBundle {
  const tris = result.finDots;
  const scores: Record<FSKind, ScoreSeries> = {
    is: computeIncomeScores(tris.is),
    bs: computeBalanceScores(tris.bs),
    cfs: computeCashflowScores(tris.cfs),
  };

  const lengths = Object.values(scores).map((s) => s.series.length).filter((n) => n > 0);
  const overallLen = lengths.length ? Math.min(...lengths) : 0;
  const overallSeries =
    overallLen > 0
      ? Array.from({ length: overallLen }, (_, idx) => {
          const isScore = scores.is.series[idx] ?? scores.is.series[scores.is.series.length - 1] ?? SCORE_NEUTRAL;
          const bsScore = scores.bs.series[idx] ?? scores.bs.series[scores.bs.series.length - 1] ?? SCORE_NEUTRAL;
          const cfsScore =
            scores.cfs.series[idx] ?? scores.cfs.series[scores.cfs.series.length - 1] ?? SCORE_NEUTRAL;
          return 0.20 * isScore + 0.35 * bsScore + 0.45 * cfsScore;
        })
      : [];

  const overallLatest = overallSeries[overallSeries.length - 1] ?? SCORE_NEUTRAL;

  return {
    perStatement: scores,
    overall: { series: overallSeries, latest: overallLatest },
  };
}
