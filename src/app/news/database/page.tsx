// src/app/news/database/page.tsx
"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { useRouter } from "next/navigation";
import Header from "../../components/header";
import { useNewsJobs } from "../useNewsJobs";

type Article = {
  id: string;
  originalFilename: string;
  uploadedAt: string;
  hasSummary: boolean;
  title: string | null;
  author: string | null;
  datePublished: string | null;
  summaryText: string | null;
  keyPointsJson: string | null;
  actionsJson: string | null;
  tickersJson: string | null;
  summarizedAt: string | null;
  storageDecision?: string | null;
  qualityTag?: string | null;
  qualityNote?: string | null;
  discountJson?: string | null;
};

type ParsedArticleData = {
  title: string;
  keyPoints: string[];
  actions: string[];
  tickers: string[];
  ongoingActions: string[];
  ongoingTickers: string[];
};

function formatDateTime(iso: string | null) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

type ListTimeframe = "1D" | "1W" | "1M" | "1Y" | "All";

function normalizeTagValue(value?: string | null): string | null {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed.length ? trimmed : null;
}

function getArticleQuality(article: Article): { tag: "Good" | "Error" | null; note: string } {
  const raw = (normalizeTagValue(article.qualityTag) || "").toLowerCase();
  let tag: "Good" | "Error" | null = null;
  if (raw === "error") tag = "Error";
  else if (raw === "good") tag = "Good";
  else if (article.hasSummary) tag = "Good";

  const note = normalizeTagValue(article.qualityNote) ?? "";
  return { tag, note };
}

function parseArticleData(article: Article): ParsedArticleData {
  const title =
    (article.title && article.title.trim().length > 0
      ? article.title
      : article.originalFilename) || "Untitled article";

  const discount = parseDiscountData(article.discountJson ?? null);

  let keyPoints: string[] = [];
  if (article.keyPointsJson) {
    try {
      const parsed = JSON.parse(article.keyPointsJson);
      if (Array.isArray(parsed)) {
        keyPoints = parsed.map((v: any) => String(v));
      }
    } catch {
      // ignore parse errors
    }
  }

  let actions: string[] = [];
  if (article.actionsJson) {
    try {
      const parsed = JSON.parse(article.actionsJson);
      if (Array.isArray(parsed)) {
        actions = parsed
          .map((v: any) => {
            if (typeof v === "string") return v;
            if (v && typeof v.description === "string") return v.description;
            return "";
          })
          .filter(Boolean);
      }
    } catch {
      // ignore parse errors
    }
  }

  let tickers: string[] = [];
  if (article.tickersJson) {
    try {
      const parsed = JSON.parse(article.tickersJson);
      if (Array.isArray(parsed)) {
        tickers = parsed
          .map((v: any) => {
            if (typeof v === "string") return v;
            if (v && typeof v.symbol === "string") return v.symbol;
            return "";
          })
          .filter(Boolean);
      }
    } catch {
      // ignore parse errors
    }
  }

  return {
    title,
    keyPoints,
    actions,
    tickers,
    ongoingActions: discount.ongoingActions,
    ongoingTickers: discount.ongoingTickers,
  };
}

function parseDiscountData(discountJson: string | null): {
  ongoingActions: string[];
  ongoingTickers: string[];
} {
  const result = { ongoingActions: [] as string[], ongoingTickers: [] as string[] };
  if (!discountJson) return result;

  try {
    const parsed = JSON.parse(discountJson);

    const formatMoney = (value: any) => {
      const num = Number(value);
      if (!Number.isFinite(num)) return "";
      return `$${num.toLocaleString(undefined, {
        maximumFractionDigits: 2,
        minimumFractionDigits: 0,
      })}`;
    };

    const actionsSource =
      parsed && typeof parsed === "object" && Array.isArray((parsed as any).ongoing_actions)
        ? (parsed as any).ongoing_actions
        : null;

    if (actionsSource) {
      result.ongoingActions = actionsSource
        .map((a: any) => {
          if (typeof a === "string") return a;
          if (a && typeof a.description === "string") return a.description;
          return "";
        })
        .filter(Boolean);

      for (const a of actionsSource) {
        const sym =
          typeof a?.ticker === "string"
            ? a.ticker.trim().toUpperCase()
            : typeof a === "string"
            ? a.trim().toUpperCase()
            : "";
        if (sym) result.ongoingTickers.push(sym);
      }
    }

    const positionsSource =
      parsed && typeof parsed === "object" && Array.isArray((parsed as any).positions)
        ? (parsed as any).positions
        : null;

    if (positionsSource) {
      for (const pos of positionsSource) {
        const symbol = typeof pos?.symbol === "string" ? pos.symbol.trim().toUpperCase() : "";
        const name = typeof pos?.name === "string" ? pos.name.trim() : "";
        const rec = typeof pos?.recommendation === "string" ? pos.recommendation.trim() : "";
        const fairValue = formatMoney(pos?.fair_value ?? pos?.fairValue);
        const stopPrice = formatMoney(pos?.stop_price ?? pos?.stopPrice);
        const entryPrice = formatMoney(pos?.entry_price ?? pos?.entryPrice);

        const label = [symbol, name].filter(Boolean).join(" — ") || "Position";
        const parts: string[] = [];
        if (rec) parts.push(rec);
        if (entryPrice) parts.push(`entry ${entryPrice}`);
        if (fairValue) parts.push(`buy-up-to ${fairValue}`);
        if (stopPrice) parts.push(`stop ${stopPrice}`);

        const detail = parts.length ? parts.join("; ") : "continued guidance";
        result.ongoingActions.push(
          `Maintain ${detail} for ${label} (ongoing guidance).`
        );
        if (symbol) {
          result.ongoingTickers.push(symbol);
        }
      }
    }

    const tickersSource =
      parsed && typeof parsed === "object" && Array.isArray((parsed as any).ongoing_tickers)
        ? (parsed as any).ongoing_tickers
        : null;

    if (tickersSource) {
      result.ongoingTickers = tickersSource
        .map((t: any) => {
          if (typeof t === "string") return t;
          if (t && typeof t.symbol === "string") return t.symbol;
          return "";
        })
        .filter(Boolean);
    }
  } catch {
    /* ignore parse errors */
  }

  result.ongoingTickers = Array.from(new Set(result.ongoingTickers));
  result.ongoingActions = result.ongoingActions.filter(Boolean);
  return result;
}

function shortenFilename(name: string, maxLength = 52) {
  if (!name) return "";
  if (name.length <= maxLength) return name;
  const extMatch = name.match(/(\.[^./\\]+)$/);
  const ext = extMatch ? extMatch[1] : "";
  const baseLength = Math.max(maxLength - ext.length - 3, 12);
  return `${name.slice(0, baseLength)}...${ext}`;
}

export default function NewsDatabasePage() {
  const router = useRouter();

  const [articles, setArticles] = useState<Article[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [uploading, setUploading] = useState<boolean>(false);
  const [summarizingSelected, setSummarizingSelected] = useState<boolean>(false);
  const [resummarizingSelected, setResummarizingSelected] = useState<boolean>(false);
  const [deletingSelected, setDeletingSelected] = useState<boolean>(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [ongoingOpen, setOngoingOpen] = useState<Record<string, boolean>>({});

  const [openId, setOpenId] = useState<string | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [fileInputKey, setFileInputKey] = useState<number>(0);
  const [emailSenders, setEmailSenders] = useState<string>("");
  const [emailLookbackDays, setEmailLookbackDays] = useState<number>(2);
  const [emailMaxEmails, setEmailMaxEmails] = useState<number>(20);
  const [emailUnreadOnly, setEmailUnreadOnly] = useState<boolean>(false);
  const [loadingEmails, setLoadingEmails] = useState<boolean>(false);
  const [emailStatus, setEmailStatus] = useState<string | null>(null);
  const emailPrefillRef = useRef(false);
  const emailSendersValueRef = useRef("");
  useEffect(() => {
    emailSendersValueRef.current = emailSenders;
  }, [emailSenders]);

  const loadArticles = useCallback(async () => {
    try {
      setError(null);
      const res = await fetch("/api/news/articles");
      if (!res.ok) {
        throw new Error(`Failed to load articles: ${res.status}`);
      }
      const data = (await res.json()) as { articles: Article[] };
      setArticles(data.articles ?? []);
    } catch (err: any) {
      setError(err?.message || "Failed to load articles.");
    } finally {
      setLoading(false);
    }
  }, []);

  const { activeJob, jobRunning, refreshJobs, setPolling } = useNewsJobs();
  useEffect(() => {
    void refreshJobs();
  }, [refreshJobs]);

  useEffect(() => {
    setPolling(jobRunning);
  }, [jobRunning, setPolling]);

  const jobWasRunningRef = useRef(jobRunning);
  const jobStatusTimerRef = useRef<number | null>(null);
  const [jobStatusText, setJobStatusText] = useState<string | null>(null);

  const clearJobStatusTimer = useCallback(() => {
    if (jobStatusTimerRef.current) {
      window.clearTimeout(jobStatusTimerRef.current);
      jobStatusTimerRef.current = null;
    }
  }, []);

  const formatJobStatus = useCallback(() => {
    if (!activeJob) return null;
    const verb =
      activeJob.type === "refresh"
        ? "Refreshing"
        : activeJob.type === "resummarize"
        ? "Resummarizing"
        : "Summarizing";
    if (activeJob.total && activeJob.total > 0) {
      const done = Math.min(Math.max(activeJob.completed ?? 0, 0), activeJob.total);
      return `${verb}: (${done}/${activeJob.total}) Articles Summarized`;
    }
    if (activeJob.summary) return `${verb}: ${activeJob.summary}`;
    return `${verb}: In progress`;
  }, [activeJob]);

  useEffect(() => {
    if (jobRunning && activeJob) {
      clearJobStatusTimer();
      setJobStatusText(formatJobStatus());
      return;
    }

    if (!jobRunning && activeJob) {
      setJobStatusText(formatJobStatus());
      clearJobStatusTimer();
      jobStatusTimerRef.current = window.setTimeout(() => {
        setJobStatusText(null);
        jobStatusTimerRef.current = null;
      }, 5000);
      return;
    }

    if (!jobRunning) {
      clearJobStatusTimer();
      setJobStatusText(null);
    }
  }, [activeJob, jobRunning, clearJobStatusTimer, formatJobStatus]);

  useEffect(() => {
    return () => {
      clearJobStatusTimer();
    };
  }, [clearJobStatusTimer]);

  useEffect(() => {
    if (jobWasRunningRef.current && !jobRunning) {
      void loadArticles();
    }
    jobWasRunningRef.current = jobRunning;
  }, [jobRunning, loadArticles]);

  const [timeframeFilter, setTimeframeFilter] = useState<ListTimeframe>("All");
  const [summaryFilter, setSummaryFilter] = useState<"all" | "summarized" | "unsummarized">("all");
  const [sortOpen, setSortOpen] = useState(false);
  const sortMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!sortOpen) return;
    const handlePointer = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!sortMenuRef.current) return;
      if (target && sortMenuRef.current.contains(target)) return;
      setSortOpen(false);
    };
    document.addEventListener("pointerdown", handlePointer);
    return () => {
      document.removeEventListener("pointerdown", handlePointer);
    };
  }, [sortOpen]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/user/verified-emails", { cache: "no-store" });
        if (!res.ok || !active) return;
        const data = (await res.json()) as { emails?: string[]; selected?: string[]; combined?: string[] };
        const selected = Array.isArray(data?.selected) ? data.selected : [];
        const combined = Array.isArray(data?.combined) ? data.combined : [];
        const saved = selected.length ? selected : Array.isArray(data?.emails) ? data.emails : combined;
        if (
          !emailPrefillRef.current &&
          !emailSendersValueRef.current.trim() &&
          saved.length
        ) {
          emailPrefillRef.current = true;
          setEmailSenders(saved.join("\n"));
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    void loadArticles();
  }, [loadArticles]);

  function parseVerifiedSenders(value: string): string[] {
    return value
      .split(/[\n,]+/)
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const formData = new FormData();
    Array.from(files).forEach((file) => {
      formData.append("files", file);
    });

    try {
      setError(null);
      setInfo(null);
      setUploading(true);
      const res = await fetch("/api/news/articles", {
        method: "POST",
        body: formData,
      });

      const data = (await res.json()) as {
        articles?: Article[];
        duplicates?: number;
        error?: string;
      };

      if (!res.ok) {
        const message = data?.error || `Upload failed: ${res.status}`;
        throw new Error(message);
      }

      if (typeof data.duplicates === "number" && data.duplicates > 0) {
        setInfo(
          `Skipped ${data.duplicates} duplicate PDF${
            data.duplicates > 1 ? "s" : ""
          }; they are already in the database.`
        );
      } else {
        setInfo(null);
      }

      await loadArticles();
    } catch (err: any) {
      setError(err?.message || "Failed to upload PDF(s).");
    } finally {
      setUploading(false);
      setFileInputKey((k) => k + 1);
    }
  }

  async function handleLoadEmails() {
    const senders = parseVerifiedSenders(emailSenders);

    try {
      setError(null);
      setInfo(null);
      setEmailStatus(null);
      setLoadingEmails(true);

      const res = await fetch("/api/news/email-ingest", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          senders,
          lookbackDays: emailLookbackDays,
          unreadOnly: emailUnreadOnly,
          maxEmails: emailMaxEmails,
        }),
      });

      let data: any = null;
      try {
        data = await res.json();
      } catch {
        // ignore parse errors; handled below
      }

      if (!res.ok) {
        const message =
          (data && typeof data.error === "string" && data.error) ||
          `Failed to load emails: ${res.status}`;
        throw new Error(message);
      }

      const summary = data?.summary;
      if (!summary) {
        throw new Error("Server did not return a summary.");
      }

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

      const message = `Loaded ${filesInserted} file${
        filesInserted === 1 ? "" : "s"
      } (${pdfUploads} PDF)${detailLabel} from ${processed} email${
        processed === 1 ? "" : "s"
      }. Skipped ${duplicates} duplicate${
        duplicates === 1 ? "" : "s"
      }.`;
      setEmailStatus(message);

      await loadArticles();
    } catch (err: any) {
      setError(err?.message || "Failed to load emails.");
    } finally {
      setLoadingEmails(false);
    }
  }

  async function enqueueJob(
    type: "summarize" | "resummarize",
    articleIds: string[],
    label?: string
  ) {
    const friendly = type === "resummarize" ? "Resummarize" : "Summarize";
    const res = await fetch("/api/news/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        type,
        articleIds,
        label,
      }),
    });
    if (!res.ok) {
      let message = `${friendly} failed: ${res.status}`;
      try {
        const data = await res.json();
        if (data?.error) message = data.error;
      } catch {
        /* ignore */
      }
      throw new Error(message);
    }
    await refreshJobs();
  }

  async function handleSummarizeSelected() {
    const toSummarize = selectedArticles.filter((a) => !a.hasSummary);
    if (!toSummarize.length) return;

    try {
      setError(null);
      setSummarizingSelected(true);
      await enqueueJob(
        "summarize",
        toSummarize.map((a) => a.id),
        `${timeframeFilter}-${summaryFilter}-selected`
      );
    } catch (err: any) {
      setError(err?.message || "Failed to summarize selected PDFs.");
    } finally {
      setSummarizingSelected(false);
    }
  }

  async function handleResummarizeSelected() {
    const toResummarize = selectedArticles.filter((a) => a.hasSummary);
    if (!toResummarize.length) return;

    try {
      setError(null);
      setResummarizingSelected(true);
      await enqueueJob(
        "resummarize",
        toResummarize.map((a) => a.id),
        `${timeframeFilter}-${summaryFilter}-selected`
      );
    } catch (err: any) {
      setError(err?.message || "Failed to resummarize selected PDFs.");
    } finally {
      setResummarizingSelected(false);
    }
  }

  async function handleDeleteSelected() {
    const selectedSet = new Set(selectedIds);
    const toDelete = articles.filter((article) => selectedSet.has(article.id));
    if (!toDelete.length) return;

    const confirmed = window.confirm(
      `Delete ${toDelete.length} PDF${toDelete.length === 1 ? "" : "s"} and their records from the database?`
    );
    if (!confirmed) return;

    try {
      setError(null);
      setDeletingSelected(true);

      for (const article of toDelete) {
        const res = await fetch(`/api/news/articles/${encodeURIComponent(article.id)}`, {
          method: "DELETE",
        });
        if (!res.ok) {
          throw new Error(`Delete failed for ${article.originalFilename}`);
        }
      }

      setArticles((prev) => prev.filter((article) => !selectedSet.has(article.id)));
      setSelectedIds([]);
    } catch (err: any) {
      setError(err?.message || "Failed to delete one or more PDFs.");
    } finally {
      setDeletingSelected(false);
    }
  }

  const filteredArticles = useMemo(() => {
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    let maxAge = Infinity;
    if (timeframeFilter === "1D") maxAge = dayMs * 1;
    else if (timeframeFilter === "1W") maxAge = dayMs * 7;
    else if (timeframeFilter === "1M") maxAge = dayMs * 30;
    else if (timeframeFilter === "1Y") maxAge = dayMs * 365;

    return articles.filter((article) => {
      if (timeframeFilter !== "All") {
        const uploadedTs = new Date(article.uploadedAt).getTime();
        if (!Number.isNaN(uploadedTs)) {
          if (now - uploadedTs > maxAge) {
            return false;
          }
        }
      }

      if (summaryFilter === "summarized" && !article.hasSummary) {
        return false;
      }
      if (summaryFilter === "unsummarized" && article.hasSummary) {
        return false;
      }
      return true;
    });
  }, [articles, timeframeFilter, summaryFilter]);

  const selectedArticles = useMemo(
    () => articles.filter((article) => selectedIds.includes(article.id)),
    [articles, selectedIds]
  );

  const { selectedCount, selectedSummarizedCount, selectedUnsummarizedCount } = useMemo(() => {
    let summarized = 0;
    let unsummarized = 0;
    for (const article of selectedArticles) {
      if (article.hasSummary) summarized += 1;
      else unsummarized += 1;
    }
    return {
      selectedCount: selectedArticles.length,
      selectedSummarizedCount: summarized,
      selectedUnsummarizedCount: unsummarized,
    };
  }, [selectedArticles]);

  useEffect(() => {
    setSelectedIds((prev) => prev.filter((id) => articles.some((article) => article.id === id)));
  }, [articles]);

  useEffect(() => {
    setOngoingOpen((prev) => {
      const validIds = new Set(articles.map((a) => a.id));
      const next: Record<string, boolean> = {};
      for (const [key, value] of Object.entries(prev)) {
        if (validIds.has(key)) next[key] = value;
      }
      return next;
    });
  }, [articles]);

  function toggleSelection(articleId: string) {
    setSelectedIds((prev) =>
      prev.includes(articleId) ? prev.filter((id) => id !== articleId) : [...prev, articleId]
    );
  }

  function toggleOngoing(articleId: string) {
    setOngoingOpen((prev) => ({
      ...prev,
      [articleId]: !prev[articleId],
    }));
  }

  function handleSelectFiltered() {
    setSelectedIds(filteredArticles.map((article) => article.id));
    setSortOpen(false);
  }

  const anyProcessing =
    summarizingSelected ||
    resummarizingSelected ||
    deletingSelected ||
    (jobRunning && activeJob?.type !== "refresh");

  return (
    <main className="min-h-screen bg-neutral-900 text-white px-6 py-8">
      <Header title="Database" />

      <div className="max-w-5xl mx-auto space-y-6">
        {/* Email ingest section */}
        <section className="rounded-2xl border border-neutral-700 bg-neutral-800/70 p-4 md:p-5 space-y-4">
          <div>
            <h2 className="text-sm font-medium text-neutral-100">
              Load emails from Gmail
            </h2>
            <p className="text-xs text-neutral-400">
              Fetch PDFs (or long-form text) from verified senders and drop them
              into the database automatically.
            </p>
          </div>

          <div className="space-y-2">
            <label
              htmlFor="verified-senders"
              className="text-xs font-medium text-neutral-300"
            >
              Verified sender emails
            </label>
            <textarea
              id="verified-senders"
              value={emailSenders}
              onChange={(event) => setEmailSenders(event.target.value)}
              rows={3}
              placeholder={
                "customerservice@exct.stansberryresearch.com\nalerts@morningstar.com"
              }
              className="w-full rounded-lg border border-neutral-600 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-500 focus:border-[var(--highlight-400)] focus:outline-none"
              disabled={loadingEmails}
            />
            <p className="text-[11px] text-neutral-500">
              Separate multiple addresses with commas or line breaks.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <label className="flex flex-col gap-1 text-xs font-medium text-neutral-300">
              Lookback days
              <input
                type="number"
                min={1}
                max={365}
                value={emailLookbackDays}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  if (Number.isNaN(value) || value < 1) {
                    setEmailLookbackDays(1);
                  } else if (value > 365) {
                    setEmailLookbackDays(365);
                  } else {
                    setEmailLookbackDays(Math.floor(value));
                  }
                }}
                className="rounded-lg border border-neutral-600 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 focus:border-[var(--highlight-400)] focus:outline-none"
                disabled={loadingEmails}
              />
            </label>

            <label className="flex flex-col gap-1 text-xs font-medium text-neutral-300">
              Max emails
              <input
                type="number"
                min={1}
                max={2000}
                value={emailMaxEmails}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  if (Number.isNaN(value) || value < 1) {
                    setEmailMaxEmails(1);
                  } else if (value > 2000) {
                    setEmailMaxEmails(2000);
                  } else {
                    setEmailMaxEmails(Math.floor(value));
                  }
                }}
                className="rounded-lg border border-neutral-600 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 focus:border-[var(--highlight-400)] focus:outline-none"
                disabled={loadingEmails}
              />
            </label>

            <label className="flex flex-col gap-2 text-xs font-medium text-neutral-300">
              <span>Options</span>
              <span className="inline-flex items-center gap-2 text-neutral-200">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-neutral-600 bg-neutral-900"
                  checked={emailUnreadOnly}
                  onChange={(event) => setEmailUnreadOnly(event.target.checked)}
                  disabled={loadingEmails}
                />
                Unread only
              </span>
            </label>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <button
              type="button"
              onClick={() => void handleLoadEmails()}
              disabled={loadingEmails}
              className="inline-flex items-center justify-center rounded-md border border-[var(--highlight-400)] px-4 py-2 text-sm font-medium text-[var(--highlight-200)] hover:border-[var(--highlight-300)] hover:text-[var(--highlight-100)] disabled:cursor-not-allowed disabled:opacity-70"
            >
              {loadingEmails ? "Loading…" : "Load Emails"}
            </button>
            {emailStatus && (
              <p className="text-xs text-neutral-300">{emailStatus}</p>
            )}
          </div>
        </section>

        {/* Upload section */}
        <section className="rounded-2xl border border-neutral-700 bg-neutral-800/70 p-4 md:p-5 space-y-3">
          <h2 className="text-sm font-medium text-neutral-100">
            Add PDFs to database
          </h2>
          <p className="text-xs text-neutral-400">
            Upload one or more PDF research reports. They will appear in the
            list below and can later be summarized and surfaced on the News
            page.
          </p>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <input
              key={fileInputKey}
              type="file"
              accept="application/pdf"
              multiple
              onChange={handleUpload}
              className="block w-full text-sm text-neutral-200 file:mr-4 file:rounded-lg file:border file:border-neutral-600 file:bg-neutral-900 file:px-4 file:py-2 file:text-sm file:font-medium file:text-neutral-100 hover:file:border-[var(--highlight-400)] cursor-pointer"
              disabled={uploading || anyProcessing}
            />
            {uploading && (
              <span className="text-xs text-neutral-400">
                Uploading PDF(s)…
              </span>
            )}
          </div>
        </section>

        {/* Error */}
        {error && (
          <div className="rounded-xl border border-red-600/60 bg-red-900/30 px-4 py-3 text-sm text-red-100">
            {error}
          </div>
        )}

        {/* Info (e.g., duplicates) */}
        {info && (
          <div className="rounded-xl border border-neutral-600 bg-neutral-800/80 px-4 py-3 text-sm text-neutral-100">
            {info}
          </div>
        )}

        {/* List section */}
        <section className="rounded-2xl border border-neutral-700 bg-neutral-800/70 p-4 md:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
            <div className="flex items-center gap-3">
              <h2 className="text-sm font-medium text-neutral-100">
                Stored PDFs
              </h2>
              {jobStatusText && (
                <span className="text-xs text-[var(--highlight-200)]">
                  {jobStatusText}
                </span>
              )}
              <div className="relative" ref={sortMenuRef}>
                <button
                  type="button"
                  className="inline-flex items-center rounded-md border border-neutral-600 bg-neutral-900/60 px-3 py-1.5 text-xs font-medium text-neutral-200 hover:border-[var(--highlight-400)]"
                  onClick={() => setSortOpen((prev) => !prev)}
                >
                  Sort by
                  <span className="ml-1 text-sm">▾</span>
                </button>
                {sortOpen && (
                  <div className="absolute left-0 right-auto z-20 mt-2 w-60 rounded-xl border border-neutral-700 bg-neutral-900/95 p-3 shadow-xl">
                    <div className="mb-1 text-[11px] uppercase tracking-wide text-neutral-500">
                      Timeframe
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {["1D", "1W", "1M", "1Y", "All"].map((tf) => (
                        <button
                          key={tf}
                          type="button"
                          onClick={() => setTimeframeFilter(tf as ListTimeframe)}
                          className={`rounded-md border px-2 py-1 text-[11px] ${
                            timeframeFilter === tf
                              ? "border-[var(--highlight-400)] text-[var(--highlight-100)]"
                              : "border-neutral-700 text-neutral-300 hover:border-[var(--highlight-400)]"
                          }`}
                        >
                          {tf}
                        </button>
                      ))}
                    </div>

                    <div className="mt-3 border-t border-neutral-800 pt-3">
                      <div className="mb-1 text-[11px] uppercase tracking-wide text-neutral-500">
                        Status
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {[
                          { key: "all", label: "All" },
                          { key: "unsummarized", label: "Unsummarized" },
                          { key: "summarized", label: "Summarized" },
                        ].map((option) => (
                          <button
                            key={option.key}
                            type="button"
                            onClick={() => setSummaryFilter(option.key as typeof summaryFilter)}
                            className={`rounded-md border px-2 py-1 text-[11px] ${
                              summaryFilter === option.key
                                ? "border-[var(--highlight-400)] text-[var(--highlight-100)]"
                                : "border-neutral-700 text-neutral-300 hover:border-[var(--highlight-400)]"
                            }`}
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="mt-3 flex items-center justify-between gap-2 border-t border-neutral-800 pt-3">
                      <span className="text-[11px] text-neutral-500">
                        {filteredArticles.length} match current filters
                      </span>
                      <button
                        type="button"
                        onClick={handleSelectFiltered}
                        className="rounded-md border border-[var(--highlight-400)] px-2 py-1 text-[11px] font-medium text-[var(--highlight-200)] hover:border-[var(--highlight-300)] hover:text-[var(--highlight-100)]"
                      >
                        Select Files
                      </button>
                    </div>
                    <div className="mt-3 text-right">
                      <button
                        type="button"
                        onClick={() => setSortOpen(false)}
                        className="text-[11px] text-neutral-400 hover:text-white"
                      >
                        Close
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
            {loading && (
              <span className="text-xs text-neutral-400">Loading…</span>
            )}
          </div>

          <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
            <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-300">
              <span className="rounded-full bg-neutral-900/60 px-3 py-1 font-medium text-neutral-100">
                {selectedCount} selected
              </span>
              <button
                type="button"
                onClick={() => setSelectedIds([])}
                disabled={selectedCount === 0}
                className="text-neutral-400 underline-offset-2 hover:text-neutral-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Clear
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs">
              <button
                type="button"
                onClick={() => void handleSummarizeSelected()}
                disabled={
                  selectedUnsummarizedCount === 0 || summarizingSelected || anyProcessing
                }
                className="inline-flex items-center rounded-md border border-[var(--highlight-400)] bg-transparent px-3 py-1.5 font-medium text-[var(--highlight-200)] hover:border-[var(--highlight-300)] hover:text-[var(--highlight-100)] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {summarizingSelected
                  ? "Summarizing…"
                  : `Summarize Selected (${selectedUnsummarizedCount})`}
              </button>
              <button
                type="button"
                onClick={() => void handleResummarizeSelected()}
                disabled={
                  selectedSummarizedCount === 0 || resummarizingSelected || anyProcessing
                }
                className="inline-flex items-center rounded-md border border-[var(--highlight-400)] bg-transparent px-3 py-1.5 font-medium text-[var(--highlight-200)] hover:border-[var(--highlight-300)] hover:text-[var(--highlight-100)] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {resummarizingSelected
                  ? "Resummarizing…"
                  : `Resummarize Selected (${selectedSummarizedCount})`}
              </button>
              <button
                type="button"
                onClick={() => void handleDeleteSelected()}
                disabled={selectedCount === 0 || deletingSelected || anyProcessing}
                className="inline-flex items-center rounded-md border border-red-600/70 bg-transparent px-3 py-1.5 font-medium text-red-100 hover:border-red-400 hover:text-red-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {deletingSelected ? "Deleting…" : `Delete Selected (${selectedCount})`}
              </button>
            </div>
          </div>

          {filteredArticles.length === 0 && !loading ? (
            <p className="text-sm text-neutral-400">
              {articles.length === 0
                ? "No PDFs in the database yet. Upload a PDF above to get started."
                : "No PDFs match the current Sort filters."}
            </p>
          ) : (
            <div>
              <table className="w-full table-fixed text-sm">
                <colgroup>
                  <col className="w-12" />
                  <col className="w-[46%]" />
                  <col className="w-[18%]" />
                  <col className="w-[14%]" />
                  <col className="w-[14%]" />
                </colgroup>
                <thead>
                  <tr className="border-b border-neutral-700 text-xs uppercase tracking-wide text-neutral-400">
                    <th className="py-2 pr-3 text-left font-medium">Select</th>
                    <th className="py-2 pr-4 text-left font-medium">Filename</th>
                    <th className="py-2 px-4 text-left font-medium">Uploaded</th>
                    <th className="py-2 pl-4 text-left font-medium">Quality</th>
                    <th className="py-2 pl-4 text-left font-medium">Summarized</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredArticles.map((article) => {
                    const { title, keyPoints, actions, tickers, ongoingActions, ongoingTickers } =
                      parseArticleData(article);
                    const { tag: qualityTag, note: qualityNote } = getArticleQuality(article);
                    const storageDecision = normalizeTagValue(article.storageDecision);
                    const isOpen = openId === article.id;
                    const displayName = shortenFilename(article.originalFilename);
                    const showOngoing = ongoingOpen[article.id] ?? false;
                    const displayTickers = showOngoing
                      ? Array.from(new Set([...tickers, ...ongoingTickers]))
                      : tickers;

                    const rows: ReactElement[] = [];

                    rows.push(
                      <tr
                        key={article.id}
                        className="border-b border-neutral-800 last:border-0"
                      >
                        <td className="py-2 pr-3 align-top">
                          <input
                            type="checkbox"
                            className="h-4 w-4 rounded border-neutral-600 bg-neutral-900"
                            checked={selectedIds.includes(article.id)}
                            onChange={() => toggleSelection(article.id)}
                          />
                        </td>
                        <td className="py-2 pr-4 align-top text-neutral-100">
                          <button
                            type="button"
                            onClick={() =>
                              setOpenId((current) =>
                                current === article.id ? null : article.id
                              )
                            }
                            className="w-full text-left whitespace-normal break-words hover:text-[var(--highlight-200)]"
                            title={article.originalFilename}
                          >
                            {displayName}
                          </button>
                        </td>
                        <td className="py-2 px-4 align-top text-neutral-300">
                          {formatDateTime(article.uploadedAt)}
                        </td>
                        <td className="py-2 pl-4 align-top">
                          {qualityTag ? (
                            <span
                              className={`inline-flex items-center rounded-full border px-2 py-1 text-[11px] font-medium ${
                                qualityTag === "Error"
                                  ? "border-red-500/70 bg-red-500/10 text-red-100"
                                  : "border-emerald-500/70 bg-emerald-500/10 text-emerald-100"
                              }`}
                            >
                              {qualityTag}
                            </span>
                          ) : (
                            <span className="text-xs text-neutral-500">
                              {article.hasSummary ? "Good" : "Pending"}
                            </span>
                          )}
                        </td>
                        <td className="py-2 pl-4 align-top text-neutral-300">
                          {article.hasSummary ? "Yes" : "No"}
                        </td>
                      </tr>
                    );

                    if (isOpen) {
                      rows.push(
                        <tr key={`${article.id}-details`}>
                          <td
                            colSpan={4}
                            className="bg-neutral-900/60 border-t border-neutral-800"
                          >
                            <div className="mt-2 mb-3 rounded-xl border border-neutral-700 bg-neutral-900/80 p-4 space-y-4">
                              {/* Title / meta */}
                              <div className="space-y-1">
                                <h3 className="text-sm font-semibold text-neutral-100">
                                  {title}
                                </h3>
                                <p className="text-xs text-neutral-400">
                                  <span className="font-medium">
                                    Filename:
                                  </span>{" "}
                                  {article.originalFilename}
                                </p>
                                <p className="text-xs text-neutral-400">
                                  <span className="font-medium">
                                    Uploaded:
                                  </span>{" "}
                                  {formatDateTime(article.uploadedAt)}
                                </p>
                                {article.datePublished && (
                                  <p className="text-xs text-neutral-400">
                                    <span className="font-medium">
                                      Published:
                                    </span>{" "}
                                    {formatDateTime(article.datePublished)}
                                  </p>
                                )}
                                {article.summarizedAt && (
                                  <p className="text-xs text-neutral-400">
                                    <span className="font-medium">
                                      Last summarized:
                                    </span>{" "}
                                    {formatDateTime(article.summarizedAt)}
                                  </p>
                                )}
                              </div>

                              <div className="space-y-2">
                                <div className="flex flex-wrap gap-2 text-[11px] text-neutral-200">
                                  {storageDecision && (
                                    <span className="inline-flex items-center rounded-full border border-neutral-600 bg-neutral-900/60 px-3 py-1 font-medium">
                                      Storage: {storageDecision}
                                    </span>
                                  )}
                                  {qualityTag && (
                                    <span
                                      className={`inline-flex items-center rounded-full border px-3 py-1 font-medium ${
                                        qualityTag === "Error"
                                          ? "border-red-500/70 bg-red-500/10 text-red-100"
                                          : "border-emerald-500/70 bg-emerald-500/10 text-emerald-100"
                                      }`}
                                    >
                                      Quality: {qualityTag}
                                    </span>
                                  )}
                                  {!qualityTag && !article.hasSummary && (
                                    <span className="inline-flex items-center rounded-full border border-neutral-600 bg-neutral-900/60 px-3 py-1 font-medium text-neutral-300">
                                      Quality: Pending
                                    </span>
                                  )}
                                </div>
                                {qualityTag === "Error" && qualityNote && (
                                  <div className="rounded-lg border border-red-600/60 bg-red-900/40 px-3 py-2 text-xs text-red-100">
                                    {qualityNote}
                                  </div>
                                )}
                              </div>

                              {/* Author */}
                              {article.author && (
                                <section className="space-y-1">
                                  <h4 className="text-xs uppercase tracking-wide text-neutral-400">
                                    Author
                                  </h4>
                                  <p className="text-sm text-neutral-200">
                                    {article.author}
                                  </p>
                                </section>
                              )}

                              {/* Summary */}
                              {article.summaryText && (
                                <section className="space-y-1">
                                  <h4 className="text-xs uppercase tracking-wide text-neutral-400">
                                    Summary
                                  </h4>
                                  <p className="text-sm text-neutral-200 leading-relaxed">
                                    {article.summaryText}
                                  </p>
                                </section>
                              )}

                              {/* Key points */}
                              {keyPoints.length > 0 && (
                                <section className="space-y-1">
                                  <h4 className="text-xs uppercase tracking-wide text-neutral-400">
                                    Key points
                                  </h4>
                                  <ul className="list-disc pl-5 space-y-1.5 text-sm text-neutral-200">
                                    {keyPoints.map((pt, idx) => (
                                      <li key={idx}>{pt}</li>
                                    ))}
                                  </ul>
                                </section>
                              )}

                              {/* Actions */}
                              {(actions.length > 0 || ongoingActions.length > 0) && (
                                <section className="space-y-1">
                                  <div className="flex items-center gap-2">
                                    <h4 className="text-xs uppercase tracking-wide text-neutral-400">
                                      Actions to take (new/updated)
                                    </h4>
                                    {ongoingActions.length > 0 && (
                                      <button
                                        type="button"
                                        aria-label={
                                          showOngoing
                                            ? "Hide continued actions"
                                            : "Show continued actions"
                                        }
                                        onClick={() => toggleOngoing(article.id)}
                                        className="text-neutral-300 hover:text-neutral-100 transition-colors"
                                      >
                                        <span className="text-sm leading-none">
                                          {showOngoing ? "▾" : "▸"}
                                        </span>
                                      </button>
                                    )}
                                  </div>
                                  {actions.length > 0 && (
                                    <ul className="list-disc pl-5 space-y-1.5 text-sm text-neutral-200">
                                      {actions.map((act, idx) => (
                                        <li key={idx}>{act}</li>
                                      ))}
                                    </ul>
                                  )}
                                  {showOngoing && ongoingActions.length > 0 && (
                                    <div className="space-y-1 pt-2">
                                      <h5 className="text-xs uppercase tracking-wide text-neutral-400">
                                        Continued actions
                                      </h5>
                                      <ul className="list-disc pl-5 space-y-1.5 text-sm text-neutral-200">
                                        {ongoingActions.map((act, idx) => (
                                          <li key={`ongoing-${idx}`}>{act}</li>
                                        ))}
                                      </ul>
                                    </div>
                                  )}
                                </section>
                              )}

                              {/* Tickers */}
                              <section className="space-y-1">
                                <h4 className="text-xs uppercase tracking-wide text-neutral-400">
                                  {showOngoing
                                    ? "Tickers (summary/new + continued)"
                                    : "Tickers in summary/new actions"}
                                </h4>
                                {displayTickers.length === 0 ? (
                                  <p className="text-sm text-neutral-300">
                                    No tickers mentioned.
                                  </p>
                                ) : (
                                  <div className="flex flex-wrap gap-2">
                                    {displayTickers.map((t) => (
                                      <button
                                        key={t}
                                        type="button"
                                        className="inline-flex items-center cursor-pointer rounded-md border border-neutral-600 bg-neutral-800/60 px-3 py-1.5 text-xs font-medium text-neutral-100 transition-[border-color,box-shadow,background-color] hover:border-[var(--highlight-400)] active:shadow-[0_0_0_2px_var(--highlight-400)] hover:bg-neutral-800 focus:outline-none"
                                        onClick={() =>
                                          router.push(
                                            `/analysis?ticker=${encodeURIComponent(
                                              t.toUpperCase()
                                            )}`
                                          )
                                        }
                                      >
                                        {t}
                                      </button>
                                    ))}
                                  </div>
                                )}
                              </section>
                            </div>
                          </td>
                        </tr>
                      );
                    }

                    return rows;
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
