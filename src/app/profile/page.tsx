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

type FamilyMember = {
  userId: number;
  username: string;
  preferredName: string | null;
  role: string | null;
};

type Family = {
  id: number;
  name: string;
  ownerId: number | null;
  role: string | null;
  members: FamilyMember[];
};

type FamilyInvite = {
  id: number;
  familyId: number;
  familyName: string;
  fromUsername: string | null;
  createdAt: string;
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
  const [families, setFamilies] = useState<Family[]>([]);
  const [familyInvites, setFamilyInvites] = useState<FamilyInvite[]>([]);
  const [familyLoading, setFamilyLoading] = useState(true);
  const [familyError, setFamilyError] = useState<string | null>(null);
  const [newFamilyName, setNewFamilyName] = useState("");
  const [inviteInputs, setInviteInputs] = useState<Record<number, string>>({});
  const [forceInputs, setForceInputs] = useState<Record<number, string>>({});
  const [canForceAdd, setCanForceAdd] = useState(false);
  const [overseenUsernames, setOverseenUsernames] = useState<string[]>([]);
  const [familyBusy, setFamilyBusy] = useState(false);

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

  const hydrateFamilyState = (payload: any) => {
    const fams: Family[] = Array.isArray(payload?.families) ? payload.families : [];
    const invs: FamilyInvite[] = Array.isArray(payload?.invites) ? payload.invites : [];
    setFamilies(fams);
    setFamilyInvites(invs);
    setCanForceAdd(Boolean(payload?.canForceAdd));
    setOverseenUsernames(
      Array.isArray(payload?.overseenUsernames)
        ? payload.overseenUsernames.map((u: any) => String(u || "").toLowerCase()).filter(Boolean)
        : []
    );
  };

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        setFamilyLoading(true);
        setFamilyError(null);
        const res = await fetch("/api/family", { cache: "no-store" });
        if (!active) return;
        if (res.status === 401) {
          setFamilies([]);
          setFamilyInvites([]);
          setFamilyError("Sign in to manage your families.");
          return;
        }
        if (!res.ok) {
          const msg = await res.text().catch(() => "");
          setFamilyError(msg || `Family service unavailable (${res.status}).`);
          setFamilies([]);
          setFamilyInvites([]);
          return;
        }
        const data = await res.json();
        if (!active) return;
        hydrateFamilyState(data);
      } catch (err) {
        if (!active) return;
        console.error("Failed to load family context", err);
        setFamilyError("Failed to load family data.");
      } finally {
        if (active) setFamilyLoading(false);
      }
    })();
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

  const createFamily = async () => {
    if (!newFamilyName.trim()) return;
    setFamilyBusy(true);
    try {
      const res = await fetch("/api/family", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create", name: newFamilyName }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      hydrateFamilyState(data);
      setNewFamilyName("");
    } catch (err) {
      console.error("Failed to create family", err);
      setFamilyError(err instanceof Error ? err.message : "Could not create family.");
    } finally {
      setFamilyBusy(false);
    }
  };

  const sendInvite = async (familyId: number) => {
    const input = inviteInputs[familyId] || "";
    const username = input.trim().toLowerCase();
    if (!username) return;
    setFamilyBusy(true);
    try {
      const res = await fetch("/api/family", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "invite", familyId, username }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      hydrateFamilyState(data);
      setInviteInputs((prev) => ({ ...prev, [familyId]: "" }));
    } catch (err) {
      console.error("Failed to invite user", err);
      setFamilyError(err instanceof Error ? err.message : "Could not invite user.");
    } finally {
      setFamilyBusy(false);
    }
  };

  const acceptInvite = async (inviteId: number) => {
    setFamilyBusy(true);
    try {
      const res = await fetch("/api/family", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "acceptInvite", inviteId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      hydrateFamilyState(data);
    } catch (err) {
      console.error("Failed to accept invite", err);
      setFamilyError(err instanceof Error ? err.message : "Could not accept invite.");
    } finally {
      setFamilyBusy(false);
    }
  };

  const declineInvite = async (inviteId: number) => {
    setFamilyBusy(true);
    try {
      const res = await fetch("/api/family", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "declineInvite", inviteId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      hydrateFamilyState(data);
    } catch (err) {
      console.error("Failed to decline invite", err);
      setFamilyError(err instanceof Error ? err.message : "Could not decline invite.");
    } finally {
      setFamilyBusy(false);
    }
  };

  const forceAdd = async (familyId: number) => {
    const raw = forceInputs[familyId] || "";
    const usernames = raw
      .split(/[, ]+/)
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    if (!usernames.length) return;
    setFamilyBusy(true);
    try {
      const res = await fetch("/api/family", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "forceAdd", familyId, usernames }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      hydrateFamilyState(data);
      setForceInputs((prev) => ({ ...prev, [familyId]: "" }));
    } catch (err) {
      console.error("Failed to force add members", err);
      setFamilyError(err instanceof Error ? err.message : "Could not add members.");
    } finally {
      setFamilyBusy(false);
    }
  };

  const leaveFamily = async (familyId: number) => {
    setFamilyBusy(true);
    try {
      const res = await fetch("/api/family", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "leave", familyId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      hydrateFamilyState(data);
    } catch (err) {
      console.error("Failed to leave family", err);
      setFamilyError(err instanceof Error ? err.message : "Could not leave family.");
    } finally {
      setFamilyBusy(false);
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

        {/* Family section */}
        <section className="rounded-2xl border border-neutral-700 bg-neutral-800 px-4 py-4 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-neutral-200">Family</h2>
              <p className="text-xs text-neutral-400">
                Create or join a family to share verified emails and auto-follow each other.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="text"
                placeholder="Family name"
                value={newFamilyName}
                onChange={(e) => setNewFamilyName(e.target.value)}
                className="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-500 focus:outline-none focus:ring-1 focus:ring-[var(--highlight-400)]"
              />
              <button
                type="button"
                onClick={createFamily}
                disabled={familyBusy}
                className="inline-flex items-center rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm font-medium text-neutral-100 hover:border-[var(--highlight-400)] disabled:opacity-60"
              >
                {familyBusy ? "Working…" : "Create"}
              </button>
            </div>
          </div>

          {familyLoading ? (
            <p className="text-sm text-neutral-400">Loading family info…</p>
          ) : familyError ? (
            <p className="text-sm text-red-400">{familyError}</p>
          ) : null}

          {familyInvites.length > 0 && (
            <div className="rounded-xl border border-neutral-700 bg-neutral-900/60 p-3 space-y-2">
              <div className="text-xs uppercase tracking-wide text-neutral-400">Invites</div>
              {familyInvites.map((inv) => (
                <div key={inv.id} className="flex items-center justify-between gap-2 text-sm">
                  <div>
                    <div className="font-semibold text-neutral-100">{inv.familyName}</div>
                    <div className="text-xs text-neutral-500">
                      From {inv.fromUsername || "someone"} • {new Date(inv.createdAt).toLocaleString()}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => acceptInvite(inv.id)}
                      disabled={familyBusy}
                      className="rounded-lg border border-[var(--good-500)] bg-[var(--good-500)]/10 px-3 py-1.5 text-xs font-semibold text-[var(--good-100)] hover:border-[var(--good-400)] disabled:opacity-60"
                    >
                      Accept
                    </button>
                    <button
                      type="button"
                      onClick={() => declineInvite(inv.id)}
                      disabled={familyBusy}
                      className="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-xs font-semibold text-neutral-200 hover:border-neutral-500 disabled:opacity-60"
                    >
                      Decline
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {families.length === 0 && !familyLoading && !familyError ? (
            <p className="text-sm text-neutral-400">You are not part of a family yet.</p>
          ) : null}

          <div className="space-y-3">
            {families.map((fam) => (
              <div
                key={fam.id}
                className="rounded-xl border border-neutral-700 bg-neutral-900/70 p-3 space-y-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="text-base font-semibold text-neutral-100">{fam.name}</div>
                    <div className="text-xs text-neutral-500">
                      Role: {fam.role || "member"} • Members: {fam.members.length}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => leaveFamily(fam.id)}
                    disabled={familyBusy}
                    className="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-xs font-semibold text-neutral-200 hover:border-red-500 hover:text-red-300 disabled:opacity-60"
                  >
                    Leave
                  </button>
                </div>

                <div className="flex flex-wrap gap-2">
                  {fam.members.map((m) => (
                    <span
                      key={m.userId}
                      className="inline-flex items-center rounded-lg border border-neutral-700 bg-neutral-800 px-2.5 py-1 text-xs text-neutral-100"
                    >
                      @{m.username}
                      {m.preferredName ? <span className="ml-1 text-neutral-400">({m.preferredName})</span> : null}
                      {m.role ? <span className="ml-1 text-[10px] uppercase text-neutral-500">{m.role}</span> : null}
                    </span>
                  ))}
                </div>

                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      placeholder="Invite username"
                      value={inviteInputs[fam.id] ?? ""}
                      onChange={(e) => setInviteInputs((prev) => ({ ...prev, [fam.id]: e.target.value.toLowerCase() }))}
                      className="flex-1 rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-500 focus:outline-none focus:ring-1 focus:ring-[var(--highlight-400)]"
                    />
                    <button
                      type="button"
                      onClick={() => sendInvite(fam.id)}
                      disabled={familyBusy}
                      className="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-xs font-semibold text-neutral-100 hover:border-[var(--highlight-400)] disabled:opacity-60"
                    >
                      Invite
                    </button>
                  </div>

                  {canForceAdd && (
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        placeholder="Force add usernames (comma separated)"
                        value={forceInputs[fam.id] ?? ""}
                        onChange={(e) => setForceInputs((prev) => ({ ...prev, [fam.id]: e.target.value }))}
                        className="flex-1 rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-500 focus:outline-none focus:ring-1 focus:ring-[var(--highlight-400)]"
                      />
                      <button
                        type="button"
                        onClick={() => forceAdd(fam.id)}
                        disabled={familyBusy}
                        className="rounded-lg border border-[var(--good-500)] bg-[var(--good-500)]/10 px-3 py-2 text-xs font-semibold text-[var(--good-100)] hover:border-[var(--good-400)] disabled:opacity-60"
                      >
                        Force
                      </button>
                    </div>
                  )}
                </div>
                {canForceAdd && overseenUsernames.length > 0 && (
                  <p className="text-[11px] text-neutral-500">
                    You can force add overseen users ({overseenUsernames.join(", ")}). Requires at least 5 overseen
                    accounts.
                  </p>
                )}
              </div>
            ))}
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
