import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { familyService } from "@/server/family";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function requireUserId() {
  const session = await getServerSession(authOptions);
  const uid = await familyService.getUserIdFromSession(session);
  if (!uid) throw new Error("Unauthorized");
  return uid;
}

async function respondContext(uid: number) {
  try {
    const ctx = await familyService.fetchFamilyContext(uid);
    return NextResponse.json({ ok: true, ...ctx });
  } catch {
    return NextResponse.json({ ok: false, error: "Family features are not available yet." }, { status: 501 });
  }
}

export async function GET() {
  try {
    const uid = await requireUserId();
    return await respondContext(uid);
  } catch (err) {
    if ((err as Error).message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("Failed to load family context", err);
    return NextResponse.json({ error: "Family data unavailable" }, { status: 501 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const uid = await requireUserId();
    const body = await req.json().catch(() => null);
    const action = body?.action;

    if (action === "create") {
      const name = String(body?.name || "").trim();
      if (!name) {
        return NextResponse.json({ error: "Family name is required" }, { status: 400 });
      }
      await familyService.createFamily(uid, name);
      return await respondContext(uid);
    }

    if (action === "invite") {
      const familyId = Number(body?.familyId);
      const username = String(body?.username || "").trim();
      if (!familyId || !username) {
        return NextResponse.json({ error: "familyId and username are required" }, { status: 400 });
      }
      const isMember = await familyService.fetchFamilyContext(uid).then((ctx) =>
        ctx.families.some((f) => f.id === familyId)
      );
      if (!isMember) {
        return NextResponse.json({ error: "Not a family member" }, { status: 403 });
      }
      await familyService.inviteToFamily(uid, familyId, username);
      return await respondContext(uid);
    }

    if (action === "acceptInvite") {
      const inviteId = Number(body?.inviteId);
      if (!inviteId) return NextResponse.json({ error: "inviteId is required" }, { status: 400 });
      await familyService.acceptInvite(uid, inviteId);
      return await respondContext(uid);
    }

    if (action === "declineInvite") {
      const inviteId = Number(body?.inviteId);
      if (!inviteId) return NextResponse.json({ error: "inviteId is required" }, { status: 400 });
      await familyService.declineInvite(uid, inviteId);
      return await respondContext(uid);
    }

    if (action === "forceAdd") {
      const familyId = Number(body?.familyId);
      const usernames = Array.isArray(body?.usernames) ? body.usernames : [];
      if (!familyId || !usernames.length) {
        return NextResponse.json({ error: "familyId and usernames are required" }, { status: 400 });
      }
      const ctx = await familyService.fetchFamilyContext(uid);
      const isMember = ctx.families.some((f) => f.id === familyId);
      if (!isMember) {
        return NextResponse.json({ error: "Not a family member" }, { status: 403 });
      }
      await familyService.forceAddMembers(uid, familyId, usernames);
      return await respondContext(uid);
    }

    if (action === "leave") {
      const familyId = Number(body?.familyId);
      if (!familyId) return NextResponse.json({ error: "familyId is required" }, { status: 400 });
      await familyService.leaveFamily(uid, familyId);
      return await respondContext(uid);
    }

    return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
  } catch (err) {
    if ((err as Error).message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const msg = err instanceof Error ? err.message : "Request failed";
    console.error("Family API error:", err);
    return NextResponse.json({ error: msg }, { status: 501 });
  }
}
