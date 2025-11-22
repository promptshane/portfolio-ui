// src/app/analysis/sections/MomentumDisplay.tsx
"use client";

import { useState } from "react";
import {
  DERIV_COLORS,
  EvalResult,
  IndicKey,
  RangeKey,
  useAnimatedNumber,
} from "../shared";
import useMomentumData from "./useMomentumData";
import MomentumHeaderPanel from "./MomentumHeaderPanel";
import MomentumChart from "./MomentumChart";

/** Local extension so we can add ADX without touching shared types */
type ExtIndicKey = IndicKey | "adx";

/** Merge in a local color for ADX derivatives without editing shared */
const DCOLORS: Record<ExtIndicKey, { d1: string; d2: string }> = {
  band: DERIV_COLORS.band,
  rsi: DERIV_COLORS.rsi,
  macd: DERIV_COLORS.macd,
  adx: { d1: "#a78bfa", d2: "#c4b5fd" }, // violet tones
};

type Props = {
  result: EvalResult;
  range: RangeKey;
  setRange: (r: RangeKey) => void;
  indicSelected: Record<IndicKey, boolean>;
  setIndicSelected: React.Dispatch<React.SetStateAction<Record<IndicKey, boolean>>>;
  deriv1Selected: Record<IndicKey, boolean>;
  setDeriv1Selected: React.Dispatch<React.SetStateAction<Record<IndicKey, boolean>>>;
  deriv2Selected: Record<IndicKey, boolean>;
  setDeriv2Selected: React.Dispatch<React.SetStateAction<Record<IndicKey, boolean>>>;
};

type HorizonKey = "short" | "medium" | "long";

export default function MomentumDisplay({
  result,
  range,
  setRange,
  indicSelected,
  setIndicSelected,
  deriv1Selected,
  setDeriv1Selected,
  setDeriv2Selected,
  deriv2Selected,
}: Props) {
  const [hoverI, setHoverI] = useState<number | null>(null);
  const [useCandles, setUseCandles] = useState(false);
  const [hKey, setHKey] = useState<HorizonKey>("medium");
  const [oneMonthInterval, setOneMonthInterval] = useState<"1h" | "1d">("1h");

  const data = useMomentumData({ result, range, hKey, hoverI, oneMonthInterval });

  // Header numbers (animated)
  const startPrice = data.visiblePriceSlice.length ? data.visiblePriceSlice[0] : 0;
  const lastPrice = data.visiblePriceSlice.length
    ? data.visiblePriceSlice[data.visiblePriceSlice.length - 1]
    : 0;
  const rawDisplayPrice = hoverI != null ? data.visiblePriceSlice[hoverI] : lastPrice;
  const rawAbs = rawDisplayPrice - startPrice;
  const rawPct = startPrice === 0 ? 0 : (rawAbs / startPrice) * 100;

  const animatedPrice = useAnimatedNumber(rawDisplayPrice, 180);
  const animatedAbs = useAnimatedNumber(rawAbs, 180);
  const animatedPct = useAnimatedNumber(rawPct, 180);

  // Derivative selections summary (for rendering derivative graphs)
  const anyDeriv1 =
    Object.values(deriv1Selected).some(Boolean) || ((deriv1Selected as any).adx ?? false);
  const anyDeriv2 =
    Object.values(deriv2Selected).some(Boolean) || ((deriv2Selected as any).adx ?? false);

  return (
    <>
      {/* === Big price panel + indicator chips === */}
      <MomentumHeaderPanel
        result={result}
        hKey={hKey}
        setHKey={setHKey}
        indicSelected={indicSelected}
        setIndicSelected={setIndicSelected}
        deriv1Selected={deriv1Selected}
        setDeriv1Selected={setDeriv1Selected}
        deriv2Selected={deriv2Selected}
        setDeriv2Selected={setDeriv2Selected}
        visibleIndexRange={data.visibleIndexRange}
        hoverI={hoverI}
        indicatorSignals={data.indicatorSignals}
        DCOLORS={DCOLORS}
        animatedPrice={animatedPrice}
        animatedAbs={animatedAbs}
        animatedPct={animatedPct}
        rangeStartMeta={data.rangeStartMeta}
        hoveredOHLC={data.hoveredOHLC}
        momentumDotScore={data.momentumDotScore}
      />

      {/* === Momentum price graph + range selector === */}
      <MomentumChart
        range={range}
        setRange={setRange}
        indicSelected={indicSelected}
        deriv1Selected={deriv1Selected}
        deriv2Selected={deriv2Selected}
        DCOLORS={DCOLORS}
        useCandles={useCandles}
        setUseCandles={setUseCandles}
        hoverI={hoverI}
        setHoverI={setHoverI}
        visibleIndexRange={data.visibleIndexRange}
        visiblePriceSlice={data.visiblePriceSlice}
        pricePathMemo={data.pricePathMemo}
        momentumGeom={data.momentumGeom}
        rangeStartMeta={data.rangeStartMeta}
        hoveredDate={data.hoveredOHLC.date ?? ""}
        active={data.active}
        ohlcSeries={data.ohlcSeries}
        rsiGeom={data.rsiGeom}
        visibleRSISlice={data.visibleRSISlice}
        adxGeom={data.adxGeom}
        visibleADXSlice={data.visibleADXSlice}
        deriv1={data.deriv1}
        deriv2={data.deriv2}
        anyDeriv1={anyDeriv1}
        anyDeriv2={anyDeriv2}
        keyStats={data.keyStats}
        oneMonthInterval={oneMonthInterval}
        setOneMonthInterval={setOneMonthInterval}
      />
    </>
  );
}
