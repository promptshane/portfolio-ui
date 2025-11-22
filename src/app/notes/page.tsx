// src/app/notes/page.tsx
"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import Header from "../components/header";
import NotesSortControl, {
  NotesSourceFilter,
  NotesTimeframe,
} from "./NotesSortControl";
import NotesRepostOverlay, { RepostDraft } from "./NotesRepostOverlay";
import NotesFeedItemRow from "./NotesFeedItemRow";
import { useNotesQa } from "./useNotesQa";
import type { NotesFeedItem, NotesRepost } from "./types";

const TIMEFRAME_WINDOWS: Record<NotesTimeframe, number | null> = {
  "1W": 7,
  "1M": 30,
  "6M": 182,
  "1Y": 365,
  All: null,
};

function parseTickerInput(raw: string): string[] {
  return raw
    .split(/[, ]+/)
    .map((t) => t.trim().toUpperCase())
    .filter(Boolean);
}

export default function NotesPage() {
  const [items, setItems] = useState<NotesFeedItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [openArticleId, setOpenArticleId] = useState<string | null>(null);
  const [timeframeFilter, setTimeframeFilter] =
    useState<NotesTimeframe>("1Y");
  const [sourceFilter, setSourceFilter] =
    useState<NotesSourceFilter>("following");
  const [tickerFilter, setTickerFilter] = useState("");

  const [repostDraft, setRepostDraft] = useState<RepostDraft | null>(null);
  const [myHandle, setMyHandle] = useState<string | null>(null);
  const [followingHandles, setFollowingHandles] = useState<Set<string>>(
    new Set()
  );
  const [friendHandles, setFriendHandles] = useState<Set<string>>(
    new Set()
  );
  const [includeWatchlist, setIncludeWatchlist] = useState(false);
  const [includePortfolio, setIncludePortfolio] = useState(false);
  const [watchlistTickers, setWatchlistTickers] = useState<Set<string>>(
    new Set()
  );
  const [portfolioTickers, setPortfolioTickers] = useState<Set<string>>(
    new Set()
  );
  const highlightTickers = useMemo(() => {
    const combined = new Set<string>();
    watchlistTickers.forEach((t) => combined.add(t));
    portfolioTickers.forEach((t) => combined.add(t));
    return combined;
  }, [watchlistTickers, portfolioTickers]);
  const tickerTokens = useMemo(
    () => parseTickerInput(tickerFilter),
    [tickerFilter]
  );
  const timeframeCutoff = useMemo(() => {
    const days = TIMEFRAME_WINDOWS[timeframeFilter];
    if (!days) return null;
    const now = Date.now();
    return now - days * 24 * 60 * 60 * 1000;
  }, [timeframeFilter]);

  const {
    getQaState,
    toggleQa,
    updateQaInput,
    addQaQuestion,
    getQaAnswers,
    deleteQaEntry,
  } = useNotesQa();

  useEffect(() => {
    let active = true;

    async function loadNotes() {
      try {
        setLoading(true);
        setLoadError(null);

        const res = await fetch("/api/notes");
        if (!active) return;

        if (res.status === 401) {
          setItems([]);
          setLoadError("Sign in to view your Notes activity.");
          return;
        }

        if (!res.ok) {
          throw new Error(`Failed to load notes feed (${res.status})`);
        }

        const data = (await res.json()) as NotesFeedItem[];
        if (!active) return;

        // Normalize handles to lowercase for display, keep other fields as-is.
        const normalized: NotesFeedItem[] = data.map((item) => ({
          ...item,
          reposts: item.reposts.map((r) => ({
            ...r,
            handle: (r.handle ?? "").toLowerCase(),
          })),
        }));

        setItems(normalized);

        // Discover current user's handle (if they already have any reposts).
        const mine = normalized
          .flatMap((it) => it.reposts)
          .find((r) => r.isMine && r.handle);
        if (mine?.handle) {
          setMyHandle(mine.handle);
        }

        // Leave all articles collapsed by default.
      } catch (err) {
        if (!active) return;
        console.error("Error loading notes feed:", err);
        setLoadError("Failed to load notes feed.");
      } finally {
        if (active) setLoading(false);
      }
    }

    void loadNotes();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/profile/social");
        if (!res.ok) return;
        const data = (await res.json()) as {
          following?: { handle: string }[];
          followers?: { handle: string }[];
        };
        if (!active) return;
        const followingSet = new Set(
          (data.following ?? [])
            .map((u) => u.handle?.toLowerCase())
            .filter(Boolean) as string[]
        );
        const followerSet = new Set(
          (data.followers ?? [])
            .map((u) => u.handle?.toLowerCase())
            .filter(Boolean) as string[]
        );
        const friendsSet = new Set(
          Array.from(followingSet).filter((handle) =>
            followerSet.has(handle)
          )
        );
        setFollowingHandles(followingSet);
        setFriendHandles(friendsSet);
      } catch (err) {
        console.error("Failed to load social graph for Notes", err);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/user/highlight-tickers");
        if (!active || !res.ok) return;
        const data = (await res.json()) as {
          portfolioTickers?: string[];
          watchlistTickers?: string[];
        };
        if (!active) return;
        setWatchlistTickers(
          new Set(
            (data.watchlistTickers ?? [])
              .map((sym) => (sym ?? "").toUpperCase().trim())
              .filter(Boolean)
          )
        );
        setPortfolioTickers(
          new Set(
            (data.portfolioTickers ?? [])
              .map((sym) => (sym ?? "").toUpperCase().trim())
              .filter(Boolean)
          )
        );
      } catch (err) {
        console.error("Failed to load highlight tickers for filters", err);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  async function markViewed(articleId: string) {
    // Optimistically mark as viewed locally
    setItems((prev) =>
      prev.map((notesItem) => {
        if (
          notesItem.article.id !== articleId &&
          notesItem.id !== articleId
        ) {
          return notesItem;
        }
        if (notesItem.article.viewed) return notesItem;
        return {
          ...notesItem,
          article: {
            ...notesItem.article,
            viewed: true,
          },
        };
      })
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

  function handleDownload(articleId: string) {
    const url = `/api/news/articles/${encodeURIComponent(
      articleId
    )}/file`;
    window.open(url, "_blank");
  }

  function openRepostPanelForItem(
    notesItem: NotesFeedItem,
    existingRepost?: NotesRepost | null
  ) {
    const article = notesItem.article;
    setRepostDraft({
      articleId: article.id,
      articleTitle: article.title,
      articleDateISO: article.dateISO,
      availableTickers: article.tickers ?? [],
      // NEW repost: no tickers selected by default.
      // EDIT existing: start from previously selected tickers.
      selectedTickers: existingRepost
        ? [...existingRepost.tickers]
        : [],
      comment: existingRepost?.comment ?? "",
      submitting: false,
      error: null,
      mode: existingRepost ? "edit" : "create",
    });
  }

  function toggleRepostTicker(ticker: string) {
    setRepostDraft((prev) => {
      if (!prev) return prev;
      const t = ticker.trim().toUpperCase();
      if (!t) return prev;

      const exists = prev.selectedTickers.includes(t);
      return {
        ...prev,
        selectedTickers: exists
          ? prev.selectedTickers.filter((x) => x !== t)
          : [...prev.selectedTickers, t],
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
        | {
            error?: string;
            repost?: {
              id: string;
              articleId: string;
              comment: string;
              tickers: string[];
              createdAtISO?: string;
            };
          }
        | null;

      if (!res.ok || !data?.repost) {
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

      const srv = data.repost;

      // Update local Notes feed so the change is visible immediately.
      setItems((prev) =>
        prev.map((notesItem) => {
          const isTarget =
            notesItem.article.id === srv.articleId ||
            notesItem.id === srv.articleId;
          if (!isTarget) return notesItem;

          const existingMine = notesItem.reposts.find((r) => r.isMine);
          const effectiveHandle =
            existingMine?.handle || myHandle || "you";

          const updatedMine = {
            id: String(srv.id ?? existingMine?.id ?? ""),
            handle: effectiveHandle.toLowerCase(),
            comment: srv.comment ?? "",
            tickers: Array.isArray(srv.tickers) ? srv.tickers : [],
            createdAtISO:
              srv.createdAtISO ??
              existingMine?.createdAtISO ??
              new Date().toISOString(),
            isMine: true,
          };

          let newReposts;
          if (existingMine) {
            newReposts = notesItem.reposts.map((r) =>
              r.isMine ? updatedMine : r
            );
          } else {
            newReposts = [updatedMine, ...notesItem.reposts];
          }

          return {
            ...notesItem,
            reposts: newReposts,
          };
        })
      );

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

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      const dateISO = item.article.dateISO;
      const articleTime = dateISO ? new Date(dateISO).getTime() : null;
      if (timeframeCutoff && (!articleTime || articleTime < timeframeCutoff)) {
        return false;
      }

      const handlesLower = item.reposts.map((r) =>
        (r.handle ?? "").toLowerCase()
      );
      const hasMine = item.reposts.some((r) => r.isMine);

      if (sourceFilter === "mine" && !hasMine) {
        return false;
      }
      if (sourceFilter === "following") {
        const hasFollowing =
          hasMine ||
          handlesLower.some((handle) => followingHandles.has(handle));
        if (!hasFollowing) return false;
      }
      if (sourceFilter === "friends") {
        const hasFriend = handlesLower.some((handle) =>
          friendHandles.has(handle)
        );
        if (!hasFriend) return false;
      }

      const articleTickers = (item.article.tickers ?? []).map((t) =>
        t.toUpperCase()
      );
      const repostTickers = item.reposts.flatMap((r) =>
        (r.tickers ?? []).map((t) => t.toUpperCase())
      );
      const combined = new Set([...articleTickers, ...repostTickers]);

      if (tickerTokens.length > 0) {
        const match = tickerTokens.some((tok) => combined.has(tok));
        if (!match) return false;
      }

      const selectedSets: Array<Set<string>> = [];
      if (includeWatchlist && watchlistTickers.size) {
        selectedSets.push(watchlistTickers);
      }
      if (includePortfolio && portfolioTickers.size) {
        selectedSets.push(portfolioTickers);
      }
      if (selectedSets.length) {
        const match = selectedSets.some((set) =>
          Array.from(combined).some((t) => set.has(t))
        );
        if (!match) return false;
      }

      return true;
    });
  }, [
    items,
    timeframeCutoff,
    sourceFilter,
    tickerTokens,
    includeWatchlist,
    includePortfolio,
    watchlistTickers,
    portfolioTickers,
    followingHandles,
    friendHandles,
  ]);

  const sortedItems = [...filteredItems].sort((a, b) => {
    const aTime = a.article.dateISO
      ? new Date(a.article.dateISO).getTime()
      : 0;
    const bTime = b.article.dateISO
      ? new Date(b.article.dateISO).getTime()
      : 0;
    return bTime - aTime;
  });

  return (
    <main className="min-h-screen bg-neutral-900 text-white px-6 py-8">
      <Header
        title="Notes"
        rightSlot={
          <div className="flex items-center gap-3">
            <NotesSortControl
              timeframe={timeframeFilter}
              onTimeframeChange={setTimeframeFilter}
              source={sourceFilter}
              onSourceChange={setSourceFilter}
              tickers={tickerFilter}
              onTickersChange={setTickerFilter}
              includeWatchlist={includeWatchlist}
              onIncludeWatchlistChange={setIncludeWatchlist}
              includePortfolio={includePortfolio}
              onIncludePortfolioChange={setIncludePortfolio}
            />
            <Link
              href="/profile"
              className="inline-flex items-center rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-sm font-medium text-neutral-100 hover:border-[var(--highlight-400)]"
            >
              Profile
            </Link>
          </div>
        }
      />

      <div className="space-y-5">
        {loading && (
          <p className="text-sm text-neutral-400">
            Loading notes activity…
          </p>
        )}

        {!loading && loadError && (
          <p className="text-sm text-red-400">{loadError}</p>
        )}

        {!loading && !loadError && sortedItems.length === 0 && (
          <p className="text-sm text-neutral-400">
            No notes activity yet. Repost an article from News to see it
            here.
          </p>
        )}

        {sortedItems.map((notesItem) => {
          const isOpen = openArticleId === notesItem.id;
          const myRepost = notesItem.reposts.find((r) => r.isMine);
          const qaState = getQaState(notesItem.article.id);

          return (
            <NotesFeedItemRow
              key={notesItem.id}
              notesItem={notesItem}
              isOpen={isOpen}
              qaState={qaState}
              onToggleOpen={() => {
                const willOpen = !isOpen;
                setOpenArticleId(willOpen ? notesItem.id : null);
                if (willOpen && !notesItem.article.viewed) {
                  void markViewed(notesItem.article.id);
                }
              }}
              onToggleQa={() => toggleQa(notesItem.article.id)}
              onUpdateQaInput={(value) =>
                updateQaInput(notesItem.article.id, value)
              }
              onAddQaQuestion={() =>
                addQaQuestion(notesItem.article.id)
              }
              onGetQaAnswers={() =>
                void getQaAnswers(notesItem.article.id)
              }
              onDeleteQaEntry={(questionId) =>
                void deleteQaEntry(notesItem.article.id, questionId)
              }
              onDownload={() =>
                handleDownload(notesItem.article.id)
              }
              onOpenRepost={() =>
                openRepostPanelForItem(notesItem, myRepost ?? null)
              }
              highlightTickers={highlightTickers}
            />
          );
        })}
      </div>

      {/* Repost overlay for Notes */}
      {repostDraft && (
        <NotesRepostOverlay
          draft={repostDraft}
          onClose={closeRepostPanel}
          onToggleTicker={toggleRepostTicker}
          onChangeComment={(value) =>
            setRepostDraft((prev) =>
              prev ? { ...prev, comment: value } : prev
            )
          }
          onSubmit={submitRepost}
        />
      )}
    </main>
  );
}
