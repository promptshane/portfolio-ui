// src/app/analysis/sections/MomentumHeaderPanel.tsx
"use client";

import { EvalResult, IndicKey, fmtPct, dotClass } from "../shared";
import { Dispatch, SetStateAction } from "react";

/** Local extension so we can add ADX without touching shared types */
type ExtIndicKey = IndicKey | "adx";

type HorizonKey = "short" | "medium" | "long";

type VisibleRange = { start: number; end: number };

type Props = {
  result: EvalResult;

  // horizon picker
  hKey: HorizonKey;
  setHKey: (k: HorizonKey) => void;

  // indicator + derivative selections
  indicSelected: Record<IndicKey, boolean>;
  setIndicSelected: Dispatch<SetStateAction<Record<IndicKey, boolean>>>;
  deriv1Selected: Record<IndicKey, boolean>;
  setDeriv1Selected: Dispatch<SetStateAction<Record<IndicKey, boolean>>>;
  deriv2Selected: Record<IndicKey, boolean>;
  setDeriv2Selected: Dispatch<SetStateAction<Record<IndicKey, boolean>>>;

  // slices / indices
  visibleIndexRange: VisibleRange;
  hoverI: number | null;

  indicatorSignals: {
    band: number[];
    rsi: number[];
    macd: number[];
    adx: number[];
    composite: number[];
  };

  // style colors for derivatives
  DCOLORS: Record<ExtIndicKey, { d1: string; d2: string }>;

  // header numbers (animated)
  animatedPrice: number;
  animatedAbs: number;
  animatedPct: number;
  rangeStartMeta: { abs: number; pct: number; sinceText: string } | null;

  // hovered OHLC & last date
  hoveredOHLC: { o: number; h: number; l: number; c: number; date: string };

  // dot score
  momentumDotScore: number;
};

export default function MomentumHeaderPanel({
  result,
  hKey,
  setHKey,
  indicSelected,
  setIndicSelected,
  deriv1Selected,
  setDeriv1Selected,
  deriv2Selected,
  setDeriv2Selected,
  visibleIndexRange,
  hoverI,
  indicatorSignals,
  DCOLORS,
  animatedPrice,
  animatedAbs,
  animatedPct,
  rangeStartMeta,
  hoveredOHLC,
  momentumDotScore,
}: Props) {
  return (
    <div className="bg-neutral-800 rounded-2xl p-5 border border-neutral-700">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        {/* Left (dynamic) */}
        <div className="flex flex-col gap-1 min-w-0">
          {/* Show company name with ticker fallback */}
          <div className="text-3xl font-extrabold tracking-wide truncate">
            {result.name?.trim() || result.sym}
          </div>
          <div className="text-4xl font-semibold">${animatedPrice.toFixed(2)}</div>
          {rangeStartMeta && (
            <div
              className={`mt-1 text-sm ${
                animatedAbs >= 0 ? "text-[var(--good-400)]" : "text-[var(--bad-400)]"
              }`}
            >
              {animatedAbs >= 0 ? "+" : "-"}${Math.abs(animatedAbs).toFixed(2)} (
              {fmtPct(animatedPct)}) since {rangeStartMeta.sinceText}
            </div>
          )}
        </div>

        {/* Middle row: Date + O/C/H/L tiles */}
        <div className="hidden md:flex flex-1 items-center justify-end pr-4">
          <div className="inline-flex items-center gap-2">
            {([
              ["OPEN", hoveredOHLC.o, "neutral"] as const,
              ["CLOSE", hoveredOHLC.c, hoveredOHLC.c >= hoveredOHLC.o ? "up" : "down"] as const,
              ["HIGH", hoveredOHLC.h, "up"] as const,
              ["LOW", hoveredOHLC.l, "down"] as const,
            ]).map(([label, val, which]) => (
              <div
                key={label}
                className="w-[74px] h-[74px] rounded-2xl bg-black/90 border border-neutral-700 flex flex-col items-center justify-center shrink-0 text-center"
              >
                <div className="text-[10px] uppercase tracking-wide text-neutral-400 leading-none">
                  {label}
                </div>
                <div
                  className={`mt-0.5 text-sm font-semibold leading-none ${
                    which === "up"
                      ? "text-[var(--good-400)]"
                      : which === "down"
                      ? "text-[var(--bad-400)]"
                      : "text-neutral-100"
                  }`}
                >
                  ${val.toFixed(2)}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right: horizon picker + indicator cluster (Total moved to FAR RIGHT) */}
        <div className="flex items-center gap-6 pl-6 border-l border-neutral-700">
          {/* Short/Medium/Long segmented control (vertical stack, per mock) */}
          <div className="flex flex-col rounded-2xl overflow-hidden border border-neutral-600 bg-black/80">
            {(["short", "medium", "long"] as HorizonKey[]).map((k, idx) => {
              const activeBtn = hKey === k;
              const label = k === "short" ? "Short" : k === "long" ? "Long" : "Medium";
              const radius = idx === 0 ? "rounded-t-2xl" : idx === 2 ? "rounded-b-2xl" : "";
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => setHKey(k)}
                  className={`px-4 py-2 w-[92px] text-sm border-neutral-600 ${radius} ${
                    activeBtn ? "bg-white text-black" : "text-neutral-200 hover:bg-neutral-800"
                  } ${idx > 0 ? "border-t" : ""}`}
                  title={`${label} horizon`}
                >
                  {label}
                </button>
              );
            })}
          </div>

          {/* Indicator tiles: BAND → RSI → ADX → MACD */}
          {([
            { label: "BAND", key: "band" as ExtIndicKey },
            { label: "RSI", key: "rsi" as ExtIndicKey },
            { label: "ADX", key: "adx" as ExtIndicKey },
            { label: "MACD", key: "macd" as ExtIndicKey },
          ]).map(({ label, key }) => {
            const activeOn = ((indicSelected as any)[key] ?? false) as boolean;

            const { start, end } = visibleIndexRange;
            const visLen = end - start + 1;
            const localI = hoverI ?? Math.max(0, visLen - 1);
            const idx = start + localI;

            let vDyn = 0;
            if (key === "band")
              vDyn =
                indicatorSignals.band[idx] ??
                indicatorSignals.band[indicatorSignals.band.length - 1] ??
                0;
            else if (key === "rsi")
              vDyn =
                indicatorSignals.rsi[idx] ??
                indicatorSignals.rsi[indicatorSignals.rsi.length - 1] ??
                0;
            else if (key === "macd")
              vDyn =
                indicatorSignals.macd[idx] ??
                indicatorSignals.macd[indicatorSignals.macd.length - 1] ??
                0;
            else if (key === "adx")
              vDyn =
                indicatorSignals.adx[idx] ??
                indicatorSignals.adx[indicatorSignals.adx.length - 1] ??
                0;

            return (
              <div key={label} className="flex flex-col items-center gap-1">
                <button
                  type="button"
                  aria-pressed={activeOn}
                  onClick={() => {
                    setIndicSelected((s) => {
                      const curr = (s as any)[key] ?? false;
                      const nextAny = { ...(s as any), [key]: !curr };
                      // If just turned OFF, also turn off its derivatives
                      if (!nextAny[key]) {
                        setDeriv1Selected((d) => ({ ...(d as any), [key]: false } as any));
                        setDeriv2Selected((d) => ({ ...(d as any), [key]: false } as any));
                      }
                      return nextAny as any;
                    });
                  }}
                  className={`w-[74px] h-[74px] rounded-2xl bg-black/90 border flex flex-col items-center justify-center shrink-0 text-center transition
                      ${
                        activeOn
                          ? "border-white ring-2 ring-white/60"
                          : "border-neutral-700 hover:border-neutral-500"
                      }`}
                >
                  <div className="text-[10px] uppercase tracking-wide text-neutral-400 leading-none">
                    {label}
                  </div>
                  <div
                    className={`mt-0.5 text-base font-semibold leading-none ${
                      vDyn >= 0 ? "text-[var(--good-400)]" : "text-[var(--bad-400)]"
                    }`}
                  >
                    {vDyn >= 0 ? "+" : ""}
                    {vDyn}
                  </div>
                </button>

                {/* derivative toggles (available for ADX too) */}
                {activeOn && (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        setDeriv1Selected((s) => ({
                          ...(s as any),
                          [key]: !((s as any)[key] ?? false),
                        } as any))
                      }
                      className={`w-6 h-6 rounded-full border text-[11px] leading-6 text-center ${
                        ((deriv1Selected as any)[key] ?? false) ? "" : "text-neutral-200"
                      }`}
                      style={{
                        borderColor: ((deriv1Selected as any)[key] ?? false)
                          ? DCOLORS[key].d1
                          : "#525252",
                        boxShadow: ((deriv1Selected as any)[key] ?? false)
                          ? `0 0 0 2px ${DCOLORS[key].d1}66`
                          : "none",
                      }}
                      title="Show 1st derivative"
                    >
                      1
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setDeriv2Selected((s) => ({
                          ...(s as any),
                          [key]: !((s as any)[key] ?? false),
                        } as any))
                      }
                      className={`w-6 h-6 rounded-full border text-[11px] leading-6 text-center ${
                        ((deriv2Selected as any)[key] ?? false) ? "" : "text-neutral-200"
                      }`}
                      style={{
                        borderColor: ((deriv2Selected as any)[key] ?? false)
                          ? DCOLORS[key].d2
                          : "#525252",
                        boxShadow: ((deriv2Selected as any)[key] ?? false)
                          ? `0 0 0 2px ${DCOLORS[key].d2}66`
                          : "none",
                      }}
                      title="Show 2nd derivative"
                    >
                      2
                    </button>
                  </div>
                )}
              </div>
            );
          })}

          {/* TOTAL moved to the FAR RIGHT */}
          {(() => {
            const { start, end } = visibleIndexRange;
            const visLen = end - start + 1;
            const localI = hoverI ?? Math.max(0, visLen - 1);
            const idx = start + localI;
            const compSeries = indicatorSignals.composite;
            const vDyn = compSeries[idx] ?? compSeries[compSeries.length - 1] ?? 0;

            return (
              <div
                className="w-[74px] h-[74px] rounded-2xl bg-black/90 border border-neutral-700 flex flex-col items-center justify-center shrink-0 text-center"
                title="Regime-weighted composite momentum (−100..100)."
              >
                <div className="text-[10px] uppercase tracking-wide text-neutral-400 leading-none">
                  Total
                </div>
                <div
                  className={`mt-0.5 text-base font-semibold leading-none ${
                    vDyn >= 0 ? "text-[var(--good-400)]" : "text-[var(--bad-400)]"
                  }`}
                >
                  {vDyn >= 0 ? "+" : ""}
                  {vDyn}
                </div>
              </div>
            );
          })()}

          <div
            className={`w-6 h-6 rounded-full border border-neutral-700 shadow-[0_0_0_3px_rgba(0,0,0,0.35)] ${dotClass(
              momentumDotScore
            )}`}
            title="Overall momentum (hover-aware, ML-weighted when available)"
          />
        </div>
      </div>
    </div>
  );
}
