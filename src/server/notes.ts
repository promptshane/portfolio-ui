// src/server/notes.ts
import prisma from "@/lib/prisma";
import type { ApiArticle, NewsItem } from "@/app/news/types";
import { mapApiArticleToNewsItem } from "@/app/news/utils";
import { getAggregatedTickerSets } from "./user/tickers";

/**
 * Shape returned to the Notes page.
 * Mirrors what the Notes UI already expects: article + reposts.
 */
export type NotesRepostForFeed = {
  id: string;
  handle: string;
  comment: string;
  tickers: string[];
  createdAtISO: string; // last edited time
  isMine: boolean;
};

export type NotesFeedItem = {
  id: string; // articleId
  article: NewsItem;
  reposts: NotesRepostForFeed[];
};

/**
 * Parse a JSON string of tickers into a normalized string array.
 * We keep this defensive because the stored JSON may evolve.
 */
function parseTickersJson(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    const out: string[] = [];
    for (const entry of parsed) {
      if (typeof entry === "string") {
        const t = entry.trim().toUpperCase();
        if (t) out.push(t);
      } else if (entry && typeof entry === "object" && "symbol" in entry) {
        const t = String((entry as any).symbol ?? "")
          .trim()
          .toUpperCase();
        if (t) out.push(t);
      }
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Compute which of an article's tickers overlap with the user's
 * portfolio/watchlist tickers. Returns a de-duplicated list of
 * UPPERCASE symbols.
 */
function getArticlePortfolioTickers(
  article: { tickersJson: string | null },
  portfolioTickers: Set<string>
): string[] {
  if (!portfolioTickers.size) return [];
  if (!article.tickersJson) return [];

  const matches = new Set<string>();

  try {
    const parsed = JSON.parse(article.tickersJson);
    if (!Array.isArray(parsed)) return [];

    for (const entry of parsed) {
      let symbol: string | null = null;

      if (typeof entry === "string") {
        symbol = entry;
      } else if (entry && typeof (entry as any).symbol === "string") {
        symbol = (entry as any).symbol;
      }

      if (symbol) {
        const upper = symbol.trim().toUpperCase();
        if (upper && portfolioTickers.has(upper)) {
          matches.add(upper);
        }
      }
    }
  } catch {
    // If tickersJson is malformed, just treat as no matches.
    return [];
  }

  return Array.from(matches);
}

/**
 * Build the Notes feed (articles + reposts) for a given user.
 * - Includes reposts by the user and by people they follow.
 * - Reuses the News mapping so articles look identical to the News page.
 */
export async function getNotesFeedForUser(
  userId: number | null
): Promise<NotesFeedItem[]> {
  if (!userId) {
    return [];
  }

  // 1) Determine which users' reposts should appear in this feed:
  //    - the user themself
  //    - anyone they follow
  const follows = await prisma.follow.findMany({
    where: { followerId: userId },
    select: { followingId: true },
  });

  const userIds = new Set<number>();
  userIds.add(userId);
  for (const f of follows) {
    userIds.add(f.followingId);
  }

  const userIdList = Array.from(userIds);

  if (userIdList.length === 0) {
    return [];
  }

  // 2) Pull all relevant reposts and their linked article + user.
  const reposts = await prisma.notesRepost.findMany({
    where: {
      userId: { in: userIdList },
    },
    include: {
      article: true,
      user: true,
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  if (!reposts.length) {
    return [];
  }

  // Group by articleId so each NotesFeedItem is one article with many reposts.
  const byArticle = new Map<
    string,
    {
      article: (typeof reposts)[number]["article"];
      reposts: (typeof reposts)[number][];
    }
  >();

  for (const r of reposts) {
    const key = r.articleId;
    const existing = byArticle.get(key);
    if (!existing) {
      byArticle.set(key, { article: r.article, reposts: [r] });
    } else {
      existing.reposts.push(r);
    }
  }

  const articleIds = Array.from(byArticle.keys());

  // 3) Fetch per-user article view flags + portfolio/watchlist tickers,
  //    same conceptual logic as the News articles API.
  const [views, tickerSets] = await Promise.all([
    prisma.newsArticleView.findMany({
      where: {
        userId,
        articleId: { in: articleIds },
      },
      select: { articleId: true },
    }),
    getAggregatedTickerSets(userId),
  ]);

  const viewedIds = new Set<string>(views.map((v) => v.articleId));

  const portfolioTickers = new Set<string>([
    ...tickerSets.portfolio,
    ...tickerSets.watchlist,
  ]);

  // 4) Build NotesFeedItem[] using the same News mapping.
  const feed: NotesFeedItem[] = [];

  for (const [articleId, group] of byArticle.entries()) {
    const article = group.article;

    const matchedPortfolioTickers =
      portfolioTickers.size
        ? getArticlePortfolioTickers(article, portfolioTickers)
        : [];

    const apiArticle: ApiArticle = {
      id: article.id,
      originalFilename: article.originalFilename,
      uploadedAt: article.uploadedAt.toISOString(),
      hasSummary: article.hasSummary,
      title: article.title ?? null,
      author: article.author ?? null,
      datePublished: article.datePublished
        ? article.datePublished.toISOString()
        : null,
      summaryText: article.summaryText ?? null,
      keyPointsJson: article.keyPointsJson ?? null,
      actionsJson: article.actionsJson ?? null,
      tickersJson: article.tickersJson ?? null,
      summarizedAt: article.summarizedAt
        ? article.summarizedAt.toISOString()
        : null,
      viewed: viewedIds.has(article.id),
      // Per-user portfolio info for this article
      hasPortfolioTicker: matchedPortfolioTickers.length > 0,
      portfolioTickers: matchedPortfolioTickers,
    };

    const newsItem = mapApiArticleToNewsItem(apiArticle);
    if (!newsItem) {
      // Article has no usable summary; skip it in the Notes feed.
      continue;
    }

    const repostDtos: NotesRepostForFeed[] = group.reposts.map((r) => {
      const rawHandle = r.user.username || r.user.email || "";
      return {
        id: String(r.id),
        handle: rawHandle.toLowerCase(),
        comment: r.comment ?? "",
        tickers: parseTickersJson(r.tickersJson),
        // use last-edited time, not original creation time
        createdAtISO: r.updatedAt.toISOString(),
        isMine: r.userId === userId,
      };
    });

    feed.push({
      id: articleId,
      article: newsItem,
      reposts: repostDtos,
    });
  }

  // Sort articles newest-first by article date; fall back to createdAt.
  feed.sort((a, b) => {
    const ta = a.article.dateISO ? new Date(a.article.dateISO).getTime() : 0;
    const tb = b.article.dateISO ? new Date(b.article.dateISO).getTime() : 0;
    return tb - ta;
  });

  return feed;
}
