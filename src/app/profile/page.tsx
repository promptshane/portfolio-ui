"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import Header from "../components/header";

type FollowUser = {
  id: string;
  handle: string;
};

type ProfileSocialResponse = {
  following: { id: number; handle: string; preferredName?: string | null }[];
  followers: { id: number; handle: string; preferredName?: string | null }[];
  repostCount: number;
};

export default function ProfilePage() {
  const [following, setFollowing] = useState<FollowUser[]>([]);
  const [followers, setFollowers] = useState<FollowUser[]>([]);
  const [repostCount, setRepostCount] = useState<number>(0);

  const [newHandle, setNewHandle] = useState("");
  const [loading, setLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [followError, setFollowError] = useState<string | null>(null);
  const [followBusy, setFollowBusy] = useState<boolean>(false);

  useEffect(() => {
    let active = true;

    async function loadSocial() {
      try {
        setLoading(true);
        setLoadError(null);

        const res = await fetch("/api/profile/social");
        if (!res.ok) {
          throw new Error(`Failed to load profile social (${res.status})`);
        }

        const data = (await res.json()) as ProfileSocialResponse;
        if (!active) return;

        setFollowing(
          (data.following ?? []).map((u) => ({
            id: String(u.id),
            handle: (u.handle ?? "").toLowerCase(),
          }))
        );
        setFollowers(
          (data.followers ?? []).map((u) => ({
            id: String(u.id),
            handle: (u.handle ?? "").toLowerCase(),
          }))
        );
        setRepostCount(data.repostCount ?? 0);
      } catch (err) {
        if (!active) return;
        console.error("Error loading profile social summary:", err);
        setLoadError("Failed to load profile summary.");
      } finally {
        if (active) setLoading(false);
      }
    }

    loadSocial();

    return () => {
      active = false;
    };
  }, []);

  // Remove follow (persists via API when we have a numeric id).
  const handleRemove = async (id: string) => {
    const numericId = Number(id);
    try {
      if (Number.isFinite(numericId)) {
        await fetch("/api/profile/follow", {
          method: "DELETE",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ targetUserId: numericId }),
        });
      }
    } catch (err) {
      console.error("Failed to unfollow user:", err);
    } finally {
      // Always update local UI so it feels responsive.
      setFollowing((prev) => prev.filter((u) => u.id !== id));
    }
  };

  // Add a handle: validate via POST /api/profile/follow.
  const handleAdd = async () => {
    const trimmedRaw = newHandle.trim();
    if (!trimmedRaw) return;

    const normalizedHandle = trimmedRaw.toLowerCase();

    // Prevent duplicates locally
    const exists = following.some(
      (u) => u.handle.toLowerCase() === normalizedHandle
    );
    if (exists) {
      setNewHandle("");
      setFollowError("You are already following this handle.");
      return;
    }

    try {
      setFollowBusy(true);
      setFollowError(null);

      const res = await fetch("/api/profile/follow", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ handle: normalizedHandle }),
      });

      const data = (await res.json().catch(() => null)) as
        | { error?: string; follow?: { id: number; handle: string } }
        | null;

      if (!res.ok) {
        const msg =
          data?.error ||
          (res.status === 404
            ? "User not found."
            : "Failed to follow user.");
        setFollowError(msg);
        return;
      }

      const follow = data?.follow;
      if (!follow) {
        setFollowError("Unexpected response from server.");
        return;
      }

      const followHandle = (follow.handle ?? "").toLowerCase();

      // Only now do we add them to the local following list.
      setFollowing((prev) => {
        const already = prev.some(
          (u) =>
            u.id === String(follow.id) ||
            u.handle.toLowerCase() === followHandle
        );
        if (already) return prev;
        return [
          ...prev,
          { id: String(follow.id), handle: followHandle },
        ];
      });

      setNewHandle("");
    } catch (err) {
      console.error("Failed to follow user:", err);
      setFollowError("Failed to follow user.");
    } finally {
      setFollowBusy(false);
    }
  };

  const friends = useMemo(() => {
    if (!following.length || !followers.length) return [];
    const followerSet = new Set(followers.map((f) => f.handle));
    return following.filter((u) => followerSet.has(u.handle));
  }, [following, followers]);

  return (
    <main className="min-h-screen bg-neutral-900 text-white px-6 py-8">
      <Header title="Profile" useBackButton />

      <div className="space-y-6">
        {loading && (
          <p className="text-sm text-neutral-400">Loading profile…</p>
        )}

        {!loading && loadError && (
          <p className="text-sm text-red-400">{loadError}</p>
        )}

        {/* Summary */}
        <section className="rounded-2xl border border-neutral-700 bg-neutral-800 px-4 py-4">
          <h2 className="text-sm font-semibold text-neutral-200 mb-3">
            Overview
          </h2>
          <div className="space-y-1 text-sm text-neutral-100">
            <p>You are following: {following.length}</p>
            <p>Followers: {followers.length}</p>
            <p>Reposts made: {repostCount}</p>
            <p>Friends: {friends.length}</p>
          </div>
        </section>

        {/* Following list */}
        <section className="rounded-2xl border border-neutral-700 bg-neutral-800 px-4 py-4 space-y-3">
          <h2 className="text-sm font-semibold text-neutral-200">
            You&apos;re following
          </h2>

          {following.length === 0 ? (
            <p className="text-sm text-neutral-400">
              You&apos;re not following anyone yet.
            </p>
          ) : (
            <ul className="space-y-2">
              {following.map((user) => (
                <li
                  key={user.id}
                  className="flex items-center justify-between gap-3 text-sm"
                >
                  <span className="font-medium text-neutral-100">
                    {user.handle}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleRemove(user.id)}
                    className="inline-flex items-center rounded-lg border border-neutral-700 bg-neutral-900 px-2.5 py-1 text-xs font-medium text-neutral-200 hover:border-red-500 hover:text-red-300"
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-3 flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={newHandle}
                onChange={(e) => {
                  const next = e.target.value.toLowerCase();
                  setNewHandle(next);
                  if (followError) setFollowError(null);
                }}
                placeholder="Add handle (e.g. alex_lee)"
                className="flex-1 rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-500 focus:outline-none focus:ring-1 focus:ring-[var(--highlight-400)]"
              />
              <button
                type="button"
                onClick={handleAdd}
                disabled={followBusy}
                className="inline-flex items-center rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm font-medium text-neutral-100 hover:border-[var(--highlight-400)] disabled:opacity-60 disabled:cursor-not-allowed"
              >
                Follow
              </button>
            </div>
            {followError && (
              <p className="text-xs text-red-400">{followError}</p>
            )}
          </div>
        </section>

        {/* Friends section */}
        <section className="rounded-2xl border border-neutral-700 bg-neutral-800 px-4 py-4 space-y-3">
          <h2 className="text-sm font-semibold text-neutral-200">Friends</h2>

          {friends.length === 0 ? (
            <p className="text-sm text-neutral-400">
              Follow someone who follows you back to become friends.
            </p>
          ) : (
            <ul className="space-y-2 text-sm text-neutral-100">
              {friends.map((user) => (
                <li key={user.id}>{user.handle}</li>
              ))}
            </ul>
          )}
        </section>

        {/* Followers list */}
        <section className="rounded-2xl border border-neutral-700 bg-neutral-800 px-4 py-4 space-y-3">
          <h2 className="text-sm font-semibold text-neutral-200">Followers</h2>

          {followers.length === 0 ? (
            <p className="text-sm text-neutral-400">
              No one is following you yet.
            </p>
          ) : (
            <ul className="space-y-2 text-sm text-neutral-100">
              {followers.map((user) => (
                <li key={user.id}>{user.handle}</li>
              ))}
            </ul>
          )}
        </section>

        <div className="flex justify-center">
          <Link
            href="/profile/leaderboard"
            className="inline-flex items-center rounded-lg border border-neutral-700 bg-neutral-800 px-4 py-2 text-sm font-semibold text-neutral-100 hover:border-[var(--highlight-400)]"
          >
            View Leaderboard →
          </Link>
        </div>
      </div>
    </main>
  );
}
