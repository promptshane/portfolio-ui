import prisma from "@/lib/prisma";
import { FamilyInviteStatus } from "@prisma/client";

const familyModelsReady = () =>
  Boolean(
    (prisma as any).familyMember?.findMany &&
      (prisma as any).familyInvite?.findMany &&
      (prisma as any).family?.findMany
  );

type FamilyView = {
  id: number;
  name: string;
  ownerId: number | null;
  role: string | null;
  members: Array<{ userId: number; username: string; preferredName: string | null; role: string | null }>;
};

type InviteView = {
  id: number;
  familyId: number;
  familyName: string;
  fromUsername: string | null;
  createdAt: string;
};

async function getUserIdFromSession(session: unknown): Promise<number | null> {
  const raw = (session as { user?: { id?: number | string | null } } | null)?.user?.id;
  if (typeof raw === "number") return raw;
  if (typeof raw === "string") {
    const parsed = Number(raw);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

async function ensureMutualFollows(userIds: number[]) {
  if (userIds.length < 2) return;
  const pairs: Array<[number, number]> = [];
  for (let i = 0; i < userIds.length; i++) {
    for (let j = i + 1; j < userIds.length; j++) {
      pairs.push([userIds[i], userIds[j]]);
      pairs.push([userIds[j], userIds[i]]);
    }
  }
  for (const [followerId, followingId] of pairs) {
    try {
      await prisma.follow.upsert({
        where: { followerId_followingId: { followerId, followingId } },
        create: { followerId, followingId },
        update: {},
      });
    } catch (err) {
      // best-effort; ignore duplicates/races
      const code = (err as { code?: string })?.code;
      if (code !== "P2002") {
        console.warn("Failed to upsert follow for family", followerId, followingId, err);
      }
    }
  }
}

async function fetchFamilyContext(userId: number): Promise<{
  families: FamilyView[];
  invites: InviteView[];
  overseenUsernames: string[];
  canForceAdd: boolean;
}> {
  if (!familyModelsReady()) {
    return { families: [], invites: [], overseenUsernames: [], canForceAdd: false };
  }

  const memberships = await prisma.familyMember.findMany({
    where: { userId },
    include: {
      family: {
        select: {
          id: true,
          name: true,
          ownerId: true,
          members: {
            include: {
              user: { select: { id: true, username: true, preferredName: true } },
            },
          },
        },
      },
    },
  });

  const families: FamilyView[] = memberships.map((m) => ({
    id: m.family.id,
    name: m.family.name,
    ownerId: m.family.ownerId ?? null,
    role: m.role ?? null,
    members: m.family.members.map((fm) => ({
      userId: fm.user.id,
      username: fm.user.username,
      preferredName: fm.user.preferredName ?? null,
      role: fm.role ?? null,
    })),
  }));

  const invitesRaw = await prisma.familyInvite.findMany({
    where: { toUserId: userId, status: FamilyInviteStatus.pending },
    include: {
      family: { select: { id: true, name: true } },
      fromUser: { select: { username: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  const invites: InviteView[] = invitesRaw.map((inv) => ({
    id: inv.id,
    familyId: inv.family.id,
    familyName: inv.family.name,
    fromUsername: inv.fromUser?.username ?? null,
    createdAt: inv.createdAt.toISOString(),
  }));

  const overseen = await prisma.overseerLink.findMany({
    where: { overseerId: userId },
    select: { target: { select: { username: true } } },
  });
  const overseenUsernames = overseen
    .map((o) => o.target?.username?.toLowerCase?.() || "")
    .filter((u): u is string => !!u);

  return {
    families,
    invites,
    overseenUsernames,
    canForceAdd: overseenUsernames.length >= 5,
  };
}

async function ensureMember(userId: number, familyId: number) {
  if (!familyModelsReady()) return false;
  const membership = await prisma.familyMember.findFirst({
    where: { familyId, userId },
  });
  return !!membership;
}

async function createFamily(userId: number, name: string) {
  if (!familyModelsReady()) throw new Error("Family tables are not available yet. Run prisma migrate.");
  const family = await prisma.family.create({
    data: {
      name: name.trim(),
      ownerId: userId,
      members: {
        create: { userId, role: "owner" },
      },
    },
  });
  await ensureMutualFollows([userId]);
  return family;
}

async function inviteToFamily(userId: number, familyId: number, username: string) {
  if (!familyModelsReady()) throw new Error("Family tables are not available yet.");
  const target = await prisma.user.findFirst({
    where: { username: username.toLowerCase().trim() },
    select: { id: true },
  });
  if (!target) throw new Error("User not found");
  const alreadyMember = await ensureMember(target.id, familyId);
  if (alreadyMember) return;
  await prisma.familyInvite.upsert({
    where: { familyId_toUserId: { familyId, toUserId: target.id } },
    create: {
      familyId,
      toUserId: target.id,
      fromUserId: userId,
    },
    update: {
      fromUserId: userId,
      status: FamilyInviteStatus.pending,
    },
  });
}

async function acceptInvite(userId: number, inviteId: number) {
  if (!familyModelsReady()) throw new Error("Family tables are not available yet.");
  const invite = await prisma.familyInvite.findUnique({
    where: { id: inviteId },
    select: { id: true, familyId: true, toUserId: true },
  });
  if (!invite || invite.toUserId !== userId) throw new Error("Invite not found");
  await prisma.$transaction(async (tx) => {
    await tx.familyInvite.update({
      where: { id: inviteId },
      data: { status: FamilyInviteStatus.accepted },
    });
    await tx.familyMember.upsert({
      where: { familyId_userId: { familyId: invite.familyId, userId } },
      create: { familyId: invite.familyId, userId, role: "member" },
      update: {},
    });
  });
  const members = await prisma.familyMember.findMany({
    where: { familyId: invite.familyId },
    select: { userId: true },
  });
  await ensureMutualFollows(members.map((m) => m.userId));
}

async function declineInvite(userId: number, inviteId: number) {
  if (!familyModelsReady()) throw new Error("Family tables are not available yet.");
  const invite = await prisma.familyInvite.findUnique({
    where: { id: inviteId },
    select: { id: true, toUserId: true },
  });
  if (!invite || invite.toUserId !== userId) throw new Error("Invite not found");
  await prisma.familyInvite.update({
    where: { id: inviteId },
    data: { status: FamilyInviteStatus.declined },
  });
}

async function forceAddMembers(userId: number, familyId: number, usernames: string[]) {
  if (!familyModelsReady()) throw new Error("Family tables are not available yet.");
  const overseen = await prisma.overseerLink.findMany({
    where: { overseerId: userId },
    select: { target: { select: { id: true, username: true } } },
  });
  const allowedMap = new Map(
    overseen
      .map((o) => o.target)
      .filter((t): t is { id: number; username: string } => !!t?.id && !!t.username)
      .map((t) => [t.username.toLowerCase(), t.id])
  );
  if (allowedMap.size < 5) {
    throw new Error("Force add requires overseeing at least 5 accounts.");
  }
  const targetIds: number[] = [];
  for (const name of usernames) {
    const key = name.toLowerCase().trim();
    const id = allowedMap.get(key);
    if (id) targetIds.push(id);
  }
  if (!targetIds.length) return;

  await prisma.$transaction(async (tx) => {
    for (const targetId of targetIds) {
      const exists = await tx.familyMember.findFirst({
        where: { familyId, userId: targetId },
        select: { id: true },
      });
      if (exists) continue;
      await tx.familyMember.create({
        data: { familyId, userId: targetId, role: "member" },
      });
      await tx.familyInvite.upsert({
        where: { familyId_toUserId: { familyId, toUserId: targetId } },
        create: {
          familyId,
          toUserId: targetId,
          fromUserId: userId,
          status: FamilyInviteStatus.accepted,
        },
        update: { status: FamilyInviteStatus.accepted, fromUserId: userId },
      });
    }
  });
  const members = await prisma.familyMember.findMany({
    where: { familyId },
    select: { userId: true },
  });
  await ensureMutualFollows(members.map((m) => m.userId));
}

async function leaveFamily(userId: number, familyId: number) {
  if (!familyModelsReady()) return;
  await prisma.familyMember.deleteMany({
    where: { familyId, userId },
  });
  const remaining = await prisma.familyMember.count({ where: { familyId } });
  if (remaining === 0) {
    await prisma.family.delete({ where: { id: familyId } }).catch(() => undefined);
  }
}

export const familyService = {
  getUserIdFromSession,
  fetchFamilyContext,
  createFamily,
  inviteToFamily,
  acceptInvite,
  declineInvite,
  forceAddMembers,
  leaveFamily,
};
