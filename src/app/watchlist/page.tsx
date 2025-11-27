"use client";

import { useEffect, useMemo, useState } from "react";
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

type Item = { sym: string };
type Row = {
  sym: string;
  price: number | null;
  chg: number | null; // % change today
  fin: number | null;
  mom: number | null;
  fair: number | null;
  strength: number;
  stability: number;
};

const dotClass = (x: number) =>
  x >= 67 ? "bg-[var(--good-500)]" : x >= 34 ? "bg-[var(--mid-400)]" : "bg-[var(--bad-500)]";
const scoreDotClass = (value: number | null | undefined) =>
  value == null ? "bg-black" : dotClass(value);

type WatchlistApiItem = { sym?: string };
type WatchlistApiResponse = { items?: WatchlistApiItem[] };

export default function WatchlistPage() {
  const [notice, setNotice] = useState<string | null>(null);
  const [edit, setEdit] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const [draft, setDraft] = useState<Item[]>([]);
  const [newSym, setNewSym] = useState("");

  // Load watchlist
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/watchlist", { cache: "no-store" });
        const data: WatchlistApiResponse = await res.json();
        if (!cancelled && Array.isArray(data.items)) {
          setItems(data.items.map((x) => ({ sym: (x.sym || "").toUpperCase() })));
        }
      } catch {
        if (!cancelled) setNotice("Failed to load watchlist");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Enter/exit edit mode
  useEffect(() => {
    if (edit) {
      setDraft(items.map((x) => ({ ...x })));
      setNewSym("");
    }
  }, [edit, items]);

  const save = async (list: Item[]) => {
    try {
      const res = await fetch("/api/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: list }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const data: WatchlistApiResponse = await res.json();
      setItems((data.items || []).map((x) => ({ sym: (x.sym || "").toUpperCase() })));
      setNotice(null);
      return true;
    } catch {
      setNotice("Save failed");
      return false;
    }
  };

  const toggleEdit = async () => {
    if (edit) {
      const cleaned = draft
        .map((d) => ({ sym: (d.sym || "").toUpperCase().trim() }))
        .filter((d) => d.sym);
      setEdit(false);
      await save(cleaned);
    } else {
      setEdit(true);
    }
  };

  const symbols = useMemo(
    () =>
      Array.from(new Set(items.map((i) => (i.sym || "").toUpperCase().trim()).filter(Boolean))),
    [items]
  );
  const { quotes, loading: quotesLoading } = useQuotes(symbols);
  const [scores, setScores] = useState<Record<string, ScoreEntry>>({});

  const openAnalysis = (sym: string) => {
    const upper = sym.trim().toUpperCase();
    if (!upper) return;
    window.open(`/analysis?ticker=${encodeURIComponent(upper)}`, "_blank", "noopener,noreferrer");
  };

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
          const fairRaw = await fetchFtvDotScore(sym, typeof result.price === "number" ? result.price : null);
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

  const rows: Row[] = useMemo(() => {
    const template: Record<
      string,
      { fin: number; mom: number; fair: number; strength: number; stability: number }
    > = {};
    for (const s of symbols) {
      template[s] ??= { fin: 60, mom: 50, fair: 55, strength: 70, stability: 65 };
    }
    return symbols.map((sym) => {
      const q = quotes?.[sym];
      const sc = scores[sym];
      const price =
        typeof q?.price === "number" ? q.price : sc?.lastPrice ?? null;
      const chg =
        typeof q?.changesPercentage === "number"
          ? q.changesPercentage
          : sc?.changePct ?? null;
      const t = template[sym]!;
      return {
        sym,
        price,
        chg,
        fin: sc?.fin ?? null,
        mom: sc?.mom ?? null,
        fair: sc?.fair ?? null,
        strength: t.strength,
        stability: t.stability,
      };
    });
  }, [symbols, quotes, scores]);

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

  return (
    <main className="min-h-screen bg-neutral-900 text-white px-6 py-8">
      <Header
        title="Watchlist"
        onRightButtonClick={toggleEdit}
        rightButtonLabel={edit ? "Save" : "Edit"}
        rightActive={edit}
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

      {/* header row */}
      {!edit && (
        <div className="grid grid-cols-12 text-gray-400 text-xs mb-2 px-2">
          <div className="col-span-3 text-left">Stock</div>
          <div className="col-span-2 text-center">Price</div>
          <div className="col-span-2 text-center">Daily Change</div>

          <div className="col-span-3 text-center border-l border-neutral-700/40">
            <div className="grid grid-cols-3">
              <span>Financial</span>
              <span>Fair Value</span>
              <span>Momentum</span>
            </div>
          </div>

          <div className="col-span-1 text-center border-l border-neutral-700/40">Strength</div>
          <div className="col-span-1 text-center">Stability</div>
        </div>
      )}

      {/* rows */}
      {!edit && (
        <div className="space-y-3">
          {rows.map((r) => (
            <div
              key={r.sym}
              className="grid grid-cols-12 items-center bg-neutral-825 rounded-2xl py-3 px-4 border border-neutral-800"
            >
              <div className="col-span-3">
                <button
                  type="button"
                  onClick={() => openAnalysis(r.sym)}
                  className="px-3 py-1.5 rounded-lg bg-black/90 border border-neutral-700 font-semibold tracking-wide hover:border-[var(--good-500)] focus-visible:border-[var(--good-500)] focus-visible:outline-none transition-colors"
                >
                  {r.sym}
                </button>
              </div>

              <div className="col-span-2 text-center">
                <span className="inline-flex w-[110px] justify-center px-2 py-1.5 text-sm font-medium">
                  {r.price != null ? `$${r.price.toFixed(2)}` : "—"}
                </span>
              </div>

              <div className="col-span-2 text-center">
                <span
                  className={`inline-flex w-[150px] justify-center px-2 py-1.5 text-sm font-medium ${
                    r.chg == null
                      ? "text-neutral-400"
                      : r.chg >= 0
                      ? "text-[var(--good-400)]"
                      : "text-[var(--bad-400)]"
                  }`}
                >
                  {r.chg == null
                    ? "—"
                    : r.chg >= 0
                    ? `(+${r.chg.toFixed(2)}%)`
                    : `(${r.chg.toFixed(2)}%)`}
                </span>
              </div>

              <div className="col-span-3 border-l border-neutral-700/40">
                <div className="grid grid-cols-3 place-items-center">
                  <div className={`w-5 h-5 rounded-full ${scoreDotClass(r.fin)} border border-neutral-700 shadow-[0_0_0_3px_rgba(0,0,0,0.35)]`} />
                  <div className={`w-5 h-5 rounded-full ${scoreDotClass(r.fair)} border border-neutral-700 shadow-[0_0_0_3px_rgba(0,0,0,0.35)]`} />
                  <div className={`w-5 h-5 rounded-full ${scoreDotClass(r.mom)} border border-neutral-700 shadow-[0_0_0_3px_rgba(0,0,0,0.35)]`} />
                </div>
              </div>

              <div className="col-span-1 text-center border-l border-neutral-700/40">
                <span
                  className="px-2.5 py-1 rounded-xl text-sm border border-neutral-700 text-neutral-400"
                >
                  X
                </span>
              </div>
              <div className="col-span-1 text-center">
                <span
                  className="px-2.5 py-1 rounded-xl text-sm border border-neutral-700 text-neutral-400"
                >
                  Y
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* edit mode */}
      {edit && (
        <div className="space-y-3">
          <div className="grid grid-cols-12 text-gray-400 text-xs mb-2 px-2">
            <div className="col-span-8 text-left">Ticker</div>
            <div className="col-span-4 text-right">Actions</div>
          </div>

          <div className="grid grid-cols-12 gap-3 items-center bg-neutral-825 rounded-2xl py-3 px-4 border border-neutral-800">
            <div className="col-span-8">
              <input
                className="w-full px-3 py-2 rounded-lg bg-black/90 border border-neutral-700 uppercase"
                placeholder="Ticker (e.g., AAPL)"
                value={newSym}
                onChange={(e) => setNewSym(e.target.value.toUpperCase())}
              />
            </div>
            <div className="col-span-4 flex justify-end">
              <button
                onClick={() => {
                  const sym = newSym.toUpperCase().trim();
                  if (!sym) return;
                  setDraft((prev) => (prev.find((x) => x.sym === sym) ? prev : [...prev, { sym }]));
                  setNewSym("");
                }}
                className="px-3 py-2 rounded-lg border hover:brightness-110"
                style={{ backgroundColor: "var(--good-500)", borderColor: "var(--good-500)" }}
              >
                Add
              </button>
            </div>
          </div>

          {draft.map((h, idx) => (
            <div
              key={h.sym + idx}
              className="grid grid-cols-12 gap-3 items-center bg-neutral-825 rounded-2xl py-3 px-4 border border-neutral-800"
            >
              <div className="col-span-8">
                <input
                  className="w-full px-3 py-2 rounded-lg bg-black/90 border border-neutral-700 uppercase"
                  value={h.sym}
                  onChange={(e) => {
                    const value = e.target.value.toUpperCase();
                    setDraft((prev) => {
                      const next = [...prev];
                      next[idx] = { ...next[idx], sym: value };
                      return next;
                    });
                  }}
                />
              </div>
              <div className="col-span-4 flex justify-end">
                <button
                  onClick={() => setDraft((prev) => prev.filter((x) => x.sym !== h.sym))}
                  className="px-3 py-2 rounded-lg border hover:brightness-110"
                  style={{ backgroundColor: "var(--bad-500)", borderColor: "var(--bad-500)" }}
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
