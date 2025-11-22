// src/app/crypto/page.tsx
"use client";

import { useState } from "react";
import Header from "../components/header";

// Reuse analysis types + components to move fast (no duplication yet)
import { EvalResult, RangeKey, IndicKey } from "../analysis/shared";
import MomentumDisplay from "../analysis/sections/MomentumDisplay";
import { evaluateStock } from "../analysis/calc/momentumCalc";

export default function CryptoPage() {
  const [ticker, setTicker] = useState("BTCUSD");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Momentum UI state (mirrors Analysis page)
  const [range, setRange] = useState<RangeKey>("6M");
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

  const [result, setResult] = useState<EvalResult | null>(null);

  const onEvaluate = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const sym = ticker.trim().toUpperCase();
      if (!sym) throw new Error("Enter a symbol (e.g., BTCUSD)");
      // Phase 1: mock data so we can stand up the UI quickly.
      // Later we’ll switch to real crypto history (same API shape).
      const evalRes = await evaluateStock(sym, /* useReal */ false);
      setResult(evalRes);
    } catch (e: any) {
      setError(e?.message ?? "Failed to evaluate symbol");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="min-h-screen bg-neutral-900 text-white px-6 py-8">
      <Header title="Crypto" />

      {/* Input */}
      <div className="bg-neutral-800 rounded-2xl p-6 border border-neutral-700 space-y-4">
        <div className="flex gap-3 items-center flex-nowrap">
          <input
            className="px-3 py-2 rounded-lg bg-black/90 border border-neutral-700 uppercase flex-1"
            placeholder="Ticker (e.g., BTCUSD)"
            value={ticker}
            onChange={(e) => setTicker(e.target.value.toUpperCase())}
          />
          <button
            onClick={onEvaluate}
            disabled={submitting}
            className="px-4 py-2 rounded-lg bg-neutral-200 text-black hover:bg-white disabled:opacity-50 shrink-0"
          >
            {submitting ? "…" : "Evaluate"}
          </button>
        </div>
        {error && (
          <div className="text-red-400 text-sm">
            {error}
          </div>
        )}
      </div>

      {/* Momentum (same look as Analysis) */}
      {result && (
        <div className="mt-6 bg-neutral-800 rounded-2xl border border-neutral-800/60 overflow-hidden">
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
        </div>
      )}
    </main>
  );
}
