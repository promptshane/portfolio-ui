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
function scheduleJob(jobId: number) {
  setTimeout(() => {
    void runJob(jobId);
  }, 10);
}

async function resumePendingJobsOnce() {
  if (resumed) return;
  resumed = true;
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
    data: {
      total,
      completed: 0,
      summary: total ? `Summarizing articles (0/${total})` : "Nothing to summarize.",
    },
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
        summary: `Summarizing articles (${completed}/${total})`,
        lastError,
      },
    });
  }

  if (lastError) {
    await markCompleted(job.id, `Summarizing articles (${completed}/${total})`, true, lastError);
  } else {
    await markCompleted(job.id, `All articles summarized (${completed}/${total}).`);
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
        summary: total ? `Found ${total} articles` : "No new articles found.",
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
          summary: `Summarizing articles (${completed}/${total})`,
          lastError,
        },
      });
    }

    if (lastError) {
      await markCompleted(job.id, `Summarizing articles (${completed}/${total})`, true, lastError);
    } else {
      await markCompleted(job.id, `All articles summarized (${completed}/${total}).`);
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
  const jobs = await prisma.newsBatchJob.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return jobs as JobSnapshot[];
}
