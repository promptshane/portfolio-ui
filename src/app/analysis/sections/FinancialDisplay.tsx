// src/app/analysis/sections/FinancialDisplay.tsx
"use client";

import { EvalResult, FSBlock, FSKind, FSRow, fmtPct0, dotClass } from "../shared";
import { buildFinScatter } from "../calc/financeCalc";
import { computeFinancialScores } from "../calc/financialScoreCalc";
import { useEffect, useMemo, useRef, useState } from "react";

function valueColor(kind: FSRow["kind"], value: number) {
  const goodUp = kind === "bad" ? value <= 0 : value >= 0;
  return goodUp ? "text-[var(--good-400)]" : "text-[var(--bad-400)]";
}

function FSRowLine({ row }: { row: FSRow }) {
  return (
    <div className="flex items-baseline justify-between">
      <div className="text-[15px] sm:text-base">
        <span className="font-medium mr-2">{row.label}</span>
        <span className={`${valueColor(row.kind, row.total)}`}>({fmtPct0(row.total)})</span>
        <span className={`ml-2 ${valueColor(row.kind, row.yoy)}`}>({fmtPct0(row.yoy)} YoY)</span>
      </div>
      <div className="text-neutral-300 font-medium">[{row.conf}]</div>
    </div>
  );
}

function FSCard({
  selected,
  onClick,
  block,
  score,
}: {
  selected: boolean;
  onClick: () => void;
  block: FSBlock;
  score?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      className={`text-left bg-neutral-800 rounded-2xl p-4 border transition-colors w-full ${
        selected ? "border-white" : "border-neutral-700 hover:border-neutral-500"
      } focus:outline-none focus:ring-2 focus:ring-white/40`}
    >
      <div className="flex items-center justify-between text-sm font-semibold mb-3">
        <span>{block.title}</span>
        {typeof score === "number" && (
          <span
            className={`w-3 h-3 rounded-full border border-neutral-700 shadow-[0_0_0_2px_rgba(0,0,0,0.4)] ${dotClass(
              score
            )}`}
          />
        )}
      </div>
      <div className="space-y-1.5">
        {block.rows.map((r, i) => (
          <FSRowLine key={i} row={r} />
        ))}
      </div>
    </button>
  );
}

type Props = {
  result: EvalResult;
  activeFS: FSKind;
  setActiveFS: (k: FSKind) => void;
};

export default function FinancialDisplay({ result, activeFS, setActiveFS }: Props) {
  // Robust check: consider "no financials" when **all** finDots series are empty (common for ETFs)
  const hasFinancial = (() => {
    const d = result.finDots;
    const has = (k: FSKind) => {
      const section = d[k];
      return section.good.length > 0 || section.bad.length > 0 || section.net.length > 0;
    };
    return has("is") || has("bs") || has("cfs");
  })();

  const [finHoverI, setFinHoverI] = useState<number | null>(null);
  const finScores = useMemo(() => computeFinancialScores(result), [result]);

  // number formatter for $ in thousands
  const fmtK = useMemo(() => new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }), []);

  // Measure container so dots/spacing fill the actual visible area (no letterboxing skew).
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [svgW, setSvgW] = useState(1000);
  const svgH = 180; // match CSS height so viewBox ratio == rendered ratio

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = Math.max(320, Math.round(entry.contentRect.width));
        if (w !== svgW) setSvgW(w);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [svgW]);

  // 5 actual (FMP) + 5 forecast (already scaled to thousands in financeCalc)
  const finScatter = useMemo(
    () =>
      hasFinancial
        ? buildFinScatter(result, activeFS, { forecastYears: 5, w: svgW, h: svgH, pad: 10 })
        : null,
    [hasFinancial, result, activeFS, svgW]
  );

  if (!finScatter) {
    return (
      <div className="bg-neutral-800 rounded-2xl p-6 border border-neutral-700 text-center text-neutral-300">
        No Financial Info
      </div>
    );
  }

  const scoreSeriesLen = finScores.overall.series.length;
  const hasScoreSeries = scoreSeriesLen > 0;
  const maxIdx = hasScoreSeries ? Math.min(finScatter.nAct - 1, scoreSeriesLen - 1) : null;
  const hoverIdx =
    finHoverI != null && maxIdx != null && maxIdx >= 0 ? Math.min(finHoverI, maxIdx) : null;
  const activeScoreIdx =
    maxIdx != null && maxIdx >= 0
      ? hoverIdx ?? maxIdx
      : hasScoreSeries
      ? scoreSeriesLen - 1
      : null;

  const headerScore =
    activeScoreIdx != null && activeScoreIdx >= 0
      ? finScores.overall.series[activeScoreIdx] ?? finScores.overall.latest
      : finScores.overall.latest;

  const statementScore = (kind: FSKind) => {
    const series = finScores.perStatement[kind].series;
    if (!series.length) return undefined;
    const idx = activeScoreIdx != null ? Math.min(activeScoreIdx, series.length - 1) : series.length - 1;
    return series[idx];
  };

  return (
    <>
      {/* Header */}
      <div className="bg-neutral-800 rounded-2xl p-4 border border-neutral-700 flex items-center justify-between">
        <div className="font-medium">
          Financial Summary <span className="ml-2 text-xs text-neutral-400">($ in thousands)</span>
        </div>
        <div
          className={`w-5 h-5 rounded-full border border-neutral-700 shadow-[0_0_0_3px_rgba(0,0,0,0.35)] ${dotClass(
            headerScore ?? result.financialScore
          )}`}
          title="Financial quality"
        />
      </div>

      {/* Graph */}
      <div ref={containerRef} className="bg-neutral-800 rounded-2xl p-4 border border-neutral-700">
        <svg
          key={activeFS}
          viewBox={`0 0 ${finScatter.w} ${finScatter.h}`}
          className="w-full h-[180px]"
          preserveAspectRatio="xMidYMid meet"
          onMouseMove={(e) => {
            const svgEl = e.currentTarget as SVGSVGElement;
            const rect = svgEl.getBoundingClientRect();

            // Account for potential letterboxing from preserveAspectRatio="meet"
            const scale = Math.min(rect.width / finScatter.w, rect.height / finScatter.h);
            const leftOffset = (rect.width - scale * finScatter.w) / 2;

            const xInSvg = (e.clientX - rect.left - leftOffset) / scale;
            const t = Math.max(
              0,
              Math.min(
                1,
                (xInSvg - finScatter.pad) / Math.max(1, finScatter.w - 2 * finScatter.pad)
              )
            );
            const i = Math.round(t * (finScatter.nTot - 1));
            setFinHoverI(i);
          }}
          onMouseLeave={() => setFinHoverI(null)}
        >
          {/* Regressions */}
          <path d={finScatter.badRegSolidPath} fill="none" stroke="var(--bad-400)" strokeWidth={1.75} />
          <path d={finScatter.goodRegSolidPath} fill="none" stroke="var(--good-300)" strokeWidth={1.75} />
          <path d={finScatter.netRegSolidPath}  fill="none" stroke="var(--mid-400)"  strokeWidth={1.75} />
          {/* Forecast (dashed) */}
          <path d={finScatter.badRegForecastPath}  fill="none" stroke="var(--bad-400)" strokeWidth={1.75} strokeDasharray="6 4" />
          <path d={finScatter.goodRegForecastPath} fill="none" stroke="var(--good-300)" strokeWidth={1.75} strokeDasharray="6 4" />
          <path d={finScatter.netRegForecastPath}  fill="none" stroke="var(--mid-400)"  strokeWidth={1.75} strokeDasharray="6 4" />

          {/* Actual dots */}
          {Array.from({ length: finScatter.nAct }).map((_, i) => (
            <g key={i}>
              <circle cx={finScatter.X(i)} cy={finScatter.Y(finScatter.trio.bad[i])}  r="3" fill="var(--bad-400)" />
              <circle cx={finScatter.X(i)} cy={finScatter.Y(finScatter.trio.good[i])} r="3" fill="var(--good-300)" />
              <circle cx={finScatter.X(i)} cy={finScatter.Y(finScatter.trio.net[i])}  r="3" fill="var(--mid-400)" />
            </g>
          ))}

          {/* hover + tooltip */}
          {finHoverI !== null && (() => {
            const i = finHoverI!;
            const x = finScatter.X(i);
            const val = (arr: number[], pred: number[]) => (i < finScatter.nAct ? arr[i] : pred[i]);
            const vGood = val(finScatter.trio.good, finScatter.gPred);
            const vBad = val(finScatter.trio.bad, finScatter.bPred);
            const vNet = val(finScatter.trio.net, finScatter.nPred);

            const labelGood = activeFS === "is" ? "Revenue" : activeFS === "bs" ? "Assets" : "Operating CF";
            const labelBad = activeFS === "is" ? "Cost" : activeFS === "bs" ? "Liabilities" : "CapEx";
            const labelNet = activeFS === "is" ? "Net Income" : activeFS === "bs" ? "Equity" : "FCF";

            const mk = (v: number, color: string) => (
              <circle cx={x} cy={finScatter.Y(v)} r="4" fill={color} stroke="#111827" strokeWidth="1" />
            );

            const year = finScatter.years[i];
            const boxX = Math.min(finScatter.w - 210, Math.max(10, x + 8));
            const boxY = 14;

            return (
              <g>
                <line x1={x} x2={x} y1={10} y2={finScatter.h - 10} stroke="#ffffff33" strokeWidth={1} />
                {mk(vGood, "var(--good-300)")}
                {mk(vBad,  "var(--bad-400)")}
                {mk(vNet,  "var(--mid-400)")}
                <g transform={`translate(${boxX},${boxY})`}>
                  <rect width="200" height="80" rx="8" fill="#0b0f1a" stroke="#374151" />
                  <text x="8" y="18" fill="#9ca3af" fontSize="12">{year}  •  $K</text>
                  <text x="8" y="36" fill="var(--good-300)" fontSize="12">
                    {labelGood}: {fmtK.format(vGood)}
                  </text>
                  <text x="8" y="52" fill="var(--bad-400)" fontSize="12">
                    {labelBad}: {fmtK.format(vBad)}
                  </text>
                  <text x="8" y="68" fill="var(--mid-400)" fontSize="12">
                    {labelNet}: {fmtK.format(vNet)}
                  </text>
                </g>
              </g>
            );
          })()}
        </svg>
      </div>

      {/* Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <FSCard
          selected={activeFS === "is"}
          onClick={() => setActiveFS("is")}
          block={result.details.is}
          score={statementScore("is")}
        />
        <FSCard
          selected={activeFS === "bs"}
          onClick={() => setActiveFS("bs")}
          block={result.details.bs}
          score={statementScore("bs")}
        />
        <FSCard
          selected={activeFS === "cfs"}
          onClick={() => setActiveFS("cfs")}
          block={result.details.cfs}
          score={statementScore("cfs")}
        />
      </div>
    </>
  );
}
