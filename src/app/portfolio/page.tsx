"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Header from "../components/header";
import { useQuotes } from "../hooks/useQuotes";
import { evaluateStock } from "../analysis/calc/momentumCalc";
import { computeMomentumCompositeScore } from "../analysis/calc/momentumSignals";
import {
  clampScore,
  extractFinancialScore,
  fetchFtvDotScore,
  type ScoreEntry,
} from "../analysis/calc/scoreDots";

import type { Holding, LineData, RangeKey } from "./types";
import { PRICES, TEMPLATE_METRICS } from "./constants";
import { usePortfolioSeries } from "./hooks/usePortfolioSeries";
import { buildSyntheticLine } from "./utils/synthetic";
import { computeAccount, computeDaily, computeRows } from "./utils/portfolio";
import { useAnimatedNumber } from "./hooks/useAnimatedNumber";
import { money } from "./utils/format";

import PortfolioChart from "./components/PortfolioChart";
import PositionsTable from "./components/PositionsTable/PositionsTable";
import EditHoldingsPanel from "./components/EditHoldingsPanel";

const RANGE_OPTIONS: RangeKey[] = ["1D", "1W", "1M", "3M", "6M", "YTD", "1Y", "2Y", "5Y"];
const RANGE_LABELS: Record<RangeKey, string> = {
  "1D": "Today",
  "1W": "1 Week",
  "1M": "1 Month",
  "3M": "3 Months",
  "6M": "6 Months",
  YTD: "Year to date",
  "1Y": "1 Year",
  "2Y": "2 Years",
  "5Y": "5 Years",
};

type AggregatedHistory = { dates: string[]; values: number[] };
type OwnerSummary = { id: number; username: string; preferredName?: string | null };

function aggregateHistory(holdings: Holding[], scores: Record<string, ScoreEntry>): AggregatedHistory | null {
  const map = new Map<string, number>();
  const sharesBySym = holdings.reduce<Record<string, number>>((acc, h) => {
    const sym = (h.sym || "").toUpperCase();
    if (!sym) return acc;
    acc[sym] = (acc[sym] || 0) + (Number(h.shares) || 0);
    return acc;
  }, {});

  for (const [sym, shares] of Object.entries(sharesBySym)) {
    if (!shares || !Number.isFinite(shares)) continue;
    const entry = scores[sym];
    if (!entry?.historyDates || !entry?.historyPrices) continue;
    const dates = entry.historyDates;
    const prices = entry.historyPrices;
    for (let i = 0; i < dates.length; i++) {
      const date = dates[i];
      const price = prices[i];
      if (!date || !Number.isFinite(price)) continue;
      const total = map.get(date) ?? 0;
      map.set(date, total + shares * (price as number));
    }
  }

  if (!map.size) return null;
  const dates = Array.from(map.keys()).sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
  const values = dates.map((d) => map.get(d) ?? 0);
  return { dates, values };
}

function rangeStartDate(range: RangeKey, end: Date) {
  const start = new Date(end);
  switch (range) {
    case "1W":
      start.setDate(start.getDate() - 7);
      break;
    case "1M":
      start.setMonth(start.getMonth() - 1);
      break;
    case "3M":
      start.setMonth(start.getMonth() - 3);
      break;
    case "6M":
      start.setMonth(start.getMonth() - 6);
      break;
    case "YTD":
      start.setMonth(0, 1);
      break;
    case "1Y":
      start.setFullYear(start.getFullYear() - 1);
      break;
    case "2Y":
      start.setFullYear(start.getFullYear() - 2);
      break;
    case "5Y":
      start.setFullYear(start.getFullYear() - 5);
      break;
    default:
      break;
  }
  return start;
}

function sliceHistory(history: AggregatedHistory | null, range: RangeKey): AggregatedHistory | null {
  if (!history || !history.dates.length) return null;
  if (range === "1D") return history;
  const endDate = new Date(history.dates[history.dates.length - 1]);
  const startDate = rangeStartDate(range, endDate);
  const startIso = startDate.toISOString().slice(0, 10);
  let startIdx = history.dates.findIndex((d) => d >= startIso);
  if (startIdx === -1) startIdx = Math.max(0, history.dates.length - 60);
  return {
    dates: history.dates.slice(startIdx),
    values: history.values.slice(startIdx),
  };
}

function buildLineFromHistory(history: AggregatedHistory | null): LineData | null {
  if (!history || !history.values.length) return null;
  const { dates, values } = history;
  if (!values.length) return null;
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (!isFinite(min) || !isFinite(max) || min === max) {
    min = values[values.length - 1] * 0.99;
    max = values[values.length - 1] * 1.01 || 1;
  }
  const points = values.map((v, i) => {
    const x = values.length === 1 ? 0 : i / (values.length - 1);
    const y = max === min ? 0.5 : 1 - (v - min) / (max - min);
    return [x, y] as [number, number];
  });
  const times = dates.map((d) => new Date(d));
  return { points, values, times, min, max };
}

export default function PortfolioPage() {
  const [owners, setOwners] = useState<OwnerSummary[]>([]);
  const [ownersLoading, setOwnersLoading] = useState(true);
  const [ownersError, setOwnersError] = useState<string | null>(null);
  const [selfOwnerId, setSelfOwnerId] = useState<number | null>(null);
  const [selectedOwnerId, setSelectedOwnerId] = useState<number | null>(null);
  const [ownerMenuOpen, setOwnerMenuOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [edit, setEdit] = useState(false);
  const [range, setRange] = useState<RangeKey>("1D");

  const [draft, setDraft] = useState<Holding[]>([]);
  const [newSym, setNewSym] = useState("");
  const [newShares, setNewShares] = useState<string>("");
  const [newAvg, setNewAvg] = useState<string>("");
  const [scores, setScores] = useState<Record<string, ScoreEntry>>({});
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [oneMonthInterval, setOneMonthInterval] = useState<"1h" | "1d">("1h");
  const [show1mMenu, setShow1mMenu] = useState(false);
  const oneMonthMenuRef = useRef<HTMLDivElement | null>(null);
  const ownerMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!ownerMenuOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (!ownerMenuRef.current?.contains(e.target as Node)) {
        setOwnerMenuOpen(false);
      }
    };
    document.addEventListener("pointerdown", handleClick);
    return () => document.removeEventListener("pointerdown", handleClick);
  }, [ownerMenuOpen]);

  useEffect(() => {
    if (owners.length <= 1 && ownerMenuOpen) {
      setOwnerMenuOpen(false);
    }
  }, [owners.length, ownerMenuOpen]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setOwnersLoading(true);
        setOwnersError(null);
        const res = await fetch("/api/oversee", { cache: "no-store", credentials: "include" });
        if (res.status === 401) {
          if (!cancelled) {
            setOwners([]);
            setSelfOwnerId(null);
            setSelectedOwnerId(null);
            setOwnersError("Please sign in to manage oversee accounts.");
          }
          return;
        }
        if (!res.ok) {
          throw new Error(`(${res.status})`);
        }
        const data = await res.json();
        if (cancelled) return;
        const list: OwnerSummary[] = [];
        if (data?.self) {
          list.push(data.self);
          setSelfOwnerId(data.self.id);
        }
        if (Array.isArray(data?.overseen)) {
          list.push(...data.overseen);
        }
        setOwners(list);
        setSelectedOwnerId((prev) => {
          if (prev && list.some((o) => o.id === prev)) {
            return prev;
          }
          return data?.self?.id ?? list[0]?.id ?? null;
        });
      } catch (err) {
        console.error("Failed to load oversee accounts", err);
        if (!cancelled) setOwnersError("Failed to load oversee accounts.");
      } finally {
        if (!cancelled) setOwnersLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setScores({});
  }, [selectedOwnerId]);

  // Load persisted holdings
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setNotice(null);
        const url =
          selectedOwnerId != null ? `/api/portfolio?ownerId=${selectedOwnerId}` : "/api/portfolio";
        const res = await fetch(url, { cache: "no-store", credentials: "include" });
        if (!res.ok) {
          setNotice(`Load failed (${res.status})`);
          return;
        }
        const data = (await res.json()) as { items: Holding[] };
        if (!cancelled) {
          const normalized = Array.isArray(data.items)
            ? data.items.map((i) => ({
                sym: (i.sym || "").toUpperCase(),
                shares: Number(i.shares) || 0,
                avgCost: Number(i.avgCost) || 0,
              }))
            : [];
          setHoldings(normalized);
        }
      } catch {
        if (!cancelled) setNotice("Load failed (500)");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedOwnerId]);

  // Quotes
  const symbols = useMemo(
    () =>
      Array.from(
        new Set(
          holdings
            .map((h) => (h.sym || "").toUpperCase().trim())
            .filter(Boolean)
        )
      ),
    [holdings]
  );
  const { quotes, loading: quotesLoading } = useQuotes(symbols);

  useEffect(() => {
    let cancelled = false;
    const pending = symbols
      .map((s) => s?.trim().toUpperCase())
      .filter((s): s is string => !!s && scores[s] === undefined);
    if (!pending.length) return;

    (async () => {
      for (const sym of pending) {
        try {
          const result = await evaluateStock(sym, true);
          if (cancelled) return;
          const momScore = clampScore(computeMomentumCompositeScore(result));
          const finScore = clampScore(extractFinancialScore(result));
          const fairRaw = await fetchFtvDotScore(
            sym,
            typeof result.price === "number" ? result.price : null
          );
          if (cancelled) return;
          setScores((prev) => ({
            ...prev,
            [sym]: {
              fin: finScore,
              mom: momScore,
              fair: clampScore(fairRaw),
              lastPrice: Number.isFinite(result.price) ? result.price : null,
              changePct: Number.isFinite(result.changePct) ? result.changePct : null,
              historyDates: Array.isArray(result.series?.dates) ? result.series.dates : [],
              historyPrices: Array.isArray(result.series?.price) ? result.series.price : [],
            },
          }));
        } catch {
          if (!cancelled) {
            setScores((prev) => ({
              ...prev,
              [sym]: { fin: null, mom: null, fair: null, lastPrice: null, changePct: null },
            }));
          }
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [symbols, scores]);

  // Draft handling
  useEffect(() => {
    if (edit) {
      setDraft(holdings.map((h) => ({ ...h })));
      setNewSym("");
      setNewShares("");
      setNewAvg("");
    }
  }, [edit, holdings]);

  // Account & daily
  const account = useMemo(() => computeAccount(holdings, quotes, PRICES), [holdings, quotes]);
  const daily = useMemo(() => computeDaily(account.positions, quotes), [account.positions, quotes]);

  const usesHourlyIntraday = range === "1W" || (range === "1M" && oneMonthInterval === "1h");
  const intervalForRange = range === "1D" ? "5min" : usesHourlyIntraday ? "1hour" : "5min";
  const rangeHintForSeries: "1D" | "1W" | "1M" =
    range === "1W" ? "1W" : range === "1M" && usesHourlyIntraday ? "1M" : "1D";

  // Series (real) and synthetic fallback
  const { series, realLine, bySymbol, error: seriesError } = usePortfolioSeries(holdings, {
    interval: intervalForRange,
    range: rangeHintForSeries,
  });
  const syntheticLine = useMemo(
    () => buildSyntheticLine(account, quotes, symbols, holdings.length),
    [account, quotes, symbols, holdings.length]
  );
  const intradayLine = realLine ?? syntheticLine;
  const aggregatedHistory = useMemo(
    () => aggregateHistory(holdings, scores),
    [holdings, scores]
  );
  const historyLine = useMemo(() => {
    if (range === "1D") return null;
    const sliced = sliceHistory(aggregatedHistory, range);
    return buildLineFromHistory(sliced);
  }, [aggregatedHistory, range]);
  const chartLine =
    range === "1D" || usesHourlyIntraday ? intradayLine : historyLine ?? intradayLine;
  const preferHistoryPrices =
    range !== "1D" && !usesHourlyIntraday && Boolean(historyLine && historyLine.values.length);
  const historyRangeStart = preferHistoryPrices ? historyLine?.times?.[0] ?? null : null;

  // Hover selection index (default to last point; chart will keep it snapped)
  useEffect(() => {
    setHoverIdx(null);
  }, [range]);

  useEffect(() => {
    if (range !== "1M") setShow1mMenu(false);
  }, [range]);

  useEffect(() => {
    if (!show1mMenu) return undefined;
    const handleClick = (evt: MouseEvent) => {
      if (!oneMonthMenuRef.current) return;
      if (!oneMonthMenuRef.current.contains(evt.target as Node)) {
        setShow1mMenu(false);
      }
    };
    window.addEventListener("mousedown", handleClick);
    return () => window.removeEventListener("mousedown", handleClick);
  }, [show1mMenu]);

  // Selection-derived totals
  const fallbackIdx = Math.max(0, chartLine.values.length - 1);
  const chartIdx =
    hoverIdx != null ? Math.max(0, Math.min(hoverIdx, chartLine.values.length - 1)) : fallbackIdx;
  const dayStartAbs = chartLine.isRelative ? (chartLine.baseline ?? 0) : (chartLine.values[0] ?? account.totalValue);
  const selectedAbs = chartLine.values.length
    ? (chartLine.isRelative
        ? (chartLine.baseline ?? 0) + (chartLine.values[chartIdx] ?? 0)
        : (chartLine.values[chartIdx] ?? account.totalValue))
    : account.totalValue;

  const rangeDeltaAbs = selectedAbs - dayStartAbs;
  const rangeDeltaPct = dayStartAbs ? (rangeDeltaAbs / dayStartAbs) * 100 : 0;

  const animatedTotal = useAnimatedNumber(selectedAbs, 180);
  const rangeDescriptor = RANGE_LABELS[range] ?? range;
  const selectedOwner = owners.find((o) => o.id === selectedOwnerId) || null;
  const ownerName = selectedOwner?.preferredName?.trim() || selectedOwner?.username || "Portfolio";
  const accountLabel = `${ownerName}'s Account`;

  const handleChartIndexChange = (value: number | null) => {
    if (value == null) {
      setHoverIdx(null);
      return;
    }
    const clamped = Math.max(0, Math.min(value, chartLine.values.length - 1));
    setHoverIdx(clamped);
  };

  const seriesPointCount = series?.times?.length ?? 0;
  const seriesIdx =
    seriesPointCount > 0
      ? hoverIdx != null
        ? Math.max(0, Math.min(hoverIdx, seriesPointCount - 1))
        : seriesPointCount - 1
      : null;

  // Rows aligned to hovered time
  const selectedDate = chartLine.times?.[chartIdx] ?? null;
  const rows = useMemo(
    () =>
      computeRows(
        account.positions,
        seriesIdx,
        quotes,
        preferHistoryPrices ? undefined : bySymbol,
        TEMPLATE_METRICS,
        selectedDate,
        scores,
        {
          rangeStartDate: historyRangeStart,
          preferHistory: preferHistoryPrices,
        }
      ),
    [
      account.positions,
      seriesIdx,
      quotes,
      bySymbol,
      selectedDate,
      scores,
      preferHistoryPrices,
      historyRangeStart,
    ]
  );

  const symbolsLoaded = useMemo(
    () => symbols.filter((s) => scores[s] !== undefined).length,
    [scores, symbols]
  );
  const tickerStatusText =
    symbols.length === 0
      ? null
      : quotesLoading || symbolsLoaded < symbols.length
      ? "Loading…"
      : `${symbolsLoaded} Tickers Loaded`;

  // Save holdings
  async function saveToServer(list: Holding[]) {
    try {
      const res = await fetch("/api/portfolio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: list,
          ownerId: selectedOwnerId ?? undefined,
        }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        setNotice(`Save failed (${res.status}) ${text ? `(${text})` : ""}`);
        return false;
      }
      setNotice(null);
      return true;
    } catch {
      setNotice("Save failed (500)");
      return false;
    }
  }
  const canEdit = selectedOwnerId != null;

  const toggleEdit = async () => {
    if (edit) {
      const cleaned = draft
        .filter((d) => d.sym && d.shares > 0)
        .map((d) => ({ ...d, sym: d.sym.toUpperCase() }));
      setHoldings(cleaned);
      await saveToServer(cleaned);
      setEdit(false);
    } else {
      setEdit(true);
    }
  };
  useEffect(() => {
    if (!canEdit && edit) {
      setEdit(false);
    }
  }, [canEdit, edit]);
  const handleToggleEdit = async () => {
    if (!canEdit) return;
    await toggleEdit();
  };

  return (
    <main className="min-h-screen bg-neutral-900 text-white px-6 py-8">
      <Header
        title="Portfolio"
        rightSlot={
          canEdit ? (
            <button
              onClick={handleToggleEdit}
              className={`px-3 py-2 rounded-lg border ${
                edit
                  ? "bg-[var(--good-500)] border-[var(--good-500)] hover:brightness-110"
                  : "bg-black/90 border-neutral-700 hover:border-neutral-600"
              }`}
              disabled={!selectedOwnerId}
            >
              {edit ? "Save" : "Edit"}
            </button>
          ) : (
            <span className="px-3 py-2 rounded-lg border border-neutral-700 text-xs text-neutral-400">
              Loading…
            </span>
          )
        }
      />

      {notice && (
        <div
          className="mb-4 rounded-md border px-4 py-2 text-sm"
          style={{
            backgroundColor: "color-mix(in srgb, var(--bad-500) 15%, transparent)",
            borderColor: "var(--bad-500)",
          }}
        >
          {notice}
        </div>
      )}

      {tickerStatusText && (
        <div className="mb-4 rounded-2xl border border-neutral-800 bg-neutral-825 p-4 text-sm text-neutral-300">
          {tickerStatusText}
        </div>
      )}

      <section className="mb-8">
        <div className="bg-neutral-825 border border-neutral-800 rounded-3xl p-6 sm:p-8 shadow space-y-6">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="text-sm uppercase tracking-widest text-neutral-400">
                {accountLabel}
              </div>
              {owners.length > 1 && (
                <div className="relative" ref={ownerMenuRef}>
                  <button
                    type="button"
                    onClick={() => setOwnerMenuOpen((prev) => !prev)}
                    disabled={ownersLoading}
                    className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] uppercase tracking-wide focus:outline-none ${
                      ownersLoading
                        ? "border-neutral-700 text-neutral-500 cursor-not-allowed"
                        : "border-neutral-600 text-neutral-200 hover:border-[var(--highlight-400)]"
                    }`}
                  >
                    <span className={`transition ${ownerMenuOpen ? "rotate-180" : ""}`}>▾</span>
                  </button>
                  {ownerMenuOpen && (
                    <div className="absolute right-0 mt-2 w-52 rounded-xl border border-neutral-700 bg-neutral-900 shadow-xl z-10">
                      {owners.map((owner) => {
                        const activeOwner = owner.id === selectedOwnerId;
                        return (
                          <button
                            key={owner.id}
                            type="button"
                            onClick={() => {
                              setSelectedOwnerId(owner.id);
                              setOwnerMenuOpen(false);
                            }}
                            className={`block w-full text-left px-3 py-2 text-sm ${
                              activeOwner
                                ? "text-white bg-neutral-800"
                                : "text-neutral-300 hover:bg-neutral-800"
                            }`}
                          >
                            {owner.preferredName?.trim() || owner.username}
                            {owner.id === selfOwnerId && (
                              <span className="ml-2 text-xs text-neutral-500">(You)</span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
            {ownersError && (
              <div className="text-xs text-red-400">{ownersError}</div>
            )}
            <div className="text-4xl sm:text-5xl font-extrabold tracking-tight leading-tight">
              ${Math.round(animatedTotal).toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </div>
            <div
              className={`text-base sm:text-lg font-semibold ${
                rangeDeltaAbs >= 0 ? "text-[var(--good-400)]" : "text-[var(--bad-400)]"
              }`}
            >
              {rangeDeltaAbs >= 0 ? "+" : "-"}
              {money(rangeDeltaAbs)} ({rangeDeltaPct.toFixed(2)}%){" "}
              <span className="ml-2 text-sm font-normal text-neutral-400">
                Selected {rangeDescriptor}
              </span>
            </div>
          </div>

          <div className="relative w-full">
            <div className="h-[320px] sm:h-[360px]">
              <PortfolioChart
                line={chartLine}
                range={range}
                oneMonthInterval={oneMonthInterval}
                seriesError={seriesError}
                fallbackChangePct={daily.changePct}
                onIndexChange={handleChartIndexChange}
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-2">
            {RANGE_OPTIONS.map((opt) => {
              const active = range === opt;
              const baseClasses = `px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                active
                  ? "bg-white text-black border-white"
                  : "border-neutral-600 text-neutral-300 hover:border-[var(--good-500)]"
              }`;

              if (opt === "1M") {
                return (
                  <div key={opt} className="relative" ref={oneMonthMenuRef}>
                    <button type="button" onClick={() => setRange(opt)} className={baseClasses}>
                      <span>{opt}</span>
                      {active && (
                        <span className="ml-2 text-[10px] uppercase tracking-wide text-neutral-700">
                          {oneMonthInterval === "1h" ? "1h" : "1d"}
                        </span>
                      )}
                    </button>
                    {active && (
                      <>
                        <button
                          type="button"
                          onClick={() => setShow1mMenu((v) => !v)}
                          className="absolute -right-2 -top-2 w-5 h-5 rounded-full bg-neutral-800 border border-neutral-600 text-[10px] text-neutral-300"
                          title="Choose 1M interval"
                        >
                          ▾
                        </button>
                        {show1mMenu && (
                          <div className="absolute right-0 mt-2 min-w-[140px] rounded-xl border border-neutral-700 bg-neutral-900 shadow-xl z-10">
                            {(["1h", "1d"] as const).map((optInterval) => (
                              <button
                                key={optInterval}
                                type="button"
                                onClick={() => {
                                  setOneMonthInterval(optInterval);
                                  setShow1mMenu(false);
                                }}
                                className={`block w-full px-4 py-2 text-left text-sm ${
                                  oneMonthInterval === optInterval ? "text-white" : "text-neutral-300"
                                } hover:bg-neutral-800`}
                              >
                                {optInterval === "1h" ? "1 Hour bars" : "1 Day bars"}
                              </button>
                            ))}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                );
              }

              return (
                <button
                  key={opt}
                  type="button"
                  onClick={() => setRange(opt)}
                  className={baseClasses}
                >
                  {opt}
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {/* Table vs Edit */}
      {!edit ? (
        <>
          <PositionsTable rows={rows} />
        </>
      ) : (
        <EditHoldingsPanel
          draft={draft}
          setDraft={setDraft}
          newSym={newSym}
          setNewSym={setNewSym}
          newShares={newShares}
          setNewShares={setNewShares}
          newAvg={newAvg}
          setNewAvg={setNewAvg}
        />
      )}
    </main>
  );
}
