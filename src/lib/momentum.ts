/**
 * Continuous multi-horizon momentum indicators and overlays.
 * Pure functions, framework-agnostic.
 *
 * This version is backward-compatible with prior callers.
 * - Keeps the rule-based blend (reversion vs trend) as a fallback.
 * - Adds optional ML-driven weights (indicator + horizon) via cfg.ml.
 */

export type MomentumMLIndicatorWeights = {
  // Weights per regime bucket. Each entry must sum to ~1 (we renormalize defensively).
  // Common buckets: "trend", "range", "extreme". You may supply a "default" bucket, too.
  [bucket: string]: { band: number; rsi: number; macd: number };
};

export type MomentumMLHorizonWeights = {
  // Map of horizon -> weight (e.g., {"5":0.25,"10":0.2,...}). We renormalize defensively.
  [horizonAsString: string]: number;
};

export type MomentumMLConfig = {
  asOf?: string;                 // metadata from the trainer
  confidence?: number;           // 0..1 confidence from ML
  minConfidence?: number;        // optional local threshold (default 0.6)
  indicator?: MomentumMLIndicatorWeights; // indicator weights per regime bucket
  horizon?: MomentumMLHorizonWeights;     // optional horizon weights override
  applyPerBar?: boolean;         // if true, evaluate regime per bar (default true)
  bucketFallback?: string;       // bucket name to use if computed bucket missing (e.g., "default" or "trend")
};

export type MomentumConfig = {
  horizons: number[];         // e.g., [5,10,20,40,80,160]
  weightByInvH: boolean;      // if true, w_i ∝ 1/h; else equal
  macdRatio: number;          // slow = ratio * fast (default 4)

  // Horizon weighting blend: reduce over-emphasis on shortest horizon by blending with equal weights.
  wBlendEqual: number;        // 0..1; 0 = pure 1/h, 1 = equal weights

  // BB base squash
  cBB: number;                // tanh squash for BB z-score (default 2)

  // MACD impulse scoring params
  cMACD: number;              // reserved for compatibility (not used directly)
  k1MACD: number;             // scaling for histogram (H/V)
  k2MACD: number;             // scaling for signal slope (Δsignal/V)
  k3MACD: number;             // scaling for regime Z
  lambdaEdge: number;         // edge penalty decay vs |Z|

  // BB context
  betaBand: number;           // boost at band extremes
  gammaBand: number;          // damp mean-reversion in wide bands

  // RSI slope
  kRSI: number;               // slope scaling for ΔRSI term

  // composite soft-normalization span
  normSpan: number;           // EMA span for |score| normalization

  // regime filter caps (trend protection)
  trendStrongSlope: number;    // threshold of |dMid|/std to cap wRev
  bandwidthWide: number;       // threshold of (bandwidth/|mean|) to cap wRev
  wRevCapStrong: number;       // cap when one condition met
  wRevCapVeryStrong: number;   // cap when both met

  // indicator agreement damping
  agreeMinFactor: number;      // floor multiplier when indicators disagree
  agreeThreshold: number;      // magnitude threshold to consider sign meaningful

  // adaptive RSI OB/OS
  rsiAdaptive: boolean;        // enable dynamic OB/OS levels
  rsiObLevel: number;          // base overbought level (default 70)
  rsiOsLevel: number;          // base oversold level (default 30)
  rsiDeltaMax: number;         // max delta to shift OB/OS (e.g., up to 20)
  rsiDeltaGain: number;        // gain from normalized trend strength to delta

  // OPTIONAL ML weights (indicator + horizon). If absent or confidence too low, fallback to rule-based.
  ml?: MomentumMLConfig | null;
};

export type MomentumInputs = {
  close: number[];            // must be same cadence (daily closes)
};

export type IndicatorSeries = {
  // overlays (aligned to input)
  bbUpper: number[]; bbMid: number[]; bbLower: number[];
  macd: number[]; macdSignal: number[]; macdHist: number[];
  // MACD-defining EMAs (mid-scale) for price-space overlay
  emaFast: number[]; emaSlow: number[];

  // scores per day in [-100,100]
  scoreBB: number[]; scoreRSI: number[]; scoreMACD: number[];
  // composite momentum in [-100,100]
  scoreMomentum: number[];
};

const DEFAULTS: MomentumConfig = {
  horizons: [5,10,20,40,80,160],
  weightByInvH: true,
  macdRatio: 4,

  wBlendEqual: 0.4,

  cBB: 2,
  cMACD: 1.5,

  k1MACD: 0.8,
  k2MACD: 0.6,
  k3MACD: 1.2,
  lambdaEdge: 1.2,

  betaBand: 0.6,
  gammaBand: 2.0,

  kRSI: 4,

  normSpan: 50,

  trendStrongSlope: 0.30,
  bandwidthWide: 0.08,
  wRevCapStrong: 0.60,
  wRevCapVeryStrong: 0.40,

  agreeMinFactor: 0.70,
  agreeThreshold: 10,

  rsiAdaptive: true,
  rsiObLevel: 70,
  rsiOsLevel: 30,
  rsiDeltaMax: 20,
  rsiDeltaGain: 10,

  ml: null
};

const EPS = 1e-8;

/* ---------- small helpers ---------- */

function tanh(x: number) {
  if (x === Infinity) return 1;
  if (x === -Infinity) return -1;
  const e2x = Math.exp(2 * x);
  return (e2x - 1) / (e2x + 1);
}

function clip(x: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, x));
}
function clamp01(x: number) { return clip(x, 0, 1); }

function ema(arr: number[], span: number): number[] {
  const out = new Array<number>(arr.length).fill(NaN);
  if (arr.length === 0) return out;
  const alpha = 2 / (span + 1);
  let prev = arr[0];
  out[0] = prev;
  for (let i = 1; i < arr.length; i++) {
    const v = arr[i];
    prev = alpha * v + (1 - alpha) * prev;
    out[i] = prev;
  }
  return out;
}

function emaAbs(arr: number[], span: number): number[] {
  const abs = arr.map(v => Math.abs(v));
  return ema(abs, span);
}

function emaStd(arr: number[], span: number): number[] {
  const ex = ema(arr, span);
  const x2 = arr.map(v => v * v);
  const ex2 = ema(x2, span);
  const out = new Array<number>(arr.length);
  for (let i = 0; i < arr.length; i++) {
    const v = Math.max(0, ex2[i] - ex[i] * ex[i]);
    out[i] = Math.sqrt(v);
  }
  return out;
}

/* ---------- normalized indicators per horizon ---------- */

// BB with extremity boost + volatility damping
function bbScoreEnhanced(
  close: number[],
  h: number,
  cBB: number,
  betaBand: number,
  gammaBand: number
) {
  const mu = ema(close, h);
  const sd = emaStd(close, h);
  const s = new Array<number>(close.length);

  for (let i = 0; i < close.length; i++) {
    const m = mu[i];
    const sdv = sd[i];
    const up = m + 2 * sdv;
    const lo = m - 2 * sdv;
    const width = up - lo;

    const z = (close[i] - m) / (sdv + EPS);
    // Base sign: mean reversion → above mid/upper = negative (expect down), below lower = positive (expect up)
    const base = -100 * tanh(z / cBB);

    // percentB & bandwidth
    let b = (close[i] - lo) / (width + EPS);
    b = clamp01(b);
    const bandwidth = width / (Math.abs(m) + EPS);

    // extremity boost (toward reversion)
    let extremityBoost = 1;
    if (b > 0.9) {
      extremityBoost *= 1 + betaBand * ((b - 0.9) / 0.1); // up to 1+beta
    } else if (b < 0.1) {
      extremityBoost *= 1 + betaBand * ((0.1 - b) / 0.1);
    }

    // volatile trends → damp mean reversion
    const volDamp = 1 / (1 + gammaBand * bandwidth);

    s[i] = clip(base * extremityBoost * volDamp, -100, 100);
  }

  return { score: s, mean: mu, std: sd };
}

// RSI with slope contribution (ADAPTIVE OB/OS)
function rsiScoreEnhanced(close: number[], h: number, kRSI: number, adaptive: {
  enabled: boolean,
  ob: number,
  os: number,
  deltaMax: number,
  gain: number
}) {
  const up = new Array<number>(close.length).fill(0);
  const dn = new Array<number>(close.length).fill(0);
  for (let i = 1; i < close.length; i++) {
    const diff = close[i] - close[i - 1];
    up[i] = diff > 0 ? diff : 0;
    dn[i] = diff < 0 ? -diff : 0;
  }
  const U = ema(up, h);
  const D = ema(dn, h);
  const s = new Array<number>(close.length);
  let prevRSI = 50;

  // auxiliary for adaptive thresholds
  const ma = ema(close, Math.max(2, h));
  const sd = emaStd(close, Math.max(2, h));

  for (let i = 0; i < close.length; i++) {
    const denom = U[i] + D[i] + EPS;
    const rsi = 100 * (U[i] / denom);       // 0..100

    let ob = adaptive.ob, os = adaptive.os;
    if (adaptive.enabled) {
      const slope = i === 0 ? 0 : (ma[i] - ma[i - 1]);
      const trendStrength = Math.abs(slope) / (sd[i] + EPS); // unitless
      const delta = Math.min(adaptive.deltaMax, adaptive.gain * trendStrength);
      ob = adaptive.ob + delta;
      os = adaptive.os - delta;
      // clamp sensible bounds
      ob = Math.min(95, Math.max(50, ob));
      os = Math.max(5, Math.min(50, os));
    }

    // centered-to-dynamic mapping
    let base: number;
    if (rsi >= 50) {
      const denomUp = Math.max(1, (ob - 50));
      base = 100 * ((rsi - 50) / denomUp);
    } else {
      const denomDn = Math.max(1, (50 - os));
      base = -100 * ((50 - rsi) / denomDn);
    }
    base = clip(base, -100, 100);

    const dRSI = rsi - prevRSI;
    prevRSI = rsi;

    // slope contribution: rising RSI adds bullish, falling adds bearish
    const slopePart = 50 * tanh(dRSI / kRSI);
    s[i] = clip(base + slopePart, -100, 100);
  }
  return { score: s };
}

// MACD impulse + slope with edge penalty and volatility scaling
function macdScoreEnhanced(
  close: number[],
  f: number,
  ratio: number,
  k1: number,
  k2: number,
  k3: number,
  lambdaEdge: number
) {
  const sSpan = Math.max(2, Math.round(f * ratio));
  const emaF = ema(close, f);
  const emaS = ema(close, sSpan);
  const macd = emaF.map((v, i) => v - emaS[i]);

  // signal line and histogram
  const signal = ema(macd, f);
  const hist = macd.map((v, i) => v - signal[i]);

  // volatility scale for MACD domain
  const macdMean = ema(macd, f);
  const absDev = macd.map((v, i) => Math.abs(v - macdMean[i]));
  // smoother/longer vol estimate stabilizes normalization
  const V = ema(absDev, Math.max(3, Math.round(3 * f))).map(v => v + EPS);

  // components
  const Z = macd.map((m, i) => m / V[i]);    // regime distance
  const dSignal = signal.map((v, i) => (i === 0 ? 0 : (v - signal[i - 1]) / V[i])); // normalized slope
  const Hn = hist.map((h, i) => h / V[i]);   // normalized impulse

  const comp1 = Hn.map(x => tanh(x / k1));   // impulse
  const comp2 = dSignal.map(x => tanh(x / k2)); // acceleration
  const comp3 = Z.map(x => tanh(x / k3));    // regime (weak weight)

  const raw = new Array<number>(close.length);
  const edge = Z.map(z => Math.exp(-Math.abs(z) / lambdaEdge));
  for (let i = 0; i < close.length; i++) {
    const r = 0.55 * comp1[i] + 0.30 * comp2[i] + 0.15 * comp3[i];
    raw[i] = 100 * clip(r * edge[i], -1, 1);
  }

  return {
    score: raw,
    macd, signal, hist,
    emaF, emaS
  };
}

/* ---------- regime bucketing helper ---------- */

type RegimeBucket = 'trend' | 'range' | 'extreme';

function bucketFromContext(
  zMid: number, percentB: number, normBW: number, trendStrength: number
): RegimeBucket {
  // "extreme" if hugging band edges
  if (percentB <= 0.10 || percentB >= 0.90 || Math.abs(zMid) >= 2) return 'extreme';
  // "trend" if near mean but strong slope or narrow-ish bands with slope
  if (Math.abs(zMid) < 1 && trendStrength > 0.25) return 'trend';
  return 'range';
}

function renormalizeWeights(obj: Record<string, number>): Record<string, number> {
  const sum = Object.values(obj).reduce((a, b) => a + (isFinite(b) ? b : 0), 0);
  if (sum <= 0) return obj;
  const out: Record<string, number> = {};
  for (const k of Object.keys(obj)) out[k] = (isFinite(obj[k]) ? obj[k] : 0) / sum;
  return out;
}

/* ---------- main ---------- */

export function computeMomentum(
  inputs: MomentumInputs,
  cfg: Partial<MomentumConfig> = {}
): IndicatorSeries {
  const C: MomentumConfig = { ...DEFAULTS, ...cfg };
  const { close } = inputs;
  const n = close.length;
  const K = C.horizons.length;
  if (n === 0 || K === 0) {
    return {
      bbUpper: [], bbMid: [], bbLower: [],
      macd: [], macdSignal: [], macdHist: [],
      emaFast: [], emaSlow: [],
      scoreBB: [], scoreRSI: [], scoreMACD: [],
      scoreMomentum: [],
    };
  }

  // --- Horizon weights (with optional ML override) ---
  let wInv = C.horizons.map(h => C.weightByInvH ? 1 / h : 1);
  const sumInv = wInv.reduce((a, b) => a + b, 0);
  wInv = wInv.map(x => x / (sumInv || 1));
  const wEq = C.horizons.map(() => 1 / Math.max(1, K));
  let w = wInv.map((x, j) => (1 - C.wBlendEqual) * x + C.wBlendEqual * wEq[j]);

  // ML override for horizon weights (if provided and confident)
  const ml = C.ml ?? null;
  const minConf = ml?.minConfidence ?? 0.6;
  const mlOK = !!ml && (ml.confidence ?? 1) >= minConf;

  if (mlOK && ml?.horizon) {
    const map: Record<number, number> = {};
    for (const key of Object.keys(ml.horizon)) {
      const hNum = Number(key);
      if (Number.isFinite(hNum)) map[hNum] = ml.horizon[key];
    }
    // build w from provided map aligned to C.horizons
    const wTmp = C.horizons.map(h => (map[h] ?? 0));
    const sum = wTmp.reduce((a, b) => a + b, 0);
    if (sum > 0) {
      w = wTmp.map(x => x / sum);
    }
  }
  // ensure normalized
  const wSum = w.reduce((a, b) => a + b, 0) || 1;
  w = w.map(x => x / wSum);

  // --- Overlays from mid horizon (unchanged API) ---
  const midIdx = Math.floor(K / 2);
  const midH = C.horizons[midIdx];

  const bbMidCalc = bbScoreEnhanced(close, midH, C.cBB, C.betaBand, C.gammaBand);
  const mean = bbMidCalc.mean;
  const std = bbMidCalc.std;
  const bbUpper = mean.map((m, i) => (Number.isFinite(m) && Number.isFinite(std[i]) ? m + 2 * std[i] : NaN));
  const bbMid = mean.slice();
  const bbLower = mean.map((m, i) => (Number.isFinite(m) && Number.isFinite(std[i]) ? m - 2 * std[i] : NaN));

  const macdMid = macdScoreEnhanced(close, midH, C.macdRatio, C.k1MACD, C.k2MACD, C.k3MACD, C.lambdaEdge);
  const macd = macdMid.macd;
  const macdSignal = macdMid.signal;
  const macdHist = macdMid.hist;
  const emaFast = macdMid.emaF;
  const emaSlow = macdMid.emaS;

  // --- Aggregate per indicator across horizons ---
  const accBB = new Array<number>(n).fill(0);
  const accRSI = new Array<number>(n).fill(0);
  const accMACD = new Array<number>(n).fill(0);

  for (let j = 0; j < K; j++) {
    const h = C.horizons[j];
    const weight = w[j];

    const bb = bbScoreEnhanced(close, h, C.cBB, C.betaBand, C.gammaBand).score;
    const rsi = rsiScoreEnhanced(close, h, C.kRSI, {
      enabled: C.rsiAdaptive, ob: C.rsiObLevel, os: C.rsiOsLevel, deltaMax: C.rsiDeltaMax, gain: C.rsiDeltaGain
    }).score;
    const macdS = macdScoreEnhanced(close, h, C.macdRatio, C.k1MACD, C.k2MACD, C.k3MACD, C.lambdaEdge).score;

    for (let i = 0; i < n; i++) {
      accBB[i]   += weight * bb[i];
      accRSI[i]  += weight * rsi[i];
      accMACD[i] += weight * macdS[i];
    }
  }

  const scoreBB = accBB.map(x => clip(x, -100, 100));
  const scoreRSI = accRSI.map(x => clip(x, -100, 100));
  const scoreMACD = accMACD.map(x => clip(x, -100, 100));

  // --- Regime context arrays (for both rule-based blend and ML bucketing) ---
  const zMid = new Array<number>(n);
  const percentBmid = new Array<number>(n);
  const dMid = new Array<number>(n).fill(0);
  const normBW = new Array<number>(n);

  for (let i = 0; i < n; i++) {
    const sdv = std[i] + EPS;
    zMid[i] = (close[i] - mean[i]) / sdv;
    const up = mean[i] + 2 * std[i];
    const lo = mean[i] - 2 * std[i];
    const width = up - lo + EPS;
    percentBmid[i] = clamp01((close[i] - lo) / width);
    normBW[i] = width / (Math.abs(mean[i]) + EPS);
    if (i > 0) dMid[i] = mean[i] - mean[i - 1];
  }
  const trendStrengthArr = dMid.map((dm, i) => Math.abs(dm) / (std[i] + EPS));

  // --- Rule-based regime weights (fallback) ---
  const wRev = zMid.map(z => clamp01((Math.abs(z) - 1) / 1));
  const wTrend = wRev.map(x => 1 - x);
  for (let i = 0; i < n; i++) {
    let cap = 1.0;
    const strong = trendStrengthArr[i] > C.trendStrongSlope;
    const wide = normBW[i] > C.bandwidthWide;
    if (strong && wide) cap = C.wRevCapVeryStrong;
    else if (strong || wide) cap = C.wRevCapStrong;

    if (cap < 1.0) {
      wRev[i] = Math.min(wRev[i], cap);
      wTrend[i] = 1 - wRev[i];
    }
  }
  const sRev = scoreBB.map((v, i) => clip(0.7 * v + 0.3 * scoreRSI[i], -100, 100));
  const sTrend = scoreMACD.map((v, i) => clip(0.7 * v + 0.3 * scoreRSI[i], -100, 100));
  const sRuleRaw = sRev.map((_, i) => clip(wRev[i] * sRev[i] + wTrend[i] * sTrend[i], -100, 100));

  // --- ML-driven indicator mixing (if provided and confident) ---
  const sRaw = sRuleRaw.slice();
  if (mlOK && ml?.indicator) {
    const buckets = ml.indicator;
    // Allow a "default" bucket as general-purpose
    const defaultBucket = buckets['default'] ? renormalizeWeights(buckets['default']) : null;

    // Pre-normalize all buckets defensively
    const normBuckets: Record<string, { band: number; rsi: number; macd: number }> = {};
    for (const key of Object.keys(buckets)) {
      const wObj = renormalizeWeights(buckets[key] as any);
      normBuckets[key] = {
        band: wObj.band ?? 0, rsi: wObj.rsi ?? 0, macd: wObj.macd ?? 0
      };
    }

    const perBar = ml.applyPerBar !== false; // default true

    if (perBar) {
      for (let i = 0; i < n; i++) {
        const bucket = bucketFromContext(zMid[i], percentBmid[i], normBW[i], trendStrengthArr[i]);
        const wSet =
          normBuckets[bucket] ??
          (ml.bucketFallback ? normBuckets[ml.bucketFallback] : null) ??
          defaultBucket;

        if (wSet) {
          const mix =
            (wSet.band  ?? 0) * scoreBB[i]  +
            (wSet.rsi   ?? 0) * scoreRSI[i] +
            (wSet.macd  ?? 0) * scoreMACD[i];
          sRaw[i] = clip(mix, -100, 100);
        }
        // else keep rule-based value
      }
    } else {
      // Single-bucket application: choose a bucket from final bar context (or default)
      const last = n - 1;
      const bucket = bucketFromContext(zMid[last], percentBmid[last], normBW[last], trendStrengthArr[last]);
      const wSet =
        normBuckets[bucket] ??
        (ml.bucketFallback ? normBuckets[ml.bucketFallback] : null) ??
        defaultBucket;

      if (wSet) {
        for (let i = 0; i < n; i++) {
          const mix =
            (wSet.band  ?? 0) * scoreBB[i]  +
            (wSet.rsi   ?? 0) * scoreRSI[i] +
            (wSet.macd  ?? 0) * scoreMACD[i];
          sRaw[i] = clip(mix, -100, 100);
        }
      }
    }
  }

  // --- Indicator agreement damping (unchanged) ---
  const sgn = (x: number) => (Math.abs(x) < C.agreeThreshold ? 0 : (x > 0 ? 1 : -1));
  const sAdj = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const sumSgn = sgn(scoreBB[i]) + sgn(scoreRSI[i]) + sgn(scoreMACD[i]);
    const agree = Math.abs(sumSgn) / 3;
    const factor = C.agreeMinFactor + (1 - C.agreeMinFactor) * agree;
    sAdj[i] = sRaw[i] * factor;
  }

  // --- Soft normalization ---
  const A = emaAbs(sAdj, C.normSpan).map(v => v + EPS);
  const sSoft = sAdj.map((v, i) => 100 * tanh(v / (1.8 * A[i])));

  // --- Small "extrema snap" nudge (unchanged) ---
  const sFinal = sSoft.slice();
  for (let i = 1; i < n; i++) {
    const b = percentBmid[i];
    const midSlopeUp = dMid[i] > 0;
    const midSlopeDn = dMid[i] < 0;
    const signalSlope = macdSignal[i] - macdSignal[i - 1];
    if (b < 0.10 && midSlopeUp && signalSlope > 0) {
      sFinal[i] = clip(sFinal[i] + 10, -100, 100);
    } else if (b > 0.90 && midSlopeDn && signalSlope < 0) {
      sFinal[i] = clip(sFinal[i] - 10, -100, 100);
    }
  }

  return {
    bbUpper, bbMid, bbLower,
    macd, macdSignal, macdHist,
    emaFast, emaSlow,
    scoreBB, scoreRSI, scoreMACD,
    scoreMomentum: sFinal,
  };
}
