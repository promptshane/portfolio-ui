// src/server/news/batchRunner.ts
import type {
  NewsBatchJob,
  NewsBatchStatus,
  NewsBatchType,
} from "@prisma/client";
import prisma from "@/lib/prisma";
import { generateAndStoreSummary } from "./summarizer";
import { ingestEmailsFromGmail } from "./emailIngest";
import { getVerifiedEmailsForUser } from "../user/preferences";

type JobSnapshot = Pick<
  NewsBatchJob,
  | "id"
  | "userId"
  | "type"
  | "status"
  | "total"
  | "completed"
  | "summary"
  | "lastError"
  | "createdAt"
  | "updatedAt"
>;

type SummarizeCriteria = {
  articleIds: string[];
  label?: string;
};

type RefreshCriteria = {
  senders: string[];
  lookbackDays?: number;
  maxEmails?: number;
};

const ACTIVE_STATUSES: NewsBatchStatus[] = ["pending", "running"];
const runningJobs = new Set<number>();
let resumed = false;
let jobTableReady = false;
let jobEnsurePromise: Promise<void> | null = null;

async function ensureNewsBatchJobTable() {
  if (jobTableReady) return;
  if (jobEnsurePromise) {
    await jobEnsurePromise;
    return;
  }

  jobEnsurePromise = (async () => {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "NewsBatchJob" (
        "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
        "userId" INTEGER NOT NULL,
        "type" TEXT NOT NULL,
        "status" TEXT NOT NULL DEFAULT 'pending',
        "total" INTEGER NOT NULL DEFAULT 0,
        "completed" INTEGER NOT NULL DEFAULT 0,
        "summary" TEXT,
        "criteriaJson" TEXT,
        "lastError" TEXT,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "NewsBatchJob_userId_fkey"
          FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
      )
    `);
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "NewsBatchJob_userId_status_createdAt_idx"
      ON "NewsBatchJob" ("userId", "status", "createdAt")
    `);
    jobTableReady = true;
  })().finally(() => {
    jobEnsurePromise = null;
  });

  await jobEnsurePromise;
}

function scheduleJob(jobId: number) {
  setTimeout(() => {
    void runJob(jobId);
  }, 10);
}

async function resumePendingJobsOnce() {
  if (resumed) return;
  resumed = true;
  await ensureNewsBatchJobTable();
  const jobs = await prisma.newsBatchJob.findMany({
    where: { status: { in: ACTIVE_STATUSES } },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });
  jobs.forEach((job) => scheduleJob(job.id));
}

async function markCompleted(jobId: number, message: string | null, failed = false, error?: string) {
  await prisma.newsBatchJob.update({
    where: { id: jobId },
    data: {
      status: failed ? "failed" : "completed",
      summary: message,
      lastError: failed ? error ?? "" : null,
    },
  });
}

function parseCriteria<T>(json: string | null): T {
  if (!json) return {} as T;
  try {
    return JSON.parse(json) as T;
  } catch {
    return {} as T;
  }
}

async function processSummarizeJob(job: NewsBatchJob) {
  const criteria = parseCriteria<SummarizeCriteria>(job.criteriaJson);
  const articleIds = Array.from(new Set(criteria.articleIds ?? [])).filter(Boolean);
  const total = articleIds.length;

  await prisma.newsBatchJob.update({
    where: { id: job.id },
    data: { total, completed: 0, summary: total ? `0/${total} Articles Processed` : "Nothing to summarize." },
  });

  if (!total) {
    return markCompleted(job.id, "Nothing to summarize.");
  }

  let completed = 0;
  let lastError: string | null = null;

  for (const articleId of articleIds) {
    try {
      await generateAndStoreSummary(articleId);
    } catch (err) {
      lastError = err instanceof Error ? err.message : "Failed to summarize an article.";
    }
    completed += 1;
    await prisma.newsBatchJob.update({
      where: { id: job.id },
      data: {
        completed,
        summary: `${completed}/${total} Articles Processed`,
        lastError,
      },
    });
  }

  if (lastError) {
    await markCompleted(job.id, `${completed}/${total} Articles Processed`, true, lastError);
  } else {
    await markCompleted(job.id, `Finished ${completed}/${total} Articles.`);
  }
}

async function processRefreshJob(job: NewsBatchJob) {
  const criteria = parseCriteria<RefreshCriteria>(job.criteriaJson);
  await prisma.newsBatchJob.update({
    where: { id: job.id },
    data: { summary: "Finding new articles…", total: 0, completed: 0 },
  });

  try {
    const summary = await ingestEmailsFromGmail({
      senders: criteria.senders,
      lookbackDays: criteria.lookbackDays,
      maxEmails: criteria.maxEmails,
    });

    const articleIds = Array.from(new Set(summary.createdArticleIds ?? []));
    const total = articleIds.length;

    await prisma.newsBatchJob.update({
      where: { id: job.id },
      data: {
        total,
        completed: 0,
        summary: total ? `Found ${total} Articles` : "No new articles found.",
      },
    });

    if (!total) {
      return markCompleted(job.id, "No new articles to process.");
    }

    let completed = 0;
    let lastError: string | null = null;

    for (const articleId of articleIds) {
      try {
        await generateAndStoreSummary(articleId);
      } catch (err) {
        lastError = err instanceof Error ? err.message : "Failed to summarize an article.";
      }
      completed += 1;
      await prisma.newsBatchJob.update({
        where: { id: job.id },
        data: {
          completed,
          summary: `${completed}/${total} Articles Processed`,
          lastError,
        },
      });
    }

    if (lastError) {
      await markCompleted(job.id, `${completed}/${total} Articles Processed`, true, lastError);
    } else {
      await markCompleted(job.id, `Completed ${completed}/${total} Articles.`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Refresh failed.";
    await markCompleted(job.id, null, true, message);
  }
}

async function runJob(jobId: number) {
  if (runningJobs.has(jobId)) return;
  runningJobs.add(jobId);
  try {
    await ensureNewsBatchJobTable();
    let job = await prisma.newsBatchJob.findUnique({ where: { id: jobId } });
    if (!job) return;
    if (!ACTIVE_STATUSES.includes(job.status)) return;

    if (job.status === "pending") {
      job = await prisma.newsBatchJob.update({
        where: { id: job.id },
        data: { status: "running" },
      });
    }

    if (job.type === "summarize" || job.type === "resummarize") {
      await processSummarizeJob(job);
    } else if (job.type === "refresh") {
      await processRefreshJob(job);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Job failed.";
    await markCompleted(jobId, null, true, message);
  } finally {
    runningJobs.delete(jobId);
  }
}

resumePendingJobsOnce().catch((err) => {
  console.error("Failed to resume pending news jobs", err);
});

async function ensureNoActiveJob(userId: number) {
  await ensureNewsBatchJobTable();
  const existing = await prisma.newsBatchJob.findFirst({
    where: {
      userId,
      status: { in: ACTIVE_STATUSES },
    },
  });
  if (existing) {
    throw new Error("A news job is already running. Please wait until it finishes.");
  }
}

export async function enqueueSummarizeJob(options: {
  userId: number;
  articleIds: string[];
  type: Extract<NewsBatchType, "summarize" | "resummarize">;
  label?: string;
}) {
  await ensureNewsBatchJobTable();
  await ensureNoActiveJob(options.userId);
  const articleIds = Array.from(new Set(options.articleIds)).filter(Boolean);
  if (!articleIds.length) {
    throw new Error("No articles selected for summarization.");
  }

  const job = await prisma.newsBatchJob.create({
    data: {
      userId: options.userId,
      type: options.type,
      status: "pending",
      total: articleIds.length,
      summary: `Queued ${articleIds.length} Articles`,
      criteriaJson: JSON.stringify({
        articleIds,
        label: options.label,
      } satisfies SummarizeCriteria),
    },
  });

  scheduleJob(job.id);
  return job;
}

export async function enqueueRefreshJob(options: {
  userId: number;
  lookbackDays?: number;
  maxEmails?: number;
}) {
  await ensureNewsBatchJobTable();
  await ensureNoActiveJob(options.userId);
  const senders = await getVerifiedEmailsForUser(options.userId);
  if (!senders.length) {
    throw new Error("Add at least one verified sender email in Settings before refreshing.");
  }

  const job = await prisma.newsBatchJob.create({
    data: {
      userId: options.userId,
      type: "refresh",
      status: "pending",
      summary: "Queued refresh", 
      criteriaJson: JSON.stringify({
        senders,
        lookbackDays: options.lookbackDays,
        maxEmails: options.maxEmails,
      } satisfies RefreshCriteria),
    },
  });

  scheduleJob(job.id);
  return job;
}

export async function getJobsForUser(userId: number, limit = 5): Promise<JobSnapshot[]> {
  if (!userId) return [];
  await ensureNewsBatchJobTable();
  const jobs = await prisma.newsBatchJob.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return jobs as JobSnapshot[];
}
