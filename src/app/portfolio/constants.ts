import type { Holding } from "./types";

export const PRICES: Record<string, number> = {
  MSFT: 512.41,
  AAPL: 245.56,
  NVDA: 331.21,
  INTC: 30.19,
};

export const DEFAULT_HOLDINGS: Holding[] = [
  { sym: "MSFT", shares: 10, avgCost: 420 },
  { sym: "AAPL", shares: 15, avgCost: 210 },
  { sym: "NVDA", shares: 5, avgCost: 250 },
  { sym: "INTC", shares: 100, avgCost: 25 },
];

export const TEMPLATE_METRICS: Record<
  string,
  { fin: number; mom: number; fair: number; strength: number; stability: number; rec: number }
> = {
  MSFT: { fin: 80, mom: 65, fair: 30, strength: 70, stability: 93, rec: 7 },
  AAPL: { fin: 68, mom: 66, fair: 60, strength: 77, stability: 85, rec: 8 },
  NVDA: { fin: 30, mom: 25, fair: 55, strength: 85, stability: 62, rec: 3 },
  INTC: { fin: 60, mom: 60, fair: 80, strength: 82, stability: 69, rec: 4 },
};
