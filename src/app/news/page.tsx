// src/app/news/page.tsx
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Header from "../components/header";
import type {
  ApiArticle,
  NewsItem,
  QaUIState,
  TimeframeOption,
} from "./types";
import {
  mapApiArticleToNewsItem,
  mergeEntries,
  makeLocalId,
  formatDateTime,
} from "./utils";
import NewsArticleCard from "./NewsArticleCard";
import { useNewsJobs } from "./useNewsJobs";

type RepostDraft = {
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

const PROCESSING_PATTERN = [3, 2, 1, 2] as const;

export default function NewsPage() {
  const router = useRouter();
  const [openId, setOpenId] = useState<string | null>(null);
  const [items, setItems] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Per-article Q&A UI state
  const [qaById, setQaById] = useState<Record<string, QaUIState>>({});

  // Sort / filter UI state
  const [sortOpen, setSortOpen] = useState(false);
  const sortDropdownRef = useRef<HTMLDivElement | null>(null);
  const [timeframe, setTimeframe] = useState<TimeframeOption>("1W");
  const [selectedAuthors, setSelectedAuthors] = useState<string[]>([]);
  const [tickerFilterInput, setTickerFilterInput] =
    useState<string>("");
  const [showUnreadOnly, setShowUnreadOnly] = useState(false);
  const [filterPortfolioMatches, setFilterPortfolioMatches] =
    useState(false);
  const [filterWatchlistMatches, setFilterWatchlistMatches] =
    useState(false);

  // Repost UI state
  const [repostDraft, setRepostDraft] = useState<RepostDraft | null>(
    null
  );
  const { activeJob, jobRunning, refreshJobs, setPolling } = useNewsJobs({ pollIntervalMs: 4000 });
  const [refreshBusy, setRefreshBusy] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  const actionButtonClass =
    "inline-flex items-center rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-sm font-medium text-neutral-100 hover:border-[var(--highlight-400)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--highlight-400)]";

  const databaseButton = (
    <button
      type="button"
      onClick={() => router.push("/news/database")}
      className={actionButtonClass}
    >
      Database
    </button>
  );

  const [refreshStatusHint, setRefreshStatusHint] = useState<string | null>(null);
  const [processingStep, setProcessingStep] = useState(0);
  const showProcessing =
    jobRunning && activeJob?.type === "refresh" && (activeJob?.total ?? 0) > 0;

  useEffect(() => {
    if (!showProcessing) {
      setProcessingStep(0);
      return;
    }
    const interval = window.setInterval(() => {
      setProcessingStep((prev) => (prev + 1) % PROCESSING_PATTERN.length);
    }, 500);
    return () => window.clearInterval(interval);
  }, [showProcessing]);

  const loadArticles = useCallback(async (options?: { silent?: boolean }) => {
    const silent = options?.silent ?? false;
    try {
      setError(null);
      if (!silent) setLoading(true);
      const res = await fetch("/api/news/articles", { credentials: "include" });
      if (!res.ok) {
        throw new Error(`Failed to load news: ${res.status}`);
      }
      const data = (await res.json()) as { articles: ApiArticle[] };

      const mapped =
        data.articles
          ?.map(mapApiArticleToNewsItem)
          .filter((v): v is NewsItem => v !== null) ?? [];

      mapped.sort((a, b) => {
        const da = new Date(a.dateISO).getTime();
        const db = new Date(b.dateISO).getTime();
        return db - da;
      });

      setItems(mapped);
    } catch (err: any) {
      setError(err?.message || "Failed to load news articles.");
    } finally {
      if (!options?.silent) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void refreshJobs();
  }, [refreshJobs]);

  useEffect(() => {
    setPolling(jobRunning);
  }, [jobRunning, setPolling]);

  useEffect(() => {
    if (!jobRunning) return;
    void loadArticles({ silent: true });
    const interval = setInterval(() => {
      void loadArticles({ silent: true });
    }, 5000);
    return () => clearInterval(interval);
  }, [jobRunning, loadArticles]);

  const prevJobRunningRef = useRef(jobRunning);
  useEffect(() => {
    if (prevJobRunningRef.current && !jobRunning) {
      void loadArticles({ silent: true });
    }
    prevJobRunningRef.current = jobRunning;
  }, [jobRunning, loadArticles]);

  useEffect(() => {
    if (!sortOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!sortDropdownRef.current || (target && sortDropdownRef.current.contains(target))) {
        return;
      }
      setSortOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSortOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [sortOpen]);

  function getDefaultQaState(): QaUIState {
    return {
      open: false,
      input: "",
      entries: [],
      loading: false,
      error: null,
    };
  }

  async function loadPersistedQa(articleId: string, force = false) {
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

  async function handleRefreshNews() {
    if (refreshBusy || jobRunning) return;
    setRefreshError(null);
    setRefreshBusy(true);
    try {
      const res = await fetch("/api/news/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ type: "refresh", lookbackDays: 7, maxEmails: 100 }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || `HTTP ${res.status}`);
      }
      await refreshJobs();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to refresh.";
      setRefreshError(message);
    } finally {
      setRefreshBusy(false);
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
      // and stay consistent across sessions.
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
        `/api/news/articles/${encodeURIComponent(articleId)}`
        ,
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
        `/api/news/articles/${encodeURIComponent(articleId)}`
        ,
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

  // Open repost panel, pre-filling from any existing repost (if present)
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

  function toggleRepostTicker(ticker: string) {
    setRepostDraft((prev) => {
      if (!prev) return prev;
      const upper = ticker.trim().toUpperCase();
      if (!upper) return prev;

      const exists = prev.selectedTickers.includes(upper);
      return {
        ...prev,
        selectedTickers: exists
          ? prev.selectedTickers.filter((x) => x !== upper)
          : [...prev.selectedTickers, upper],
      };
    });
  }

  function closeRepostPanel() {
    setRepostDraft(null);
  }

  async function submitRepost() {
    if (!repostDraft) return;

    const trimmedComment = repostDraft.comment.trim();

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
          articleId: repostDraft.articleId,
          tickers: repostDraft.selectedTickers,
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

      // Success: close the panel.
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

  useEffect(() => {
    void loadArticles();
  }, [loadArticles]);

  // Derived filter data
  const allAuthors = Array.from(
    new Set(
      items
        .map((i) => i.author)
        .filter(
          (a): a is string =>
            typeof a === "string" && a.trim().length > 0
        )
    )
  ).sort((a, b) => a.localeCompare(b));

  const tickerFilterTokens = tickerFilterInput
    .split(/[,\s]+/)
    .map((t) => t.trim().toUpperCase())
    .filter(Boolean);

  const filteredItems = items.filter((item) => {
    // Timeframe filter
    let withinTimeframe = true;
    const timeMs = new Date(item.dateISO).getTime();
    if (!Number.isNaN(timeMs)) {
      const now = Date.now();
      const diff = now - timeMs;
      const dayMs = 24 * 60 * 60 * 1000;
      let maxDiff = 7 * dayMs; // default 1W
      if (timeframe === "1D") maxDiff = 1 * dayMs;
      else if (timeframe === "1W") maxDiff = 7 * dayMs;
      else if (timeframe === "1M") maxDiff = 30 * dayMs;
      else if (timeframe === "1Y") maxDiff = 365 * dayMs;

      withinTimeframe = diff <= maxDiff;
    }
    if (!withinTimeframe) return false;

    // Author filter
    if (selectedAuthors.length > 0) {
      if (!item.author || !selectedAuthors.includes(item.author)) {
        return false;
      }
    }

    // Ticker filter
    if (tickerFilterTokens.length > 0) {
      const articleTickers = item.tickers.map((t) =>
        t.trim().toUpperCase()
      );
      const hasMatch = tickerFilterTokens.some((tok) =>
        articleTickers.includes(tok)
      );
      if (!hasMatch) return false;
    }

    if (showUnreadOnly && item.viewed) {
      return false;
    }

    const matchesPortfolio = item.hasPortfolioTicker;
    const matchesWatchlist = item.hasWatchlistTicker;

    if (filterPortfolioMatches && filterWatchlistMatches) {
      if (!(matchesPortfolio || matchesWatchlist)) {
        return false;
      }
    } else if (filterPortfolioMatches && !matchesPortfolio) {
      return false;
    } else if (filterWatchlistMatches && !matchesWatchlist) {
      return false;
    }

    return true;
  });

  const timeframeItems = useMemo(() => {
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    let maxDiff = 7 * dayMs;
    if (timeframe === "1D") maxDiff = 1 * dayMs;
    else if (timeframe === "1W") maxDiff = 7 * dayMs;
    else if (timeframe === "1M") maxDiff = 30 * dayMs;
    else if (timeframe === "1Y") maxDiff = 365 * dayMs;

    return items.filter((item) => {
      const ts = new Date(item.dateISO).getTime();
      if (Number.isNaN(ts)) return false;
      return now - ts <= maxDiff;
    });
  }, [items, timeframe]);

  const timeframeReadCount = timeframeItems.filter((item) => item.viewed).length;
  const timeframeTotal = timeframeItems.length;
  const timeframeLabels: Record<TimeframeOption, string> = {
    "1D": "Today",
    "1W": "This Week",
    "1M": "This Month",
    "1Y": "This Year",
  };
  const timeframeLabel = timeframeLabels[timeframe];

  const refreshJobSummary = useMemo(() => {
    if (!activeJob || activeJob.type !== "refresh") return null;
    if (activeJob.status === "failed") {
      return activeJob.lastError || "Refresh failed.";
    }
    return activeJob.summary;
  }, [activeJob]);

  const refreshButtonLabel =
    activeJob?.type === "refresh" && jobRunning
      ? refreshJobSummary || `${activeJob.completed}/${Math.max(activeJob.total, 0)} Articles Processed`
      : refreshBusy
      ? "Starting…"
      : "Refresh";

  const refreshStatusText =
    activeJob?.type === "refresh" && jobRunning
      ? null
      : refreshJobSummary || refreshError;

  const processingDots = ".".repeat(PROCESSING_PATTERN[processingStep]);

  useEffect(() => {
    if (showProcessing) {
      setRefreshStatusHint(`Processing${processingDots}`);
      return;
    }
    if (!refreshStatusText) {
      setRefreshStatusHint(null);
      return;
    }
    setRefreshStatusHint(refreshStatusText);
    if (jobRunning) return;
    const handle = window.setTimeout(() => {
      setRefreshStatusHint(null);
    }, 5000);
    return () => window.clearTimeout(handle);
  }, [showProcessing, processingDots, refreshStatusText, jobRunning]);

  return (
    <main className="min-h-screen bg-neutral-900 text-white px-6 py-8">
      <Header
        title="News"
        subtitle={`(${timeframeReadCount}/${timeframeTotal} Articles read for ${timeframeLabel})`}
        leftSlot={databaseButton}
        rightSlot={
          <div className="flex items-start gap-2">
            {/* Refresh button + status */}
            <div className="relative flex flex-col items-start pb-4">
              <button
                type="button"
                onClick={handleRefreshNews}
                disabled={refreshBusy || jobRunning}
                className={`${actionButtonClass} ${
                  jobRunning && activeJob?.type === "refresh"
                    ? "border-[var(--highlight-400)] text-[var(--highlight-100)]"
                    : ""
                }`}
              >
                {refreshButtonLabel}
              </button>
              {refreshStatusHint && (
                <span className="absolute left-0 top-full mt-1 text-[10px] text-neutral-400 whitespace-nowrap">
                  {refreshStatusHint}
                </span>
              )}
            </div>

            {/* Sort dropdown */}
            <div className="relative" ref={sortDropdownRef}>
              <button
                type="button"
                onClick={() => setSortOpen((prev) => !prev)}
                className={actionButtonClass}
                aria-haspopup="true"
                aria-expanded={sortOpen}
              >
                Sort by
              </button>
              {sortOpen && (
                <div className="absolute right-0 mt-2 w-72 rounded-xl border border-neutral-700 bg-neutral-900/95 p-3 shadow-lg z-20">
                  {/* Timeframe */}
                  <div className="mb-3">
                    <div className="mb-1 text-[11px] uppercase tracking-wide text-neutral-500">
                      Timeframe
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {(["1D", "1W", "1M", "1Y"] as TimeframeOption[]).map(
                        (tf) => (
                          <button
                            key={tf}
                            type="button"
                            onClick={() => setTimeframe(tf)}
                            className={`rounded-md border px-2 py-1 text-[11px] ${
                              timeframe === tf
                                ? "border-[var(--highlight-400)] text-[var(--highlight-100)]"
                                : "border-neutral-700 text-neutral-300 hover:border-[var(--highlight-400)]"
                            }`}
                          >
                            {tf}
                          </button>
                        )
                      )}
                    </div>
                    <label className="mt-2 flex items-center gap-2 text-[11px] text-neutral-300">
                      <input
                        type="checkbox"
                        className="h-3 w-3 rounded border-neutral-600 bg-neutral-900"
                        checked={showUnreadOnly}
                        onChange={(e) => setShowUnreadOnly(e.target.checked)}
                      />
                      <span>Unread only</span>
                    </label>
                  </div>

                  {/* Author filter */}
                  <div className="mb-3 border-t border-neutral-800 pt-2">
                    <div className="mb-1 text-[11px] uppercase tracking-wide text-neutral-500">
                      Author
                    </div>
                    {allAuthors.length === 0 ? (
                      <p className="text-[11px] text-neutral-500">
                        No authors available yet.
                      </p>
                    ) : (
                      <div className="max-h-28 space-y-1 overflow-y-auto">
                        {allAuthors.map((name) => {
                          const checked =
                            selectedAuthors.includes(name);
                          return (
                            <label
                              key={name}
                              className="flex items-center gap-2 text-[11px] text-neutral-200"
                            >
                              <input
                                type="checkbox"
                                className="h-3 w-3 rounded border-neutral-600 bg-neutral-900"
                                checked={checked}
                                onChange={() =>
                                  setSelectedAuthors((prev) =>
                                    checked
                                      ? prev.filter((a) => a !== name)
                                      : [...prev, name]
                                  )
                                }
                              />
                              <span className="truncate">{name}</span>
                            </label>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* Ticker filter */}
                  <div className="border-t border-neutral-800 pt-2">
                    <div className="mb-1 text-[11px] uppercase tracking-wide text-neutral-500">
                      Ticker
                    </div>
                    <input
                      type="text"
                      value={tickerFilterInput}
                      onChange={(e) =>
                        setTickerFilterInput(e.target.value)
                      }
                      placeholder="e.g. CENX, AA"
                      className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-xs text-neutral-100 placeholder:text-neutral-500 focus:outline-none focus:border-[var(--highlight-400)]"
                    />
                    <p className="mt-1 text-[10px] text-neutral-500">
                      Show articles mentioning any of these tickers.
                    </p>
                  </div>
                  <div className="mt-3 border-t border-neutral-800 pt-2">
                    <div className="mb-1 text-[11px] uppercase tracking-wide text-neutral-500">
                      Mentions
                    </div>
                    <div className="space-y-1 text-[11px] text-neutral-300">
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          className="h-3 w-3 rounded border-neutral-600 bg-neutral-900"
                          checked={filterPortfolioMatches}
                          onChange={(e) => setFilterPortfolioMatches(e.target.checked)}
                        />
                        <span>Portfolio tickers</span>
                      </label>
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          className="h-3 w-3 rounded border-neutral-600 bg-neutral-900"
                          checked={filterWatchlistMatches}
                          onChange={(e) => setFilterWatchlistMatches(e.target.checked)}
                        />
                        <span>Watchlist tickers</span>
                      </label>
                    </div>
                  </div>
                  <div className="mt-3 border-t border-neutral-800 pt-2 flex justify-end">
                    <button
                      type="button"
                      onClick={() => setSortOpen(false)}
                      className="rounded-lg border border-neutral-600 px-3 py-1 text-[11px] text-neutral-200 hover:border-white"
                    >
                      Close
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        }
      />

      {error && (
        <div className="mb-4 rounded-xl border border-red-600/60 bg-red-900/30 px-4 py-3 text-sm text-red-100">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-neutral-400">Loading news…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-neutral-400">
          No summarized articles yet. Add PDFs in the Database and summarize
          them to see items here.
        </p>
      ) : filteredItems.length === 0 ? (
        <p className="text-sm text-neutral-400">
          No articles match the current filters.
        </p>
      ) : (
        <div className="space-y-3">
          {filteredItems.map((item) => {
            const open = openId === item.id;
            const qaState = qaById[item.id] ?? getDefaultQaState();

            return (
              <NewsArticleCard
                key={item.id}
                item={item}
                open={open}
                qaState={qaState}
                onToggleOpen={() => {
                  const willOpen = !open;
                  setOpenId(willOpen ? item.id : null);
                  if (!willOpen && !item.viewed) {
                    void markViewed(item.id);
                  }
                }}
                onToggleQa={() => toggleQa(item.id)}
                onUpdateQaInput={(value) =>
                  updateQaInput(item.id, value)
                }
                onAddQaQuestion={() => addQaQuestion(item.id)}
                onGetQaAnswers={() => void getQaAnswers(item.id)}
                onDeleteQaEntry={(questionId) =>
                  void deleteQaEntry(item.id, questionId)
                }
                onDownload={() => handleDownload(item.id)}
                onOpenRepost={openRepostPanel}
              />
            );
          })}
        </div>
      )}

      {/* Repost overlay */}
      {repostDraft && (
        <div className="fixed inset-0 z-30 flex items-end md:items-center justify-center bg-black/60 px-4 py-6">
          <div className="w-full max-w-lg rounded-2xl border border-neutral-700 bg-neutral-900 p-4 md:p-5 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-neutral-100">
                  {repostDraft.mode === "edit"
                    ? "Edit repost"
                    : "Repost to Notes"}
                </h2>
                <p className="mt-1 text-xs text-neutral-400">
                  Select tickers and add an optional comment.
                </p>
              </div>
              <button
                type="button"
                onClick={closeRepostPanel}
                className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-neutral-700 text-xs text-neutral-300 hover:border-neutral-500 hover:text-neutral-50"
                aria-label="Close repost panel"
                disabled={repostDraft.submitting}
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
                {repostDraft.articleTitle}
              </div>
              {repostDraft.articleDateISO && (
                <div className="text-[11px] text-neutral-500">
                  {formatDateTime(repostDraft.articleDateISO)}
                </div>
              )}
            </div>

            {/* Ticker selection */}
            <div className="space-y-1.5">
              <div className="text-xs uppercase tracking-wide text-neutral-500">
                Tickers
              </div>
              {repostDraft.availableTickers.length === 0 ? (
                <p className="text-xs text-neutral-400">
                  No tickers detected for this article. You can still repost
                  with a comment.
                </p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {repostDraft.availableTickers.map((t) => {
                    const upper = t.toUpperCase();
                    const selected =
                      repostDraft.selectedTickers.includes(upper);
                    return (
                      <button
                        key={upper}
                        type="button"
                        onClick={() => toggleRepostTicker(upper)}
                        disabled={repostDraft.submitting}
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
                value={repostDraft.comment}
                onChange={(e) =>
                  setRepostDraft((prev) =>
                    prev
                      ? { ...prev, comment: e.target.value }
                      : prev
                  )
                }
                disabled={repostDraft.submitting}
                placeholder="Add a quick note (optional)…"
                className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-500 focus:outline-none focus:border-[var(--highlight-400)]"
              />
              <p className="text-[10px] text-neutral-500">
                Your handle, tickers, and comment will appear in Notes.
              </p>
            </div>

            {repostDraft.error && (
              <div className="rounded-md border border-red-600/70 bg-red-900/40 px-3 py-2 text-xs text-red-50">
                {repostDraft.error}
              </div>
            )}

            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={closeRepostPanel}
                disabled={repostDraft.submitting}
                className="inline-flex items-center rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-xs font-medium text-neutral-200 hover:border-neutral-500 disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submitRepost}
                disabled={repostDraft.submitting}
                className="inline-flex items-center rounded-lg border border-[var(--highlight-400)] bg-[var(--highlight-500)]/10 px-4 py-1.5 text-xs font-semibold text-[var(--highlight-100)] hover:border-[var(--highlight-300)] hover:bg-[var(--highlight-500)]/20 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {repostDraft.submitting
                  ? repostDraft.mode === "edit"
                    ? "Updating…"
                    : "Reposting…"
                  : repostDraft.mode === "edit"
                  ? "Update repost"
                  : "Repost"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
