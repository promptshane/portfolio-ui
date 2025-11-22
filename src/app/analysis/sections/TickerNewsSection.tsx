// src/app/analysis/sections/TickerNewsSection.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import type { ApiArticle, NewsItem, QaUIState } from "../../news/types";
import {
  mapApiArticleToNewsItem,
  mergeEntries,
  makeLocalId,
  getDefaultQaState,
} from "../../news/utils";
import NewsArticleCard from "../../news/NewsArticleCard";
import NotesRepostOverlay, {
  RepostDraft,
} from "../../notes/NotesRepostOverlay";

type TickerNewsSectionProps = {
  symbol: string;
};

type TickerNewsTimeframe = "1D" | "1W" | "1M" | "1Y" | "ALL";

export default function TickerNewsSection({
  symbol,
}: TickerNewsSectionProps) {
  const normalizedSymbol = symbol.trim().toUpperCase();

  const [items, setItems] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const [openId, setOpenId] = useState<string | null>(null);
  const [qaById, setQaById] = useState<Record<string, QaUIState>>({});

  const [sortOpen, setSortOpen] = useState(false);
  const [timeframe, setTimeframe] =
    useState<TickerNewsTimeframe>("1M");

  // Repost state
  const [repostDraft, setRepostDraft] = useState<RepostDraft | null>(
    null
  );

  // Load news articles and filter to those mentioning the symbol
  useEffect(() => {
    if (!normalizedSymbol) {
      setItems([]);
      setError(null);
      setOpenId(null);
      return;
    }

    let aborted = false;

    async function load() {
      try {
        setError(null);
        setLoading(true);
        const res = await fetch("/api/news/articles");
        if (!res.ok) {
          throw new Error(`Failed to load news: ${res.status}`);
        }

        const data = (await res.json()) as {
          articles: ApiArticle[];
        };

        const mapped =
          data.articles
            ?.map(mapApiArticleToNewsItem)
            .filter((v): v is NewsItem => v !== null) ?? [];

        const upperSymbol = normalizedSymbol.toUpperCase();

        const filteredBySymbol = mapped.filter((item) => {
          const articleTickers = item.tickers.map((t) =>
            t.trim().toUpperCase()
          );
          return articleTickers.includes(upperSymbol);
        });

        // Sort newest first
        filteredBySymbol.sort((a, b) => {
          const da = new Date(a.dateISO).getTime();
          const db = new Date(b.dateISO).getTime();
          return db - da;
        });

        if (!aborted) {
          setItems(filteredBySymbol);
        }
      } catch (err: any) {
        if (!aborted) {
          setItems([]);
          setError(
            err?.message || "Failed to load related news articles."
          );
        }
      } finally {
        if (!aborted) {
          setLoading(false);
        }
      }
    }

    void load();

    return () => {
      aborted = true;
    };
  }, [normalizedSymbol]);

  // --- Q&A helpers (aligned with News page) ---

  async function loadPersistedQa(
    articleId: string,
    force = false
  ) {
    let shouldFetch = true;

    // If we already have entries and we're not forcing, skip fetch.
    if (!force) {
      setQaById((prev) => {
        const prevState = prev[articleId] ?? getDefaultQaState();
        if (prevState.entries.length > 0) {
          shouldFetch = false;
          return prev;
        }
        return prev;
      });
    }

    if (!shouldFetch) return;

    try {
      const res = await fetch(
        `/api/news/articles/${encodeURIComponent(articleId)}`
      );
      if (!res.ok) {
        // If we can't load history, just keep local state.
        return;
      }
      const data = (await res.json()) as {
        qaHistory?: {
          id?: string;
          question?: string;
          answer?: string | null;
          createdAtISO?: string;
        }[];
      };

      const rawHistory = Array.isArray(data.qaHistory)
        ? data.qaHistory
        : [];

      // Sort by createdAt (oldest first) so we can later render newest on top.
      rawHistory.sort((a, b) => {
        const ta = a?.createdAtISO
          ? new Date(a.createdAtISO).getTime()
          : 0;
        const tb = b?.createdAtISO
          ? new Date(b.createdAtISO).getTime()
          : 0;
        return ta - tb;
      });

      const fromServer = rawHistory
        .map((row) => {
          const question =
            typeof row.question === "string" ? row.question : "";
          const idSource =
            typeof row.id === "string" && row.id.trim().length > 0
              ? row.id.trim()
              : question
              ? `srv-${question}-${row.createdAtISO ?? ""}`
              : "";
          return {
            id: idSource,
            question,
            answer:
              typeof row.answer === "string"
                ? row.answer
                : undefined,
            createdAtISO: row.createdAtISO,
          };
        })
        .filter((e) => e.id && e.question);

      if (!fromServer.length) return;

      setQaById((prev) => {
        const prevState = prev[articleId] ?? getDefaultQaState();
        const merged = mergeEntries(prevState.entries, fromServer);
        return {
          ...prev,
          [articleId]: {
            ...prevState,
            entries: merged,
          },
        };
      });
    } catch {
      // Swallow errors: local UI state stays as-is.
      return;
    }
  }

  function toggleQa(id: string) {
    const current = qaById[id] ?? getDefaultQaState();
    const willOpen = !current.open;

    setQaById((prev) => {
      const prevState = prev[id] ?? getDefaultQaState();
      return {
        ...prev,
        [id]: {
          ...prevState,
          open: !prevState.open,
          error: null,
        },
      };
    });

    if (willOpen) {
      void loadPersistedQa(id);
    }
  }

  function updateQaInput(id: string, value: string) {
    setQaById((prev) => {
      const current = prev[id] ?? getDefaultQaState();
      return {
        ...prev,
        [id]: {
          ...current,
          input: value,
          error: null,
        },
      };
    });
  }

  function addQaQuestion(id: string) {
    setQaById((prev) => {
      const current = prev[id] ?? getDefaultQaState();
      const text = current.input.trim();
      if (!text) return prev;

      const newEntry = {
        id: makeLocalId(),
        question: text,
      };

      return {
        ...prev,
        [id]: {
          ...current,
          input: "",
          error: null,
          entries: [...current.entries, newEntry],
        },
      };
    });
  }

  async function getQaAnswers(id: string) {
    const current = qaById[id] ?? getDefaultQaState();

    const pendingEntries = current.entries.filter(
      (e) => !e.answer || !e.answer.trim()
    );
    const questions = pendingEntries
      .map((e) => e.question)
      .filter((q) => q && q.trim().length > 0);

    if (!questions.length) {
      setQaById((prev) => {
        const prevState = prev[id] ?? current;
        return {
          ...prev,
          [id]: {
            ...prevState,
            error: "Add at least one unanswered question first.",
          },
        };
      });
      return;
    }

    const pendingIds = pendingEntries.map((e) => e.id);

    setQaById((prev) => {
      const prevState = prev[id] ?? current;
      return {
        ...prev,
        [id]: {
          ...prevState,
          loading: true,
          error: null,
        },
      };
    });

    try {
      const res = await fetch(
        `/api/news/articles/${encodeURIComponent(id)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "qa", questions }),
        }
      );

      if (!res.ok) {
        let message = `Failed to get answers: ${res.status}`;
        try {
          const data = await res.json();
          if (data?.error) message = data.error;
        } catch {
          // ignore parse errors
        }
        throw new Error(message);
      }

      const data = (await res.json()) as {
        answers?: { question: string; answer: string }[];
      };

      const answersArray = Array.isArray(data.answers)
        ? data.answers
        : [];

      setQaById((prev) => {
        const prevState = prev[id] ?? current;

        if (answersArray.length !== questions.length) {
          return {
            ...prev,
            [id]: {
              ...prevState,
              loading: false,
              error: null,
            },
          };
        }

        const updatedEntries = prevState.entries.map((entry) => {
          const idx = pendingIds.indexOf(entry.id);
          if (idx === -1) return entry;

          const answerObj = answersArray[idx];
          const answerText =
            answerObj && typeof answerObj.answer === "string"
              ? answerObj.answer
              : "";

          return {
            ...entry,
            answer: answerText,
          };
        });

        return {
          ...prev,
          [id]: {
            ...prevState,
            entries: updatedEntries,
            loading: false,
            error: null,
          },
        };
      });

      // Sync with persisted history (per-user) so we pick up IDs/timestamps
      void loadPersistedQa(id, true);
    } catch (err: any) {
      const message = err?.message || "Failed to get answers.";
      setQaById((prev) => {
        const prevState = prev[id] ?? current;
        return {
          ...prev,
          [id]: {
            ...prevState,
            loading: false,
            error: message,
          },
        };
      });
    }
  }

  async function deleteQaEntry(articleId: string, questionId: string) {
    const trimmedId = questionId.trim();
       if (!trimmedId) return;

    // Optimistically remove from UI by ID
    setQaById((prev) => {
      const prevState = prev[articleId] ?? getDefaultQaState();
      const remaining = prevState.entries.filter(
        (e) => e.id !== trimmedId
      );
      return {
        ...prev,
        [articleId]: {
          ...prevState,
          entries: remaining,
        },
      };
    });

    try {
      const res = await fetch(
        `/api/news/articles/${encodeURIComponent(articleId)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "deleteQuestion",
            questionId: trimmedId,
          }),
        }
      );

      if (!res.ok) {
        // If delete fails, reload from server to stay consistent.
        void loadPersistedQa(articleId, true);
      }
    } catch {
      void loadPersistedQa(articleId, true);
    }
  }

  async function markViewed(articleId: string) {
    // Optimistically mark as viewed locally
    setItems((prev) =>
      prev.map((item) =>
        item.id === articleId ? { ...item, viewed: true } : item
      )
    );

    try {
      await fetch(
        `/api/news/articles/${encodeURIComponent(articleId)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "markViewed" }),
        }
      );
    } catch {
      // ignore errors – local state is already updated
    }
  }

  function handleDownload(id: string) {
    const url = `/api/news/articles/${encodeURIComponent(id)}/file`;
    window.open(url, "_blank");
  }

  // --- Repost helpers (using NotesRepostOverlay) ---

  function openRepostPanel(item: NewsItem) {
    void (async () => {
      let mode: "create" | "edit" = "create";
      let existingComment = "";
      let existingTickers: string[] = [];

      try {
        const res = await fetch(
          `/api/notes/repost?articleId=${encodeURIComponent(
            item.id
          )}`
        );
        if (res.ok) {
          const data = (await res.json().catch(() => null)) as
            | {
                repost?: {
                  comment?: string | null;
                  tickers?: string[];
                } | null;
              }
            | null;

          const repost = data?.repost ?? null;
          if (repost) {
            mode = "edit";
            if (typeof repost.comment === "string") {
              existingComment = repost.comment;
            }
            if (Array.isArray(repost.tickers)) {
              existingTickers = repost.tickers
                .filter((t): t is string => typeof t === "string")
                .map((t) => t.trim().toUpperCase())
                .filter((t) => t.length > 0);
            }
          }
        }
      } catch {
        // If fetch fails, fall back to "create" with empty defaults.
      }

      setRepostDraft({
        articleId: item.id,
        articleTitle: item.title,
        articleDateISO: item.dateISO,
        availableTickers: item.tickers,
        selectedTickers: existingTickers,
        comment: existingComment,
        submitting: false,
        error: null,
        mode,
      });
    })();
  }

  function closeRepostPanel() {
    setRepostDraft(null);
  }

  function handleToggleRepostTicker(ticker: string) {
    setRepostDraft((prev) => {
      if (!prev) return prev;
      const upper = ticker.trim().toUpperCase();
      if (!upper) return prev;

      const exists = prev.selectedTickers.includes(upper);
      return {
        ...prev,
        selectedTickers: exists
          ? prev.selectedTickers.filter((t) => t !== upper)
          : [...prev.selectedTickers, upper],
      };
    });
  }

  function handleChangeRepostComment(value: string) {
    setRepostDraft((prev) =>
      prev ? { ...prev, comment: value } : prev
    );
  }

  async function submitRepost() {
    if (!repostDraft) return;

    const draft = repostDraft;
    const trimmedComment = draft.comment.trim();

    setRepostDraft((prev) =>
      prev
        ? {
            ...prev,
            submitting: true,
            error: null,
          }
        : prev
    );

    try {
      const res = await fetch("/api/notes/repost", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          articleId: draft.articleId,
          tickers: draft.selectedTickers,
          comment: trimmedComment || null,
        }),
      });

      const data = (await res.json().catch(() => null)) as
        | { error?: string }
        | null;

      if (!res.ok) {
        const msg =
          data?.error ||
          (res.status === 401
            ? "You must be signed in to repost."
            : "Failed to repost article.");
        setRepostDraft((prev) =>
          prev
            ? {
                ...prev,
                submitting: false,
                error: msg,
              }
            : prev
        );
        return;
      }

      // Success: close panel
      setRepostDraft(null);
    } catch {
      setRepostDraft((prev) =>
        prev
          ? {
              ...prev,
              submitting: false,
              error: "Failed to repost article.",
            }
          : prev
      );
    }
  }

  // --- Timeframe filtering ---

  const filteredItems = useMemo(() => {
    if (!items.length) return [] as NewsItem[];
    if (timeframe === "ALL") return items;

    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;

    let maxDiff: number;
    if (timeframe === "1D") maxDiff = 1 * dayMs;
    else if (timeframe === "1W") maxDiff = 7 * dayMs;
    else if (timeframe === "1M") maxDiff = 30 * dayMs;
    else maxDiff = 365 * dayMs;

    return items.filter((item) => {
      const timeMs = new Date(item.dateISO).getTime();
      if (Number.isNaN(timeMs)) return true;
      const diff = now - timeMs;
      return diff <= maxDiff;
    });
  }, [items, timeframe]);

  const timeframeOptions: {
    value: TickerNewsTimeframe;
    label: string;
  }[] = [
    { value: "1D", label: "1D" },
    { value: "1W", label: "1W" },
    { value: "1M", label: "1M" },
    { value: "1Y", label: "1Y" },
    { value: "ALL", label: "All" },
  ];

  if (!normalizedSymbol) {
    return null;
  }

  return (
    <>
      <section className="bg-neutral-800 rounded-2xl p-5 border border-neutral-700">
        <div className="flex items-center justify-between gap-3 mb-4">
          <div>
            <div className="text-sm font-semibold">
              News mentioning {normalizedSymbol}
            </div>
            <div className="text-xs text-neutral-400">
              Pulled from your uploaded articles.
            </div>
          </div>

          <div className="relative">
            <button
              type="button"
              onClick={() => setSortOpen((open) => !open)}
              className="inline-flex items-center gap-2 rounded-md border border-neutral-700 bg-black/40 px-3 py-1.5 text-xs text-neutral-200 hover:border-[var(--highlight-400)]"
            >
              <span>Sort</span>
              <span className="text-[10px] uppercase tracking-wide">
                {
                  timeframeOptions.find(
                    (o) => o.value === timeframe
                  )?.label
                }
              </span>
              <span className="text-[10px]">▾</span>
            </button>

            {sortOpen && (
              <div className="absolute right-0 mt-2 w-44 rounded-xl border border-neutral-700 bg-neutral-900 shadow-lg p-2 z-10">
                <div className="text-[11px] font-medium text-neutral-400 px-1 mb-1">
                  Timeframe
                </div>
                <div className="flex flex-wrap gap-1">
                  {timeframeOptions.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => {
                        setTimeframe(opt.value);
                        setSortOpen(false);
                      }}
                      className={`rounded-md border px-2 py-1 text-[11px] ${
                        timeframe === opt.value
                          ? "border-[var(--highlight-400)] text-[var(--highlight-100)]"
                          : "border-neutral-700 text-neutral-300 hover:border-[var(--highlight-400)]"
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {loading && (
          <div className="text-xs text-neutral-400">
            Loading related news…
          </div>
        )}

        {error && !loading && (
          <div className="text-xs text-[var(--bad-300)] mb-2">
            {error}
          </div>
        )}

        {!loading && !error && filteredItems.length === 0 && (
          <div className="text-xs text-neutral-400">
            No articles mentioning {normalizedSymbol} in this
            timeframe.
          </div>
        )}

        {!loading && filteredItems.length > 0 && (
          <div className="space-y-3">
            {filteredItems.map((item) => {
              const open = openId === item.id;
              const qaState =
                qaById[item.id] ?? getDefaultQaState();

              return (
                <NewsArticleCard
                  key={item.id}
                  item={item}
                  open={open}
                  qaState={qaState}
                  onToggleOpen={() => {
                    const willOpen = !open;
                    setOpenId(willOpen ? item.id : null);
                    if (willOpen && !item.viewed) {
                      void markViewed(item.id);
                    }
                  }}
                  onToggleQa={() => toggleQa(item.id)}
                  onUpdateQaInput={(value) =>
                    updateQaInput(item.id, value)
                  }
                  onAddQaQuestion={() =>
                    addQaQuestion(item.id)
                  }
                  onGetQaAnswers={() =>
                    void getQaAnswers(item.id)
                  }
                  onDeleteQaEntry={(questionId) =>
                    void deleteQaEntry(item.id, questionId)
                  }
                  onDownload={() =>
                    handleDownload(item.id)
                  }
                  onOpenRepost={openRepostPanel}
                />
              );
            })}
          </div>
        )}
      </section>

      {repostDraft && (
        <NotesRepostOverlay
          draft={repostDraft}
          onClose={closeRepostPanel}
          onToggleTicker={handleToggleRepostTicker}
          onChangeComment={handleChangeRepostComment}
          onSubmit={submitRepost}
        />
      )}
    </>
  );
}
