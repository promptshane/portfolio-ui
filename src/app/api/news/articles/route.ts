// src/app/api/news/articles/route.ts
import { NextRequest, NextResponse } from "next/server";
import path from "path";
import { addPdfFromBuffer, listPdfs } from "@/server/news/store";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { getAggregatedTickerSets } from "@/server/user/tickers";

export const runtime = "nodejs";

function getArticleTickerMatches(
  article: {
    tickersJson: string | null;
  },
  targetTickers: Set<string>
): string[] {
  if (!targetTickers.size) return [];
  if (!article.tickersJson) return [];

  const matches = new Set<string>();

  try {
    const parsed = JSON.parse(article.tickersJson);
    if (!Array.isArray(parsed)) return [];

    for (const v of parsed) {
      let symbol: string | null = null;

      if (typeof v === "string") {
        symbol = v;
      } else if (v && typeof (v as any).symbol === "string") {
        symbol = (v as any).symbol;
      }

      if (symbol) {
        const upper = symbol.trim().toUpperCase();
        if (upper && targetTickers.has(upper)) {
          matches.add(upper);
        }
      }
    }
  } catch {
    // If parsing fails, just treat as no matches.
    return [];
  }

  return Array.from(matches);
}

export async function GET() {
  const articles = await listPdfs();

  // Default: unauthenticated, no per-user flags.
  let viewedIds = new Set<string>();
  let portfolioTickers = new Set<string>();
  let watchlistTickers = new Set<string>();

  // Try to resolve current user
  const session = await getServerSession(authOptions);
  const uid = Number((session as any)?.user?.id) || 0;

  if (uid && articles.length > 0) {
    const articleIds = articles.map((a) => a.id);

    const [views, tickerSets] = await Promise.all([
      prisma.newsArticleView.findMany({
        where: {
          userId: uid,
          articleId: { in: articleIds },
        },
        select: { articleId: true },
      }),
      getAggregatedTickerSets(uid),
    ]);

    viewedIds = new Set(views.map((v) => v.articleId));
    portfolioTickers = new Set(tickerSets.portfolio);
    watchlistTickers = new Set(tickerSets.watchlist);
  }

  return NextResponse.json({
    articles: articles.map((a) => {
      const matchedPortfolioTickers =
        uid && portfolioTickers.size
          ? getArticleTickerMatches(a, portfolioTickers)
          : [];

      const matchedWatchlistTickers =
        uid && watchlistTickers.size
          ? getArticleTickerMatches(a, watchlistTickers)
          : [];

      const ext = path.extname(a.pdfPath || "").toLowerCase();
      const fileKind = ext === ".txt" ? "text" : "pdf";

      return {
        id: a.id,
        originalFilename: a.originalFilename,
        uploadedAt: a.uploadedAt.toISOString(),
        hasSummary: a.hasSummary,
        title: a.title,
        author: a.author,
        datePublished: a.datePublished
          ? a.datePublished.toISOString()
          : null,
        summaryText: a.summaryText,
        keyPointsJson: a.keyPointsJson,
        actionsJson: a.actionsJson,
        tickersJson: a.tickersJson,
        summarizedAt: a.summarizedAt
          ? a.summarizedAt.toISOString()
          : null,
        fileKind,
        // New per-user flags (will be false/empty if not logged in)
        viewed: uid ? viewedIds.has(a.id) : false,
        hasPortfolioTicker: uid
          ? matchedPortfolioTickers.length > 0
          : false,
        portfolioTickers: uid ? matchedPortfolioTickers : [],
        hasWatchlistTicker: uid
          ? matchedWatchlistTickers.length > 0
          : false,
        watchlistTickers: uid ? matchedWatchlistTickers : [],
      };
    }),
  });
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const files = formData.getAll("files");

    if (!files || files.length === 0) {
      return NextResponse.json(
        {
          error:
            "No files provided. Use 'files' field with one or more PDFs.",
        },
        { status: 400 }
      );
    }

    const created: {
      id: string;
      originalFilename: string;
      uploadedAt: string;
      hasSummary: boolean;
    }[] = [];
    let duplicates = 0;

    for (const entry of files) {
      if (!(entry instanceof File)) continue;

      const arrayBuffer = await entry.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      const { article, isDuplicate } = await addPdfFromBuffer(
        buffer,
        entry.name || "upload.pdf"
      );

      if (isDuplicate) {
        duplicates += 1;
        continue;
      }

      created.push({
        id: article.id,
        originalFilename: article.originalFilename,
        uploadedAt: article.uploadedAt.toISOString(),
        hasSummary: article.hasSummary,
      });
    }

    if (created.length === 0 && duplicates === 0) {
      return NextResponse.json(
        { error: "No valid file entries found in 'files' field." },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { articles: created, duplicates },
      { status: created.length ? 201 : 200 }
    );
  } catch (err) {
    console.error("Error uploading PDFs:", err);
    return NextResponse.json(
      { error: "Failed to upload PDFs." },
      { status: 500 }
    );
  }
}
