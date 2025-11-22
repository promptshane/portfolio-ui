import { useEffect, useMemo, useRef, useState } from "react";
import type { Holding, Series, LineData } from "../types";

/**
 * Fetches REAL intraday portfolio series from /api/portfolio/series
 * and shapes it into a baseline-relative LineData for the chart.
 *
 * Returns { series, realLine, bySymbol, error }.
 * No UI/behavior changes vs current implementation.
 */
type IntervalKey = "1min" | "5min" | "1hour";
type RangeHint = "1D" | "1W" | "1M";

export function usePortfolioSeries(
  holdings: Holding[],
  options: { interval?: IntervalKey; range?: RangeHint } = {}
) {
  const { interval = "5min", range = "1D" } = options;
  const [series, setSeries] = useState<Series | null>(null);
  const [error, setError] = useState<boolean>(false);
  const cacheRef = useRef<Map<string, Series>>(new Map());

  const normalizedHoldings = useMemo(() => {
    return holdings
      .map((h) => ({
        sym: (h.sym || "").toUpperCase().trim(),
        shares: Number(h.shares) || 0,
        avgCost: Number(h.avgCost) || 0,
      }))
      .filter((h) => h.sym)
      .sort((a, b) => {
        if (a.sym === b.sym) {
          if (a.shares === b.shares) return a.avgCost - b.avgCost;
          return a.shares - b.shares;
        }
        return a.sym.localeCompare(b.sym);
      });
  }, [holdings]);

  const cacheKey = useMemo(() => {
    return JSON.stringify({ holdings: normalizedHoldings, interval, range });
  }, [normalizedHoldings, interval, range]);

  useEffect(() => {
    let cancelled = false;
    setError(false);

    const cached = cacheRef.current.get(cacheKey);
    if (cached) {
      setSeries(cached);
      return () => {
        cancelled = true;
      };
    }

    setSeries(null);

    (async () => {
      try {
        const res = await fetch("/api/portfolio/series", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ items: holdings, interval, range }),
          cache: "no-store",
        });
        if (!res.ok) {
          if (!cancelled) setError(true);
          return;
        }
        const data = (await res.json()) as Series;
        if (!cancelled) {
          cacheRef.current.set(cacheKey, data);
          setSeries(data);
        }
      } catch {
        if (!cancelled) setError(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [cacheKey, holdings, interval, range]);

  const realLine: LineData | null = useMemo(() => {
    if (!series || series.values.length < 2) return null;

    const baseline = series.baseline ?? 0;
    const raw = series.values;
    const rel = baseline ? raw.map((v) => v - baseline) : raw;

    let min = Math.min(...rel),
      max = Math.max(...rel);
    if (!isFinite(min) || !isFinite(max) || min === max) {
      const t = rel[rel.length - 1] || 1;
      min = t * 0.99;
      max = t * 1.01;
    }

    const points = rel.map((v, i) => {
      const x = i / (rel.length - 1);
      const y = 1 - (v - min) / (max - min);
      return [x, y] as [number, number];
    });
    const times = series.times.map((s) => new Date(s));
    return {
      points,
      values: rel,
      times,
      min,
      max,
      isRelative: Boolean(baseline),
      baseline,
    };
  }, [series]);

  return { series, realLine, bySymbol: series?.bySymbol, error };
}
