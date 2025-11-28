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

const RATIO_LABELS: Record<string, string> = {
  grossProfitMargin: "Gross Profit Margin",
  operatingProfitMargin: "Operating Profit Margin",
  netProfitMargin: "Net Profit Margin",
  returnOnEquity: "ROE",
  returnOnAssets: "ROA",
  returnOnCapitalEmployed: "ROCE",
  currentRatio: "Current Ratio",
  quickRatio: "Quick Ratio",
  cashRatio: "Cash Ratio",
  debtEquityRatio: "Debt/Equity",
  debtRatio: "Debt Ratio",
  interestCoverage: "Interest Coverage",
  cashFlowToDebtRatio: "CF to Debt",
  assetTurnover: "Asset Turnover",
  inventoryTurnover: "Inventory Turnover",
  receivablesTurnover: "Receivables Turnover",
  daysOfSalesOutstanding: "Days Sales Outstanding",
  daysOfInventoryOutstanding: "Days Inventory Outstanding",
  daysOfPayablesOutstanding: "Days Payables Outstanding",
  cashConversionCycle: "Cash Conversion Cycle",
  operatingCashFlowSalesRatio: "OCF / Sales",
  freeCashFlowOperatingCashFlowRatio: "FCF / OCF",
  operatingCashFlowPerShare: "OCF / Share",
  freeCashFlowPerShare: "FCF / Share",
  cashPerShare: "Cash / Share",
  priceEarningsRatio: "P/E",
  priceToSalesRatio: "P/S",
  priceToBookRatio: "P/B",
  enterpriseValueMultiple: "EV / EBITDA",
  priceToFreeCashFlowsRatio: "P/FCF",
  dividendYield: "Dividend Yield",
  priceEarningsToGrowthRatio: "PEG",
  payoutRatio: "Payout Ratio",
  dividendPayoutRatio: "Dividend Payout",
};

const normalizeRatioKey = (raw: string): string | null => {
  if (!raw) return null;
  let key = raw.trim();
  key = key.replace(/[_\s-]*ttm$/i, "");
  if (!key) return null;
  key = key.replace(/[_-]([a-zA-Z0-9])/g, (_, c) => c.toUpperCase());
  if (key.toLowerCase() === "dividendyiel") key = "dividendYield";
  if (key.toLowerCase() === "dividendyieldpercentage") key = "dividendYield";
  return key;
};

const aliasRatioKey = (key: string): string => {
  const lower = key.toLowerCase();
  if (lower === "dividendyieldpercentage") return "dividendYield";
  if (lower === "pricetoearningsratio") return "priceEarningsRatio";
  return key;
};

const normalizeRatiosRecord = (input: any): Record<string, number> => {
  const out: Record<string, number> = {};
  if (!input || typeof input !== "object") return out;
  for (const [rawKey, rawVal] of Object.entries(input)) {
    const numVal = Number(rawVal);
    if (!Number.isFinite(numVal)) continue;
    const normalized = normalizeRatioKey(rawKey);
    if (!normalized) continue;
    const alias = aliasRatioKey(normalized);
    out[alias] = numVal;
  }
  return out;
};

type Props = {
  result: EvalResult;
  activeFS: FSKind;
  setActiveFS: (k: FSKind) => void;
};

export default function FinancialDisplay({ result, activeFS, setActiveFS }: Props) {
  const [ratios, setRatios] = useState<Record<string, number> | null>(null);
  const [ratiosError, setRatiosError] = useState<string | null>(null);
  const [ratiosLoading, setRatiosLoading] = useState(false);
  const [showRatios, setShowRatios] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setRatiosLoading(true);
      setRatiosError(null);
      try {
        const res = await fetch(`/api/fmp/ratios-ttm?symbol=${encodeURIComponent(result.sym)}`, { cache: "no-store" });
        const data = await res.json();
        if (!res.ok || data?.error) throw new Error(data?.error || `HTTP ${res.status}`);

        const rows = Array.isArray(data?.ratios)
          ? data.ratios
          : Array.isArray(data?.rows)
          ? data.rows
          : Array.isArray(data)
          ? data
          : [];

        const rec = rows.length ? rows[0] : null;
        if (!rec || typeof rec !== "object") throw new Error("No ratios returned");

        const normalized = normalizeRatiosRecord(rec);
        const hasAny = Object.keys(RATIO_LABELS).some(
          (k) => normalized[k] !== undefined && normalized[k] !== null
        );
        if (!hasAny) throw new Error("No ratio data available");
        if (!cancelled) setRatios(normalized);
      } catch (err: any) {
        if (!cancelled) setRatiosError(err?.message || "Failed to load ratios");
        if (!cancelled) setRatios(null);
      } finally {
        if (!cancelled) setRatiosLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [result.sym]);

  const ratioGroups: { title: string; keys: string[] }[] = useMemo(
    () => [
      { title: "Profitability", keys: ["grossProfitMargin", "operatingProfitMargin", "netProfitMargin"] },
      { title: "Returns", keys: ["returnOnEquity", "returnOnAssets", "returnOnCapitalEmployed"] },
      { title: "Liquidity", keys: ["currentRatio", "quickRatio", "cashRatio"] },
      { title: "Leverage / Solvency", keys: ["debtEquityRatio", "debtRatio", "interestCoverage", "cashFlowToDebtRatio"] },
      {
        title: "Efficiency",
        keys: [
          "assetTurnover",
          "inventoryTurnover",
          "receivablesTurnover",
          "daysOfSalesOutstanding",
          "daysOfInventoryOutstanding",
          "daysOfPayablesOutstanding",
          "cashConversionCycle",
        ],
      },
      { title: "Cash-flow quality", keys: ["operatingCashFlowSalesRatio", "freeCashFlowOperatingCashFlowRatio"] },
      { title: "Per-share", keys: ["operatingCashFlowPerShare", "freeCashFlowPerShare", "cashPerShare"] },
      {
        title: "Valuation",
        keys: [
          "priceEarningsRatio",
          "priceToSalesRatio",
          "priceToBookRatio",
          "enterpriseValueMultiple",
          "priceToFreeCashFlowsRatio",
          "dividendYield",
          "priceEarningsToGrowthRatio",
          "payoutRatio",
          "dividendPayoutRatio",
        ],
      },
    ],
    []
  );

  const formatRatioValue = (key: string, value?: number) => {
    if (value === undefined || value === null || Number.isNaN(value)) return "—";
    const pctKeys = new Set([
      "grossProfitMargin",
      "operatingProfitMargin",
      "netProfitMargin",
      "returnOnEquity",
      "returnOnAssets",
      "returnOnCapitalEmployed",
      "dividendYield",
      "payoutRatio",
      "dividendPayoutRatio",
    ]);
    const dayKeys = new Set([
      "daysOfSalesOutstanding",
      "daysOfInventoryOutstanding",
      "daysOfPayablesOutstanding",
      "cashConversionCycle",
    ]);
    if (pctKeys.has(key)) return `${(value * 100).toFixed(1)}%`;
    if (dayKeys.has(key)) return `${value.toFixed(1)}d`;
    if (key.toLowerCase().includes("perShare".toLowerCase())) return `$${value.toFixed(2)}`;
    if (key === "dividendYield") return `${(value * 100).toFixed(2)}%`;
    return value.toFixed(2);
  };

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

      {/* Key Financial Ratios */}
      <div className="bg-neutral-800 rounded-2xl p-4 border border-neutral-700">
        <button
          type="button"
          onClick={() => setShowRatios((v) => !v)}
          className="w-full flex items-center justify-between text-left"
          aria-expanded={showRatios}
        >
          <span className="text-sm text-neutral-300">Key Financial Ratios</span>
          <span className={`text-neutral-400 text-xs transition-transform ${showRatios ? "rotate-180" : ""}`}>
            ▾
          </span>
        </button>

        {showRatios && (
          <div className="mt-3 space-y-3">
            {ratiosLoading && <div className="text-sm text-neutral-400">Loading ratios…</div>}
            {ratiosError && <div className="text-sm text-[var(--bad-300)]">{ratiosError}</div>}
            {!ratiosLoading && !ratiosError && ratios && (
              ratioGroups.map((group) => {
                const rows = group.keys
                  .map((k) => ({
                    key: k,
                    value: ratios[k],
                  }))
                  .filter((r) => r.value !== undefined && r.value !== null);
                if (!rows.length) return null;
                return (
                  <div key={group.title} className="border border-neutral-700 rounded-xl p-3">
                    <div className="text-xs uppercase tracking-wide text-neutral-400 mb-2">{group.title}</div>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-2 text-sm">
                      {rows.map((r) => (
                        <div key={r.key} className="flex items-center justify-between gap-2">
                          <span className="text-neutral-400">{RATIO_LABELS[r.key] ?? r.key}</span>
                          <span className="text-neutral-100 tabular-nums">{formatRatioValue(r.key, r.value)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>
    </>
  );
}
