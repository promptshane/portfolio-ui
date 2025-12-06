// src/app/news/page.tsx
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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

const LOADING_DOTS = [".", "..", "..."] as const;

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
  const [tickerFilterInput, setTickerFilterInput] =
    useState<string>("");
  const [showUnreadOnly, setShowUnreadOnly] = useState(false);
  const [filterPortfolioMatches, setFilterPortfolioMatches] =
    useState(false);
  const [filterWatchlistMatches, setFilterWatchlistMatches] =
    useState(false);
  const [sortPrefsKey, setSortPrefsKey] = useState<string | null>(null);
  const sortPrefsLoadedRef = useRef(false);

  // Repost UI state
  const [repostDraft, setRepostDraft] = useState<RepostDraft | null>(
    null
  );
  const { jobs, jobRunning, refreshJobs, setPolling } = useNewsJobs({ pollIntervalMs: 1500 });
  const [refreshBusy, setRefreshBusy] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [databaseError, setDatabaseError] = useState<string | null>(null);

  const actionButtonClass =
    "inline-flex items-center rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-sm font-medium text-neutral-100 hover:border-[var(--highlight-400)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--highlight-400)]";

  const [refreshPhaseActive, setRefreshPhaseActive] = useState(false);
  const [loadingFrame, setLoadingFrame] = useState(0);
  const [refreshStatus, setRefreshStatus] = useState<string | null>(null);
  const [expectedSummaryTotal, setExpectedSummaryTotal] = useState<number | null>(null);
  const [refreshProgressCompleted, setRefreshProgressCompleted] = useState(0);
  const [refreshJobId, setRefreshJobId] = useState<number | null>(null);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [refreshFinished, setRefreshFinished] = useState(true);
  const completionTimerRef = useRef<number | null>(null);
  const refreshCancelledRef = useRef(false);
  const progressFlashTimerRef = useRef<number | null>(null);
  const [progressFlash, setProgressFlash] = useState<string | null>(null);
  const lastJobCompletedRef = useRef(0);
  const lastProgressTextRef = useRef<string | null>(null);
  const loadingActive = refreshBusy || (!refreshFinished && (refreshPhaseActive || Boolean(refreshJobId)));

  const clearCompletionTimer = useCallback(() => {
    if (completionTimerRef.current) {
      window.clearTimeout(completionTimerRef.current);
      completionTimerRef.current = null;
    }
  }, []);

  const clearProgressFlash = useCallback(() => {
    if (progressFlashTimerRef.current) {
      window.clearTimeout(progressFlashTimerRef.current);
      progressFlashTimerRef.current = null;
    }
    setProgressFlash(null);
  }, []);

  const showProgressFlash = useCallback((text: string, durationMs = 5000) => {
    setProgressFlash(text);
    if (progressFlashTimerRef.current) {
      window.clearTimeout(progressFlashTimerRef.current);
    }
    progressFlashTimerRef.current = window.setTimeout(() => {
      setProgressFlash(null);
      progressFlashTimerRef.current = null;
    }, durationMs);
  }, []);

  const resetRefreshPhase = useCallback(() => {
    clearCompletionTimer();
    clearProgressFlash();
    refreshCancelledRef.current = false;
    setRefreshPhaseActive(false);
    setRefreshStatus(null);
    setExpectedSummaryTotal(null);
    setRefreshProgressCompleted(0);
    setRefreshJobId(null);
    setCancelBusy(false);
    setRefreshFinished(true);
    lastJobCompletedRef.current = 0;
    lastProgressTextRef.current = null;
  }, [clearCompletionTimer, clearProgressFlash]);

  const scheduleRefreshReset = useCallback(
    (delayMs = 5000) => {
      clearCompletionTimer();
      completionTimerRef.current = window.setTimeout(() => {
        resetRefreshPhase();
      }, delayMs);
    },
    [clearCompletionTimer, resetRefreshPhase]
  );

  useEffect(() => {
    const shouldAnimate = loadingActive || (refreshPhaseActive && !refreshFinished);
    if (!shouldAnimate) {
      setLoadingFrame(0);
      return;
    }
    const interval = window.setInterval(() => {
      setLoadingFrame((prev) => (prev + 1) % LOADING_DOTS.length);
    }, 450);
    return () => window.clearInterval(interval);
  }, [loadingActive, refreshPhaseActive, refreshFinished]);

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
    setPolling(jobRunning || Boolean(refreshJobId));
  }, [jobRunning, refreshJobId, setPolling]);

  useEffect(() => {
    let cancelled = false;
    const hydratePrefs = (key: string) => {
      try {
        const raw = window.localStorage.getItem(key);
        if (!raw) return;
        const parsed = JSON.parse(raw);
        if (typeof parsed?.timeframe === "string") setTimeframe(parsed.timeframe as TimeframeOption);
        if (typeof parsed?.tickerFilterInput === "string") setTickerFilterInput(parsed.tickerFilterInput);
        if (typeof parsed?.showUnreadOnly === "boolean") setShowUnreadOnly(parsed.showUnreadOnly);
        if (typeof parsed?.filterPortfolioMatches === "boolean")
          setFilterPortfolioMatches(parsed.filterPortfolioMatches);
        if (typeof parsed?.filterWatchlistMatches === "boolean")
          setFilterWatchlistMatches(parsed.filterWatchlistMatches);
      } catch {
        /* ignore malformed prefs */
      } finally {
        sortPrefsLoadedRef.current = true;
      }
    };

    const fetchProfile = async () => {
      try {
        const res = await fetch("/api/user/profile", { cache: "no-store", credentials: "include" });
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        const id = data?.id || data?.userId || data?.user?.id;
        const email = data?.email || data?.user?.email;
        const key = `news-sort:${id ?? email ?? "anon"}`;
        setSortPrefsKey(key);
        hydratePrefs(key);
      } catch {
        if (cancelled) return;
        const key = "news-sort:anon";
        setSortPrefsKey(key);
        hydratePrefs(key);
      }
    };

    fetchProfile();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!sortPrefsKey || !sortPrefsLoadedRef.current) return;
    const payload = {
      timeframe,
      tickerFilterInput,
      showUnreadOnly,
      filterPortfolioMatches,
      filterWatchlistMatches,
    };
    try {
      window.localStorage.setItem(sortPrefsKey, JSON.stringify(payload));
    } catch {
      /* ignore quota errors */
    }
  }, [filterPortfolioMatches, filterWatchlistMatches, showUnreadOnly, sortPrefsKey, tickerFilterInput, timeframe]);

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

  const handleDatabaseAccess = async () => {
    setDatabaseError(null);
    const password = window.prompt("Enter dev password to view the Database:");
    if (!password) return;
    try {
      const res = await fetch("/api/ftv/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Unauthorized");
      router.push("/news/database");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Access denied";
      setDatabaseError(msg);
      window.alert(msg);
    }
  };

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

  const fetchVerifiedSenders = useCallback(async (): Promise<string[]> => {
    try {
      const res = await fetch("/api/user/verified-emails", { cache: "no-store", credentials: "include" });
      const data = await res.json().catch(() => ({}));
      const selected: string[] = Array.isArray(data?.selected) ? data.selected : [];
      const combined: string[] = Array.isArray(data?.combined) ? data.combined : [];
      const list = selected.length ? selected : combined;
      return list.map((e) => e.trim()).filter(Boolean);
    } catch {
      return [];
    }
  }, []);

  const startSummarizeJob = useCallback(
    async (articleIds: string[]) => {
      const ids = Array.from(new Set(articleIds.map((id) => String(id).trim()).filter(Boolean)));
      if (!ids.length) return null;
      const res = await fetch("/api/news/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          type: "summarize",
          articleIds: ids,
          replaceExisting: true,
          label: "refresh-auto",
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || `HTTP ${res.status}`);
      }
      await refreshJobs();
      return data?.job ?? null;
    },
    [refreshJobs]
  );

  const fetchUnsummarizedIds = useCallback(async (): Promise<string[]> => {
    try {
      const res = await fetch("/api/news/articles", { cache: "no-store", credentials: "include" });
      const data = (await res.json().catch(() => ({}))) as { articles?: ApiArticle[] };
      if (!Array.isArray(data?.articles)) return [];
      return data.articles
        .filter((a) => !a.hasSummary)
        .map((a) => String(a.id))
        .filter(Boolean);
    } catch {
      return [];
    }
  }, []);

  async function handleRefreshNews() {
    if (refreshBusy || jobRunning || refreshPhaseActive) return;
    setRefreshError(null);
    resetRefreshPhase();
    setRefreshFinished(false);
    refreshCancelledRef.current = false;
    setRefreshPhaseActive(true);
    setRefreshBusy(true);
    try {
      const verifiedSenders = await fetchVerifiedSenders();
      if (!verifiedSenders.length) {
        throw new Error("Add at least one verified sender email in Settings before refreshing.");
      }

      const ingestRes = await fetch("/api/news/email-ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          senders: verifiedSenders,
          lookbackDays: 7,
          maxEmails: 100,
        }),
      });
      const ingestData = await ingestRes.json().catch(() => ({}));
      if (!ingestRes.ok) {
        throw new Error(ingestData?.error || `Refresh failed: HTTP ${ingestRes.status}`);
      }

      const summary = ingestData?.summary ?? {};
      const createdIds: string[] = Array.isArray(summary?.createdArticleIds)
        ? summary.createdArticleIds.map((id: any) => String(id)).filter(Boolean)
        : [];

      const filesInserted = Number(summary.filesInserted || 0);
      const processed = Number(summary.processedEmails || 0);
      const duplicates = Number(summary.duplicates || 0);
      const pdfUploads = Number(summary.pdfUploads || 0);
      const attachmentPdfUploads = Number(summary.attachmentPdfUploads || 0);
      const bodyPdfUploads = Number(summary.bodyPdfUploads || 0);
      const detailParts: string[] = [];
      if (attachmentPdfUploads) {
        detailParts.push(
          `${attachmentPdfUploads} attachment PDF${attachmentPdfUploads === 1 ? "" : "s"}`
        );
      }
      if (bodyPdfUploads) {
        detailParts.push(
          `${bodyPdfUploads} body PDF${bodyPdfUploads === 1 ? "" : "s"}`
        );
      }
      const detailLabel = detailParts.length ? ` (${detailParts.join(" + ")})` : "";

      const statusMessage = `Loaded ${filesInserted} file${filesInserted === 1 ? "" : "s"} (${pdfUploads} PDF)${detailLabel} from ${processed} email${processed === 1 ? "" : "s"}. Skipped ${duplicates} duplicate${duplicates === 1 ? "" : "s"}.`;
      setRefreshStatus(statusMessage);

      if (refreshCancelledRef.current) {
        await loadArticles({ silent: true });
        setRefreshFinished(true);
        scheduleRefreshReset(1000);
        return;
      }

      const unsummarizedIds = await fetchUnsummarizedIds();
      const summaryTargets = Array.from(new Set([...unsummarizedIds, ...createdIds]));

      if (summaryTargets.length > 0) {
        setExpectedSummaryTotal(summaryTargets.length);
        setRefreshProgressCompleted(0);
        const initialLabel = `(${0}/${summaryTargets.length}) Articles Summarized`;
        lastProgressTextRef.current = initialLabel;
        showProgressFlash(initialLabel);
        const job = await startSummarizeJob(summaryTargets);
        const jobId =
          job && typeof (job as any).id !== "undefined" && (job as any).id !== null
            ? Number((job as any).id)
            : null;
        if (jobId && !Number.isNaN(jobId)) {
          setRefreshJobId(jobId);
        }
      } else {
        setRefreshStatus(statusMessage);
        setRefreshFinished(true);
        scheduleRefreshReset(5000);
      }

      await loadArticles({ silent: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to refresh.";
      setRefreshError(message);
      setRefreshFinished(true);
      scheduleRefreshReset(3000);
    } finally {
      setRefreshBusy(false);
    }
  }

  const handleCancelRefresh = useCallback(async () => {
    if (!refreshPhaseActive && !refreshJobId) return;
    refreshCancelledRef.current = true;
    setCancelBusy(true);
    setRefreshError(null);
    try {
      await fetch("/api/news/jobs", {
        method: "DELETE",
        credentials: "include",
      });
      setRefreshStatus("Cancelled");
    } catch (err: any) {
      setRefreshError(err?.message || "Failed to cancel.");
    } finally {
      setCancelBusy(false);
      setRefreshFinished(true);
      scheduleRefreshReset(1000);
    }
  }, [refreshJobId, refreshPhaseActive, scheduleRefreshReset]);

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
    void markViewed(id);
    const url = `/news/viewer/${encodeURIComponent(id)}`;
    window.open(url, "_blank", "noreferrer");
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

  const tickerFilterTokens = tickerFilterInput
    .split(/[,\s]+/)
    .map((t) => t.trim().toUpperCase())
    .filter(Boolean);

  const filteredItems = items.filter((item) => {
    // Timeframe filter
    let withinTimeframe = true;
    const timeMs = new Date(item.dateISO).getTime();
    if (!Number.isNaN(timeMs) && timeframe !== "All") {
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

  const timeframeReadCount = filteredItems.filter((item) => item.viewed).length;
  const timeframeTotal = filteredItems.length;
  const timeframeLabels: Record<TimeframeOption, string> = {
    "1D": "Today",
    "1W": "this Week",
    "1M": "this Month",
    "1Y": "this Year",
    "All": "All Time",
  };
  const timeframeLabel = timeframeLabels[timeframe];
  const loadingDots = LOADING_DOTS[loadingFrame % LOADING_DOTS.length];
  const refreshJob =
    refreshJobId != null ? jobs.find((j) => j.id === refreshJobId) ?? null : null;
  const refreshJobRunning = Boolean(
    refreshJob && (refreshJob.status === "pending" || refreshJob.status === "running")
  );
  const refreshActive =
    (!refreshFinished && (refreshPhaseActive || refreshBusy || refreshJobRunning || Boolean(refreshJobId))) ||
    cancelBusy;
  const refreshButtonLabel = refreshActive ? (cancelBusy ? "Cancelling..." : "Cancel") : "Refresh";


  useEffect(() => {
    if (!refreshPhaseActive) return;
    if (!refreshJob) return;

    if (refreshJob.total > 0) {
      setExpectedSummaryTotal(refreshJob.total);
    }

    const completed = Math.max(refreshJob.completed ?? 0, 0);
    const prevCompleted = lastJobCompletedRef.current;
    setRefreshProgressCompleted(completed);

    const total = refreshJob.total && refreshJob.total > 0 ? refreshJob.total : expectedSummaryTotal ?? null;
    if (total && total > 0) {
      const done = Math.min(completed, total);
      const label = `(${done}/${total}) Articles Summarized`;
      if (label !== lastProgressTextRef.current) {
        lastProgressTextRef.current = label;
        showProgressFlash(label);
      }
    }

    if (completed > prevCompleted) {
      lastJobCompletedRef.current = completed;
      void loadArticles({ silent: true });
      void refreshJobs();
    } else {
      lastJobCompletedRef.current = completed;
    }

    const active = refreshJob.status === "pending" || refreshJob.status === "running";
    if (!active) {
      if (refreshJob.lastError) {
        setRefreshError((prev) => prev ?? refreshJob.lastError);
      }
      setRefreshFinished(true);
      setRefreshJobId(null);
      scheduleRefreshReset(5000);
    }
  }, [refreshJob, refreshPhaseActive, scheduleRefreshReset, expectedSummaryTotal, showProgressFlash, loadArticles]);

  useEffect(() => {
    return () => {
      clearCompletionTimer();
      clearProgressFlash();
    };
  }, [clearCompletionTimer, clearProgressFlash]);

  const defaultSubtitle = `(${timeframeReadCount}/${timeframeTotal}) Articles Read ${timeframeLabel}`;
  const progressTotal =
    refreshJob && refreshJob.total > 0
      ? refreshJob.total
      : expectedSummaryTotal && expectedSummaryTotal > 0
      ? expectedSummaryTotal
      : null;
  const progressCompleted = refreshJob
    ? Math.max(refreshJob.completed ?? 0, refreshProgressCompleted ?? 0)
    : refreshProgressCompleted ?? 0;
  const refreshSubtitle = (() => {
    if (!refreshPhaseActive) return null;
    if (refreshError) return refreshError;
    if (progressFlash) return progressFlash;
    return `Loading${loadingDots}`;
  })();
  const computedSubtitle = refreshSubtitle ?? defaultSubtitle;

  return (
    <main className="min-h-screen bg-neutral-900 text-white px-6 py-8">
      <Header
        title="News"
        subtitle={computedSubtitle}
        rightSlot={
          <div className="flex items-start gap-3">
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
                      {(["1D", "1W", "1M", "1Y", "All"] as TimeframeOption[]).map(
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
                  </div>

                  {/* Read status */}
                  <div className="mb-3">
                    <div className="mb-1 text-[11px] uppercase tracking-wide text-neutral-500">
                      Read status
                    </div>
                    <div className="inline-flex rounded-md border border-neutral-700 bg-neutral-950 p-0.5">
                      {[
                        { key: "unread", label: "Unread" },
                        { key: "all", label: "All News" },
                      ].map((option) => {
                        const isUnread = option.key === "unread";
                        const active = showUnreadOnly === isUnread;
                        return (
                          <button
                            key={option.key}
                            type="button"
                            onClick={() => setShowUnreadOnly(isUnread)}
                            className={`px-3 py-1 text-[11px] font-medium rounded ${active ? "bg-[var(--highlight-500)]/15 text-[var(--highlight-50)] border border-[var(--highlight-400)]" : "text-neutral-300 border border-transparent hover:border-neutral-700"}`}
                          >
                            {option.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="my-2 border-t border-neutral-800" />

                  {/* Mentions */}
                  <div className="space-y-2">
                    <div className="text-[11px] uppercase tracking-wide text-neutral-500">
                      Mentions
                    </div>
                    <label className="flex items-center gap-2 text-[11px] text-neutral-200">
                      <input
                        type="checkbox"
                        className="h-3 w-3 rounded border-neutral-600 bg-neutral-900 accent-[var(--good-400)]"
                        checked={filterPortfolioMatches}
                        onChange={(e) => setFilterPortfolioMatches(e.target.checked)}
                      />
                      <span>Portfolio</span>
                    </label>
                    <label className="flex items-center gap-2 text-[11px] text-neutral-200">
                      <input
                        type="checkbox"
                        className="h-3 w-3 rounded border-neutral-600 bg-neutral-900 accent-[var(--good-400)]"
                        checked={filterWatchlistMatches}
                        onChange={(e) => setFilterWatchlistMatches(e.target.checked)}
                      />
                      <span>Watchlist</span>
                    </label>
                  </div>

                  <div className="my-2 border-t border-neutral-800" />

                  {/* Ticker filter */}
                  <div className="space-y-1">
                    <div className="text-[11px] uppercase tracking-wide text-neutral-500">
                      Ticker
                    </div>
                    <input
                      type="text"
                      value={tickerFilterInput}
                      onChange={(e) =>
                        setTickerFilterInput(e.target.value.toUpperCase())
                      }
                      placeholder="e.g. CENX, AA"
                      className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-xs text-neutral-100 placeholder:text-neutral-500 focus:outline-none focus:border-[var(--highlight-400)]"
                    />
                    <p className="text-[10px] text-neutral-500">
                      Show articles mentioning any of these tickers.
                    </p>
                  </div>

                  <div className="my-3 border-t border-neutral-800" />

                  <div className="flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={handleDatabaseAccess}
                      className="text-[11px] underline text-neutral-300 hover:text-white"
                    >
                      View Database
                    </button>
                    <button
                      type="button"
                      onClick={() => setSortOpen(false)}
                      className="rounded-lg border border-neutral-600 px-3 py-1 text-[11px] text-neutral-200 hover:border-[var(--highlight-400)] hover:text-[var(--highlight-100)]"
                    >
                      Close
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Refresh / Cancel button */}
            <button
              type="button"
              onClick={refreshActive ? handleCancelRefresh : handleRefreshNews}
              disabled={cancelBusy}
              className={`${actionButtonClass} ${
                refreshActive
                  ? "border-red-500 text-red-100 bg-transparent hover:border-red-400"
                  : ""
              }`}
            >
              {refreshButtonLabel}
            </button>
          </div>
        }
      />

      {error && (
        <div className="mb-4 rounded-xl border border-red-600/60 bg-red-900/30 px-4 py-3 text-sm text-red-100">
          {error}
        </div>
      )}
      {databaseError && (
        <div className="mb-3 rounded-lg border border-red-600/60 bg-red-900/30 px-3 py-2 text-xs text-red-100">
          {databaseError}
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
                  if (willOpen) {
                    if (openId && openId !== item.id) {
                      const prev = items.find((it) => it.id === openId);
                      if (prev && !prev.viewed) {
                        void markViewed(prev.id);
                      }
                    }
                    setOpenId(item.id);
                  } else {
                    setOpenId(null);
                    if (!item.viewed) {
                      void markViewed(item.id);
                    }
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
