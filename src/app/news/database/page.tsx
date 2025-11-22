// src/app/news/database/page.tsx
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
};

type ParsedArticleData = {
  title: string;
  keyPoints: string[];
  actions: string[];
  tickers: string[];
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

function parseArticleData(article: Article): ParsedArticleData {
  const title =
    (article.title && article.title.trim().length > 0
      ? article.title
      : article.originalFilename) || "Untitled article";

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
  };
}

export default function NewsDatabasePage() {
  const router = useRouter();

  const [articles, setArticles] = useState<Article[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [uploading, setUploading] = useState<boolean>(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [summarizingId, setSummarizingId] = useState<string | null>(null);
  const [summarizingAll, setSummarizingAll] = useState<boolean>(false);

  const [resummarizingId, setResummarizingId] = useState<string | null>(null);
  const [resummarizingAll, setResummarizingAll] = useState<boolean>(false);

  const [openId, setOpenId] = useState<string | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [fileInputKey, setFileInputKey] = useState<number>(0);
  const [emailSenders, setEmailSenders] = useState<string>("");
  const [emailLookbackDays, setEmailLookbackDays] = useState<number>(7);
  const [emailMaxEmails, setEmailMaxEmails] = useState<number>(100);
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
        const data = (await res.json()) as { emails?: string[] };
        const saved = Array.isArray(data?.emails) ? data.emails : [];
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
      const textUploads = Number(summary.textUploads || 0);

      const message = `Loaded ${filesInserted} file${
        filesInserted === 1 ? "" : "s"
      } (${pdfUploads} PDF, ${textUploads} text) from ${processed} email${
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

  async function handleDelete(id: string) {
    const confirmed = window.confirm(
      "Delete this PDF and its record from the database?"
    );
    if (!confirmed) return;

    try {
      setError(null);
      setDeletingId(id);
      const res = await fetch(`/api/news/articles/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        throw new Error(`Delete failed: ${res.status}`);
      }
      setArticles((prev) => prev.filter((a) => a.id !== id));
    } catch (err: any) {
      setError(err?.message || "Failed to delete PDF.");
    } finally {
      setDeletingId(null);
    }
  }

  async function handleSummarize(id: string) {
    try {
      setError(null);
      setSummarizingId(id);
      const res = await fetch(`/api/news/articles/${encodeURIComponent(id)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "summarize" }),
      });
      if (!res.ok) {
        let message = `Summarize failed: ${res.status}`;
        try {
          const data = await res.json();
          if (data?.error) message = data.error;
        } catch {
          // ignore JSON parse errors
        }
        throw new Error(message);
      }
      await loadArticles();
    } catch (err: any) {
      setError(err?.message || "Failed to summarize PDF.");
    } finally {
      setSummarizingId(null);
    }
  }

  async function handleSummarizeAll() {
    const toSummarize = filteredArticles.filter((a) => !a.hasSummary);
    if (!toSummarize.length) return;

    try {
      setError(null);
      setSummarizingAll(true);
      const res = await fetch("/api/news/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "summarize",
          articleIds: toSummarize.map((a) => a.id),
          label: `${timeframeFilter}-${summaryFilter}`,
        }),
      });
      if (!res.ok) {
        let message = `Summarize failed: ${res.status}`;
        try {
          const data = await res.json();
          if (data?.error) message = data.error;
        } catch {
          /* ignore */
        }
        throw new Error(message);
      }
      await refreshJobs();
    } catch (err: any) {
      setError(err?.message || "Failed to summarize one or more PDFs.");
    } finally {
      setSummarizingAll(false);
    }
  }

  async function handleResummarize(id: string) {
    try {
      setError(null);
      setResummarizingId(id);
      const res = await fetch(`/api/news/articles/${encodeURIComponent(id)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "summarize" }),
      });
      if (!res.ok) {
        let message = `Resummarize failed: ${res.status}`;
        try {
          const data = await res.json();
          if (data?.error) message = data.error;
        } catch {
          // ignore JSON parse errors
        }
        throw new Error(message);
      }
      await loadArticles();
    } catch (err: any) {
      setError(err?.message || "Failed to resummarize PDF.");
    } finally {
      setResummarizingId(null);
    }
  }

  async function handleResummarizeAll() {
    const toResummarize = filteredArticles.filter((a) => a.hasSummary);
    if (!toResummarize.length) return;

    try {
      setError(null);
      setResummarizingAll(true);
      const res = await fetch("/api/news/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "resummarize",
          articleIds: toResummarize.map((a) => a.id),
          label: `${timeframeFilter}-${summaryFilter}`,
        }),
      });
      if (!res.ok) {
        let message = `Resummarize failed: ${res.status}`;
        try {
          const data = await res.json();
          if (data?.error) message = data.error;
        } catch {
          /* ignore */
        }
        throw new Error(message);
      }
      await refreshJobs();
    } catch (err: any) {
      setError(err?.message || "Failed to resummarize one or more PDFs.");
    } finally {
      setResummarizingAll(false);
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

  const { visibleUnsummarizedCount, visibleSummarizedCount } = useMemo(() => {
    let uns = 0;
    let sum = 0;
    for (const article of filteredArticles) {
      if (article.hasSummary) sum += 1;
      else uns += 1;
    }
    return { visibleUnsummarizedCount: uns, visibleSummarizedCount: sum };
  }, [filteredArticles]);

  const anySummarizing =
    summarizingAll ||
    resummarizingAll ||
    summarizingId !== null ||
    resummarizingId !== null ||
    jobRunning;

  const jobStatusText = useMemo(() => {
    if (!activeJob) return null;
    const verb =
      activeJob.type === "refresh"
        ? "Refreshing"
        : activeJob.type === "resummarize"
        ? "Resummarizing"
        : "Summarizing";
    const detail =
      activeJob.summary ||
      `${activeJob.completed}/${Math.max(activeJob.total, 0)} Articles Processed`;
    return `${verb}: ${detail}`;
  }, [activeJob]);

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
              disabled={uploading || anySummarizing}
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

            <div className="flex items-center gap-3">
              {loading && (
                <span className="text-xs text-neutral-400">Loading…</span>
              )}
              <button
                type="button"
                onClick={() => void handleSummarizeAll()}
                disabled={
                  visibleUnsummarizedCount === 0 ||
                  summarizingAll ||
                  loading ||
                  anySummarizing
                }
                className="inline-flex items-center rounded-md border border-[var(--highlight-400)] bg-transparent px-3 py-1.5 text-xs font-medium text-[var(--highlight-200)] hover:border-[var(--highlight-300)] hover:text-[var(--highlight-100)] disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {summarizingAll
                  ? "Summarizing…"
                  : `Summarize Visible (${visibleUnsummarizedCount})`}
              </button>
              <button
                type="button"
                onClick={() => void handleResummarizeAll()}
                disabled={
                  visibleSummarizedCount === 0 ||
                  resummarizingAll ||
                  loading ||
                  anySummarizing
                }
                className="inline-flex items-center rounded-md border border-[var(--highlight-400)] bg-transparent px-3 py-1.5 text-xs font-medium text-[var(--highlight-200)] hover:border-[var(--highlight-300)] hover:text-[var(--highlight-100)] disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {resummarizingAll
                  ? "Resummarizing…"
                  : `Resummarize Visible (${visibleSummarizedCount})`}
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
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-neutral-700 text-xs uppercase tracking-wide text-neutral-400">
                    <th className="py-2 pr-4 text-left font-medium">
                      Filename
                    </th>
                    <th className="py-2 px-4 text-left font-medium">
                      Uploaded
                    </th>
                    <th className="py-2 px-4 text-left font-medium">
                      Summarized
                    </th>
                    <th className="py-2 pl-4 text-right font-medium">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredArticles.map((article) => {
                    const { title, keyPoints, actions, tickers } =
                      parseArticleData(article);
                    const isOpen = openId === article.id;

                    const rows: JSX.Element[] = [];

                    rows.push(
                      <tr
                        key={article.id}
                        className="border-b border-neutral-800 last:border-0"
                      >
                        <td className="py-2 pr-4 align-top text-neutral-100">
                          <button
                            type="button"
                            onClick={() =>
                              setOpenId((current) =>
                                current === article.id ? null : article.id
                              )
                            }
                            className="w-full text-left hover:text-[var(--highlight-200)]"
                          >
                            {article.originalFilename}
                          </button>
                        </td>
                        <td className="py-2 px-4 align-top text-neutral-300">
                          {formatDateTime(article.uploadedAt)}
                        </td>
                        <td className="py-2 px-4 align-top text-neutral-300">
                          {article.hasSummary ? "Yes" : "No"}
                        </td>
                        <td className="py-2 pl-4 align-top">
                          <div className="flex justify-end gap-2">
                            {!article.hasSummary ? (
                              <button
                                type="button"
                                onClick={() => void handleSummarize(article.id)}
                                disabled={
                                  summarizingId === article.id ||
                                  summarizingAll ||
                                  anySummarizing
                                }
                                className="inline-flex items-center rounded-md border border-[var(--highlight-400)] bg-transparent px-3 py-1.5 text-xs font-medium text-[var(--highlight-200)] hover:border-[var(--highlight-300)] hover:text-[var(--highlight-100)] disabled:opacity-60 disabled:cursor-not-allowed"
                              >
                                {summarizingId === article.id
                                  ? "Summarizing…"
                                  : "Summarize"}
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() =>
                                  void handleResummarize(article.id)
                                }
                                disabled={
                                  resummarizingId === article.id ||
                                  resummarizingAll ||
                                  anySummarizing
                                }
                                className="inline-flex items-center rounded-md border border-[var(--highlight-400)] bg-transparent px-3 py-1.5 text-xs font-medium text-[var(--highlight-200)] hover:border-[var(--highlight-300)] hover:text-[var(--highlight-100)] disabled:opacity-60 disabled:cursor-not-allowed"
                              >
                                {resummarizingId === article.id
                                  ? "Resummarizing…"
                                  : "Resummarize"}
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => void handleDelete(article.id)}
                              disabled={deletingId === article.id || anySummarizing}
                              className="inline-flex items-center rounded-md border border-red-600/70 bg-transparent px-3 py-1.5 text-xs font-medium text-red-100 hover:border-red-400 hover:text-red-50 disabled:opacity-60 disabled:cursor-not-allowed"
                            >
                              {deletingId === article.id
                                ? "Deleting…"
                                : "Delete"}
                            </button>
                          </div>
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
                              {actions.length > 0 && (
                                <section className="space-y-1">
                                  <h4 className="text-xs uppercase tracking-wide text-neutral-400">
                                    Actions to take
                                  </h4>
                                  <ul className="list-disc pl-5 space-y-1.5 text-sm text-neutral-200">
                                    {actions.map((act, idx) => (
                                      <li key={idx}>{act}</li>
                                    ))}
                                  </ul>
                                </section>
                              )}

                              {/* Tickers */}
                              {tickers.length > 0 && (
                                <section className="space-y-1">
                                  <h4 className="text-xs uppercase tracking-wide text-neutral-400">
                                    Tickers mentioned
                                  </h4>
                                  <div className="flex flex-wrap gap-2">
                                    {tickers.map((t) => (
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
                                </section>
                              )}
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
