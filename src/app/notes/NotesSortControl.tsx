"use client";

import { useState } from "react";

export type NotesTimeframe = "1W" | "1M" | "6M" | "1Y" | "All";
export type NotesSourceFilter = "following" | "mine" | "friends";

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
const SOURCE_OPTIONS: { value: NotesSourceFilter; label: string }[] = [
  { value: "following", label: "Following" },
  { value: "mine", label: "My posts" },
  { value: "friends", label: "Friends" },
];

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
        Sort / Filter
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-72 rounded-xl border border-neutral-700 bg-neutral-900 p-4 text-sm shadow-xl space-y-4 z-10">
          <div>
            <h3 className="text-xs uppercase tracking-widest text-neutral-400 mb-2">
              Timeframe
            </h3>
            <div className="flex flex-wrap gap-2">
              {TIMEFRAME_OPTIONS.map((opt) => (
                <button
                  key={opt}
                  type="button"
                  onClick={() => onTimeframeChange(opt)}
                  className={`px-3 py-1.5 rounded-full border text-xs font-semibold ${
                    timeframe === opt
                      ? "bg-white text-black border-white"
                      : "border-neutral-600 text-neutral-300 hover:border-[var(--highlight-400)]"
                  }`}
                >
                  {opt}
                </button>
              ))}
            </div>
          </div>

          <div>
            <h3 className="text-xs uppercase tracking-widest text-neutral-400 mb-2">
              Posts from
            </h3>
            <div className="grid grid-cols-3 gap-2">
              {SOURCE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => onSourceChange(opt.value)}
                  className={`rounded-lg border px-2 py-1 text-xs font-medium ${
                    source === opt.value
                      ? "border-white text-white"
                      : "border-neutral-600 text-neutral-300 hover:border-[var(--highlight-400)]"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <h3 className="text-xs uppercase tracking-widest text-neutral-400 mb-2">
              Tickers (comma separated)
            </h3>
            <input
              type="text"
              value={tickers}
              onChange={(e) => onTickersChange(e.target.value)}
              placeholder="e.g. AAPL, NVDA"
              className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-500 focus:outline-none focus:ring-1 focus:ring-[var(--highlight-400)]"
            />
            <div className="mt-3 space-y-2 text-xs text-neutral-300">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={includeWatchlist}
                  onChange={(e) => onIncludeWatchlistChange(e.target.checked)}
                  className="h-4 w-4 rounded border border-neutral-600 bg-neutral-900 text-[var(--highlight-400)] focus:ring-[var(--highlight-400)]"
                />
                Only show tickers in my Watchlist
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={includePortfolio}
                  onChange={(e) => onIncludePortfolioChange(e.target.checked)}
                  className="h-4 w-4 rounded border border-neutral-600 bg-neutral-900 text-[var(--highlight-400)] focus:ring-[var(--highlight-400)]"
                />
                Only show tickers in my Portfolio
              </label>
            </div>
          </div>

          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-lg border border-neutral-600 px-3 py-1 text-xs text-neutral-200 hover:border-white"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
