// src/server/news/store.ts
import fs from "fs";
import path from "path";
import crypto from "crypto";
import type { NewsArticle } from "@prisma/client";
import prisma from "@/lib/prisma";

const PDF_DIR = path.join(process.cwd(), "data", "news-pdfs");

function ensurePdfDir() {
  if (!fs.existsSync(PDF_DIR)) {
    fs.mkdirSync(PDF_DIR, { recursive: true });
  }
}

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

export async function addPdfFromBuffer(
  buffer: Buffer,
  originalFilename: string
): Promise<{ article: NewsArticle; isDuplicate: boolean }> {
  ensurePdfDir();

  const id = generateArticleId(buffer);
  const existing = await prisma.newsArticle.findUnique({
    where: { id },
  });

  // Duplicate by content: do not rewrite or create a new row
  if (existing) {
    return { article: existing, isDuplicate: true };
  }

  const storedExtension = determineStoredExtension(originalFilename);
  const relativePath = path.join(
    "data",
    "news-pdfs",
    `${id}${storedExtension}`
  );
  const absolutePath = path.join(process.cwd(), relativePath);

  await fs.promises.writeFile(absolutePath, buffer);

  const article = await prisma.newsArticle.create({
    data: {
      id,
      originalFilename,
      pdfPath: relativePath,
    },
  });

  return { article, isDuplicate: false };
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

export async function getPdfPath(id: string): Promise<string> {
  const article = await prisma.newsArticle.findUnique({
    where: { id },
  });

  if (!article) {
    throw new Error(`NewsArticle not found for id=${id}`);
  }

  const storedPath = article.pdfPath;
  if (path.isAbsolute(storedPath)) {
    return storedPath;
  }
  return path.join(process.cwd(), storedPath);
}

export async function deletePdf(id: string): Promise<void> {
  const article = await prisma.newsArticle.findUnique({
    where: { id },
  });

  if (article) {
    const storedPath = article.pdfPath;
    const absolutePath = path.isAbsolute(storedPath)
      ? storedPath
      : path.join(process.cwd(), storedPath);

    try {
      await fs.promises.unlink(absolutePath);
    } catch {
      // ignore if file is already gone
    }
  }

  await prisma.newsArticle.delete({
    where: { id },
  });
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
  actions?: string[] | null;
  // keep generic so we can store richer ticker objects if needed
  tickers?: unknown[] | null;
};

export async function saveSummary(
  id: string,
  payload: SummaryPayload
): Promise<NewsArticle> {
  const datePublished =
    payload.datePublished instanceof Date
      ? payload.datePublished
      : payload.datePublished
      ? new Date(payload.datePublished)
      : null;

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
