// src/app/notes/NotesFeedItemRow.tsx
"use client";

import { useState } from "react";
import NewsArticleCard from "../news/NewsArticleCard";
import type { QaUIState } from "../news/types";
import { formatDateTime } from "../news/utils";
import type { NotesFeedItem } from "./types";

const TICKER_CHIP_CLASSES =
  "inline-flex items-center cursor-pointer rounded-md border bg-neutral-800/60 px-3 py-1.5 text-sm font-medium text-neutral-200 hover:border-[var(--highlight-400)] hover:bg-neutral-800 focus:outline-none";

const USERNAME_CHIP_BASE =
  "inline-flex items-center cursor-pointer rounded-md border px-3 py-1.5 text-sm font-medium transition-colors";

type NotesFeedItemRowProps = {
  notesItem: NotesFeedItem;
  isOpen: boolean;
  qaState: QaUIState;
  onToggleOpen: () => void;
  onToggleQa: () => void;
  onUpdateQaInput: (value: string) => void;
  onAddQaQuestion: () => void;
  onGetQaAnswers: () => void;
  onDeleteQaEntry: (questionId: string) => void;
  onDownload: () => void;
  // Repost from Notes: new repost or edit existing if it's mine.
  onOpenRepost: () => void;
  highlightTickers: ReadonlySet<string>;
};

export default function NotesFeedItemRow({
  notesItem,
  isOpen,
  qaState,
  onToggleOpen,
  onToggleQa,
  onUpdateQaInput,
  onAddQaQuestion,
  onGetQaAnswers,
  onDeleteQaEntry,
  onDownload,
  onOpenRepost,
  highlightTickers,
}: NotesFeedItemRowProps) {
  const [selectedReposterId, setSelectedReposterId] = useState<string | null>(
    null
  );

  const selectedRepost =
    notesItem.reposts.find((r) => r.id === selectedReposterId) ?? null;

  return (
    <div className="space-y-3 border-b border-neutral-800 pb-4 last:border-b-0 last:pb-0">
      {/* Core article card (same UI as News page) */}
      <NewsArticleCard
        item={notesItem.article}
        open={isOpen}
        qaState={qaState}
        onToggleOpen={onToggleOpen}
        onToggleQa={onToggleQa}
        onUpdateQaInput={onUpdateQaInput}
        onAddQaQuestion={onAddQaQuestion}
        onGetQaAnswers={onGetQaAnswers}
        onDeleteQaEntry={onDeleteQaEntry}
        onDownload={onDownload}
        onOpenRepost={onOpenRepost}
      />

      {/* Reposted-by row */}
      <div className="rounded-2xl border border-neutral-700 bg-neutral-800 px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="flex-1 text-sm text-neutral-200">
            <span className="mr-1">Reposted by</span>
            {notesItem.reposts.map((r, idx2) => {
              const isSelected = selectedReposterId === r.id;
              const isMine = Boolean(r.isMine);

              const prefix =
                idx2 === 0
                  ? ""
                  : idx2 === notesItem.reposts.length - 1
                  ? ", and "
                  : ", ";

              const baseText = isMine ? "text-white" : "text-neutral-400";
              let classes = `${USERNAME_CHIP_BASE} border-neutral-600 bg-neutral-800/60 ${baseText} hover:border-[var(--highlight-400)] hover:bg-neutral-800`;
              if (isSelected) {
                classes = `${USERNAME_CHIP_BASE} border-[var(--good-400)] bg-neutral-800 text-[var(--good-100)]`;
              }
              const weightClass = isMine ? "font-semibold" : "";

              return (
                <span key={r.id}>
                  {prefix}
                  <button
                    type="button"
                    onClick={() =>
                      setSelectedReposterId((prev) =>
                        prev === r.id ? null : r.id
                      )
                    }
                    className={`${classes} ${weightClass}`}
                  >
                    {r.handle}
                  </button>
                </span>
              );
            })}
          </div>
        </div>
      </div>

      {/* Selected user comment */}
      {selectedRepost && (
        <div className="rounded-2xl border border-neutral-700 bg-neutral-800 px-4 py-3 space-y-3">
          {/* Comment + timestamp */}
          <div className="flex items-start justify-between gap-3">
            <p className="text-sm text-neutral-100 flex-1">
              <span className={`font-semibold ${selectedRepost.isMine ? "text-white" : "text-neutral-100"}`}>
                {selectedRepost.handle}:
              </span>{" "}
              {selectedRepost.comment &&
              selectedRepost.comment.trim().length > 0 ? (
                selectedRepost.comment
              ) : (
                <span className="text-neutral-500">
                  No comment added yet.
                </span>
              )}
            </p>
            {selectedRepost.createdAtISO && (
              <span className="text-xs text-neutral-500 shrink-0">
                {formatDateTime(selectedRepost.createdAtISO)}
              </span>
            )}
          </div>

          {/* Tickers row + Edit button on the same horizontal level */}
          {(selectedRepost.tickers && selectedRepost.tickers.length > 0) ||
          selectedRepost.isMine ? (
            <div className="space-y-1 pt-1">
              {selectedRepost.tickers &&
                selectedRepost.tickers.length > 0 && (
                  <div className="text-xs uppercase tracking-wide text-neutral-400">
                    Tickers
                  </div>
                )}

              <div className="flex items-center justify-between gap-3">
                <div className="flex flex-wrap gap-2 flex-1 min-w-0">
                  {selectedRepost.tickers &&
                    selectedRepost.tickers.length > 0 &&
                    selectedRepost.tickers.map((t) => {
                      const upper = t.toUpperCase();
                      const isUserTicker = highlightTickers.has(upper);
                      return (
                        <button
                          key={t}
                          type="button"
                          className={`${TICKER_CHIP_CLASSES} ${
                            isUserTicker
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
                </div>

                <div className="flex justify-end shrink-0">
                  {selectedRepost.isMine ? (
                    <button
                      type="button"
                      onClick={onOpenRepost}
                      className="inline-flex items-center rounded-md border border-neutral-600 bg-neutral-900 px-3 py-1.5 text-xs font-medium text-neutral-200 hover:border-[var(--highlight-400)]"
                    >
                      Edit repost
                    </button>
                  ) : (
                    <span className="inline-flex h-[28px] px-3 py-1.5 rounded-md border border-transparent text-xs font-medium text-transparent pointer-events-none select-none">
                      Edit repost
                    </span>
                  )}
                </div>
              </div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
