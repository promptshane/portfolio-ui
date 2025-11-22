// src/app/news/NewsArticleCard.tsx
"use client";

import React from "react";
import type { NewsItem, QaUIState } from "./types";
import { formatDateTime, decorateTextWithTickers } from "./utils";

type NewsArticleCardProps = {
  item: NewsItem;
  open: boolean;
  qaState: QaUIState;

  // Called when the row header is clicked (handles openId + markViewed in parent)
  onToggleOpen: () => void;

  // Q&A handlers (parent owns state & API calls)
  onToggleQa: () => void;
  onUpdateQaInput: (value: string) => void;
  onAddQaQuestion: () => void;
  onGetQaAnswers: () => void;
  onDeleteQaEntry: (questionId: string) => void;

  // Download handler (parent handles actual URL/open)
  onDownload: () => void;

  // Optional: open the repost panel for this article
  onOpenRepost?: (item: NewsItem) => void;
};

export default function NewsArticleCard({
  item,
  open,
  qaState,
  onToggleOpen,
  onToggleQa,
  onUpdateQaInput,
  onAddQaQuestion,
  onGetQaAnswers,
  onDeleteQaEntry,
  onDownload,
  onOpenRepost,
}: NewsArticleCardProps) {
  const qaOpen = qaState.open;

  const totalEntries = qaState.entries.length;
  const displayedEntries =
    totalEntries > 0 ? qaState.entries.slice().reverse() : [];

  const hasUnanswered = qaState.entries.some(
    (entry) => !entry.answer || !entry.answer.trim()
  );

  const isRead = !!item.viewed;
  const hasAttentionTicker = !!(item.hasPortfolioTicker || item.hasWatchlistTicker);

  // Build a quick lookup set of portfolio tickers for this article
  const portfolioTickerSet = new Set(
    [
      ...(item.portfolioTickers ?? []),
      ...(item.watchlistTickers ?? []),
    ]
      .map((sym) => sym.trim().toUpperCase())
      .filter(Boolean)
  );

  // Base: thin neutral border, highlight on hover
  let cardBorderClasses =
    "border-neutral-700 hover:border-[var(--highlight-400)]";

  if (open) {
    // Open card: highlight color, same thin width
    cardBorderClasses = "border-[var(--highlight-400)]";
  } else if (!isRead && hasAttentionTicker) {
    // Unread + portfolio ticker: bad-color border by default,
    // but good-color highlight on hover should still dominate.
    cardBorderClasses =
      "border-[var(--bad-400)] hover:border-[var(--highlight-400)]";
  } else if (!isRead) {
    // Unread (no portfolio ticker): white border, thin, no glow
    cardBorderClasses =
      "border-white hover:border-[var(--highlight-400)]";
  }

  const titleClasses = `font-medium truncate pr-2 ${
    isRead ? "text-neutral-400" : "text-neutral-50"
  }`;

  const dateClasses = `hidden sm:block text-sm ${
    isRead ? "text-neutral-500" : "text-neutral-300"
  }`;

  let chevronColorClasses = "";
  if (hasAttentionTicker) {
    // Always bad color if article mentions user's tickers
    chevronColorClasses = "text-[var(--bad-400)]";
  } else if (isRead) {
    // Read, non-portfolio article: gray chevron
    chevronColorClasses = "text-neutral-500";
  } else {
    // Unread, non-portfolio: default neutral
    chevronColorClasses = "text-neutral-300";
  }

  // Shared base classes for ticker buttons; border color added conditionally
  const tickerButtonBaseClasses =
    "inline-flex items-center cursor-pointer rounded-md border bg-neutral-800/60 px-3 py-1.5 text-sm font-medium text-neutral-100 transition-[border-color,box-shadow,background-color] hover:border-[var(--highlight-400)] active:shadow-[0_0_0_2px_var(--highlight-400)] hover:bg-neutral-800 focus:outline-none";

  const isPdfFile = item.fileKind !== "text";
  const eyeButtonClasses = isPdfFile
    ? "inline-flex h-9 w-9 items-center justify-center rounded-full border border-[var(--highlight-400)] bg-[var(--highlight-500)]/10 text-sm font-semibold text-white hover:border-[var(--highlight-300)] hover:bg-[var(--highlight-500)]/20 hover:text-white transition-[border-color,background-color,color,box-shadow]"
    : "inline-flex h-9 w-9 items-center justify-center rounded-full border border-neutral-500 bg-transparent text-sm font-semibold text-neutral-200 hover:border-[var(--highlight-400)] hover:text-white transition-[border-color,background-color,color,box-shadow]";

  return (
    <div
      className={`rounded-2xl border bg-neutral-800 overflow-hidden transition-[border-color,box-shadow] ${cardBorderClasses}`}
    >
      {/* Row header */}
      <button
        onClick={onToggleOpen}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-3 p-4 md:p-5 text-left cursor-pointer rounded-2xl active:shadow-[0_0_0_2px_var(--highlight-400)] transition-[box-shadow]"
      >
        <span className={titleClasses}>{item.title}</span>

        <div className="flex items-center gap-3 shrink-0">
          <span className={dateClasses}>
            {formatDateTime(item.dateISO)}
          </span>
          {/* Chevron */}
          <svg
            className={`h-5 w-5 transition-transform ${chevronColorClasses} ${
              open ? "rotate-180" : ""
            }`}
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              d="M5.23 7.21a.75.75 0 011.06.02L10 10.94l3.71-3.71a.75.75 0 111.06 1.06l-4.24 4.24a.75.75 0 01-1.06 0L5.25 8.29a.75.75 0 01-.02-1.08z"
              clipRule="evenodd"
            />
          </svg>
        </div>
      </button>

      {/* Expanded content */}
      {open && (
        <div className="border-t border-neutral-700 px-4 md:px-6 py-5">
          <div className="space-y-5">
            {/* Author */}
            {item.author && (
              <section className="space-y-1">
                <h3 className="text-xs uppercase tracking-wide text-neutral-400">
                  Author
                </h3>
                <p className="text-sm text-neutral-300">{item.author}</p>
              </section>
            )}

            {/* Summary */}
            <section className="space-y-2">
              <h3 className="text-xs uppercase tracking-wide text-neutral-400">
                Summary
              </h3>
              <p className="text-neutral-300 leading-relaxed">
                {decorateTextWithTickers(
                  item.summary,
                  item.tickerDetails
                )}
              </p>
            </section>

            {/* Key points */}
            {item.keyPoints.length > 0 && (
              <section className="space-y-2">
                <h3 className="text-xs uppercase tracking-wide text-neutral-400">
                  Key points
                </h3>
                <ul className="list-disc pl-5 space-y-1.5 text-neutral-300">
                  {item.keyPoints.map((pt, i) => (
                    <li key={i}>
                      {decorateTextWithTickers(
                        pt,
                        item.tickerDetails
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {/* Actions */}
            {item.actions.length > 0 && (
              <section className="space-y-2">
                <h3 className="text-xs uppercase tracking-wide text-neutral-400">
                  Actions to take
                </h3>
                <ul className="list-disc pl-5 space-y-1.5 text-neutral-300">
                  {item.actions.map((act, i) => (
                    <li key={i}>
                      {decorateTextWithTickers(
                        act,
                        item.tickerDetails
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {/* Tickers row + controls */}
            <section className="space-y-2">
              <h3 className="text-xs uppercase tracking-wide text-neutral-400">
                Tickers
              </h3>
              <div className="flex items-center justify-between gap-3">
                <div className="flex flex-wrap gap-2 flex-1">
                  {item.tickers.map((t) => {
                    const upper = t.trim().toUpperCase();
                    const isPortfolioTicker =
                      portfolioTickerSet.has(upper);

                    return (
                      <button
                        key={t}
                        type="button"
                        className={`${tickerButtonBaseClasses} ${
                          isPortfolioTicker
                            ? "border-[var(--bad-400)]"
                            : "border-neutral-600"
                        }`}
                        onClick={() =>
                          window.open(
                            `/analysis?ticker=${encodeURIComponent(
                              upper
                            )}`,
                            "_blank",
                            "noopener,noreferrer"
                          )
                        }
                      >
                        {upper}
                      </button>
                    );
                  })}
                  {item.tickers.length === 0 && (
                    <p className="text-sm text-neutral-500 italic">
                      No tickers mentioned.
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {/* Download button */}
                  <button
                    type="button"
                    onClick={onDownload}
                    className={eyeButtonClasses}
                    aria-label="View article PDF"
                  >
                    <svg
                      viewBox="0 0 24 24"
                      width="18"
                      height="18"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M1.5 12s4-7 10.5-7 10.5 7 10.5 7-4 7-10.5 7S1.5 12 1.5 12z" />
                      <circle cx="12" cy="12" r="3.2" />
                    </svg>
                  </button>

                  {/* Repost button (optional, only if handler provided) */}
                  {onOpenRepost && (
                    <button
                      type="button"
                      onClick={() => onOpenRepost(item)}
                      className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-[var(--highlight-400)] bg-[var(--highlight-500)]/10 text-sm font-semibold text-[var(--highlight-100)] hover:border-[var(--highlight-300)] hover:bg-[var(--highlight-500)]/20 hover:text-[var(--highlight-50)] transition-[border-color,background-color,color,box-shadow]"
                      aria-label="Repost this article to your hub"
                    >
                      <span className="text-xl leading-none">+</span>
                    </button>
                  )}

                  {/* Q&A toggle */}
                  <button
                    type="button"
                    onClick={onToggleQa}
                    className={`inline-flex h-9 w-9 items-center justify-center rounded-full border text-sm font-semibold transition-[border-color,background-color,color,box-shadow] ${
                      qaOpen
                        ? "border-red-500 text-red-200 bg-red-500/10 hover:border-red-400 hover:bg-red-500/20 hover:text-red-50"
                        : "border-[var(--highlight-400)] bg-[var(--highlight-500)]/10 text-[var(--highlight-100)] hover:border-[var(--highlight-300)] hover:bg-[var(--highlight-500)]/20 hover:text-[var(--highlight-50)]"
                    }`}
                    aria-label={
                      qaOpen
                        ? "Close questions for this article"
                        : "Ask questions about this article"
                    }
                  >
                    {qaOpen ? "✕" : "?"}
                  </button>
                </div>
              </div>
            </section>

            {/* Q&A section (opens beneath the article) */}
            {qaOpen && (
              <div className="pt-4 border-t border-neutral-800 space-y-3">
                <section className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-xs uppercase tracking-wide text-neutral-400">
                      Ask this article
                    </h3>
                    <span className="text-[11px] text-neutral-500">
                      Answers are based only on this PDF.
                    </span>
                  </div>

                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <input
                      type="text"
                      value={qaState.input}
                      onChange={(e) =>
                        onUpdateQaInput(e.target.value)
                      }
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          onAddQaQuestion();
                        }
                      }}
                      placeholder="Type a question, then press Enter to add it…"
                      className="flex-1 rounded-md border border-neutral-600 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-500 focus:outline-none focus:border-[var(--highlight-400)]"
                      disabled={qaState.loading}
                    />
                    <button
                      type="button"
                      onClick={onAddQaQuestion}
                      disabled={qaState.loading || !qaState.input.trim()}
                      className="inline-flex items-center justify-center rounded-md border border-neutral-600 bg-neutral-900 px-3 py-2 text-xs font-medium text-neutral-100 hover:border-[var(--highlight-400)] disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      Add question
                    </button>
                  </div>

                  {qaState.error && (
                    <div className="rounded-md border border-red-600/70 bg-red-900/40 px-3 py-2 text-xs text-red-50">
                      {qaState.error}
                    </div>
                  )}

                  {totalEntries > 0 && (
                    <div className="space-y-3">
                      {displayedEntries.map((entry, idx) => {
                        const questionNumber = totalEntries - idx; // newest gets highest number
                        const key =
                          entry.id || entry.question || `q-${idx}`;

                        return (
                          <div
                            key={key}
                            className="rounded-lg border border-neutral-700 bg-neutral-900/60 px-3 py-2"
                          >
                            <div className="mb-1 flex items-center justify-between">
                              <div className="text-[11px] uppercase tracking-wide text-neutral-500">
                                Question {questionNumber}
                              </div>
                              <button
                                type="button"
                                onClick={() =>
                                  onDeleteQaEntry(entry.id)
                                }
                                className="text-[11px] text-neutral-500 transition-colors hover:text-red-400"
                                aria-label="Delete this question"
                              >
                                ✕
                              </button>
                            </div>

                            <p className="text-sm text-neutral-100">
                              {entry.question}
                            </p>
                            {entry.answer ? (
                              <>
                                <div className="mt-2 text-[11px] uppercase tracking-wide text-neutral-500">
                                  Answer
                                </div>
                                <p className="text-sm text-neutral-200 whitespace-pre-line">
                                  {entry.answer}
                                </p>
                              </>
                            ) : (
                              qaState.loading && (
                                <p className="mt-2 text-xs text-neutral-400">
                                  Getting answer…
                                </p>
                              )
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={onGetQaAnswers}
                      disabled={qaState.loading || !hasUnanswered}
                      className="inline-flex items-center justify-center rounded-md border border-[var(--highlight-400)] bg-transparent px-3 py-1.5 text-xs font-medium text-[var(--highlight-200)] hover:border-[var(--highlight-300)] hover:text-[var(--highlight-100)] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {qaState.loading
                        ? "Getting answers…"
                        : "Get answers"}
                    </button>
                  </div>
                </section>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
