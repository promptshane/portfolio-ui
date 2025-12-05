// src/server/user/preferences.ts
import prisma from "@/lib/prisma";

let verifiedColumnEnsured = false;
let ensurePromise: Promise<void> | null = null;
let selectionColumnEnsured = false;
let ensureSelectionPromise: Promise<void> | null = null;

const familyTablesReady = () =>
  Boolean((prisma as any).familyMember?.findMany && (prisma as any).family?.findMany);

async function ensureVerifiedEmailsColumn() {
  if (verifiedColumnEnsured) return;
  if (ensurePromise) {
    await ensurePromise;
    return;
  }

  ensurePromise = (async () => {
    try {
      await prisma.$executeRawUnsafe(
        'ALTER TABLE "User" ADD COLUMN "verifiedEmailsJson" TEXT'
      );
    } catch (err) {
      const message = err instanceof Error ? err.message.toLowerCase() : "";
      if (!message.includes("duplicate column") && !message.includes("already exists")) {
        throw err;
      }
    } finally {
      verifiedColumnEnsured = true;
    }
  })().finally(() => {
    ensurePromise = null;
  });

  await ensurePromise;
}

async function ensureSelectionColumn() {
  if (selectionColumnEnsured) return;
  if (ensureSelectionPromise) {
    await ensureSelectionPromise;
    return;
  }

  ensureSelectionPromise = (async () => {
    try {
      await prisma.$executeRawUnsafe(
        'ALTER TABLE "User" ADD COLUMN "newsEmailSelectionsJson" TEXT'
      );
    } catch (err) {
      const message = err instanceof Error ? err.message.toLowerCase() : "";
      if (!message.includes("duplicate column") && !message.includes("already exists")) {
        throw err;
      }
    } finally {
      selectionColumnEnsured = true;
    }
  })().finally(() => {
    ensureSelectionPromise = null;
  });

  await ensureSelectionPromise;
}

function normalizeEmail(value: string): string | null {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return null;
  // Lightweight email validation to avoid obviously bad entries
  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRe.test(trimmed) ? trimmed : null;
}

export function parseEmailList(input: string | string[] | null | undefined): string[] {
  if (!input) return [];
  const rawEntries = Array.isArray(input)
    ? input
    : String(input)
        .split(/[\n,]+/g)
        .map((entry) => entry.trim());

  const deduped = new Set<string>();
  for (const entry of rawEntries) {
    const normalized = normalizeEmail(entry);
    if (normalized) deduped.add(normalized);
  }
  return Array.from(deduped);
}

export async function getVerifiedEmailsForUser(userId: number): Promise<string[]> {
  if (!userId) return [];
  await ensureVerifiedEmailsColumn();
  const record = await prisma.user.findUnique({
    where: { id: userId },
    select: { verifiedEmailsJson: true },
  });
  if (!record?.verifiedEmailsJson) return [];
  try {
    const parsed = JSON.parse(record.verifiedEmailsJson);
    if (!Array.isArray(parsed)) return [];
    const deduped = new Set<string>();
    for (const entry of parsed) {
      if (typeof entry !== "string") continue;
      const normalized = normalizeEmail(entry);
      if (normalized) deduped.add(normalized);
    }
    return Array.from(deduped);
  } catch {
    return [];
  }
}

export async function saveVerifiedEmailsForUser(userId: number, emails: string[]): Promise<string[]> {
  if (!userId) return [];
  await ensureVerifiedEmailsColumn();
  const normalized = parseEmailList(emails);
  await prisma.user.update({
    where: { id: userId },
    data: {
      verifiedEmailsJson: normalized.length ? JSON.stringify(normalized) : null,
    },
  });
  return normalized;
}

async function getFamilyMemberIds(userId: number): Promise<number[]> {
  if (!familyTablesReady()) return [];
  const memberships = await prisma.familyMember.findMany({
    where: { userId },
    select: {
      family: {
        select: {
          members: { select: { userId: true } },
        },
      },
    },
  });
  const ids = new Set<number>();
  for (const m of memberships) {
    for (const member of m.family.members) {
      if (member.userId !== userId) {
        ids.add(member.userId);
      }
    }
  }
  return Array.from(ids);
}

export async function getAggregatedVerifiedEmailsForUser(userId: number): Promise<{
  own: string[];
  family: string[];
  combined: string[];
  selected: string[];
}> {
  const own = await getVerifiedEmailsForUser(userId);
  const selectedRaw = await getSelectedEmailsForUser(userId);
  const familyMemberIds = await getFamilyMemberIds(userId);
  let family: string[] = [];
  if (familyMemberIds.length && familyTablesReady()) {
    try {
      const rows = await prisma.user.findMany({
        where: { id: { in: familyMemberIds } },
        select: { verifiedEmailsJson: true },
      });
      const out = new Set<string>();
      for (const row of rows) {
        if (!row.verifiedEmailsJson) continue;
        try {
          const parsed = JSON.parse(row.verifiedEmailsJson);
          if (!Array.isArray(parsed)) continue;
          for (const entry of parsed) {
            const normalized = typeof entry === "string" ? entry.trim().toLowerCase() : null;
            if (normalized && normalized.includes("@")) {
              out.add(normalized);
            }
          }
        } catch {
          /* ignore */
        }
      }
      family = Array.from(out);
    } catch {
      family = [];
    }
  }
  const baseCombined = Array.from(new Set([...own, ...family]));
  // Allow explicit selections to include addresses beyond the auto-detected family/own list.
  const selected = selectedRaw.length ? selectedRaw : baseCombined;
  const combined = Array.from(new Set([...baseCombined, ...selected]));
  return { own, family, combined, selected };
}

export async function getSelectedEmailsForUser(userId: number): Promise<string[]> {
  if (!userId) return [];
  await ensureSelectionColumn();
  const record = await prisma.user.findUnique({
    where: { id: userId },
    select: { newsEmailSelectionsJson: true },
  });
  if (!record?.newsEmailSelectionsJson) return [];
  try {
    const parsed = JSON.parse(record.newsEmailSelectionsJson);
    if (!Array.isArray(parsed)) return [];
    const deduped = new Set<string>();
    for (const entry of parsed) {
      if (typeof entry !== "string") continue;
      const normalized = normalizeEmail(entry);
      if (normalized) deduped.add(normalized);
    }
    return Array.from(deduped);
  } catch {
    return [];
  }
}

export async function saveSelectedEmailsForUser(userId: number, emails: string[]): Promise<string[]> {
  if (!userId) return [];
  await ensureSelectionColumn();
  const normalized = parseEmailList(emails);
  await prisma.user.update({
    where: { id: userId },
    data: {
      newsEmailSelectionsJson: normalized.length ? JSON.stringify(normalized) : null,
    },
  });
  return normalized;
}
