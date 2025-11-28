"use client";

import { formatDateTime } from "../news/utils";

export type RepostDraft = {
  articleId: string;
  articleTitle: string;
  articleDateISO: string | null;
  availableTickers: string[];
  selectedTickers: string[];
  comment: string;
  submitting: boolean;
  error: string | null;
  mode: "create" | "edit";
};

type NotesRepostOverlayProps = {
  draft: RepostDraft;
  onClose: () => void;
  onToggleTicker: (ticker: string) => void;
  onChangeComment: (value: string) => void;
  onSubmit: () => void;
  onDelete?: () => void;
};

export default function NotesRepostOverlay({
  draft,
  onClose,
  onToggleTicker,
  onChangeComment,
  onSubmit,
  onDelete,
}: NotesRepostOverlayProps) {
  return (
    <div className="fixed inset-0 z-30 flex items-end md:items-center justify-center bg-black/60 px-4 py-6">
      <div className="w-full max-w-lg rounded-2xl border border-neutral-700 bg-neutral-900 p-4 md:p-5 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-neutral-100">
              {draft.mode === "edit" ? "Edit repost" : "Repost to Notes"}
            </h2>
            <p className="mt-1 text-xs text-neutral-400">
              Select tickers and add an optional comment.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-neutral-700 text-xs text-neutral-300 hover:border-neutral-500 hover:text-neutral-50"
            aria-label="Close repost panel"
            disabled={draft.submitting}
          >
            ✕
          </button>
        </div>

        {/* Article preview */}
        <div className="rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2.5 space-y-1.5">
          <div className="text-xs uppercase tracking-wide text-neutral-500">
            Article
          </div>
          <div className="text-sm font-medium text-neutral-100 line-clamp-2">
            {draft.articleTitle}
          </div>
          {draft.articleDateISO && (
            <div className="text-[11px] text-neutral-500">
              {formatDateTime(draft.articleDateISO)}
            </div>
          )}
        </div>

        {/* Ticker selection */}
        <div className="space-y-1.5">
          <div className="text-xs uppercase tracking-wide text-neutral-500">
            Tickers
          </div>
          {draft.availableTickers.length === 0 ? (
            <p className="text-xs text-neutral-400">
              No tickers detected for this article. You can still repost with a
              comment.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {draft.availableTickers.map((t) => {
                const upper = t.toUpperCase();
                const selected = draft.selectedTickers.includes(upper);
                return (
                  <button
                    key={upper}
                    type="button"
                    onClick={() => onToggleTicker(upper)}
                    disabled={draft.submitting}
                    className={`inline-flex items-center rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
                      selected
                        ? "border-[var(--highlight-400)] bg-neutral-800 text-[var(--highlight-100)]"
                        : "border-neutral-700 bg-neutral-900 text-neutral-200 hover:border-[var(--highlight-400)]"
                    }`}
                  >
                    {upper}
                  </button>
                );
              })}
            </div>
          )}
          <p className="text-[10px] text-neutral-500">
            Selected tickers will be attached to your repost.
          </p>
        </div>

        {/* Comment box */}
        <div className="space-y-1.5">
          <div className="text-xs uppercase tracking-wide text-neutral-500">
            Comment
          </div>
          <textarea
            rows={3}
            value={draft.comment}
            onChange={(e) => onChangeComment(e.target.value)}
            disabled={draft.submitting}
            placeholder="Add a quick note (optional)…"
            className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-500 focus:outline-none focus:border-[var(--highlight-400)]"
          />
          <p className="text-[10px] text-neutral-500">
            Your handle, tickers, and comment will appear in Notes.
          </p>
        </div>

        {draft.error && (
          <div className="rounded-md border border-red-600/70 bg-red-900/40 px-3 py-2 text-xs text-red-50">
            {draft.error}
          </div>
        )}

        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={draft.submitting}
            className="inline-flex items-center rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-xs font-medium text-neutral-200 hover:border-neutral-500 disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSubmit}
            disabled={draft.submitting}
            className="inline-flex items-center rounded-lg border border-[var(--highlight-400)] bg-[var(--highlight-500)]/10 px-4 py-1.5 text-xs font-semibold text-[var(--highlight-100)] hover:border-[var(--highlight-300)] hover:bg-[var(--highlight-500)]/20 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {draft.submitting
              ? draft.mode === "edit"
                ? "Updating…"
                : "Reposting…"
              : draft.mode === "edit"
              ? "Update repost"
              : "Repost"}
          </button>
          {draft.mode === "edit" && onDelete && (
            <button
              type="button"
              onClick={onDelete}
              disabled={draft.submitting}
              className="inline-flex items-center rounded-lg border border-red-500 bg-red-900/30 px-3 py-1.5 text-xs font-semibold text-red-100 hover:border-red-400 disabled:opacity-60"
            >
              Delete repost
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
