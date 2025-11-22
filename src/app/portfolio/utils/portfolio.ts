import type { Holding, PositionRow } from "../types";
import type { ScoreEntry } from "../../analysis/calc/scoreDots";

type QuoteLite = { price?: number | null; changesPercentage?: number | null };
type QuotesMap = Record<string, QuoteLite | undefined>;

export function computeAccount(
  holdings: Holding[],
  quotes: QuotesMap,
  prices: Record<string, number>
) {
  const positions = holdings.map((h) => {
    const sym = (h.sym || "").toUpperCase();
    const live = quotes?.[sym];
    const px = (live?.price ?? prices[sym]) || 0;
    const value = h.shares * px;
    const cost = h.shares * (h.avgCost || 0);
    const retAbs = value - cost;
    const retPct = cost > 0 ? (retAbs / cost) * 100 : 0;
    return { ...h, sym, price: px, value, cost, retAbs, retPct };
  });

  const totalValue = positions.reduce((s, p) => s + p.value, 0);
  const totalCost = positions.reduce((s, p) => s + p.cost, 0);
  const allAbs = totalValue - totalCost;
  const allPct = totalCost > 0 ? (allAbs / totalCost) * 100 : 0;

  const withAlloc = positions.map((p) => ({
    ...p,
    alloc: totalValue > 0 ? (p.value / totalValue) * 100 : 0,
  }));

  return {
    positions: withAlloc,
    totalValue,
    totalCost,
    allTimeAbs: allAbs,
    allTimePct: allPct,
    strength: 76,
    stability: 81,
    policy: "70/30 (Strength → Stability)",
  };
}

export function computeDaily(
  positions: Array<{ sym: string; value: number }>,
  quotes: QuotesMap
) {
  const total = positions.reduce((s, p) => s + p.value, 0);
  if (total <= 0) return { prevTotal: 0, currTotal: 0, changeAbs: 0, changePct: 0 };
  let deltaAbs = 0;
  for (const p of positions) {
    const cp = Number(quotes?.[p.sym]?.changesPercentage ?? 0); // % today
    deltaAbs += p.value * (cp / 100);
  }
  const changePct = (deltaAbs / total) * 100;
  return { prevTotal: total - deltaAbs, currTotal: total, changeAbs: deltaAbs, changePct };
}

function priceFromScoreHistory(entry: ScoreEntry | undefined, targetDate: Date | null) {
  if (!entry || !targetDate || !Array.isArray(entry.historyDates) || !Array.isArray(entry.historyPrices)) {
    return null;
  }
  const { historyDates, historyPrices } = entry;
  if (!historyDates.length || !historyPrices.length) return null;

  const targetTime = targetDate.getTime();
  let bestIdx = -1;
  let bestDiff = Number.POSITIVE_INFINITY;

  for (let i = 0; i < historyDates.length; i++) {
    const dt = historyDates[i];
    if (!dt) continue;
    const time = Date.parse(dt);
    if (!Number.isFinite(time)) continue;
    const diff = targetTime - time;
    if (diff >= 0 && diff < bestDiff) {
      bestDiff = diff;
      bestIdx = i;
    }
  }

  if (bestIdx === -1) {
    // fallback to closest overall if no date <= target
    for (let i = 0; i < historyDates.length; i++) {
      const dt = historyDates[i];
      if (!dt) continue;
      const time = Date.parse(dt);
      if (!Number.isFinite(time)) continue;
      const diff = Math.abs(targetTime - time);
      if (diff < bestDiff) {
        bestDiff = diff;
        bestIdx = i;
      }
    }
  }

  if (bestIdx === -1) return null;
  const safeIdx = Math.min(bestIdx, historyPrices.length - 1);
  const val = historyPrices[safeIdx];
  return Number.isFinite(val) ? (val as number) : null;
}

type ComputeRowsOptions = {
  rangeStartDate?: Date | null;
  preferHistory?: boolean;
};

export function computeRows(
  positions: Array<{ sym: string; price: number; avgCost: number; shares: number; alloc: number }>,
  seriesIdx: number | null,
  quotes: QuotesMap,
  bySymbol: Record<string, { values: number[]; baseline?: number }> | undefined,
  template: Record<
    string,
    { fin: number; mom: number; fair: number; strength: number; stability: number; rec: number }
  >,
  selectedDate: Date | null,
  scores?: Record<string, ScoreEntry | undefined>,
  options: ComputeRowsOptions = {}
): PositionRow[] {
  const clampedSeriesIdx =
    seriesIdx != null && seriesIdx >= 0 ? seriesIdx : seriesIdx != null ? 0 : null;
  const rangeStartDate = options.rangeStartDate ?? null;
  const useHistory = Boolean(options.preferHistory && rangeStartDate);

  const mapped = positions.map((p) => {
    const sym = p.sym;
    const symSeries = !useHistory ? bySymbol?.[sym] : undefined;
    const scoreEntry = scores?.[sym];

    // Price at selected time if available; otherwise current computed price
    let priceAtSel =
      symSeries && symSeries.values?.length && clampedSeriesIdx != null
        ? symSeries.values[
            clampedSeriesIdx != null
              ? Math.max(0, Math.min(clampedSeriesIdx, symSeries.values.length - 1))
              : symSeries.values.length - 1
          ]
        : p.price;

    if (useHistory) {
      const histPrice = priceFromScoreHistory(scoreEntry, selectedDate);
      if (histPrice != null) priceAtSel = histPrice;
    }

    if (
      (!Number.isFinite(priceAtSel) || (Number(priceAtSel) ?? 0) <= 0) &&
      Number.isFinite(scoreEntry?.lastPrice ?? NaN)
    ) {
      priceAtSel = scoreEntry!.lastPrice as number;
    }
    if (!Number.isFinite(priceAtSel) || (Number(priceAtSel) ?? 0) <= 0) {
      const histPrice = priceFromScoreHistory(scoreEntry, selectedDate);
      if (histPrice != null) priceAtSel = histPrice;
    }
    const priceForCalc = Number.isFinite(priceAtSel) ? (priceAtSel as number) : 0;
    const displayPrice =
      Number.isFinite(priceAtSel) && (priceAtSel as number) > 0 ? (priceAtSel as number) : null;

    // Daily % at selected time vs baseline (symbol)
    const symBaseline =
      symSeries &&
      (typeof symSeries.baseline === "number" ? symSeries.baseline : symSeries.values?.[0]);

    let chgPctAtSel: number | null = null;
    if (!useHistory && typeof symBaseline === "number" && symBaseline !== 0) {
      chgPctAtSel = ((priceForCalc - symBaseline) / symBaseline) * 100;
    } else if (useHistory) {
      const startHistPrice = priceFromScoreHistory(scoreEntry, rangeStartDate);
      if (typeof startHistPrice === "number" && startHistPrice !== 0) {
        chgPctAtSel = ((priceForCalc - startHistPrice) / startHistPrice) * 100;
      }
    } else if (typeof quotes?.[sym]?.changesPercentage === "number") {
      chgPctAtSel = quotes[sym]!.changesPercentage as number;
    } else if (Number.isFinite(scoreEntry?.changePct ?? NaN)) {
      chgPctAtSel = scoreEntry!.changePct as number;
    }

    // Total return at selected time
    const valueAtSel = p.shares * priceForCalc;
    const retAbsAtSel = valueAtSel - p.shares * (p.avgCost || 0);
    const retPctAtSel = (p.avgCost || 0) > 0 ? (retAbsAtSel / (p.shares * (p.avgCost || 0))) * 100 : 0;

    const baseTemplate = template[sym] ?? {
      fin: 50,
      mom: 50,
      fair: 50,
      strength: 50,
      stability: 50,
      rec: 5,
    };
    const stockScores = scores?.[sym];

    return {
      sym,
      price: displayPrice,
      chg: chgPctAtSel,
      avgCost: p.avgCost,
      retAbs: retAbsAtSel,
      retPct: retPctAtSel,
      fin: stockScores?.fin ?? null,
      mom: stockScores?.mom ?? null,
      fair: stockScores?.fair ?? null,
      strength: baseTemplate.strength,
      stability: baseTemplate.stability,
      rec: baseTemplate.rec,
      valueAtSel,
    };
  });

  const totalSelValue = mapped.reduce((sum, row) => sum + row.valueAtSel, 0);

  return mapped.map(({ valueAtSel, ...rest }) => ({
    ...rest,
    cur: totalSelValue > 0 ? (valueAtSel / totalSelValue) * 100 : 0,
  }));
}
