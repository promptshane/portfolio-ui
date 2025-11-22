// src/app/analysis/page.tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Header from "../components/header";
import {
  EvalResult,
  FSKind,
  IndicKey,
  RangeKey,
} from "./shared";
import MomentumDisplay from "./sections/MomentumDisplay";
import FinancialDisplay from "./sections/FinancialDisplay";
import FTVDisplay from "./sections/FTVDisplay";
import { evaluateStock } from "./calc/momentumCalc";
import TickerNewsSection from "./sections/TickerNewsSection";

export default function AnalysisPage() {
  const [ticker, setTicker] = useState("");
  const [result, setResult] = useState<EvalResult | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [statusMsg, setStatusMsg] = useState<null | { kind: "error" | "info"; text: string }>(
    null
  );

  const [range, setRange] = useState<RangeKey>("6M");
  const [activeFS, setActiveFS] = useState<FSKind>("is");

  const [indicSelected, setIndicSelected] = useState<Record<IndicKey, boolean>>({
    band: false,
    rsi: false,
    macd: false,
  });
  const [deriv1Selected, setDeriv1Selected] = useState<Record<IndicKey, boolean>>({
    band: false,
    rsi: false,
    macd: false,
  });
  const [deriv2Selected, setDeriv2Selected] = useState<Record<IndicKey, boolean>>({
    band: false,
    rsi: false,
    macd: false,
  });

  const [useReal, setUseReal] = useState(true);

  // Watchlist state
  const [watchlistSyms, setWatchlistSyms] = useState<string[]>([]);
  const [watchlistUpdating, setWatchlistUpdating] = useState(false);

  const normalizedTicker = ticker.trim().toUpperCase();
  const runEvaluation = useCallback(
    async (symIn: string) => {
      const sym = symIn.trim().toUpperCase();
      if (!sym) {
        setStatusMsg({ kind: "info", text: "Enter a ticker symbol to evaluate." });
        setResult(null);
        return;
      }
      setSubmitting(true);
      setStatusMsg(null);
      try {
        const res = await evaluateStock(sym, useReal);
        setResult(res);
      } catch (err) {
        console.error("Failed to evaluate ticker", err);
        setResult(null);
        const raw = err instanceof Error ? err.message || "" : "";
        const friendly = raw.toLowerCase().includes("not enough history")
          ? `No data available for ${sym}. Try another ticker.`
          : `Could not load data for ${sym}. Please try again.`;
        setStatusMsg({ kind: "error", text: friendly });
      } finally {
        setSubmitting(false);
        setActiveFS("is");
        setIndicSelected({ band: false, rsi: false, macd: false });
        setDeriv1Selected({ band: false, rsi: false, macd: false });
        setDeriv2Selected({ band: false, rsi: false, macd: false });
      }
    },
    [useReal]
  );

  const onEvaluate = async () => {
    await runEvaluation(normalizedTicker);
  };

  useEffect(() => {
    setStatusMsg(null);
  }, [ticker]);

  // Load watchlist on mount
  useEffect(() => {
    let aborted = false;

    async function loadWatchlist() {
      try {
        const res = await fetch("/api/watchlist", { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        if (aborted) return;
        const items: any[] = Array.isArray(data?.items) ? data.items : [];
        const syms = items
          .map((it) =>
            typeof it?.sym === "string" ? it.sym.trim().toUpperCase() : ""
          )
          .filter(Boolean);
        setWatchlistSyms(syms);
      } catch {
        // ignore
      }
    }

    loadWatchlist();
    return () => {
      aborted = true;
    };
  }, []);

  async function syncWatchlist(nextSyms: string[]) {
    setWatchlistUpdating(true);
    try {
      const body = {
        items: nextSyms.map((sym) => ({ sym })),
      };
      const res = await fetch("/api/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) return;
      setWatchlistSyms(nextSyms);
    } catch {
      // ignore; keep prior local state
    } finally {
      setWatchlistUpdating(false);
    }
  }

  const isInWatchlist =
    !!normalizedTicker && watchlistSyms.includes(normalizedTicker);

  const showWatchlistButton =
    !!result && result.sym?.toUpperCase() === normalizedTicker;

  const handleAddToWatchlist = async () => {
    if (!normalizedTicker) return;
    const next = Array.from(new Set([...watchlistSyms, normalizedTicker]));
    await syncWatchlist(next);
  };

  const handleRemoveFromWatchlist = async () => {
    if (!normalizedTicker) return;
    const next = watchlistSyms.filter((s) => s !== normalizedTicker);
    await syncWatchlist(next);
  };

  // NEW: read ?ticker= from URL and auto-run evaluation as if user entered it
  const searchParams = useSearchParams();
  useEffect(() => {
    const param = searchParams.get("ticker");
    if (!param) return;
    const sym = param.trim().toUpperCase();
    if (!sym) return;

    setTicker(sym);
    void runEvaluation(sym);
  }, [searchParams, runEvaluation]);

  return (
    <main className="min-h-screen bg-neutral-900 text-white px-6 py-8">
      <div className="relative">
        <Header title="Analysis" />
        <button
          onClick={() => setUseReal((v) => !v)}
          className={`absolute right-0 top-1.5 px-3 py-1.5 rounded-md text-xs border ${
            useReal
              ? "border-[var(--good-500)] text-[var(--good-300)] bg-[color:var(--good-500)/0.1]"
              : "border-neutral-600 text-neutral-300 bg-black/30"
          }`}
          title="Toggle between live FMP-backed data and mock data"
        >
          Real data: {useReal ? "ON" : "OFF"}
        </button>
      </div>

      {/* Input */}
      <div className="bg-neutral-800 rounded-2xl p-6 border border-neutral-700 space-y-4">
        <div className="flex gap-3 items-center flex-nowrap">
          <input
            className="px-3 py-2 rounded-lg bg-black/90 border border-neutral-700 uppercase flex-1"
            placeholder="Ticker (e.g., MSFT)"
            value={ticker}
            onChange={(e) => setTicker(e.target.value.toUpperCase())}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (!submitting) {
                  void onEvaluate();
                }
              }
            }}
          />

          {showWatchlistButton ? (
            <button
              onClick={
                isInWatchlist
                  ? handleRemoveFromWatchlist
                  : handleAddToWatchlist
              }
              disabled={watchlistUpdating}
              className={`px-4 py-2 rounded-lg text-sm border bg-black/30 disabled:opacity-50 shrink-0 transition-colors ${
                isInWatchlist
                  ? "border-[var(--bad-500)] text-[var(--bad-300)] hover:border-[var(--bad-300)]"
                  : "border-[var(--good-500)] text-[var(--good-300)] hover:border-[var(--good-300)]"
              }`}
            >
              {watchlistUpdating
                ? "…"
                : isInWatchlist
                ? "Remove from Watchlist"
                : "Add to Watchlist"}
            </button>
          ) : (
            <button
              onClick={onEvaluate}
              disabled={submitting}
              className="px-4 py-2 rounded-lg bg-neutral-200 text-black hover:bg-white disabled:opacity-50 shrink-0"
            >
              {submitting ? "…" : "Evaluate"}
            </button>
          )}
        </div>
        {statusMsg && (
          <div
            className={`text-sm ${
              statusMsg.kind === "error" ? "text-red-400" : "text-neutral-300"
            }`}
          >
            {statusMsg.text}
          </div>
        )}
      </div>

      {/* Results */}
      {result && (
        <div className="mt-6 space-y-6">
          <MomentumDisplay
            result={result}
            range={range}
            setRange={setRange}
            indicSelected={indicSelected}
            setIndicSelected={setIndicSelected}
            deriv1Selected={deriv1Selected}
            setDeriv1Selected={setDeriv1Selected}
            deriv2Selected={deriv2Selected}
            setDeriv2Selected={setDeriv2Selected}
          />

          {/* Divider */}
          <div className="h-px bg-neutral-800" />

          <FinancialDisplay
            result={result}
            activeFS={activeFS}
            setActiveFS={setActiveFS}
          />

          {/* Divider */}
          <div className="h-px bg-neutral-800" />

          <FTVDisplay result={result} />

          {/* Divider */}
          <div className="h-px bg-neutral-800" />

          {/* Related News (by ticker) */}
          <TickerNewsSection symbol={ticker} />
        </div>
      )}
    </main>
  );
}
