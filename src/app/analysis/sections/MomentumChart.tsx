// src/app/analysis/sections/MomentumChart.tsx
"use client";

import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { IndicKey, RangeKey, toPathXY, KeyStats } from "../shared";

/** Local extension so we can add ADX + intraday ranges without touching shared types yet */
type ExtIndicKey = IndicKey | "adx";
type ExtRangeKey = RangeKey | "1D" | "1W";

type VisibleRange = { start: number; end: number };

type Geom = {
  X: (i: number) => number;
  Y: (v: number) => number;
  w: number;
  h: number;
  pad: number;
  sx?: number;
};

type OHLC = { open: number[]; high: number[]; low: number[]; close: number[] };

type Derivs = {
  band: number[];
  rsi: number[];
  macd: number[];
  adx: number[];
};

type Props = {
  range: RangeKey;
  setRange: (r: RangeKey) => void;

  indicSelected: Record<IndicKey, boolean>;
  deriv1Selected: Record<IndicKey, boolean>;
  deriv2Selected: Record<IndicKey, boolean>;

  DCOLORS: Record<ExtIndicKey, { d1: string; d2: string }>;

  useCandles: boolean;
  setUseCandles: (v: boolean) => void;

  hoverI: number | null;
  setHoverI: (i: number | null) => void;

  visibleIndexRange: VisibleRange;
  visiblePriceSlice: number[];
  pricePathMemo: string;
  momentumGeom: Geom | null;
  rangeStartMeta: { abs: number; pct: number; sinceText: string } | null;
  hoveredDate: string;

  active: any;
  ohlcSeries: OHLC;

  rsiGeom: Geom | null;
  visibleRSISlice: number[];

  adxGeom: Geom | null;
  visibleADXSlice: number[];

  deriv1: Derivs;
  deriv2: Derivs;
  anyDeriv1: boolean;
  anyDeriv2: boolean;

  /** NEW (optional): stats for Key Statistics expandable */
  keyStats?: KeyStats;
  oneMonthInterval: "1h" | "1d";
  setOneMonthInterval: (v: "1h" | "1d") => void;
};

function clampToInterval(date: Date, minutes: number) {
  const next = new Date(date);
  const minute = next.getMinutes();
  const snapped = Math.floor(minute / minutes) * minutes;
  next.setMinutes(snapped, 0, 0);
  return next;
}

function parseDateString(value: string) {
  if (!value) return null;
  const candidates = [
    value,
    value.includes("T") ? value : value.replace(" ", "T"),
    value.endsWith("Z") ? value : `${value}Z`,
    value.includes("T") ? (value.endsWith("Z") ? value : `${value}Z`) : `${value.replace(" ", "T")}Z`,
  ];
  for (const candidate of candidates) {
    const d = new Date(candidate);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return null;
}

function formatHoverLabel(range: RangeKey, dateStr: string, oneMonthInterval: "1h" | "1d") {
  const date = parseDateString(dateStr);
  if (!date) return "";
  switch (range) {
    case "1D": {
      const snapped = clampToInterval(date, 5);
      return snapped.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    }
    case "1W":
      return date.toLocaleString([], {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
    case "1M":
      if (oneMonthInterval === "1d") {
        return date.toLocaleDateString([], { month: "short", day: "numeric" });
      }
      return date.toLocaleString([], {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
    default:
      return date.toLocaleDateString([], {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
  }
}

function fmtMaybe(n?: number | null, digits = 2) {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toFixed(digits);
}

function fmtPctMaybe(n?: number | null, digits = 2) {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n.toFixed(digits)}%`;
}

function fmtCap(n?: number | null) {
  if (n == null || !Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1e12) return `${(n / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(2)}K`;
  return n.toFixed(0);
}

function fmtPriceMaybe(n?: number | null) {
  if (n == null || !Number.isFinite(n)) return "—";
  return `$${n.toFixed(2)}`;
}

export default function MomentumChart({
  range,
  setRange,
  indicSelected,
  deriv1Selected,
  deriv2Selected,
  DCOLORS,
  useCandles,
  setUseCandles,
  hoverI,
  setHoverI,
  visibleIndexRange,
  visiblePriceSlice,
  pricePathMemo,
  momentumGeom,
  rangeStartMeta,
  hoveredDate,
  active,
  ohlcSeries,
  rsiGeom,
  visibleRSISlice,
  adxGeom,
  visibleADXSlice,
  deriv1,
  deriv2,
  anyDeriv1,
  anyDeriv2,
  keyStats,
  oneMonthInterval,
  setOneMonthInterval,
}: Props) {
  const extRange = range as ExtRangeKey;
  const [showStats, setShowStats] = useState(false);
  const [show1mMenu, setShow1mMenu] = useState(false);
  const oneMonthMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!show1mMenu) return;
    const handleClick = (e: MouseEvent) => {
      if (!oneMonthMenuRef.current) return;
      if (!oneMonthMenuRef.current.contains(e.target as Node)) {
        setShow1mMenu(false);
      }
    };
    document.addEventListener("pointerdown", handleClick);
    return () => document.removeEventListener("pointerdown", handleClick);
  }, [show1mMenu]);

  useEffect(() => {
    if (extRange !== "1M") setShow1mMenu(false);
  }, [extRange]);

  // Precompute hover X for derivative charts to avoid undefined
  const { start, end } = visibleIndexRange;
  const iHover = hoverI ?? Math.max(0, end - start);
  const xHover = useMemo(
    () => (momentumGeom ? momentumGeom.X(iHover) : undefined),
    [momentumGeom, iHover]
  );

  const statsRows = useMemo(() => {
    const s = keyStats ?? {};
    return [
      { label: "Market Cap", value: fmtCap(s.marketCap) },
      { label: "P/E (TTM)", value: fmtMaybe(s.peRatio, 2) },
      { label: "Div Yield", value: fmtPctMaybe(s.dividendYield, 2) },
      { label: "Beta", value: fmtMaybe(s.beta, 2) },
      { label: "52W High", value: fmtPriceMaybe(s.high52w) },
      { label: "52W Low", value: fmtPriceMaybe(s.low52w) },
      { label: "Avg Volume", value: fmtCap(s.avgVolume) },
    ];
  }, [keyStats]);

  const showHoverLabel = hoverI !== null && !!hoveredDate;
  const hoverLabel = showHoverLabel ? formatHoverLabel(range, hoveredDate, oneMonthInterval) : "";
  const hoverLeftPercent =
    showHoverLabel && momentumGeom && hoverI !== null
      ? (momentumGeom.X(hoverI) / momentumGeom.w) * 100
      : null;
  const hoverLeftClamped =
    hoverLeftPercent === null ? null : Math.max(2, Math.min(98, hoverLeftPercent));

  return (
    <div className="bg-neutral-800 rounded-2xl p-4 border border-neutral-700">
      <div className="relative">
        {hoverLabel && hoverLeftClamped !== null && (
          <div
            className="pointer-events-none absolute -translate-x-1/2 text-xs text-neutral-300"
            style={{ left: `${hoverLeftClamped}%`, top: -6, whiteSpace: "nowrap" }}
          >
            {hoverLabel}
          </div>
        )}
      <svg
        viewBox="0 0 1000 280"
        className="w-full h-[260px]"
        preserveAspectRatio="none"
        onMouseMove={(e) => {
          if (!momentumGeom || !visiblePriceSlice.length) return;
          const svgEl = e.currentTarget as SVGSVGElement;
          const rect = svgEl.getBoundingClientRect();
          const x = e.clientX - rect.left;
          const scaleX = rect.width / momentumGeom.w;
          const padPx = momentumGeom.pad * scaleX;
          let t = (x - padPx) / Math.max(1, rect.width - 2 * padPx);
          t = Math.max(0, Math.min(1, t));
          const i = Math.round(t * (visiblePriceSlice.length - 1));
          setHoverI(i);
        }}
        onMouseLeave={() => setHoverI(null)}
      >
        <defs>
          <linearGradient id="priceFillUp" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--good-500)" stopOpacity="0.25" />
            <stop offset="100%" stopColor="var(--good-500)" stopOpacity="0.0" />
          </linearGradient>
          <linearGradient id="priceFillDown" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--bad-500)" stopOpacity="0.25" />
            <stop offset="100%" stopColor="var(--bad-500)" stopOpacity="0.0" />
          </linearGradient>
        </defs>

        {/* Candles OR line */}
        {useCandles && momentumGeom ? (
          (() => {
            const open = ohlcSeries.open.slice(start, end + 1);
            const high = ohlcSeries.high.slice(start, end + 1);
            const low = ohlcSeries.low.slice(start, end + 1);
            const close = ohlcSeries.close.slice(start, end + 1);

            const len = close.length;
            const half = Math.max(0.6, Math.min(5, momentumGeom.sx! * 0.32));
            const upFill = "var(--highlight-500)";
            const dnFill = "var(--bad-500)";
            const wick = "#9ca3af";
            const outline = "#111827";

            const elements: ReactElement[] = [];
            for (let i = 0; i < len; i++) {
              const x = momentumGeom.X(i);
              const yH = momentumGeom.Y(high[i]);
              const yL = momentumGeom.Y(low[i]);
              const yO = momentumGeom.Y(open[i]);
              const yC = momentumGeom.Y(close[i]);
              const up = close[i] >= open[i];

              elements.push(
                <line key={`w-${i}`} x1={x} x2={x} y1={yH} y2={yL} stroke={wick} strokeWidth={1} />
              );
              const top = Math.min(yO, yC);
              const h = Math.max(1, Math.abs(yO - yC));
              elements.push(
                <rect
                  key={`b-${i}`}
                  x={x - half}
                  y={top}
                  width={half * 2}
                  height={h}
                  fill={up ? upFill : dnFill}
                  stroke={outline}
                  strokeWidth={0.6}
                  rx={0.8}
                  ry={0.8}
                />
              );
            }
            return <g>{elements}</g>;
          })()
        ) : (
          pricePathMemo && (
            <>
              <path
                d={`${pricePathMemo} L 990 270 L 10 270 Z`}
                fill={(rangeStartMeta?.abs ?? 0) >= 0 ? "url(#priceFillUp)" : "url(#priceFillDown)"}
              />
              <path
                d={pricePathMemo}
                fill="none"
                stroke={(rangeStartMeta?.abs ?? 0) >= 0 ? "var(--good-300)" : "var(--bad-400)"}
                strokeWidth={1.0}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            </>
          )
        )}

        {/* Bollinger overlay (from ACTIVE horizon) */}
        {((indicSelected as any).band ?? false) &&
          momentumGeom &&
          (() => {
            const up = active.bbUpper.slice(start, end + 1);
            const mid = active.bbMid.slice(start, end + 1);
            const low = active.bbLower.slice(start, end + 1);
            const dUp = toPathXY(up, momentumGeom.X, momentumGeom.Y);
            const dMid = toPathXY(mid, momentumGeom.X, momentumGeom.Y);
            const dLow = toPathXY(low, momentumGeom.X, momentumGeom.Y);
            return (
              <>
                <path d={dUp} fill="none" stroke="#93c5fd" strokeWidth={0.8} strokeDasharray="3 2" />
                <path d={dMid} fill="none" stroke="#60a5fa" strokeWidth={1.0} />
                <path d={dLow} fill="none" stroke="#93c5fd" strokeWidth={0.8} strokeDasharray="3 2" />
              </>
            );
          })()}

        {/* MACD EMAs overlay (ACTIVE horizon) */}
        {((indicSelected as any).macd ?? false) &&
          momentumGeom &&
          (() => {
            const emaFast = active.emaFast.slice(start, end + 1);
            const emaSlow = active.emaSlow.slice(start, end + 1);
            const dFast = toPathXY(emaFast, momentumGeom.X, momentumGeom.Y);
            const dSlow = toPathXY(emaSlow, momentumGeom.X, momentumGeom.Y);
            return (
              <>
                <path d={dSlow} fill="none" stroke="#a3a3a3" strokeWidth={1.1} />
                <path d={dFast} fill="none" stroke="var(--highlight-400)" strokeWidth={1.0} />
              </>
            );
          })()}

        {/* Crosshairs */}
        {momentumGeom && hoverI !== null && (
          <>
            <line
              x1={momentumGeom.X(hoverI)}
              x2={momentumGeom.X(hoverI)}
              y1={10}
              y2={270}
              stroke="#ffffff33"
              strokeWidth={1}
            />
            <line
              x1={10}
              x2={990}
              y1={momentumGeom.Y(visiblePriceSlice[hoverI])}
              y2={momentumGeom.Y(visiblePriceSlice[hoverI])}
              stroke="#ffffff33"
              strokeWidth={1}
            />
          </>
        )}
      </svg>
      </div>

      {/* RSI sub-chart (period synced to horizon) */}
      {((indicSelected as any).rsi ?? false) && rsiGeom && visibleRSISlice.length > 0 && (
        <div className="mt-3">
          <svg
            viewBox={`0 0 ${rsiGeom.w} ${rsiGeom.h}`}
            className="w-full h-[120px]"
            preserveAspectRatio="none"
            onMouseMove={(e) => {
              const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
              const scaleX = rect.width / rsiGeom.w;
              const padPx = rsiGeom.pad * scaleX;
              const x = e.clientX - rect.left;
              let t = (x - padPx) / Math.max(1, rect.width - 2 * padPx);
              t = Math.max(0, Math.min(1, t));
              const i = Math.round(t * (visibleRSISlice.length - 1));
              setHoverI(i);
            }}
            onMouseLeave={() => setHoverI(null)}
          >
            {(() => {
              const x1 = 10,
                x2 = 990;
              const yOB = rsiGeom.Y(70);
              const yMID = rsiGeom.Y(50);
              const yOS = rsiGeom.Y(30);
              return (
                <>
                  <line x1={x1} x2={x2} y1={yOB} y2={yOB} stroke="#64748b" strokeDasharray="4 4" strokeWidth={1} />
                  <line x1={x1} x2={x2} y1={yMID} y2={yMID} stroke="#64748b" strokeDasharray="4 4" strokeWidth={1} />
                  <line x1={x1} x2={x2} y1={yOS} y2={yOS} stroke="#64748b" strokeDasharray="4 4" strokeWidth={1} />
                  <text x="14" y={yOB - 4} fill="#9ca3af" fontSize="10">70</text>
                  <text x="14" y={yMID - 4} fill="#9ca3af" fontSize="10">50</text>
                  <text x="14" y={yOS - 4} fill="#9ca3af" fontSize="10">30</text>
                </>
              );
            })()}

            {(() => {
              const path = toPathXY(visibleRSISlice, rsiGeom.X, rsiGeom.Y);
              if (!path) return null;
              const yOB = rsiGeom.Y(70);
              const yOS = rsiGeom.Y(30);
              return (
                <>
                  <path d={path} fill="none" stroke="#e5e7eb" strokeWidth={1.0} strokeLinejoin="round" strokeLinecap="round" />
                  <defs>
                    <clipPath id="clipRSIAboveOB"><rect x="0" y="0" width={rsiGeom.w} height={yOB} /></clipPath>
                    <clipPath id="clipRSIBelowOS"><rect x="0" y={yOS} width={rsiGeom.w} height={rsiGeom.h - yOS} /></clipPath>
                  </defs>
                  <g clipPath="url(#clipRSIAboveOB)">
                    <path d={path} fill="none" stroke="var(--bad-500)" strokeWidth={1.0} strokeLinejoin="round" strokeLinecap="round" />
                  </g>
                  <g clipPath="url(#clipRSIBelowOS)">
                    <path d={path} fill="none" stroke="var(--good-500)" strokeWidth={1.0} strokeLinejoin="round" strokeLinecap="round" />
                  </g>
                </>
              );
            })()}

            {hoverI !== null &&
              (() => {
                const i = hoverI!;
                const x = rsiGeom.X(i);
                const v = visibleRSISlice[i];
                const hasVal = Number.isFinite(v);
                const y = hasVal ? rsiGeom.Y(v) : null;
                return (
                  <>
                    <line x1={x} x2={x} y1={10} y2={rsiGeom.h - 10} stroke="#ffffff33" strokeWidth={1} />
                    {hasVal && (
                      <line x1={10} x2={990} y1={y as number} y2={y as number} stroke="#ffffff33" strokeWidth={1} />
                    )}
                  </>
                );
              })()}
          </svg>
        </div>
      )}

      {/* ADX sub-chart */}
      {((indicSelected as any).adx ?? false) && adxGeom && visibleADXSlice.length > 0 && (
        <div className="mt-3">
          <svg
            viewBox={`0 0 ${adxGeom.w} ${adxGeom.h}`}
            className="w-full h-[120px]"
            preserveAspectRatio="none"
            onMouseMove={(e) => {
              const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
              const scaleX = rect.width / adxGeom.w;
              const padPx = adxGeom.pad * scaleX;
              const x = e.clientX - rect.left;
              let t = (x - padPx) / Math.max(1, rect.width - 2 * padPx);
              t = Math.max(0, Math.min(1, t));
              const i = Math.round(t * (visibleADXSlice.length - 1));
              setHoverI(i);
            }}
            onMouseLeave={() => setHoverI(null)}
          >
            {(() => {
              const x1 = 10, x2 = 990;
              const y20 = adxGeom.Y(20);
              const y25 = adxGeom.Y(25);
              const y50 = adxGeom.Y(50);
              return (
                <>
                  <line x1={x1} x2={x2} y1={y50} y2={y50} stroke="#64748b" strokeDasharray="4 4" strokeWidth={1} />
                  <line x1={x1} x2={x2} y1={y25} y2={y25} stroke="#64748b" strokeDasharray="4 4" strokeWidth={1} />
                  <line x1={x1} x2={x2} y1={y20} y2={y20} stroke="#64748b" strokeDasharray="4 4" strokeWidth={1} />
                  <text x="14" y={y50 - 4} fill="#9ca3af" fontSize="10">50</text>
                  <text x="14" y={y25 - 4} fill="#9ca3af" fontSize="10">25</text>
                  <text x="14" y={y20 - 4} fill="#9ca3af" fontSize="10">20</text>
                </>
              );
            })()}

            {(() => {
              const path = toPathXY(visibleADXSlice, adxGeom.X, adxGeom.Y);
              if (!path) return null;

              const y20 = adxGeom.Y(20);
              const y25 = adxGeom.Y(25);
              const y50 = adxGeom.Y(50);

              return (
                <>
                  <defs>
                    <clipPath id="clipADXlt20"><rect x="0" y={y20} width={adxGeom.w} height={adxGeom.h - y20} /></clipPath>
                    <clipPath id="clipADX20to25"><rect x="0" y={y25} width={adxGeom.w} height={Math.max(0, y20 - y25)} /></clipPath>
                    <clipPath id="clipADX25to50"><rect x="0" y={y50} width={adxGeom.w} height={Math.max(0, y25 - y50)} /></clipPath>
                    <clipPath id="clipADX50plus"><rect x="0" y={0} width={adxGeom.w} height={y50} /></clipPath>
                  </defs>

                  <g clipPath="url(#clipADXlt20)">
                    <path d={path} fill="none" stroke="#e5e7eb" strokeOpacity={0.4} strokeWidth={1.0} strokeLinejoin="round" strokeLinecap="round" />
                  </g>
                  <g clipPath="url(#clipADX20to25)">
                    <path d={path} fill="none" stroke="#a3a3a3" strokeWidth={1.0} strokeLinejoin="round" strokeLinecap="round" />
                  </g>
                  <g clipPath="url(#clipADX25to50)">
                    <path d={path} fill="none" stroke="var(--good-500)" strokeWidth={1.0} strokeLinejoin="round" strokeLinecap="round" />
                  </g>
                  <g clipPath="url(#clipADX50plus)">
                    <path d={path} fill="none" stroke="var(--bad-500)" strokeWidth={1.0} strokeLinejoin="round" strokeLinecap="round" />
                  </g>
                </>
              );
            })()}

            {hoverI !== null &&
              (() => {
                const i = hoverI!;
                const x = adxGeom.X(i);
                const v = visibleADXSlice[i];
                const hasVal = Number.isFinite(v);
                const y = hasVal ? adxGeom.Y(v) : null;
                return (
                  <>
                    <line x1={x} x2={x} y1={10} y2={adxGeom.h - 10} stroke="#ffffff33" strokeWidth={1} />
                    {hasVal && (
                      <line x1={10} x2={990} y1={y as number} y2={y as number} stroke="#ffffff33" strokeWidth={1} />
                    )}
                  </>
                );
              })()}
          </svg>
        </div>
      )}

      {/* Derivative graphs */}
      {(() => {
        const w = 1000, h = 100, pad = 10;
        const Y01 = (v: number) => {
          const min = 0, max = 1;
          const sy = (h - 2 * pad) / (max - min);
          return h - pad - (v - min) * sy;
        };

        return (
          <>
            {anyDeriv1 && momentumGeom && (
              <svg
                viewBox={`0 0 ${w} ${h}`}
                className="w-full h-[90px] mt-2"
                preserveAspectRatio="none"
                onMouseMove={(e) => {
                  const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
                  const x = e.clientX - rect.left;
                  const scaleX = rect.width / momentumGeom.w;
                  const padPx = momentumGeom.pad * scaleX;
                  let t = (x - padPx) / Math.max(1, rect.width - 2 * padPx);
                  t = Math.max(0, Math.min(1, t));
                  const i2 = Math.round(t * Math.max(0, end - start));
                  setHoverI(i2);
                }}
                onMouseLeave={() => setHoverI(null)}
              >
                <line x1={10} x2={990} y1={Y01(0.5)} y2={Y01(0.5)} stroke="#64748b" strokeDasharray="4 4" strokeWidth={1} />
                {(["band", "rsi", "adx", "macd"] as ExtIndicKey[]).map((k) => {
                  if (!((deriv1Selected as any)[k] ?? false)) return null;
                  const arr = k === "adx" ? (deriv1 as any).adx : (deriv1 as any)[k];
                  const d = toPathXY(arr.slice(start, end + 1), momentumGeom.X, Y01);
                  return <path key={`d1-${k}`} d={d} fill="none" stroke={DCOLORS[k].d1} strokeWidth={0.5} />;
                })}
                {xHover !== undefined && (
                  <line x1={xHover} x2={xHover} y1={10} y2={h - 10} stroke="#ffffff33" strokeWidth={1} />
                )}
              </svg>
            )}

            {anyDeriv2 && momentumGeom && (
              <svg
                viewBox={`0 0 ${w} ${h}`}
                className="w-full h-[90px] mt-2"
                preserveAspectRatio="none"
                onMouseMove={(e) => {
                  const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
                  const x = e.clientX - rect.left;
                  const scaleX = rect.width / momentumGeom.w;
                  const padPx = momentumGeom.pad * scaleX;
                  let t = (x - padPx) / Math.max(1, rect.width - 2 * padPx);
                  t = Math.max(0, Math.min(1, t));
                  const i2 = Math.round(t * Math.max(0, end - start));
                  setHoverI(i2);
                }}
                onMouseLeave={() => setHoverI(null)}
              >
                <line x1={10} x2={990} y1={Y01(0.5)} y2={Y01(0.5)} stroke="#64748b" strokeDasharray="4 4" strokeWidth={1} />
                {(["band", "rsi", "adx", "macd"] as ExtIndicKey[]).map((k) => {
                  if (!((deriv2Selected as any)[k] ?? false)) return null;
                  const arr = k === "adx" ? (deriv2 as any).adx : (deriv2 as any)[k];
                  const d = toPathXY(arr.slice(start, end + 1), momentumGeom.X, Y01);
                  return <path key={`d2-${k}`} d={d} fill="none" stroke={DCOLORS[k].d2} strokeWidth={0.5} />;
                })}
                {xHover !== undefined && (
                  <line x1={xHover} x2={xHover} y1={10} y2={h - 10} stroke="#ffffff33" strokeWidth={1} />
                )}
              </svg>
            )}
          </>
        );
      })()}

      {/* Range selector + View toggle */}
      <div className="mt-4 flex items-center gap-3 flex-wrap">
        <span className="text-sm text-neutral-400">Range</span>
        {(
          ["1D", "1W", "1M", "3M", "6M", "YTD", "1Y", "2Y", "5Y"] as ExtRangeKey[]
        ).map((key) => {
          const active = extRange === key;
          const baseClasses = `px-3 py-1.5 rounded-full border text-sm transition ${
            active
              ? (rangeStartMeta?.abs ?? 0) >= 0
                ? "border-[var(--good-500)] bg-[color:var(--good-500)/0.1]"
                : "border-[var(--bad-500)] bg-[color:var(--bad-500)/0.1]"
              : "border-neutral-600 hover:border-neutral-400"
          }`;

          if (key === "1M") {
            return (
              <div key="1M" className="relative" ref={oneMonthMenuRef}>
                <button
                  onClick={() => setRange("1M")}
                  className={baseClasses}
                  type="button"
                >
                  <span>{key}</span>
                  {active && (
                    <span className="ml-1 text-xs text-neutral-300">
                      {oneMonthInterval === "1h" ? "1h" : "1d"}
                    </span>
                  )}
                </button>
                {active && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setShow1mMenu((prev) => !prev);
                    }}
                    className="absolute -right-1 -top-1 w-4 h-4 rounded-full bg-neutral-800 border border-neutral-500 text-[10px] text-neutral-200"
                    title="Choose 1M interval"
                  >
                    ▾
                  </button>
                )}
                {active && show1mMenu && (
                  <div className="absolute right-0 mt-2 min-w-[120px] rounded-lg border border-neutral-700 bg-neutral-900 shadow-lg z-20">
                    {(["1h", "1d"] as const).map((opt) => (
                      <button
                        key={opt}
                        type="button"
                        onClick={() => {
                          setOneMonthInterval(opt);
                          setShow1mMenu(false);
                        }}
                        className={`block w-full px-3 py-1.5 text-left text-sm ${
                          oneMonthInterval === opt ? "text-white" : "text-neutral-300"
                        } hover:bg-neutral-800`}
                      >
                        {opt === "1h" ? "1 Hour bars" : "1 Day bars"}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          }

          return (
            <button
              key={key}
              onClick={() => setRange(key as RangeKey)}
              className={baseClasses}
              type="button"
            >
              {key}
            </button>
          );
        })}

        <div className="grow" />

        {/* View toggle */}
        <div className="inline-flex rounded-xl border border-neutral-600 overflow-hidden">
          <button
            type="button"
            onClick={() => setUseCandles(false)}
            className={`px-0 py-1.5 text-sm w-[84px] ${
              !useCandles ? "bg-neutral-200 text-black" : "text-neutral-300"
            }`}
            title="Line chart"
          >
            Line
          </button>
          <button
            type="button"
            onClick={() => setUseCandles(true)}
            className={`px-0 py-1.5 text-sm w-[84px] ${
              useCandles ? "bg-neutral-200 text-black" : "text-neutral-300"
            }`}
            title="Candlesticks"
          >
            Candles
          </button>
        </div>
      </div>

      {/* Key Statistics expandable (minimalist) */}
      <div className="mt-3 pt-3 border-t border-neutral-700">
        <button
          type="button"
          onClick={() => setShowStats((v) => !v)}
          className="w-full flex items-center justify-between text-left"
          aria-expanded={showStats}
        >
          <span className="text-sm text-neutral-300">Key Statistics</span>
          <span
            className={`text-neutral-400 text-xs transition-transform ${
              showStats ? "rotate-180" : ""
            }`}
          >
            ▾
          </span>
        </button>

        {showStats && (
          <div className="mt-2 grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-2 text-sm">
            {statsRows.map((r) => (
              <div key={r.label} className="flex items-center justify-between gap-2">
                <span className="text-neutral-400">{r.label}</span>
                <span className="text-neutral-100 tabular-nums">{r.value}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
