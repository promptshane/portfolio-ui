// src/app/analysis/sections/FinancialDisplay.tsx
"use client";

import { EvalResult, FSBlock, FSKind, FSRow, fmtPct0, dotClass, linRegStats, toPathXY } from "../shared";
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
  label,
}: {
  selected: boolean;
  onClick: () => void;
  block: FSBlock;
  score?: number;
  label?: string;
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
      } focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40 focus:ring-0`}
    >
      <div className="flex items-center justify-between text-sm font-semibold mb-3">
        <span>{label ?? block.title}</span>
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
  returnOnInvestedCapital: "ROIC",
  returnOnCapitalEmployed: "ROCE",
  currentRatio: "Current Ratio",
  quickRatio: "Quick Ratio",
  cashRatio: "Cash Ratio",
  debtEquityRatio: "Debt/Equity",
  debtRatio: "Debt Ratio",
  interestCoverage: "Interest Coverage",
  cashFlowToDebtRatio: "CF to Debt",
  netDebtToEbitda: "Net Debt / EBITDA",
  assetTurnover: "Asset Turnover",
  inventoryTurnover: "Inventory Turnover",
  receivablesTurnover: "Receivables Turnover",
  daysOfSalesOutstanding: "Days Sales Outstanding",
  daysOfInventoryOutstanding: "Days Inventory Outstanding",
  daysOfPayablesOutstanding: "Days Payables Outstanding",
  cashConversionCycle: "Cash Conversion Cycle",
  operatingCashFlowSalesRatio: "CFO margin",
  freeCashFlowSalesRatio: "FCF margin",
  freeCashFlowOperatingCashFlowRatio: "FCF / OCF",
  operatingCashFlowNetIncomeRatio: "CFO / Net Income",
  freeCashFlowNetIncomeRatio: "FCF / Net Income",
  operatingCashFlowPerShare: "OCF / Share",
  freeCashFlowPerShare: "FCF / Share",
  cashPerShare: "Cash / Share",
  revenuePerShare: "Revenue / Share",
  eps: "EPS (TTM)",
  priceEarningsRatio: "P/E",
  priceToSalesRatio: "P/S",
  priceToBookRatio: "P/B",
  enterpriseValueMultiple: "EV / EBITDA",
  evToEbitda: "EV / EBITDA",
  evToEbit: "EV / EBIT",
  evToSales: "EV / Sales",
  evToFreeCashFlow: "EV / FCF",
  priceToFreeCashFlowsRatio: "P/FCF",
  dividendYield: "Dividend Yield",
  priceEarningsToGrowthRatio: "PEG",
  payoutRatio: "Payout Ratio",
  dividendPayoutRatio: "Dividend Payout",
  enterpriseValue: "Enterprise Value",
  totalDebt: "Total Debt",
  cashAndCashEquivalents: "Cash & Equivalents",
  netDebt: "Net Debt",
  ebitda: "EBITDA",
  ebitdaMargin: "EBITDA Margin",
  operatingIncome: "Operating Income",
  operatingMargin: "Operating Margin",
  interestExpense: "Interest Expense",
  shareRepurchases: "Share Repurchases",
  dividendsPaid: "Dividends Paid",
  netBuybacks: "Net Buybacks",
  buybackYield: "Buyback Yield",
  shareholderYield: "Shareholder Yield",
  sharesOutstanding: "Shares Outstanding",
  sharesOutstandingYoY: "Shares YoY",
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
  if (lower === "pricetoearningsratio" || lower === "priceearningsratio") return "priceEarningsRatio";
  if (lower === "pfcfratio") return "priceToFreeCashFlowsRatio";
  if (lower === "roe") return "returnOnEquity";
  if (lower === "roa") return "returnOnAssets";
  if (lower === "roic") return "returnOnInvestedCapital";
  if (lower === "netdebttoebitda") return "netDebtToEbitda";
  if (lower === "enterprisevalueoverebitda") return "evToEbitda";
  if (lower === "enterprisevaluetorevenue" || lower === "evtosales") return "evToSales";
  if (lower === "evtoebit") return "evToEbit";
  if (lower === "weightedaverageshsout" || lower === "weightedaverageshsoutdil")
    return "sharesOutstanding";
  if (lower === "epsdiluted") return "eps";
  if (lower === "ebitdaratio") return "ebitdaMargin";
  if (lower === "operatingincomeratio" || lower === "operatingincomemargin" || lower === "operatingmargin")
    return "operatingMargin";
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

const FS_LABEL_FULL: Record<FSKind, string> = {
  is: "Income Statement",
  bs: "Balance Sheet",
  cfs: "Cash Flow Statement",
};

type Props = {
  result: EvalResult;
  activeFS: FSKind;
  setActiveFS: (k: FSKind) => void;
};

const scoreColor = (v: number) => (v >= 67 ? "var(--good-500)" : v >= 34 ? "var(--mid-400)" : "var(--bad-500)");

export default function FinancialDisplay({ result, activeFS, setActiveFS }: Props) {
  const [ratios, setRatios] = useState<Record<string, number> | null>(null);
  const [ratiosError, setRatiosError] = useState<string | null>(null);
  const [ratiosLoading, setRatiosLoading] = useState(false);
  const [showRatios, setShowRatios] = useState(false);

  useEffect(() => {
    const numMaybe = (v: any): number | null => {
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };

    let cancelled = false;
    (async () => {
      setRatiosLoading(true);
      setRatiosError(null);
      try {
        const [ratiosRes, metricsRes, keyMetricsRes] = await Promise.all([
          fetch(`/api/fmp/ratios-ttm?symbol=${encodeURIComponent(result.sym)}`, { cache: "no-store" }),
          fetch(`/api/fmp/financial-metrics?symbol=${encodeURIComponent(result.sym)}`, { cache: "no-store" }),
          fetch(`/api/fmp/key-metrics?symbol=${encodeURIComponent(result.sym)}`, { cache: "no-store" }),
        ]);

        const ratiosJson = await ratiosRes.json();
        if (!ratiosRes.ok || ratiosJson?.error) throw new Error(ratiosJson?.error || `HTTP ${ratiosRes.status}`);
        const ratioRows = Array.isArray(ratiosJson?.ratios)
          ? ratiosJson.ratios
          : Array.isArray(ratiosJson?.rows)
          ? ratiosJson.rows
          : Array.isArray(ratiosJson)
          ? ratiosJson
          : [];
        const ratioRecord =
          ratioRows.length && typeof ratioRows[0] === "object" ? normalizeRatiosRecord(ratioRows[0]) : {};

        const metricsJson = await metricsRes.json();
        if (!metricsRes.ok || metricsJson?.error) throw new Error(metricsJson?.error || `HTTP ${metricsRes.status}`);
        const metrics: Record<string, number> = {};
        if (metricsJson?.metrics && typeof metricsJson.metrics === "object") {
          for (const [k, v] of Object.entries(metricsJson.metrics)) {
            const num = Number(v);
            if (Number.isFinite(num)) metrics[k] = num;
          }
        }

        let keyMetricsRows: any[] = [];
        try {
          const keyMetricsJson = await keyMetricsRes.json();
          if (keyMetricsRes.ok && !keyMetricsJson?.error) {
            keyMetricsRows = Array.isArray(keyMetricsJson?.rows)
              ? keyMetricsJson.rows
              : Array.isArray(keyMetricsJson)
              ? keyMetricsJson
              : [];
          }
        } catch {
          keyMetricsRows = [];
        }

        const sortedKm = [...keyMetricsRows].sort((a, b) => {
          const ta = Date.parse(String((a as any)?.date ?? (a as any)?.calendarYear ?? 0));
          const tb = Date.parse(String((b as any)?.date ?? (b as any)?.calendarYear ?? 0));
          return (Number.isNaN(tb) ? -Infinity : tb) - (Number.isNaN(ta) ? -Infinity : ta);
        });
        const latestKm = sortedKm[0];
        const priorKm = sortedKm[1];
        const normKmLatest = latestKm ? normalizeRatiosRecord(latestKm) : {};
        const normKmPrior = priorKm ? normalizeRatiosRecord(priorKm) : {};

        const merged: Record<string, number> = {
          ...ratioRecord,
          ...metrics,
          ...normKmLatest,
        };

        if (merged.netDebtToEbitda == null && merged.netDebt != null && merged.ebitda) {
          const ratio = merged.ebitda === 0 ? null : merged.netDebt / merged.ebitda;
          if (ratio != null && Number.isFinite(ratio)) merged.netDebtToEbitda = ratio;
        }

        const marketCap = numMaybe(result.keyStats?.marketCap ?? null);
        const buybacks = numMaybe(merged.shareRepurchases);
        const dividends = numMaybe(merged.dividendsPaid);
        if (marketCap && buybacks) merged.buybackYield = buybacks / marketCap;
        if (marketCap && (buybacks || dividends)) {
          const numer = (buybacks ?? 0) + (dividends ?? 0);
          if (numer !== 0) merged.shareholderYield = numer / marketCap;
        }

        const sharesLatest = numMaybe(
          normKmLatest.sharesOutstanding ?? normKmLatest.weightedAverageShsOut ?? normKmLatest.weightedAverageShsOutDil
        );
        const sharesPrior = numMaybe(
          normKmPrior.sharesOutstanding ?? normKmPrior.weightedAverageShsOut ?? normKmPrior.weightedAverageShsOutDil
        );
        if (sharesLatest != null) merged.sharesOutstanding = sharesLatest;
        if (sharesLatest != null && sharesPrior) {
          const delta = sharesPrior === 0 ? null : (sharesLatest - sharesPrior) / sharesPrior;
          if (delta != null && Number.isFinite(delta)) merged.sharesOutstandingYoY = delta;
        }

        const assignIf = (key: string, value: number | null) => {
          if (value !== null && value !== undefined && Number.isFinite(value)) merged[key] = value;
        };
        assignIf("revenuePerShare", numMaybe(normKmLatest.revenuePerShare));
        assignIf("eps", numMaybe(normKmLatest.eps ?? normKmLatest.epsdiluted ?? normKmLatest.netIncomePerShare));
        assignIf("operatingCashFlowPerShare", numMaybe(normKmLatest.operatingCashFlowPerShare));
        assignIf("freeCashFlowPerShare", numMaybe(normKmLatest.freeCashFlowPerShare));
        assignIf("cashPerShare", numMaybe(normKmLatest.cashPerShare));

        const fcfPerShare = numMaybe(merged.freeCashFlowPerShare);
        const price = Number.isFinite(result.price) ? result.price : null;
        if (!merged.priceToFreeCashFlowsRatio && price && fcfPerShare && fcfPerShare !== 0) {
          merged.priceToFreeCashFlowsRatio = price / fcfPerShare;
        }

        if (merged.enterpriseValue && merged.freeCashFlow) {
          const ratio = merged.freeCashFlow === 0 ? null : merged.enterpriseValue / merged.freeCashFlow;
          if (ratio != null && Number.isFinite(ratio)) merged.evToFreeCashFlow = ratio;
        }
        if (merged.enterpriseValue && merged.revenue) {
          const ratio = merged.revenue === 0 ? null : merged.enterpriseValue / merged.revenue;
          if (ratio != null && Number.isFinite(ratio)) merged.evToSales = ratio;
        }
        if (merged.enterpriseValue && merged.ebit) {
          const ratio = merged.ebit === 0 ? null : merged.enterpriseValue / merged.ebit;
          if (ratio != null && Number.isFinite(ratio)) merged.evToEbit = ratio;
        }

        const hasAny = Object.keys(RATIO_LABELS).some(
          (k) => merged[k] !== undefined && merged[k] !== null && Number.isFinite(merged[k] as number)
        );
        if (!hasAny) {
          throw new Error("No ratio data available");
        }

        if (!cancelled) {
          setRatios(merged);
          setRatiosError(null);
        }
      } catch (err: any) {
        if (!cancelled) {
          setRatiosError(err?.message || "Failed to load ratios");
          setRatios(null);
        }
      } finally {
        if (!cancelled) setRatiosLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [result.sym, result.price, result.keyStats?.marketCap]);

  const ratioGroups: { title: string; keys: string[] }[] = useMemo(
    () => [
      { title: "Profitability", keys: ["grossProfitMargin", "operatingProfitMargin", "netProfitMargin"] },
      { title: "Returns", keys: ["returnOnEquity", "returnOnAssets", "returnOnCapitalEmployed"] },
      { title: "Liquidity", keys: ["currentRatio", "quickRatio", "cashRatio"] },
      { title: "Leverage / Solvency", keys: ["debtEquityRatio", "debtRatio", "cashFlowToDebtRatio"] },
      { title: "Capital Structure", keys: ["enterpriseValue", "totalDebt", "cashAndCashEquivalents", "netDebt"] },
      {
        title: "Earnings & Coverage",
        keys: ["ebitda", "ebitdaMargin", "operatingIncome", "operatingMargin", "interestExpense", "interestCoverage"],
      },
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
      { title: "Capital Returns", keys: ["shareRepurchases", "dividendsPaid", "netBuybacks"] },
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

  const pctKeys = useMemo(
    () =>
      new Set([
        "grossProfitMargin",
        "operatingProfitMargin",
        "netProfitMargin",
        "returnOnEquity",
        "returnOnAssets",
        "returnOnCapitalEmployed",
        "payoutRatio",
        "dividendPayoutRatio",
        "ebitdaMargin",
        "operatingMargin",
      ]),
    []
  );
  const dayKeys = useMemo(
    () =>
      new Set([
        "daysOfSalesOutstanding",
        "daysOfInventoryOutstanding",
        "daysOfPayablesOutstanding",
        "cashConversionCycle",
      ]),
    []
  );
  const currencyKeys = useMemo(
    () =>
      new Set([
        "enterpriseValue",
        "totalDebt",
        "cashAndCashEquivalents",
        "netDebt",
        "ebitda",
        "operatingIncome",
        "interestExpense",
        "shareRepurchases",
        "dividendsPaid",
        "netBuybacks",
      ]),
    []
  );

  const fmtCurrencyCompact = useMemo(
    () =>
      new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        notation: "compact",
        maximumFractionDigits: 1,
      }),
    []
  );

  const formatRatioValue = (key: string, value?: number) => {
    if (value === undefined || value === null || Number.isNaN(value)) return "—";
    if (key === "dividendYield") return `${(value * 100).toFixed(2)}%`;
    if (pctKeys.has(key)) return `${(value * 100).toFixed(1)}%`;
    if (dayKeys.has(key)) return `${value.toFixed(1)}d`;
    if (currencyKeys.has(key)) return fmtCurrencyCompact.format(value);
    if (key.toLowerCase().includes("pershare")) return `$${value.toFixed(2)}`;
    if (key === "interestCoverage") return `${value.toFixed(2)}×`;
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
  const [summaryMode, setSummaryMode] = useState(false);
  const [summarySelection, setSummarySelection] = useState<Record<FSKind, boolean>>({
    is: true,
    bs: true,
    cfs: true,
  });
  const [summaryHoverI, setSummaryHoverI] = useState<number | null>(null);
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

  useEffect(() => {
    if (summaryMode) {
      setSummarySelection({ is: true, bs: true, cfs: true });
      setSummaryHoverI(null);
    } else {
      setSummaryHoverI(null);
    }
  }, [summaryMode]);

  // 5 actual (FMP) + 5 forecast (already scaled to thousands in financeCalc)
  const finScatter = useMemo(
    () =>
      hasFinancial
        ? buildFinScatter(result, activeFS, { forecastYears: 5, w: svgW, h: svgH, pad: 10 })
        : null,
    [hasFinancial, result, activeFS, svgW]
  );

  const summarySelectedKinds = useMemo(() => {
    const enabled = Object.entries(summarySelection)
      .filter(([, on]) => on)
      .map(([k]) => k as FSKind);
    return enabled.length ? enabled : (["is", "bs", "cfs"] as FSKind[]);
  }, [summarySelection]);

  useEffect(() => {
    setSummaryHoverI(null);
  }, [summarySelectedKinds]);

  const summaryScore = useMemo(() => {
    const weights: Record<FSKind, number> = { is: 0.2, bs: 0.35, cfs: 0.45 };
    const seriesList = summarySelectedKinds.map((k) => finScores.perStatement[k].series ?? []);
    const minLen = seriesList.length ? Math.min(...seriesList.map((s) => s.length || 0)) : 0;
    if (!minLen) {
      return { series: [] as number[], latest: finScores.overall.latest };
    }

    const totalWeight = summarySelectedKinds.reduce((acc, k) => acc + (weights[k] ?? 1), 0) || summarySelectedKinds.length;
    const normWeights = summarySelectedKinds.map((k) => ((weights[k] ?? 1) as number) / totalWeight);

    const combined = Array.from({ length: minLen }, (_, idx) =>
      summarySelectedKinds.reduce((sum, k, i) => {
        const series = finScores.perStatement[k].series;
        const val = series[idx] ?? series[series.length - 1] ?? finScores.overall.latest;
        return sum + normWeights[i] * val;
      }, 0)
    );

    return { series: combined, latest: combined[combined.length - 1] ?? finScores.overall.latest };
  }, [finScores, summarySelectedKinds]);

  const summaryYears = useMemo(() => {
    const len = summaryScore.series.length;
    if (!len) return [];
    const pickYears = (k: FSKind) => {
      const yrs = result.finYears?.[k];
      if (yrs?.length) {
        if (yrs.length === len) return yrs;
        if (yrs.length > len) return yrs.slice(yrs.length - len);
      }
      return null;
    };
    for (const k of summarySelectedKinds) {
      const yrs = pickYears(k);
      if (yrs) return yrs;
    }
    if (finScatter?.years?.length) {
      return finScatter.years.slice(0, len);
    }
    const thisYear = new Date().getFullYear();
    return Array.from({ length: len }, (_, i) => `${thisYear - (len - 1) + i}`);
  }, [finScatter, result.finYears, summaryScore.series.length, summarySelectedKinds]);

  const summaryGraph = useMemo(() => {
    if (!summaryScore.series.length) return null;
    const actual = summaryScore.series.slice(-5);
    const yearsActual = summaryYears.slice(-actual.length);
    const nAct = actual.length;
    const nFor = 5;
    const nTot = nAct + nFor;
    const { slope, intercept } = linRegStats(actual);
    const reg = Array.from({ length: nTot }, (_, i) => intercept + slope * i);
    const combined = Array.from({ length: nTot }, (_, i) => (i < nAct ? actual[i] : reg[i]));
    const pad = finScatter?.pad ?? 10;
    const w = finScatter?.w ?? svgW;
    const h = finScatter?.h ?? svgH;
    const min = Math.min(0, ...combined, 0);
    const max = Math.max(100, ...combined, 1);
    const X = (i: number) => pad + (i * (w - 2 * pad)) / Math.max(1, nTot - 1);
    const Y = (v: number) =>
      h - pad - ((Math.max(min, Math.min(max, v)) - min) * (h - 2 * pad)) / Math.max(1, max - min);

    const yearsFull = (() => {
      const out = [...yearsActual];
      const last = out[out.length - 1];
      const lastNum = Number.parseInt(last, 10);
      for (let i = 0; i < nFor; i++) {
        const val =
          Number.isFinite(lastNum) && !Number.isNaN(lastNum) ? String(lastNum + i + 1) : `F+${i + 1}`;
        out.push(val);
      }
      return out.slice(0, nTot);
    })();

    const points = Array.from({ length: nTot }, (_, i) => ({
      x: X(i),
      y: Y(combined[i]),
      v: combined[i],
      year: yearsFull[i] ?? "",
      actual: i < nAct,
    }));

    const regActPath = toPathXY(
      reg.map((v, idx) => (idx < nAct ? v : Number.NaN)),
      X,
      Y
    );
    const regForecastPath = toPathXY(
      reg.map((v, idx) => (idx >= Math.max(0, nAct - 1) ? v : Number.NaN)),
      X,
      Y
    );

    return { nAct, nTot, w, h, pad, points, regActPath, regForecastPath, Y };
  }, [finScatter, summaryScore.series, summaryYears, svgH, svgW]);

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

  const summaryChartIdx =
    summaryMode && summaryGraph && summaryHoverI != null
      ? Math.max(0, Math.min(summaryHoverI, summaryGraph.nTot - 1))
      : null;

  const defaultHeaderScore =
    activeScoreIdx != null && activeScoreIdx >= 0
      ? finScores.overall.series[activeScoreIdx] ?? finScores.overall.latest
      : finScores.overall.latest;

  const headerScore = summaryMode
    ? summaryChartIdx != null
      ? summaryGraph?.points[summaryChartIdx]?.v ?? summaryScore.latest
      : summaryGraph?.points?.[Math.max(0, (summaryGraph?.nAct ?? 1) - 1)]?.v ?? summaryScore.latest
    : defaultHeaderScore;

  const statementScore = (kind: FSKind) => {
    const series = finScores.perStatement[kind].series;
    if (!series.length) return undefined;
    const idx =
      summaryMode && summaryChartIdx != null
        ? Math.min(summaryChartIdx, series.length - 1)
        : activeScoreIdx != null
        ? Math.min(activeScoreIdx, series.length - 1)
        : series.length - 1;
    return series[idx];
  };

  const handleCardClick = (kind: FSKind) => {
    if (summaryMode) {
      setSummarySelection((sel) => {
        const next = { ...sel, [kind]: !sel[kind] };
        if (!Object.values(next).some(Boolean)) return sel;
        return next;
      });
      setSummaryHoverI(null);
    } else {
      setActiveFS(kind);
    }
  };

  const handleDotToggle = () => {
    setSummaryMode((v) => !v);
    setFinHoverI(null);
    setSummaryHoverI(null);
  };

  const summaryHoverPt =
    summaryMode && summaryGraph && summaryChartIdx != null
      ? summaryGraph.points[Math.min(summaryChartIdx, summaryGraph.points.length - 1)]
      : null;

  return (
    <>
      {/* Header */}
      <div className="bg-neutral-800 rounded-2xl p-4 border border-neutral-700 flex items-center justify-between">
        <div className="flex flex-col">
          <div className="font-medium flex items-center gap-2">
            <span>Financial Summary</span>
            <span className="text-xs text-neutral-400">($ in thousands)</span>
          </div>
          <div className="text-[11px] uppercase tracking-wide text-neutral-500 mt-1">
            Source: Financial Modeling Prep
          </div>
        </div>
        <button
          type="button"
          onClick={handleDotToggle}
          aria-pressed={summaryMode}
          className={`w-6 h-6 rounded-full border border-neutral-700 shadow-[0_0_0_3px_rgba(0,0,0,0.35)] ${dotClass(
            headerScore ?? result.financialScore
          )} ${summaryMode ? "ring-2 ring-white" : ""}`}
          title={summaryMode ? "Hide financial score timeline" : "Show financial score timeline"}
        />
      </div>

      {/* Graph */}
      <div ref={containerRef} className="bg-neutral-800 rounded-2xl p-4 border border-neutral-700">
        {summaryMode ? (
          summaryGraph ? (
            <div className="space-y-2">
              <svg
                viewBox={`0 0 ${summaryGraph.w} ${summaryGraph.h}`}
                className="w-full h-[180px]"
                preserveAspectRatio="xMidYMid meet"
                onMouseMove={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const scale = Math.min(rect.width / summaryGraph.w, rect.height / summaryGraph.h);
                  const leftOffset = (rect.width - scale * summaryGraph.w) / 2;
                  const xInSvg = (e.clientX - rect.left - leftOffset) / scale;
                  const t = Math.max(
                    0,
                    Math.min(
                      1,
                      (xInSvg - summaryGraph.pad) / Math.max(1, summaryGraph.w - 2 * summaryGraph.pad)
                    )
                  );
                  const idx = Math.round(t * (summaryGraph.nTot - 1));
                  setSummaryHoverI(idx);
                }}
                onMouseLeave={() => setSummaryHoverI(null)}
              >
                {[67, 34].map((v) => {
                  const y = summaryGraph.Y ? summaryGraph.Y(v) : null;
                  if (y == null || Number.isNaN(y)) return null;
                  return (
                    <line
                      key={v}
                      x1={0}
                      x2={summaryGraph.w}
                      y1={y}
                      y2={y}
                      stroke={v === 67 ? "var(--good-500)" : "var(--mid-400)"}
                      strokeWidth={0.75}
                      strokeDasharray="3 4"
                      opacity={0.35}
                    />
                  );
                })}
                <path
                  d={summaryGraph.regActPath}
                  fill="none"
                  stroke="white"
                  strokeWidth={1.75}
                  strokeLinecap="round"
                />
                <path
                  d={summaryGraph.regForecastPath}
                  fill="none"
                  stroke="white"
                  strokeWidth={1.75}
                  strokeDasharray="6 4"
                  strokeLinecap="round"
                />
                {summaryGraph.points
                  .filter((p) => p.actual)
                  .map((p, idx) => (
                    <circle
                      key={idx}
                      cx={p.x}
                      cy={p.y}
                      r={summaryHoverI != null && summaryHoverI === idx ? 4 : 3}
                      fill={scoreColor(p.v)}
                      stroke="#111827"
                      strokeWidth={1}
                    />
                  ))}
                {summaryHoverPt && (
                  <g>
                    <line x1={summaryHoverPt.x} x2={summaryHoverPt.x} y1={10} y2={summaryGraph.h - 10} stroke="#ffffff33" />
                    <g
                      transform={`translate(${Math.min(
                        summaryGraph.w - 200,
                        Math.max(10, summaryHoverPt.x + 8)
                      )},12)`}
                    >
                      <rect width="190" height="60" rx="8" fill="#0b0f1a" stroke="#374151" />
                      <text x="10" y="20" fill="#9ca3af" fontSize="12">
                        {summaryHoverPt.year || (summaryHoverPt.actual ? "Actual" : "Forecast")}
                      </text>
                      <text x="10" y="38" fill="white" fontSize="14" fontWeight="600">
                        {Math.round(summaryHoverPt.v)} / 100
                      </text>
                      <text x="10" y="52" fill="#9ca3af" fontSize="11">
                        {summaryHoverPt.actual ? "Actual" : "Forecast"}
                      </text>
                    </g>
                  </g>
                )}
              </svg>
            </div>
          ) : (
            <div className="text-sm text-neutral-400">Not enough score history to chart.</div>
          )
        ) : (
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
        )}
      </div>

      {/* Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <FSCard
          selected={summaryMode ? summarySelection.is : activeFS === "is"}
          onClick={() => handleCardClick("is")}
          block={result.details.is}
          score={statementScore("is")}
          label={FS_LABEL_FULL.is}
        />
        <FSCard
          selected={summaryMode ? summarySelection.bs : activeFS === "bs"}
          onClick={() => handleCardClick("bs")}
          block={result.details.bs}
          score={statementScore("bs")}
          label={FS_LABEL_FULL.bs}
        />
        <FSCard
          selected={summaryMode ? summarySelection.cfs : activeFS === "cfs"}
          onClick={() => handleCardClick("cfs")}
          block={result.details.cfs}
          score={statementScore("cfs")}
          label={FS_LABEL_FULL.cfs}
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
                    <div className="text-xs uppercase tracking-wide text-white font-semibold mb-2">{group.title}</div>
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
