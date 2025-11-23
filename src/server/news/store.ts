// src/server/news/store.ts
import fs from "fs";
import path from "path";
import crypto from "crypto";
import type { NewsArticle } from "@prisma/client";
import prisma from "@/lib/prisma";
import { getObjectBuffer, putObjectBuffer, s3Enabled } from "../s3Client";

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
  const id = generateArticleId(buffer);
  const existing = await prisma.newsArticle.findUnique({
    where: { id },
  });

  // Duplicate by content: do not rewrite or create a new row
  if (existing) {
    return { article: existing, isDuplicate: true };
  }

  const storedExtension = determineStoredExtension(originalFilename);
  const key = `news-pdfs/${id}${storedExtension}`;

  if (s3Enabled) {
    await putObjectBuffer({
      key,
      body: buffer,
      contentType: storedExtension === ".txt" ? "text/plain" : "application/pdf",
    });
  } else {
    const relativePath = path.join("data", "news-pdfs", `${id}${storedExtension}`);
    const absolutePath = path.join(process.cwd(), relativePath);
    await fs.promises.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.promises.writeFile(absolutePath, buffer);
  }

  const article = await prisma.newsArticle.create({
    data: {
      id,
      originalFilename,
      pdfPath: key,
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

export async function readPdfBuffer(id: string): Promise<Buffer> {
  const article = await prisma.newsArticle.findUnique({
    where: { id },
  });
  if (!article) {
    throw new Error(`NewsArticle not found for id=${id}`);
  }

  if (s3Enabled) {
    const buf = await getObjectBuffer(article.pdfPath);
    if (!buf) throw new Error("PDF not found in S3");
    return buf;
  }

  const storedPath = path.isAbsolute(article.pdfPath)
    ? article.pdfPath
    : path.join(process.cwd(), article.pdfPath);
  return await fs.promises.readFile(storedPath);
}

export async function deletePdf(id: string): Promise<void> {
  const article = await prisma.newsArticle.findUnique({
    where: { id },
  });

  if (article) {
    // Best-effort local cleanup; S3 cleanup can be handled separately via lifecycle or manual delete.
    try {
      const storedPath = path.isAbsolute(article.pdfPath)
        ? article.pdfPath
        : path.join(process.cwd(), article.pdfPath);
      await fs.promises.unlink(storedPath);
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
