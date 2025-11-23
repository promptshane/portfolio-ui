import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  enqueueRefreshJob,
  enqueueSummarizeJob,
  getJobsForUser,
} from "@/server/news/batchRunner";

function getUserId(session: unknown): number | null {
  const rawId = (session as { user?: { id?: number | string | null } } | null)?.user?.id;
  if (typeof rawId === "number") return rawId;
  if (typeof rawId === "string") {
    const parsed = Number(rawId);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

export async function GET() {
  const session = await getServerSession(authOptions);
  const uid = getUserId(session);
  if (!uid) return NextResponse.json({ jobs: [] }, { status: 200 });

  const jobs = await getJobsForUser(uid, 5);
  return NextResponse.json({ jobs });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const uid = getUserId(session);
  if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: any = null;
  try {
    body = await req.json();
  } catch {
    /* noop */
  }

  const type = typeof body?.type === "string" ? body.type : "";

  try {
    if (type === "refresh") {
      const lookbackDays = Number(body?.lookbackDays) || 7;
      const maxEmails = Number(body?.maxEmails) || 100;
      const job = await enqueueRefreshJob({ userId: uid, lookbackDays, maxEmails });
      return NextResponse.json({ job });
    }

    if (type === "summarize" || type === "resummarize") {
      const ids: unknown[] = Array.isArray(body?.articleIds) ? body.articleIds : [];
      const articleIds = ids.map((id: unknown) => String(id)).filter((id) => id.trim().length > 0);
      const job = await enqueueSummarizeJob({
        userId: uid,
        articleIds,
        type,
        label: body?.label,
      });
      return NextResponse.json({ job });
    }

    return NextResponse.json({ error: "Unsupported job type" }, { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to start job.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
