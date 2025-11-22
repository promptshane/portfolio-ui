import type { LineData } from "../types";

/**
 * Synthetic fallback line generator (unchanged logic).
 * Mirrors the existing in-page implementation exactly.
 */
export function buildSyntheticLine(
  account: {
    totalValue: number;
    positions: Array<{ sym: string; value: number }>;
  },
  quotes: Record<string, { changesPercentage?: number | null } | undefined>,
  symbols: string[],
  holdingsCount: number
): LineData {
  const n = 140;
  const total = Math.max(account.totalValue, 0);

  const targetPct = (() => {
    if (!account.positions.length) return 0;
    const weights = account.positions.map((p) => p.value);
    const sumW = weights.reduce((a, b) => a + b, 0) || 1;
    return account.positions.reduce((s, p) => {
      const cp = quotes?.[p.sym]?.changesPercentage ?? 0;
      return s + (p.value / sumW) * cp;
    }, 0);
  })();

  if (total <= 0) {
    return { points: [], values: [], times: [], min: 0, max: 1 };
  }

  const startValue = total / (1 + targetPct / 100);

  function seeded(seedStr: string) {
    // FNV-1a-ish seed + xorshift sequence (same as current code)
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

  const dayKey = new Date().toISOString().slice(0, 10);
  const seedKey = `${dayKey}:${symbols.join(",")}:${holdingsCount}`;
  const rnd = seeded(seedKey);

  const today = new Date();
  const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 9, 30, 0, 0).getTime();
  const t1 = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 16, 0, 0, 0).getTime();

  const values: number[] = [];
  const times: Date[] = [];
  const drift = total - startValue;

  for (let i = 0; i < n; i++) {
    const p = i / (n - 1);
    const ease = p * p * (3 - 2 * p);
    const wiggle = (rnd() - 0.5) * 0.18 + Math.sin(p * Math.PI * (1.5 + rnd())) * 0.04 * (1 - p);
    const val = startValue + drift * ease * (1 + wiggle * 0.15);
    values.push(Math.max(0, val));
    times.push(new Date(t0 + (t1 - t0) * p));
  }
  values[values.length - 1] = total;

  let min = Math.min(...values),
    max = Math.max(...values);
  if (!isFinite(min) || !isFinite(max) || min === max) {
    min = total * 0.99;
    max = total * 1.01;
  }

  const points = values.map((v, i) => {
    const x = i / (n - 1);
    const y = 1 - (v - min) / (max - min);
    return [x, y] as [number, number];
  });

  return { points, values, times, min, max };
}
