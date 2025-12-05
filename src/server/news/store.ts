// src/server/news/store.ts
import crypto from "crypto";
import path from "path";
import type { NewsArticle } from "@prisma/client";
import prisma from "@/lib/prisma";
import { deleteObject, getObjectBuffer, putObjectBuffer, s3Enabled } from "../s3Client";

const SUPPORTED_EXTENSIONS = new Set([".pdf", ".txt"]);

function determineStoredExtension(originalFilename: string): string {
  const ext = (path.extname(originalFilename || "") || "").toLowerCase();
  if (SUPPORTED_EXTENSIONS.has(ext)) {
    return ext;
  }
  return ".pdf";
}

// Content-based id (buffer only) so duplicates are detected regardless of filename
function generateArticleId(buffer: Buffer): string {
  const hash = crypto.createHash("sha256").update(buffer).digest("hex");
  return hash.slice(0, 40);
}

async function storageExists(article: NewsArticle): Promise<boolean> {
  try {
    const buf = await getObjectBuffer(article.pdfPath);
    if (buf) return true;
  } catch {
    /* missing or inaccessible */
  }
  return false;
}

export async function addPdfFromBuffer(
  buffer: Buffer,
  originalFilename: string,
  options?: { sourceEmail?: string | null }
): Promise<{ article: NewsArticle; isDuplicate: boolean }> {
  if (!s3Enabled) {
    throw new Error("S3 is not configured. Cloud storage is required for news PDFs.");
  }
  const id = generateArticleId(buffer);
  const existing = await prisma.newsArticle.findUnique({
    where: { id },
  });

  // Duplicate by content: do not rewrite or create a new row
  if (existing) {
    const hasStorage = await storageExists(existing);
    if (hasStorage) {
      return { article: existing, isDuplicate: true };
    }
    // Storage missing: clean up stale record and re-store
    try {
      await deletePdf(existing.id);
    } catch {
      /* ignore cleanup errors */
    }
  }

  const storedExtension = determineStoredExtension(originalFilename);
  const key = `news-pdfs/${id}${storedExtension}`;
  const storedPathForDb = key;

  await putObjectBuffer({
    key,
    body: buffer,
    contentType: storedExtension === ".txt" ? "text/plain" : "application/pdf",
    tags: { section: "news", kind: "article-pdf" },
    metadata: { section: "news", kind: "article-pdf", articleId: id },
  });

  const article = await prisma.newsArticle.create({
    data: {
      id,
      originalFilename,
      pdfPath: storedPathForDb,
      sourceEmail: options?.sourceEmail?.trim().toLowerCase() || null,
    },
  });

  return { article, isDuplicate: false };
}

export async function filenameExistsAndValid(filename: string): Promise<boolean> {
  const name = filename.trim();
  if (!name) return false;
  const existing = await prisma.newsArticle.findFirst({
    where: { originalFilename: name },
    select: { id: true, pdfPath: true },
  });
  if (!existing) return false;

  const hasStorage = await storageExists(existing as NewsArticle);
  if (hasStorage) return true;

  // Storage missing: clean up stale record so ingest can re-store
  try {
    await deletePdf(existing.id);
  } catch {
    /* ignore */
  }
  return false;
}

export async function listPdfs(): Promise<NewsArticle[]> {
  return prisma.newsArticle.findMany({
    orderBy: { uploadedAt: "desc" },
  });
}

export async function getArticleById(
  id: string
): Promise<NewsArticle | null> {
  return prisma.newsArticle.findUnique({
    where: { id },
  });
}

export async function readPdfBuffer(id: string): Promise<Buffer> {
  const article = await prisma.newsArticle.findUnique({
    where: { id },
  });
  if (!article) {
    throw new Error(`NewsArticle not found for id=${id}`);
  }

  if (!s3Enabled) {
    throw new Error("S3 is not configured. Cloud storage is required for news PDFs.");
  }

  const buf = await getObjectBuffer(article.pdfPath);
  if (!buf) {
    throw new Error("PDF not found in S3 storage");
  }
  return buf;
}

export async function deletePdf(id: string): Promise<void> {
  const article = await prisma.newsArticle.findUnique({
    where: { id },
  });

  if (!article) {
    return;
  }

  if (!s3Enabled) {
    throw new Error("S3 is not configured. Cloud storage is required for news PDFs.");
  }

  if (article.pdfPath) {
    await deleteObject(article.pdfPath);
  }

  try {
    await prisma.newsArticle.delete({
      where: { id },
    });
  } catch (err: any) {
    if (err?.code !== "P2025") {
      throw err;
    }
  }
}

/**
 * Summary helpers.
 */

export type SummaryPayload = {
  title?: string | null;
  author?: string | null;
  datePublished?: string | Date | null;
  summaryText?: string | null;
  keyPoints?: string[] | null;
  actions?: unknown[] | null;
  // keep generic so we can store richer ticker objects if needed
  tickers?: unknown[] | null;
  positions?: unknown[] | null;
  ongoingActions?: unknown[] | null;
  ongoingTickers?: unknown[] | null;
};

export async function saveSummary(
  id: string,
  payload: SummaryPayload,
  options?: {
    storageDecision?: string | null;
    qualityTag?: string | null;
    qualityNote?: string | null;
  }
): Promise<NewsArticle> {
  const datePublished =
    payload.datePublished instanceof Date
      ? payload.datePublished
      : payload.datePublished
      ? new Date(payload.datePublished)
      : null;

  const buildDiscountPayload = () => {
    const discountPayload: {
      positions?: unknown[];
      ongoing_actions?: unknown[];
      ongoing_tickers?: unknown[];
    } = {};

    if (payload.positions?.length) discountPayload.positions = payload.positions;
    if (payload.ongoingActions?.length)
      discountPayload.ongoing_actions = payload.ongoingActions as unknown[];
    if (payload.ongoingTickers?.length)
      discountPayload.ongoing_tickers = payload.ongoingTickers as unknown[];

    return Object.keys(discountPayload).length ? discountPayload : null;
  };

  const article = await prisma.newsArticle.update({
    where: { id },
    data: {
      hasSummary: true,
      title: payload.title ?? null,
      author: payload.author ?? null,
      datePublished,
      summaryText: payload.summaryText ?? null,
      keyPointsJson: payload.keyPoints
        ? JSON.stringify(payload.keyPoints)
        : null,
      actionsJson: payload.actions ? JSON.stringify(payload.actions) : null,
      tickersJson: payload.tickers ? JSON.stringify(payload.tickers) : null,
      storageDecision:
        typeof options?.storageDecision === "string" && options.storageDecision.trim()
          ? options.storageDecision.trim()
          : "Store",
      qualityTag:
        typeof options?.qualityTag === "string" && options.qualityTag.trim()
          ? options.qualityTag.trim()
          : "Good",
      qualityNote:
        typeof options?.qualityNote === "string" && options.qualityNote.trim()
          ? options.qualityNote.trim()
          : null,
      discountJson: (() => {
        const discountPayload = buildDiscountPayload();
        return discountPayload ? JSON.stringify(discountPayload) : null;
      })(),
      summarizedAt: new Date(),
    },
  });

  return article;
}

export async function listSummarizedArticles(): Promise<NewsArticle[]> {
  return prisma.newsArticle.findMany({
    where: { hasSummary: true },
    orderBy: [
      { summarizedAt: "desc" },
      { uploadedAt: "desc" },
    ],
  });
}

/**
 * Per-user view tracking.
 */
export async function markArticleViewed(
  articleId: string,
  userId: number
): Promise<void> {
  if (!userId || !articleId) return;

  const now = new Date();

  await prisma.newsArticleView.upsert({
    where: {
      userId_articleId: {
        userId,
        articleId,
      },
    },
    create: {
      userId,
      articleId,
      firstViewedAt: now,
      lastViewedAt: now,
    },
    update: {
      lastViewedAt: now,
    },
  });
}
