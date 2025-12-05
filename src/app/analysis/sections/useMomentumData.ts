// src/app/analysis/useMomentumData.ts
import { useMemo } from "react";
import {
  EvalResult,
  KeyStats,
  RangeKey,
  rsiWilder,
  derivative01,
  toPath,
  addMonths,
  startOfYear,
  clamp,
} from "../shared";
import { computeMomentum } from "../../../lib/momentum";

type HorizonKey = "short" | "medium" | "long";

/** local extension for intraday ranges without touching shared types */
type ExtRangeKey = RangeKey | "1D" | "1W";

type Args = {
  result: EvalResult;
  range: RangeKey;
  hKey: HorizonKey;
  hoverI: number | null;
  oneMonthInterval: "1h" | "1d";
};

type VisibleRange = { start: number; end: number };

type Geom = {
  X: (i: number) => number;
  Y: (v: number) => number;
  w: number;
  h: number;
  pad: number;
  sx?: number;
  min?: number;
  max?: number;
};

type OHLC = { open: number[]; high: number[]; low: number[]; close: number[] };

type Derivs = {
  band: number[];
  rsi: number[];
  macd: number[];
  adx: number[];
};

type HorizonKeyMap<T> = Record<HorizonKey, T>;

type IntradaySeries = { dates: string[]; price: number[] };
type IntradayKey = "1D" | "1W" | "1M_1H";

function parseDateLike(value: string): Date | null {
  if (!value) return null;
  const normalized = value.includes("T") ? value : value.replace(" ", "T");
  const exact = new Date(normalized);
  if (!Number.isNaN(exact.getTime())) return exact;
  const fallback = new Date(value);
  if (!Number.isNaN(fallback.getTime())) return fallback;
  return null;
}

/* -------------------------- Wilder-style ADX (0..100) -------------------------- */
/* Uses (synthetic) OHLC so it works in both real and mock modes. */
function adxWilder(high: number[], low: number[], close: number[], period = 14): number[] {
  const n = close.length;
  const out = new Array<number>(n).fill(NaN);
  if (n < period + 1) return out;

  const TR = new Array<number>(n).fill(0);
  const plusDM = new Array<number>(n).fill(0);
  const minusDM = new Array<number>(n).fill(0);

  for (let i = 1; i < n; i++) {
    const upMove = high[i] - high[i - 1];
    const downMove = low[i - 1] - low[i];

    plusDM[i] = upMove > downMove && upMove > 0 ? upMove : 0;
    minusDM[i] = downMove > upMove && downMove > 0 ? downMove : 0;

    const tr1 = high[i] - low[i];
    const tr2 = Math.abs(high[i] - close[i - 1]);
    const tr3 = Math.abs(low[i] - close[i - 1]);
    TR[i] = Math.max(tr1, tr2, tr3);
  }

  // Wilder smoothing
  let ATR = 0, smPlusDM = 0, smMinusDM = 0;
  for (let i = 1; i <= period; i++) {
    ATR += TR[i];
    smPlusDM += plusDM[i];
    smMinusDM += minusDM[i];
  }
  ATR /= period; smPlusDM /= period; smMinusDM /= period;

  const DX = new Array<number>(n).fill(NaN);
  const di = (p: number, m: number, atr: number) => {
    const plusDI  = atr === 0 ? 0 : (100 * p) / atr;
    const minusDI = atr === 0 ? 0 : (100 * m) / atr;
    const denom = plusDI + minusDI;
    return denom === 0 ? 0 : (100 * Math.abs(plusDI - minusDI)) / denom;
  };

  DX[period] = di(smPlusDM, smMinusDM, ATR);
  for (let i = period + 1; i < n; i++) {
    ATR = (ATR * (period - 1) + TR[i]) / period;
    smPlusDM = (smPlusDM * (period - 1) + plusDM[i]) / period;
    smMinusDM = (smMinusDM * (period - 1) + minusDM[i]) / period;
    DX[i] = di(smPlusDM, smMinusDM, ATR);
  }

  // ADX is a smoothed average of DX
  let adx = 0;
  let count = 0;
  for (let i = period; i < period * 2 && i < n; i++) { adx += DX[i]; count++; }
  if (count > 0) {
    adx /= count;
    out[period * 2 - 1] = adx;
  }

  for (let i = period * 2; i < n; i++) {
    adx = ((out[i - 1] * (period - 1)) + DX[i]) / period;
    out[i] = adx;
  }
  return out;
}

/* -------------------------- DI sign for BI+/BI- --------------------------- */
/* Returns an array of +1 / -1 (or NaN before ready) based on DI+ vs DI− using Wilder smoothing. */
function adxSignWilder(high: number[], low: number[], close: number[], period = 14): number[] {
  const n = close.length;
  const sign = new Array<number>(n).fill(NaN);
  if (n < period + 1) return sign;

  const TR = new Array<number>(n).fill(0);
  const plusDM = new Array<number>(n).fill(0);
  const minusDM = new Array<number>(n).fill(0);

  for (let i = 1; i < n; i++) {
    const upMove = high[i] - high[i - 1];
    const downMove = low[i - 1] - low[i];

    plusDM[i] = upMove > downMove && upMove > 0 ? upMove : 0;
    minusDM[i] = downMove > upMove && downMove > 0 ? downMove : 0;

    const tr1 = high[i] - low[i];
    const tr2 = Math.abs(high[i] - close[i - 1]);
    const tr3 = Math.abs(low[i] - close[i - 1]);
    TR[i] = Math.max(tr1, tr2, tr3);
  }

  // Wilder smoothing seeds
  let ATR = 0, smPlusDM = 0, smMinusDM = 0;
  for (let i = 1; i <= period; i++) {
    ATR += TR[i];
    smPlusDM += plusDM[i];
    smMinusDM += minusDM[i];
  }
  ATR /= period; smPlusDM /= period; smMinusDM /= period;

  // First sign at 'period'
  {
    const plusDI  = ATR === 0 ? 0 : (100 * smPlusDM) / ATR;
    const minusDI = ATR === 0 ? 0 : (100 * smMinusDM) / ATR;
    sign[period] = plusDI >= minusDI ? 1 : -1;
  }

  // Subsequent signs
  for (let i = period + 1; i < n; i++) {
    ATR = (ATR * (period - 1) + TR[i]) / period;
    smPlusDM = (smPlusDM * (period - 1) + plusDM[i]) / period;
    smMinusDM = (smMinusDM * (period - 1) + minusDM[i]) / period;
    const plusDI  = ATR === 0 ? 0 : (100 * smPlusDM) / ATR;
    const minusDI = ATR === 0 ? 0 : (100 * smMinusDM) / ATR;
    sign[i] = plusDI >= minusDI ? 1 : -1;
  }

  return sign;
}

function numMaybe(v: any): number | null {
  if (v == null) return null;
  const n = typeof v === "string" ? Number(v.replace(/,/g, "")) : Number(v);
  return Number.isFinite(n) ? n : null;
}

const EPS = 1e-6;

function stddev(arr: number[]) {
  if (!arr.length) return 0;
  const mean = arr.reduce((acc, v) => acc + v, 0) / arr.length;
  const variance = arr.reduce((acc, v) => acc + (v - mean) * (v - mean), 0) / arr.length;
  return Math.sqrt(variance);
}

function alignTail(arr: number[], targetLen: number): number[] {
  if (targetLen <= 0) return [];
  if (arr.length === targetLen) return arr;
  if (arr.length < targetLen) {
    const pad = new Array<number>(targetLen - arr.length).fill(NaN);
    return [...pad, ...arr];
  }
  return arr.slice(arr.length - targetLen);
}

function synthOHLC(closeSeries: number[]): OHLC {
  const n = closeSeries.length;
  const open = new Array<number>(n);
  const high = new Array<number>(n);
  const low = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const prev = i === 0 ? closeSeries[i] : closeSeries[i - 1];
    const curr = closeSeries[i];
    const delta = Math.abs(curr - prev);
    const wiggle = Math.max(delta * 0.25, curr * 0.002);
    open[i] = prev;
    high[i] = Math.max(prev, curr) + wiggle;
    low[i] = Math.min(prev, curr) - wiggle;
  }
  return { open, high, low, close: closeSeries };
}

export default function useMomentumData({
  result,
  range,
  hKey,
  hoverI,
  oneMonthInterval,
}: Args) {
  const extRange = range as ExtRangeKey;
  const intradayKey = useMemo<IntradayKey | null>(() => {
    if (extRange === "1D") return "1D";
    if (extRange === "1W") return "1W";
    if (extRange === "1M" && oneMonthInterval === "1h") return "1M_1H";
    return null;
  }, [extRange, oneMonthInterval]);
  // Pull intraday series (best-effort; EvalResult may not be typed with this field yet)
  const intradayMap = (result as any)?.intraday as
    | Partial<Record<IntradayKey, IntradaySeries>>
    | undefined;

  const intradaySeries = intradayKey ? intradayMap?.[intradayKey] : undefined;
  const hasIntradayData = useMemo(() => {
    if (!intradaySeries) return false;
    const prices = intradaySeries.price ?? [];
    const dates = intradaySeries.dates ?? [];
    return prices.length > 1 && prices.length === dates.length;
  }, [intradaySeries]);

  const baseSeries = useMemo(() => {
    if (hasIntradayData) {
      return intradaySeries!;
    }
    return { dates: result.series.dates, price: result.series.price };
  }, [hasIntradayData, intradaySeries, result.series.dates, result.series.price]);

  const baseDates = baseSeries.dates;
  const basePrices = baseSeries.price;
  const baseLen = basePrices.length;

  const historyPrices = result.series.price;
  const indicatorPrices = useMemo(() => {
    if (!hasIntradayData) return historyPrices;
    if (!historyPrices.length) return basePrices;
    return [...historyPrices, ...basePrices];
  }, [hasIntradayData, historyPrices, basePrices]);

  /* -------------------------- Horizon selection (UI) -------------------------- */
  const H = useMemo(() => {
    if (hKey === "short") return 10;
    if (hKey === "long") return 160;
    return 40; // medium (default)
  }, [hKey]);

  const rsiPeriod = useMemo(() => (hKey === "short" ? 10 : hKey === "long" ? 50 : 14), [hKey]);
  const adxPeriod = useMemo(() => (hKey === "short" ? 10 : hKey === "long" ? 50 : 14), [hKey]);

  // Single-horizon momentum set used for VISUALS (overlays + tiles + derivs).
  // Compute with extended history so indicators warm up, then align to the visible base series.
  const active = useMemo(() => {
    const mom = computeMomentum({ close: indicatorPrices }, { horizons: [H] });
    if (mom.scoreBB.length === baseLen) return mom;
    const align = (arr: number[]) => alignTail(arr, baseLen);
    return {
      bbUpper: align(mom.bbUpper),
      bbMid: align(mom.bbMid),
      bbLower: align(mom.bbLower),
      macd: align(mom.macd),
      macdSignal: align(mom.macdSignal),
      macdHist: align(mom.macdHist),
      emaFast: align(mom.emaFast),
      emaSlow: align(mom.emaSlow),
      scoreBB: align(mom.scoreBB),
      scoreRSI: align(mom.scoreRSI),
      scoreMACD: align(mom.scoreMACD),
      scoreMomentum: align(mom.scoreMomentum),
    };
  }, [indicatorPrices, H, baseLen]);

  /* --------------------------- Visible index range --------------------------- */
  const visibleIndexRange: VisibleRange = useMemo(() => {
    const dates = baseDates;
    const end = dates.length - 1;
    if (end < 0) return { start: 0, end: 0 };

    const nowDate = parseDateLike(dates[end]);
    if (!nowDate) return { start: 0, end };
    const now = nowDate;
    let startDate: Date;

    switch (extRange) {
      case "1D": {
        startDate = new Date(now);
        startDate.setDate(startDate.getDate() - 1);
        break;
      }
      case "1W": {
        startDate = new Date(now);
        startDate.setDate(startDate.getDate() - 7);
        break;
      }
      case "YTD": startDate = startOfYear(now); break;
      case "1M":  startDate = addMonths(now, 1); break;
      case "3M":  startDate = addMonths(now, 3); break;
      case "6M":  startDate = addMonths(now, 6); break;
      case "1Y":  startDate = addMonths(now, 12); break;
      case "2Y":  startDate = addMonths(now, 24); break;
      case "5Y":  startDate = addMonths(now, 60); break;
      default:    startDate = addMonths(now, 6);
    }
    const startTime = startDate.getTime();

    let start = 0;
    for (let i = 0; i < dates.length; i++) {
      const dt = parseDateLike(dates[i]);
      if (!dt) continue;
      if (dt.getTime() >= startTime) {
        start = i;
        break;
      }
    }
    return { start, end };
  }, [baseDates, extRange]);

  /* ------------------------------ Sliced series ----------------------------- */
  const visiblePriceSlice = useMemo(() => {
    const { start, end } = visibleIndexRange;
    return basePrices.slice(start, end + 1);
  }, [basePrices, visibleIndexRange]);

  const rangeStartMeta = useMemo(() => {
    if (!visiblePriceSlice.length) return null as null | { abs: number; pct: number; sinceText: string };
    const { start, end } = visibleIndexRange;
    const startVal = basePrices[start];
    const endVal = basePrices[end];
    const abs = endVal - startVal;
    const pct = startVal === 0 ? 0 : (abs / startVal) * 100;
    const sinceText = baseDates[start];
    return { abs, pct, sinceText };
  }, [basePrices, baseDates, visiblePriceSlice, visibleIndexRange]);

  const pricePathMemo = useMemo(
    () => (visiblePriceSlice.length ? toPath(visiblePriceSlice) : ""),
    [visiblePriceSlice]
  );

  /* ------------------------------ Chart geometry ---------------------------- */
  const momentumGeom: Geom | null = useMemo(() => {
    if (!visiblePriceSlice.length) return null;
    const pad = 10;
    const w = 1000;
    const h = 280;
    const min = Math.min(...visiblePriceSlice);
    const max = Math.max(...visiblePriceSlice);
    const sx = (w - 2 * pad) / Math.max(1, visiblePriceSlice.length - 1);
    const sy = max === min ? 1 : (h - 2 * pad) / (max - min);
    const X = (i: number) => pad + i * sx;
    const Y = (v: number) => h - pad - (v - min) * sy;
    return { X, Y, w, h, pad, min, max, sx };
  }, [visiblePriceSlice]);

  /* --------------------------------- RSI view ------------------------------- */
  const fullRSI = useMemo(
    () => alignTail(rsiWilder(indicatorPrices, rsiPeriod), baseLen),
    [indicatorPrices, rsiPeriod, baseLen]
  );
  const visibleRSISlice = useMemo(() => {
    const { start, end } = visibleIndexRange;
    return fullRSI.slice(start, end + 1);
  }, [fullRSI, visibleIndexRange]);

  const rsiGeom: Geom | null = useMemo(() => {
    if (!visibleRSISlice.length) return null;
    const pad = 10;
    const w = 1000;
    const h = 120;
    const min = 0;
    const max = 100;
    const sx = (w - 2 * pad) / Math.max(1, visibleRSISlice.length - 1);
    const sy = (h - 2 * pad) / (max - min);
    const X = (i: number) => pad + i * sx;
    const Y = (v: number) => h - pad - (v - min) * sy;
    return { X, Y, w, h, pad };
  }, [visibleRSISlice]);

  /* ------------------------------- OHLC base -------------------------------- */
  const ohlcSeries: OHLC = useMemo(() => synthOHLC(basePrices), [basePrices]);
  const extendedOhlcSeries: OHLC = useMemo(
    () => synthOHLC(indicatorPrices),
    [indicatorPrices]
  );

  /* --------------------------------- ADX ------------------------------------ */
  const fullADXAbsRaw = useMemo(
    () => adxWilder(extendedOhlcSeries.high, extendedOhlcSeries.low, extendedOhlcSeries.close, adxPeriod),
    [extendedOhlcSeries, adxPeriod]
  );

  const fullADXSignRaw = useMemo(
    () => adxSignWilder(extendedOhlcSeries.high, extendedOhlcSeries.low, extendedOhlcSeries.close, adxPeriod),
    [extendedOhlcSeries, adxPeriod]
  );

  const fullADXAbs = useMemo(
    () => alignTail(fullADXAbsRaw, baseLen),
    [fullADXAbsRaw, baseLen]
  );

  const fullADXSign = useMemo(
    () => alignTail(fullADXSignRaw, baseLen),
    [fullADXSignRaw, baseLen]
  );

  const fullADX = useMemo(
    () =>
      fullADXAbs.map((v, i) =>
        Number.isNaN(v) || Number.isNaN(fullADXSign[i])
          ? v
          : v * (fullADXSign[i] >= 0 ? 1 : -1)
      ),
    [fullADXAbs, fullADXSign]
  );

  const visibleADXSlice = useMemo(() => {
    const { start, end } = visibleIndexRange;
    const slice = fullADX.slice(start, end + 1);
    return slice.map((v) => (Number.isNaN(v) ? v : Math.abs(v)));
  }, [fullADX, visibleIndexRange]);

  const adxGeom: Geom | null = useMemo(() => {
    if (!visibleADXSlice.length) return null;
    const pad = 10, w = 1000, h = 120, min = 0, max = 100;
    const sx = (w - 2 * pad) / Math.max(1, visibleADXSlice.length - 1);
    const sy = (h - 2 * pad) / (max - min);
    const X = (i: number) => pad + i * sx;
    const Y = (v: number) => h - pad - ((Math.abs(v) - min) * sy);
    return { X, Y, w, h, pad };
  }, [visibleADXSlice]);

  /* -------------------------- Derivatives (0..1) ---------------------------- */
  const baseDeriv1 = useMemo(
    () => ({
      band: derivative01(active.scoreBB, 1),
      rsi: derivative01(active.scoreRSI, 1),
      macd: derivative01(active.scoreMACD, 1),
    }),
    [active]
  );
  const baseDeriv2 = useMemo(
    () => ({
      band: derivative01(active.scoreBB, 2),
      rsi: derivative01(active.scoreRSI, 2),
      macd: derivative01(active.scoreMACD, 2),
    }),
    [active]
  );
  const adxDeriv1 = useMemo(() => derivative01(fullADX, 1), [fullADX]);
  const adxDeriv2 = useMemo(() => derivative01(fullADX, 2), [fullADX]);

  const deriv1: Derivs = useMemo(
    () => ({ ...baseDeriv1, adx: adxDeriv1 }),
    [baseDeriv1, adxDeriv1]
  );
  const deriv2: Derivs = useMemo(
    () => ({ ...baseDeriv2, adx: adxDeriv2 }),
    [baseDeriv2, adxDeriv2]
  );

  const indicatorSignals = useMemo(() => {
    const empty = {
      band: [] as number[],
      rsi: [] as number[],
      macd: [] as number[],
      adx: [] as number[],
      composite: [] as number[],
    };
    if (!baseLen) return empty;

    const bbUpper = active.bbUpper ?? [];
    const bbLower = active.bbLower ?? [];
    const macdHist = active.macdHist ?? [];

    const macdValues = macdHist.filter((v) => Number.isFinite(v));
    const macdWindow = macdValues.slice(
      Math.max(0, macdValues.length - Math.min(252, macdValues.length))
    );
    const macdStd = macdWindow.length ? stddev(macdWindow) : 0;
    const macdDenom = macdStd > EPS ? macdStd : 1;

    const bandArr = new Array<number>(baseLen).fill(0);
    const rsiArr = new Array<number>(baseLen).fill(0);
    const macdArr = new Array<number>(baseLen).fill(0);
    const adxArr = new Array<number>(baseLen).fill(0);
    const compArr = new Array<number>(baseLen).fill(0);

    for (let i = 0; i < baseLen; i++) {
      const price = basePrices[i];
      const upper = bbUpper[i];
      const lower = bbLower[i];
      let percentB = 0.5;
      if (Number.isFinite(upper) && Number.isFinite(lower) && upper !== lower) {
        percentB = clamp((price - lower) / Math.max(EPS, upper - lower), 0, 1);
      }
      const sBand = clamp((0.5 - percentB) / 0.5, -1, 1);

      const rsiValue = fullRSI[i];
      const sRsi = Number.isFinite(rsiValue) ? clamp((50 - rsiValue) / 20, -1, 1) : 0;

      const hist = macdHist[i];
      const sMacd = Number.isFinite(hist) ? clamp((hist / macdDenom) / 2, -1, 1) : 0;

      const adxAbs = fullADXAbs[i];
      const strength = Number.isFinite(adxAbs) ? clamp((adxAbs - 15) / 20, 0, 1) : 0;
      const dirRaw = fullADXSign[i];
      const dir = Number.isFinite(dirRaw) ? clamp(dirRaw, -1, 1) : 0;
      const sAdx = strength * dir;

      const trending = Number.isFinite(adxAbs) && adxAbs >= 25;
      const weights = trending
        ? { macd: 0.45, rsi: 0.25, band: 0.20, adx: 0.10 }
        : { macd: 0.25, rsi: 0.35, band: 0.30, adx: 0.10 };

      const composite = clamp(
        weights.band * sBand + weights.rsi * sRsi + weights.macd * sMacd + weights.adx * sAdx,
        -1,
        1
      );

      bandArr[i] = Math.round(sBand * 100);
      rsiArr[i] = Math.round(sRsi * 100);
      macdArr[i] = Math.round(sMacd * 100);
      adxArr[i] = Math.round(sAdx * 100);
      compArr[i] = Math.round(composite * 100);
    }

    return {
      band: bandArr,
      rsi: rsiArr,
      macd: macdArr,
      adx: adxArr,
      composite: compArr,
    };
  }, [baseLen, basePrices, active, fullRSI, fullADXAbs, fullADXSign]);

  /* ------------------------------ Hovered OHLC ------------------------------ */
  const hoveredOHLC = useMemo(() => {
    const { start, end } = visibleIndexRange;
    const localI = hoverI ?? (end - start);
    const gi = start + localI;
    const o = ohlcSeries.open[gi] ?? 0;
    const h = ohlcSeries.high[gi] ?? 0;
    const l = ohlcSeries.low[gi] ?? 0;
    const c = ohlcSeries.close[gi] ?? 0;
    const date = baseDates[gi] ?? "";
    return { o, h, l, c, date };
  }, [ohlcSeries, hoverI, visibleIndexRange, baseDates]);

  /* --------------------------- Momentum Dot Score --------------------------- */
  const momentumDotScore = useMemo(() => {
    const compSeries = indicatorSignals.composite;
    if (!compSeries.length) return 50;

    const { start, end } = visibleIndexRange;
    if (end < start) return 50;
    const localI = hoverI ?? (end - start);
    const globalI = start + localI;
    const raw = compSeries[globalI] ?? compSeries[compSeries.length - 1] ?? 0;
    return Math.round((raw + 100) / 2);
  }, [indicatorSignals.composite, visibleIndexRange, hoverI]);

  const visibleCompositeSlice = useMemo(() => {
    const { start, end } = visibleIndexRange;
    return indicatorSignals.composite.slice(start, end + 1);
  }, [indicatorSignals.composite, visibleIndexRange]);

  const visibleCompositeSlicesByHorizon: HorizonKeyMap<number[]> = useMemo(() => {
    const map: HorizonKeyMap<number[]> = { short: [], medium: [], long: [] };
    const HMAP: HorizonKeyMap<number> = { short: 10, medium: 40, long: 160 };
    const RSIMAP: HorizonKeyMap<number> = { short: 10, medium: 14, long: 50 };
    const ADXMAP: HorizonKeyMap<number> = { short: 10, medium: 14, long: 50 };

    const { start, end } = visibleIndexRange;

    const computeFor = (key: HorizonKey) => {
      const H = HMAP[key];
      const rsiPeriodH = RSIMAP[key];
      const adxPeriodH = ADXMAP[key];

      const mom = computeMomentum({ close: indicatorPrices }, { horizons: [H] });
      const align = (arr: number[]) => alignTail(arr, baseLen);
      const bbUpper = align(mom.bbUpper ?? []);
      const bbLower = align(mom.bbLower ?? []);
      const macdHist = align(mom.macdHist ?? []);
      const fullRSIh = alignTail(rsiWilder(indicatorPrices, rsiPeriodH), baseLen);
      const fullADXAbsH = alignTail(
        adxWilder(extendedOhlcSeries.high, extendedOhlcSeries.low, extendedOhlcSeries.close, adxPeriodH),
        baseLen
      );
      const fullADXSignH = alignTail(
        adxSignWilder(extendedOhlcSeries.high, extendedOhlcSeries.low, extendedOhlcSeries.close, adxPeriodH),
        baseLen
      );

      const macdValues = macdHist.filter((v) => Number.isFinite(v));
      const macdWindow = macdValues.slice(
        Math.max(0, macdValues.length - Math.min(252, macdValues.length))
      );
      const macdStd = macdWindow.length ? stddev(macdWindow) : 0;
      const macdDenom = macdStd > EPS ? macdStd : 1;

      const compArr = new Array<number>(baseLen).fill(0);
      for (let i = 0; i < baseLen; i++) {
        const price = basePrices[i];
        const upper = bbUpper[i];
        const lower = bbLower[i];
        let percentB = 0.5;
        if (Number.isFinite(upper) && Number.isFinite(lower) && upper !== lower) {
          percentB = clamp((price - lower) / Math.max(EPS, upper - lower), 0, 1);
        }
        const sBand = clamp((0.5 - percentB) / 0.5, -1, 1);

        const rsiValue = fullRSIh[i];
        const sRsi = Number.isFinite(rsiValue) ? clamp((50 - rsiValue) / 20, -1, 1) : 0;

        const hist = macdHist[i];
        const sMacd = Number.isFinite(hist) ? clamp((hist / macdDenom) / 2, -1, 1) : 0;

        const adxAbs = fullADXAbsH[i];
        const strength = Number.isFinite(adxAbs) ? clamp((adxAbs - 15) / 20, 0, 1) : 0;
        const dirRaw = fullADXSignH[i];
        const dir = Number.isFinite(dirRaw) ? clamp(dirRaw, -1, 1) : 0;
        const sAdx = strength * dir;

        const trending = Number.isFinite(adxAbs) && adxAbs >= 25;
        const weights = trending
          ? { macd: 0.45, rsi: 0.25, band: 0.20, adx: 0.10 }
          : { macd: 0.25, rsi: 0.35, band: 0.30, adx: 0.10 };

        const composite = clamp(
          weights.band * sBand + weights.rsi * sRsi + weights.macd * sMacd + weights.adx * sAdx,
          -1,
          1
        );
        compArr[i] = Math.round(composite * 100);
      }

      map[key] = compArr.slice(start, end + 1);
    };

    computeFor("short");
    computeFor("medium");
    computeFor("long");

    return map;
  }, [indicatorPrices, baseLen, visibleIndexRange, basePrices, extendedOhlcSeries]);

  /* ------------------------------ Key Stats ------------------------------ */
  const keyStats: KeyStats | undefined = useMemo(() => {
    const r: any = result as any;

    const s =
      r.keyStats ??
      r.stats ??
      r.profile ??
      r.quote ??
      r.company ??
      undefined;

    if (!s) return undefined;

    return {
      marketCap: numMaybe(s.marketCap ?? s.mktCap ?? s.marketCapTTM),
      peRatio: numMaybe(s.peRatio ?? s.pe ?? s.priceEarningsRatioTTM),
      dividendYield: numMaybe(
        s.dividendYield ??
          s.divYield ??
          s.dividendYieldPercentageTTM ??
          s.dividendYieldTTM
      ),
      beta: numMaybe(s.beta),
      high52w: numMaybe(s.high52w ?? s.yearHigh ?? s["52WeekHigh"]),
      low52w: numMaybe(s.low52w ?? s.yearLow ?? s["52WeekLow"]),
      avgVolume: numMaybe(s.avgVolume ?? s.avgVol ?? s.volumeAvg),
    };
  }, [result]);

  return {
    H,
    rsiPeriod,
    adxPeriod,
    active,
    baseLen,

    visibleIndexRange,
    visiblePriceSlice,
    pricePathMemo,
    rangeStartMeta,

    momentumGeom,
    rsiGeom,
    adxGeom,
    fullRSI,
    visibleRSISlice,

    ohlcSeries,
    fullADX,
    visibleADXSlice,

    deriv1,
    deriv2,

    hoveredOHLC,
    momentumDotScore,
    indicatorSignals,
    visibleCompositeSlice,
    visibleCompositeSlicesByHorizon: visibleCompositeSlicesByHorizon,

    keyStats,
  };
}
