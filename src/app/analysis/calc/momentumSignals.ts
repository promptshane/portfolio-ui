import { computeMomentum } from "../../../lib/momentum";

const EPS = 1e-6;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

type OHLC = { open: number[]; high: number[]; low: number[]; close: number[] };

export function synthOHLC(closeSeries: number[]): OHLC {
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

function rsiWilder(close: number[], period = 14): number[] {
  const n = close.length;
  const out = new Array<number>(n).fill(NaN);
  if (n < 2) return out;

  const gains = new Array<number>(n).fill(0);
  const losses = new Array<number>(n).fill(0);
  for (let i = 1; i < n; i++) {
    const diff = close[i] - close[i - 1];
    gains[i] = diff > 0 ? diff : 0;
    losses[i] = diff < 0 ? -diff : 0;
  }

  let avgGain = 0;
  let avgLoss = 0;
  const initEnd = Math.min(period, n - 1);
  for (let i = 1; i <= initEnd; i++) {
    avgGain += gains[i];
    avgLoss += losses[i];
  }
  avgGain /= period;
  avgLoss /= period;
  if (n > period) {
    const denom = avgGain + avgLoss;
    out[period] = denom === 0 ? 50 : 100 * (avgGain / denom);
  }

  for (let i = period + 1; i < n; i++) {
    avgGain = (avgGain * (period - 1) + gains[i]) / period;
    avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
    const denom = avgGain + avgLoss;
    out[i] = denom === 0 ? 50 : 100 * (avgGain / denom);
  }

  return out;
}

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

  let ATR = 0,
    smPlusDM = 0,
    smMinusDM = 0;
  for (let i = 1; i <= period; i++) {
    ATR += TR[i];
    smPlusDM += plusDM[i];
    smMinusDM += minusDM[i];
  }
  ATR /= period;
  smPlusDM /= period;
  smMinusDM /= period;

  const DX = new Array<number>(n).fill(NaN);
  const di = (p: number, m: number, atr: number) => {
    const plusDI = atr === 0 ? 0 : (100 * p) / atr;
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

  let adx = 0;
  let count = 0;
  for (let i = period; i < period * 2 && i < n; i++) {
    adx += DX[i];
    count++;
  }
  if (count > 0) {
    adx /= count;
    out[period * 2 - 1] = adx;
  }

  for (let i = period * 2; i < n; i++) {
    adx = (out[i - 1] * (period - 1) + DX[i]) / period;
    out[i] = adx;
  }

  return out;
}

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

  let ATR = 0,
    smPlusDM = 0,
    smMinusDM = 0;
  for (let i = 1; i <= period; i++) {
    ATR += TR[i];
    smPlusDM += plusDM[i];
    smMinusDM += minusDM[i];
  }
  ATR /= period;
  smPlusDM /= period;
  smMinusDM /= period;

  const plusDI = ATR === 0 ? 0 : (100 * smPlusDM) / ATR;
  const minusDI = ATR === 0 ? 0 : (100 * smMinusDM) / ATR;
  sign[period] = plusDI >= minusDI ? 1 : -1;

  for (let i = period + 1; i < n; i++) {
    ATR = (ATR * (period - 1) + TR[i]) / period;
    smPlusDM = (smPlusDM * (period - 1) + plusDM[i]) / period;
    smMinusDM = (smMinusDM * (period - 1) + minusDM[i]) / period;
    const plusDINew = ATR === 0 ? 0 : (100 * smPlusDM) / ATR;
    const minusDINew = ATR === 0 ? 0 : (100 * smMinusDM) / ATR;
    sign[i] = plusDINew >= minusDINew ? 1 : -1;
  }

  return sign;
}

function stddev(arr: number[]) {
  if (!arr.length) return 0;
  const mean = arr.reduce((acc, v) => acc + v, 0) / arr.length;
  const variance = arr.reduce((acc, v) => acc + (v - mean) * (v - mean), 0) / arr.length;
  return Math.sqrt(variance);
}

export type IndicatorSignals = {
  band: number[];
  rsi: number[];
  macd: number[];
  adx: number[];
  composite: number[];
};

function alignTail(arr: number[] | undefined, targetLen: number): number[] {
  const safe = Array.isArray(arr) ? arr : [];
  if (safe.length === targetLen) return safe.slice();
  if (safe.length > targetLen) return safe.slice(safe.length - targetLen);
  const pad = new Array<number>(targetLen - safe.length).fill(NaN);
  return [...pad, ...safe];
}

export function computeIndicatorSignals(closeSeries: number[]): IndicatorSignals {
  const len = Array.isArray(closeSeries) ? closeSeries.length : 0;
  const empty = { band: [], rsi: [], macd: [], adx: [], composite: [] };
  if (!len) return empty;

  const momo = computeMomentum({ close: closeSeries });
  const bbUpper = alignTail(momo.bbUpper, len);
  const bbLower = alignTail(momo.bbLower, len);
  const macdHist = alignTail(momo.macdHist, len);

  const rsi = rsiWilder(closeSeries, 14);
  const ohlc = synthOHLC(closeSeries);
  const adxAbs = alignTail(adxWilder(ohlc.high, ohlc.low, ohlc.close, 14), len);
  const adxSign = alignTail(adxSignWilder(ohlc.high, ohlc.low, ohlc.close, 14), len);

  const macdValues = macdHist.filter((v) => Number.isFinite(v));
  const macdWindow = macdValues.slice(Math.max(0, macdValues.length - Math.min(252, macdValues.length)));
  const macdStd = macdWindow.length ? stddev(macdWindow) : 0;
  const macdDenom = macdStd > EPS ? macdStd : 1;

  const bandArr = new Array<number>(len).fill(0);
  const rsiArr = new Array<number>(len).fill(0);
  const macdArr = new Array<number>(len).fill(0);
  const adxArr = new Array<number>(len).fill(0);
  const compArr = new Array<number>(len).fill(0);

  for (let i = 0; i < len; i++) {
    const price = closeSeries[i];
    const upper = bbUpper[i];
    const lower = bbLower[i];
    let percentB = 0.5;
    if (Number.isFinite(upper) && Number.isFinite(lower) && upper !== lower) {
      percentB = clamp((price - lower) / Math.max(EPS, upper - lower), 0, 1);
    }
    const sBand = clamp((0.5 - percentB) / 0.5, -1, 1);

    const rsiValue = rsi[i];
    const sRsi = Number.isFinite(rsiValue) ? clamp((50 - rsiValue) / 20, -1, 1) : 0;

    const hist = macdHist[i];
    const sMacd = Number.isFinite(hist) ? clamp((hist / macdDenom) / 2, -1, 1) : 0;

    const adxAbsVal = adxAbs[i];
    const strength = Number.isFinite(adxAbsVal) ? clamp((Math.abs(adxAbsVal) - 15) / 20, 0, 1) : 0;
    const dirRaw = adxSign[i];
    const dir = Number.isFinite(dirRaw) ? clamp(dirRaw, -1, 1) : 0;
    const sAdx = strength * dir;

    const trending = Number.isFinite(adxAbsVal) && Math.abs(adxAbsVal) >= 25;
    const weights = trending
      ? { macd: 0.45, rsi: 0.25, band: 0.2, adx: 0.1 }
      : { macd: 0.25, rsi: 0.35, band: 0.3, adx: 0.1 };

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

  return { band: bandArr, rsi: rsiArr, macd: macdArr, adx: adxArr, composite: compArr };
}

type EvalMomentumResult = {
  series?: { price?: number[] };
  momentum?: { scoreMomentum?: number[] };
};

export function computeMomentumCompositeScore(result: EvalMomentumResult | null | undefined): number | null {
  const prices = result?.series?.price ?? [];
  if (!Array.isArray(prices) || prices.length < 2) {
    const fallback = result?.momentum?.scoreMomentum;
    const raw = Array.isArray(fallback) ? fallback[fallback.length - 1] : undefined;
    if (!Number.isFinite(raw)) return null;
    return Math.round((((raw as number) ?? 0) + 100) / 2);
  }

  const signals = computeIndicatorSignals(prices);
  if (!signals.composite.length) return null;
  const last = signals.composite[signals.composite.length - 1];
  if (!Number.isFinite(last)) {
    const fallback = result?.momentum?.scoreMomentum;
    const raw = Array.isArray(fallback) ? fallback[fallback.length - 1] : undefined;
    if (!Number.isFinite(raw)) return null;
    return Math.round((((raw as number) ?? 0) + 100) / 2);
  }
  return Math.round(((last ?? 0) + 100) / 2);
}
