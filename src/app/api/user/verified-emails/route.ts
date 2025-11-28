import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  getAggregatedVerifiedEmailsForUser,
  parseEmailList,
  saveVerifiedEmailsForUser,
} from "@/server/user/preferences";

export const dynamic = "force-dynamic";

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
  if (!uid) return NextResponse.json({ emails: [] }, { status: 200 });

  const { own, family, combined } = await getAggregatedVerifiedEmailsForUser(uid);
  return NextResponse.json({ emails: own, familyEmails: family, combined });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const uid = getUserId(session);
  if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: any = null;
  try {
    body = await req.json();
  } catch {
    /* ignore */
  }

  const rawList = Array.isArray(body?.emails) ? body.emails : body?.emails;
  const emails = parseEmailList(rawList);

  const saved = await saveVerifiedEmailsForUser(uid, emails);
  const aggregated = await getAggregatedVerifiedEmailsForUser(uid);
  return NextResponse.json({ emails: saved, familyEmails: aggregated.family, combined: aggregated.combined });
}
