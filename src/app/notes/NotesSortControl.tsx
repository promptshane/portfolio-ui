"use client";

import { useState } from "react";

export type NotesTimeframe = "1W" | "1M" | "6M" | "1Y" | "All";
export type NotesSourceFilter = "following" | "mine";

type NotesSortControlProps = {
  timeframe: NotesTimeframe;
  onTimeframeChange: (value: NotesTimeframe) => void;
  source: NotesSourceFilter;
  onSourceChange: (value: NotesSourceFilter) => void;
  tickers: string;
  onTickersChange: (value: string) => void;
  includeWatchlist: boolean;
  onIncludeWatchlistChange: (value: boolean) => void;
  includePortfolio: boolean;
  onIncludePortfolioChange: (value: boolean) => void;
};

const TIMEFRAME_OPTIONS: NotesTimeframe[] = ["1W", "1M", "6M", "1Y", "All"];
export default function NotesSortControl({
  timeframe,
  onTimeframeChange,
  source,
  onSourceChange,
  tickers,
  onTickersChange,
  includeWatchlist,
  onIncludeWatchlistChange,
  includePortfolio,
  onIncludePortfolioChange,
}: NotesSortControlProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        type="button"
        className="inline-flex items-center rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-sm font-medium text-neutral-100 hover:border-[var(--highlight-400)]"
        onClick={() => setOpen((prev) => !prev)}
      >
        Sort by
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-72 rounded-xl border border-neutral-700 bg-neutral-900/95 p-4 text-sm shadow-xl space-y-4 z-10">
          <div>
            <h3 className="text-[11px] uppercase tracking-wide text-neutral-500 mb-2">Timeframe</h3>
            <div className="flex flex-wrap gap-1.5">
              {TIMEFRAME_OPTIONS.map((opt) => (
                <button
                  key={opt}
                  type="button"
                  onClick={() => onTimeframeChange(opt)}
                  className={`rounded-md border px-2 py-1 text-[11px] ${
                    timeframe === opt
                      ? "border-[var(--highlight-400)] text-[var(--highlight-100)]"
                      : "border-neutral-700 text-neutral-300 hover:border-[var(--highlight-400)]"
                  }`}
                >
                  {opt}
                </button>
              ))}
            </div>
          </div>

          <div>
            <h3 className="text-[11px] uppercase tracking-wide text-neutral-500 mb-2">Posts from</h3>
            <div className="inline-flex rounded-md border border-neutral-700 bg-neutral-950 p-0.5">
              {[
                { key: "mine", label: "My posts" },
                { key: "following", label: "Following" },
              ].map((opt) => {
                const active = source === opt.key;
                return (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => onSourceChange(opt.key as NotesSourceFilter)}
                    className={`px-3 py-1 text-[11px] font-medium rounded ${
                      active
                        ? "bg-[var(--highlight-500)]/15 text-[var(--highlight-50)] border border-[var(--highlight-400)]"
                        : "text-neutral-300 border border-transparent hover:border-neutral-700"
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-1">
            <h3 className="text-[11px] uppercase tracking-wide text-neutral-500">Tickers</h3>
            <input
              type="text"
              value={tickers}
              onChange={(e) => onTickersChange(e.target.value.toUpperCase())}
              placeholder="e.g. AAPL, NVDA"
              className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-xs text-neutral-100 placeholder:text-neutral-500 focus:outline-none focus:border-[var(--highlight-400)]"
            />
            <p className="text-[10px] text-neutral-500">Uppercase tickers separated by commas or spaces.</p>
          </div>

          <div className="space-y-2">
            <h3 className="text-[11px] uppercase tracking-wide text-neutral-500">Mentions</h3>
            <label className="flex items-center gap-2 text-[11px] text-neutral-200">
              <input
                type="checkbox"
                checked={includeWatchlist}
                onChange={(e) => onIncludeWatchlistChange(e.target.checked)}
                className="h-3 w-3 rounded border-neutral-600 bg-neutral-900 accent-[var(--good-400)]"
              />
              Watchlist
            </label>
            <label className="flex items-center gap-2 text-[11px] text-neutral-200">
              <input
                type="checkbox"
                checked={includePortfolio}
                onChange={(e) => onIncludePortfolioChange(e.target.checked)}
                className="h-3 w-3 rounded border-neutral-600 bg-neutral-900 accent-[var(--good-400)]"
              />
              Portfolio
            </label>
          </div>

          <div className="flex justify-between items-center pt-1">
            <span className="text-[11px] text-neutral-500">Adjust filters</span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-lg border border-neutral-600 px-3 py-1 text-[11px] text-neutral-200 hover:border-[var(--highlight-400)] hover:text-[var(--highlight-100)]"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
