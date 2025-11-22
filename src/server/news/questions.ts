// src/server/news/questions.ts
import prisma from "@/lib/prisma";

export type QaEntryStatus = "pending" | "answered" | "error";

/**
 * A single Q&A entry stored in NewsArticle.qaHistoryJson.
 *
 * - userId:
 *   - number for entries tied to a specific user
 *   - null for legacy/global entries (they will not be shown to any user)
 */
export type QaEntry = {
  id: string;
  userId: number | null;
  question: string;
  answer: string | null;
  status: QaEntryStatus;
  createdAtISO: string;
  answeredAtISO: string | null;
};

/**
 * Safely parse the stored JSON blob into a clean QaEntry[].
 */
function parseQaHistoryJson(json: string | null): QaEntry[] {
  if (!json) return [];
  try {
    const raw = JSON.parse(json);
    if (!Array.isArray(raw)) return [];

    const result: QaEntry[] = [];

    for (const item of raw) {
      if (!item || typeof item !== "object") continue;

      const anyItem = item as any;

      const id =
        typeof anyItem.id === "string" && anyItem.id.trim().length > 0
          ? anyItem.id.trim()
          : null;

      const question =
        typeof anyItem.question === "string" &&
        anyItem.question.trim().length > 0
          ? anyItem.question.trim()
          : null;

      const answer =
        typeof anyItem.answer === "string" &&
        anyItem.answer.trim().length > 0
          ? anyItem.answer.trim()
          : null;

      const statusValue = anyItem.status;
      const status: QaEntryStatus =
        statusValue === "pending" ||
        statusValue === "answered" ||
        statusValue === "error"
          ? statusValue
          : "answered";

      const createdAtISO =
        typeof anyItem.createdAtISO === "string" &&
        anyItem.createdAtISO.trim().length > 0
          ? anyItem.createdAtISO.trim()
          : null;

      const answeredAtISO =
        typeof anyItem.answeredAtISO === "string" &&
        anyItem.answeredAtISO.trim().length > 0
          ? anyItem.answeredAtISO.trim()
          : null;

      // userId may be stored as number or string; legacy entries may have none.
      let userId: number | null = null;
      if (typeof anyItem.userId === "number" && Number.isFinite(anyItem.userId)) {
        userId = anyItem.userId;
      } else if (
        typeof anyItem.userId === "string" &&
        anyItem.userId.trim().length > 0 &&
        !Number.isNaN(Number(anyItem.userId))
      ) {
        userId = Number(anyItem.userId);
      }

      if (!id || !question || !createdAtISO) continue;

      result.push({
        id,
        userId,
        question,
        answer,
        status,
        createdAtISO,
        answeredAtISO,
      });
    }

    return result;
  } catch (err) {
    console.error("Failed to parse qaHistoryJson:", err);
    return [];
  }
}

/**
 * Serialise QaEntry[] back to JSON for storage.
 */
function serialiseQaHistory(entries: QaEntry[]): string {
  return JSON.stringify(entries, null, 2);
}

/**
 * Load ALL QA history entries (for every user) for a given article.
 * Most callers should prefer the per-user helpers below.
 */
async function loadAllQaHistory(articleId: string): Promise<QaEntry[]> {
  const article = await prisma.newsArticle.findUnique({
    where: { id: articleId },
    select: { qaHistoryJson: true },
  });

  if (!article) return [];
  return parseQaHistoryJson(article.qaHistoryJson);
}

/**
 * Persist ALL QA history entries (for every user) into NewsArticle.qaHistoryJson.
 */
async function saveAllQaHistory(
  articleId: string,
  entries: QaEntry[]
): Promise<void> {
  const payload = serialiseQaHistory(entries);

  await prisma.newsArticle.update({
    where: { id: articleId },
    data: { qaHistoryJson: payload },
  });
}

/**
 * Load QA history for a single user & article.
 * Legacy entries without a userId are ignored.
 */
export async function loadQaHistoryForUser(
  articleId: string,
  userId: number
): Promise<QaEntry[]> {
  const all = await loadAllQaHistory(articleId);
  return all.filter((entry) => entry.userId === userId);
}

/**
 * Replace the QA history for a single user on a given article.
 * Entries for other users (and legacy entries with userId === null) are preserved.
 */
export async function saveQaHistoryForUser(
  articleId: string,
  userId: number,
  userEntries: QaEntry[]
): Promise<void> {
  const all = await loadAllQaHistory(articleId);

  const others = all.filter((entry) => entry.userId !== userId);

  const normalizedUserEntries: QaEntry[] = userEntries.map((entry) => ({
    ...entry,
    userId,
  }));

  const combined = [...others, ...normalizedUserEntries];
  await saveAllQaHistory(articleId, combined);
}

/**
 * Append new entries to the current user's QA history for an article.
 * Returns the updated history for that user (sorted by createdAtISO ascending).
 */
export async function appendQaEntriesForUser(
  articleId: string,
  userId: number,
  newEntries: QaEntry[]
): Promise<QaEntry[]> {
  const existing = await loadQaHistoryForUser(articleId, userId);

  const normalizedNew: QaEntry[] = newEntries.map((entry) => ({
    ...entry,
    userId,
  }));

  const merged = [...existing, ...normalizedNew];

  // Persist full combined set per user
  await saveQaHistoryForUser(articleId, userId, merged);

  // Sort by creation time, oldest first (client can reverse if it wants newest-first)
  merged.sort((a, b) => a.createdAtISO.localeCompare(b.createdAtISO));
  return merged;
}

/**
 * Delete a single QA entry (by id) for the given user & article.
 * Returns the updated history for that user.
 */
export async function deleteQuestionForUser(
  articleId: string,
  userId: number,
  questionId: string
): Promise<QaEntry[]> {
  const all = await loadAllQaHistory(articleId);

  const filteredAll = all.filter(
    (entry) => !(entry.userId === userId && entry.id === questionId)
  );

  await saveAllQaHistory(articleId, filteredAll);

  return filteredAll.filter((entry) => entry.userId === userId);
}
