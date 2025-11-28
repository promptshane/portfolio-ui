import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { compare, hash } from "bcryptjs";
import { validateDevPassword } from "@/server/devPassword";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type OverseerAction =
  | { action: "link"; username: string; password: string }
  | { action: "create"; username: string; password: string; preferredName?: string; devPassword?: string };

type OverseenRow = {
  id: number;
  username: string;
  preferredName?: string | null;
};

function normalizeUsername(value: string) {
  return value.trim().toLowerCase();
}

function safeEmail(username: string) {
  return `${username}+oversee@local.invalid`;
}

function getUserId(session: unknown): number | null {
  const candidate = session as { user?: { id?: number | string | null } } | null;
  const raw = candidate?.user?.id;
  if (typeof raw === "number") return raw;
  if (typeof raw === "string") {
    const parsed = Number(raw);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

async function listOverseen(uid: number): Promise<OverseenRow[]> {
  const links = await prisma.overseerLink.findMany({
    where: { overseerId: uid },
    select: {
      target: {
        select: { id: true, username: true, preferredName: true },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  return links
    .map((link) => link.target)
    .filter((t): t is { id: number; username: string; preferredName: string | null } => !!t)
    .map((t) => ({
      id: t.id,
      username: t.username,
      preferredName: t.preferredName,
    }));
}

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    const uid = getUserId(session);
    if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const self = await prisma.user.findUnique({
      where: { id: uid },
      select: { id: true, username: true, preferredName: true },
    });

    const overseen = await listOverseen(uid);

    return NextResponse.json({
      self,
      overseen,
    });
  } catch (err) {
    console.error("Failed to load oversee accounts", err);
    return NextResponse.json({ error: "Failed to load oversee accounts" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const uid = getUserId(session);
    if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = (await req.json().catch(() => null)) as OverseerAction | null;
    if (!body || typeof body !== "object" || !("action" in body)) {
      return NextResponse.json({ error: "Invalid body" }, { status: 400 });
    }

    if (body.action === "link") {
      const username = normalizeUsername(body.username || "");
      const password = body.password || "";
      if (!username || !password) {
        return NextResponse.json({ error: "Username and password required" }, { status: 400 });
      }

      const target = await prisma.user.findFirst({
        where: { username },
        select: { id: true, username: true, preferredName: true, password: true },
      });
      if (!target || !target.password) {
        return NextResponse.json({ error: "Account not found" }, { status: 404 });
      }
      if (target.id === uid) {
        return NextResponse.json({ error: "You are already signed into this account." }, { status: 400 });
      }

      const ok = await compare(password, target.password);
      if (!ok) {
        return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
      }

      await prisma.overseerLink.upsert({
        where: { overseerId_targetId: { overseerId: uid, targetId: target.id } },
        update: {},
        create: { overseerId: uid, targetId: target.id },
      });

      return NextResponse.json({
        ok: true,
        account: { id: target.id, username: target.username, preferredName: target.preferredName },
      });
    }

    if (body.action === "create") {
      const rawUsername = normalizeUsername(body.username || "");
      const password = body.password || "";
      const devCheck = validateDevPassword(body.devPassword);
      if (!rawUsername || password.length < 6) {
        return NextResponse.json(
          { error: "Username and password (min 6 chars) are required" },
          { status: 400 }
        );
      }
      if (!devCheck.ok) {
        const status = devCheck.error?.includes("not configured") ? 500 : 401;
        return NextResponse.json({ error: devCheck.error }, { status });
      }

      const existing = await prisma.user.findFirst({
        where: { username: rawUsername },
        select: { id: true },
      });
      if (existing) {
        return NextResponse.json({ error: "Username already exists" }, { status: 409 });
      }

      const hashed = await hash(password, 12);
      const preferredName = body.preferredName?.trim();

      const created = await prisma.user.create({
        data: {
          username: rawUsername,
          preferredName: preferredName || rawUsername,
          password: hashed,
          email: safeEmail(rawUsername),
        },
        select: { id: true, username: true, preferredName: true },
      });

      await prisma.overseerLink.create({
        data: { overseerId: uid, targetId: created.id },
      });

      return NextResponse.json({ ok: true, account: created });
    }

    return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
  } catch (err) {
    console.error("Failed to upsert oversee account", err);
    const message =
      (err as { code?: string })?.code === "P2002"
        ? "Account already added"
        : err instanceof Error
        ? err.message
        : "Request failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const uid = getUserId(session);
    if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json().catch(() => null);
    const targetId = Number(body?.targetUserId);
    if (!targetId || Number.isNaN(targetId)) {
      return NextResponse.json({ error: "targetUserId required" }, { status: 400 });
    }

    await prisma.overseerLink.deleteMany({
      where: { overseerId: uid, targetId },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Failed to remove oversee account", err);
    return NextResponse.json({ error: "Failed to remove oversee account" }, { status: 500 });
  }
}
