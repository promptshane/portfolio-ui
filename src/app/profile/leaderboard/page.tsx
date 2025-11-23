"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import Header from "../../components/header";

type FollowUser = {
  id: string;
  handle: string;
  preferredName?: string | null;
};

type ProfileSocialResponse = {
  following: FollowUser[];
  followers: FollowUser[];
};

type LeaderboardRange =
  | "1D"
  | "1W"
  | "1M"
  | "3M"
  | "6M"
  | "YTD"
  | "1Y"
  | "2Y"
  | "5Y";

const RANGE_OPTIONS: LeaderboardRange[] = [
  "1D",
  "1W",
  "1M",
  "3M",
  "6M",
  "YTD",
  "1Y",
  "2Y",
  "5Y",
];

type FriendEntry = { id: string; handle: string; preferredName?: string | null; pct?: number };

function deriveFriends(data: ProfileSocialResponse): FriendEntry[] {
  const following = data.following ?? [];
  const followers = data.followers ?? [];
  if (!following.length || !followers.length) return [];
  const followerMap = new Map<string, FollowUser>();
  for (const follower of followers) {
    const handle = (follower.handle ?? "").toLowerCase();
    if (handle) followerMap.set(handle, follower);
  }
  return following
    .map((f) => {
      const handle = (f.handle ?? "").toLowerCase();
      if (!handle) return null;
      if (!followerMap.has(handle)) return null;
      const matched = followerMap.get(handle)!;
      return {
        id: String(f.id),
        handle,
        preferredName: matched.preferredName ?? f.preferredName ?? null,
      };
    })
    .filter(Boolean) as FriendEntry[];
}

function hashHandle(handle: string, range: LeaderboardRange): number {
  let hash = 0;
  const input = `${handle}:${range}`;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) & 0xffffffff;
  }
  return Math.abs(hash);
}

function mockReturnPct(handle: string, range: LeaderboardRange): number {
  const hash = hashHandle(handle, range);
  // Map hash deterministically to roughly -25%..+40%
  const span = 65; // range width
  const base = -25;
  return base + (hash % span);
}

export default function LeaderboardPage() {
  const [friends, setFriends] = useState<FriendEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState<LeaderboardRange>("1D");
  const [sessionUser, setSessionUser] = useState<{
    username?: string | null;
    preferredName?: string | null;
    name?: string | null;
  } | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const res = await fetch("/api/profile/social");
        if (!res.ok) {
          throw new Error(`Failed to load social graph (${res.status})`);
        }
        const data = (await res.json()) as ProfileSocialResponse;
        if (!active) return;
        setFriends(deriveFriends(data));
      } catch (err) {
        console.error("Failed to load leaderboard data", err);
        if (active) setError("Unable to load leaderboard.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/auth/session");
        if (!active) return;
        if (res.ok) {
          const data = await res.json();
          setSessionUser(data?.user ?? null);
        } else {
          setSessionUser(null);
        }
      } catch {
        if (active) setSessionUser(null);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const selfHandle = sessionUser?.username
    ? sessionUser.username.toLowerCase()
    : null;
  const selfPreferred = sessionUser?.preferredName ?? sessionUser?.name ?? null;

  const rankedFriends = useMemo<Array<FriendEntry & { pct: number }>>(() => {
    const base: FriendEntry[] = friends.slice();
    if (selfHandle) {
      const exists = base.some((f) => f.handle === selfHandle);
      if (!exists) {
        base.push({
          id: "self",
          handle: selfHandle,
          preferredName: selfPreferred ?? "You",
        });
      }
    }
    return base
      .map((f) => ({
        ...f,
        pct: mockReturnPct(f.handle, range),
      }))
      .sort((a, b) => b.pct - a.pct);
  }, [friends, range, selfHandle, selfPreferred]);

  return (
    <main className="min-h-screen bg-neutral-900 text-white px-6 py-8">
      <Header title="Leaderboard" useBackButton />

      <div className="mt-2 text-sm text-neutral-300">
        Only friends (mutual follows) appear here. Returns are shown as
        percentages for the selected range.
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {RANGE_OPTIONS.map((opt) => (
          <button
            key={opt}
            type="button"
            onClick={() => setRange(opt)}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
              range === opt
                ? "bg-white text-black border-white"
                : "border-neutral-600 text-neutral-300 hover:border-[var(--highlight-400)]"
            }`}
          >
            {opt}
          </button>
        ))}
      </div>

      <section className="mt-6 rounded-3xl border border-neutral-800 bg-neutral-825 px-4 py-4">
        {loading ? (
          <p className="text-sm text-neutral-400">Loading leaderboard…</p>
        ) : error ? (
          <p className="text-sm text-red-400">{error}</p>
        ) : rankedFriends.length === 0 ? (
          <div className="text-sm text-neutral-400 space-y-2">
            <p>You don&apos;t have any friends yet.</p>
            <Link
              href="/profile"
              className="inline-flex items-center rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-xs font-medium text-neutral-100 hover:border-[var(--highlight-400)]"
            >
              Go back to Profile
            </Link>
          </div>
        ) : (
          <ol className="space-y-3">
            {rankedFriends.map((friend, index) => {
              const isSelf = selfHandle && friend.handle === selfHandle;
              return (
                <li
                  key={`${friend.id}-${friend.handle}`}
                  className={`flex items-center justify-between rounded-2xl border border-neutral-700 px-4 py-3 text-sm ${
                    isSelf ? "bg-[color:var(--highlight-500)/0.12]" : "bg-black/20"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span className="text-neutral-400 w-6 text-right">
                      {index + 1}.
                    </span>
                    <div>
                      <div className="font-semibold text-neutral-50 flex items-center gap-2">
                        {friend.preferredName?.trim() || friend.handle}
                        {isSelf && (
                          <span className="rounded-full border border-white/60 px-2 py-0.5 text-[10px] uppercase tracking-wide">
                            You
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-neutral-500">
                        @{friend.handle}
                      </div>
                    </div>
                  </div>
                  <div
                    className={`text-base font-semibold ${
                      friend.pct >= 0
                        ? "text-[var(--good-400)]"
                        : "text-[var(--bad-400)]"
                    }`}
                  >
                    {friend.pct >= 0 ? "+" : ""}
                    {friend.pct.toFixed(1)}%
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </section>
    </main>
  );
}
