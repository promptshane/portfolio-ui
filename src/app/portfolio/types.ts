export type RangeKey = "1D" | "1W" | "1M" | "3M" | "6M" | "YTD" | "1Y" | "2Y" | "5Y";

export type Holding = { sym: string; shares: number; avgCost: number };

export type Series = {
  times: string[];
  values: number[];
  baseline?: number;
  bySymbol?: Record<string, { values: number[]; baseline?: number }>;
};

export type LineData = {
  points: Array<[number, number]>;
  values: number[];
  times: Date[];
  min: number;
  max: number;
  isRelative?: boolean;
  baseline?: number;
};

export type PositionRow = {
  sym: string;
  price: number | null;
  chg: number | null;
  cur: number;
  avgCost: number;
  retAbs: number;
  retPct: number;
  fin?: number;
  mom?: number;
  fair?: number;
  strength?: number;
  stability?: number;
  rec?: number;
};
