// src/app/settings/page.tsx
"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import Header from "../components/header";
import { signOut } from "next-auth/react";
import { useRouter } from "next/navigation";

type OverseenAccount = {
  id: number;
  username: string;
  preferredName?: string | null;
};

type OverseerSummary = {
  username: string;
  preferredName?: string | null;
};

type ThemeKey =
  | "default"
  | "icy"
  | "violet"
  | "luxe"
  | "blueAmberTeal"
  | "crimsonVioletMint";

const THEMES: Array<{
  key: ThemeKey;
  label: string;
  // ordered good → mid → bad (for preview chips)
  swatches: { good: string; mid: string; bad: string; highlight?: string };
}> = [
  {
    key: "default",
    label: "Default",
    swatches: { good: "#22c55e", mid: "#eab308", bad: "#ef4444" },
  },
  {
    key: "icy",
    label: "Ice",
    swatches: { good: "#0ea5e9", mid: "#ffffff", bad: "#ec4899" },
  },
  {
    key: "violet",
    label: "Violet Scale",
    swatches: { good: "#b026ff", mid: "#9b84d6", bad: "#14011f" },
  },
  {
    key: "luxe",
    label: "Luxe",
    swatches: { good: "#d4af37", mid: "#c0c0c0", bad: "#7f1d1d" },
  },
  {
    key: "blueAmberTeal",
    label: "Blue · Amber · Teal",
    swatches: { good: "#1fa187", mid: "#f2b705", bad: "#4c6a92" },
  },
  {
    key: "crimsonVioletMint",
    label: "Crimson · Violet · Mint",
    swatches: { good: "#2ecc71", mid: "#7b61ff", bad: "#c81d25" },
  },
];

const THEME_KEY_SET = new Set(THEMES.map((t) => t.key));

function paletteToThemeKey(value?: string | null): ThemeKey {
  if (!value) return "default";
  const normalized = value === "classic" ? "default" : (value as ThemeKey);
  return THEME_KEY_SET.has(normalized) ? normalized : "default";
}

function themeKeyToPaletteValue(theme: ThemeKey) {
  return theme === "default" ? "classic" : theme;
}

export default function SettingsPage() {
  const router = useRouter();

  // ----- load current profile -----
  const [loading, setLoading] = useState(true);
  const [username, setUsername] = useState(() => {
    if (typeof window === "undefined") return "";
    return window.localStorage.getItem("profile:username") ?? "";
  });
  const [preferredName, setPreferredName] = useState(() => {
    if (typeof window === "undefined") return "";
    return window.localStorage.getItem("profile:preferredNameFull") ?? "";
  });
  const [editingAccount, setEditingAccount] = useState(false);
  const [overseenBy, setOverseenBy] = useState<OverseerSummary[]>([]);
  const overseerNames = useMemo(
    () =>
      overseenBy
        .map((o) => o.preferredName?.trim() || o.username)
        .filter(Boolean)
        .join(", "),
    [overseenBy]
  );
  const hasOverseer = overseenBy.length > 0;
  const overseerDisplay = hasOverseer ? overseerNames || "another account holder" : "";

  useEffect(() => {
    let cancelled = false;
    const cacheProfile = (u?: string, p?: string) => {
      try {
        if (u) window.localStorage.setItem("profile:username", u);
        if (p) window.localStorage.setItem("profile:preferredNameFull", p);
      } catch {
        /* ignore */
      }
    };

    async function hydrateFromSession() {
      try {
        const sessRes = await fetch("/api/auth/session", { cache: "no-store" });
        if (!sessRes.ok) return;
        const session = await sessRes.json();
        if (cancelled) return;
        const fallbackUsername = String(session?.user?.username ?? "")
          .trim()
          .toLowerCase();
        if (fallbackUsername) {
          setUsername(fallbackUsername);
          cacheProfile(fallbackUsername, undefined);
        }
        const fallbackPreferred =
          session?.user?.preferredName ??
          session?.user?.name ??
          session?.user?.username ??
          "";
        if (fallbackPreferred) {
          setPreferredName(fallbackPreferred);
          cacheProfile(undefined, fallbackPreferred);
        }
      } catch {
        /* ignore */
      }
    }
    (async () => {
      try {
        const res = await fetch("/api/user/profile", { cache: "no-store", credentials: "include" });
        if (!res.ok) throw new Error("profile fetch failed");
        const data = await res.json();
        if (!cancelled) {
          const loadedUsername = String(data?.username ?? "");
          if (loadedUsername) {
            const normalized = loadedUsername.toLowerCase();
            setUsername(normalized);
            cacheProfile(normalized, undefined);
          }
          if (data?.preferredName != null) {
            setPreferredName(data.preferredName);
            cacheProfile(undefined, data.preferredName);
          }
          if (typeof data?.colorPalette === "string") {
            setTheme(paletteToThemeKey(data.colorPalette));
          }
          const overseers: OverseerSummary[] = Array.isArray(data?.overseenBy)
            ? (data.overseenBy as any[])
                .map((o) => ({
                  username: String(o?.username ?? ""),
                  preferredName: o?.preferredName ?? null,
                }))
                .filter((o) => o.username)
            : [];
          setOverseenBy(overseers);
        }
      } catch {
        if (!cancelled) {
          void hydrateFromSession();
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ----- account info (username / preferred name) -----
  const [saveNamesBusy, setSaveNamesBusy] = useState(false);
  const [saveNamesMsg, setSaveNamesMsg] = useState<null | { ok: boolean; text: string }>(null);

  async function saveNames() {
    setSaveNamesBusy(true);
    setSaveNamesMsg(null);
    try {
      const normalizedUsername = username.trim().toLowerCase();

      const res = await fetch("/api/user/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: normalizedUsername, preferredName }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await res.json();
      // ensure local state stays normalized
      setUsername(normalizedUsername);
      setSaveNamesMsg({ ok: true, text: "Saved." });
      setEditingAccount(false);
    } catch {
      setSaveNamesMsg({ ok: false, text: "Could not save. Check API route /api/user/profile." });
    } finally {
      setSaveNamesBusy(false);
    }
  }

  // ----- password change (stop on first non-404/405; show exact server error) -----
  const [curPw, setCurPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [newPw2, setNewPw2] = useState("");
  const pwValid = useMemo(() => newPw.length >= 8 && newPw === newPw2, [newPw, newPw2]);
  const [pwBusy, setPwBusy] = useState(false);
  const [pwMsg, setPwMsg] = useState<null | { ok: boolean; text: string }>(null);

  async function changePassword() {
    if (!pwValid) {
      setPwMsg({ ok: false, text: "Passwords must match and be at least 8 characters." });
      return;
    }
    setPwBusy(true);
    setPwMsg(null);

    const endpoints = [
      "/api/user/change-password", // primary
      "/api/user/password",        // legacy
      "/api/auth/password",        // auth-scoped fallback
    ];
    const payload = { currentPassword: curPw, newPassword: newPw };

    try {
      for (let i = 0; i < endpoints.length; i++) {
        const path = endpoints[i];
        const res = await fetch(path, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        if (res.ok) {
          setCurPw("");
          setNewPw("");
          setNewPw2("");
          setPwMsg({ ok: true, text: "Password updated." });
          setPwBusy(false);
          return;
        }

        let detail = "";
        try {
          const data = await res.json();
          detail = data?.error || data?.message || "";
        } catch {
          try {
            detail = await res.text();
          } catch {
            /* noop */
          }
        }

        if (res.status !== 404 && res.status !== 405) {
          const msg = detail
            ? `(${res.status}) ${detail}`
            : `(${res.status}) Request failed`;
          setPwMsg({
            ok: false,
            text: `Password change failed: ${msg}.`,
          });
          setPwBusy(false);
          return;
        }
      }

      setPwMsg({
        ok: false,
        text:
          "Password change failed: no matching endpoint found (404/405). Check that /api/user/change-password exists.",
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Network error";
      setPwMsg({ ok: false, text: `Password change failed: ${message}.` });
    } finally {
      setPwBusy(false);
    }
  }

  // ----- Oversee accounts -----
  const [overseenAccounts, setOverseenAccounts] = useState<OverseenAccount[]>([]);
  const [overseeLoading, setOverseeLoading] = useState(true);
  const [overseeError, setOverseeError] = useState<string | null>(null);
  const [linkUsername, setLinkUsername] = useState("");
  const [linkPassword, setLinkPassword] = useState("");
  const [linkBusy, setLinkBusy] = useState(false);
  const [linkMsg, setLinkMsg] = useState<string | null>(null);
  const [createUsername, setCreateUsername] = useState("");
  const [createPreferredName, setCreatePreferredName] = useState("");
  const [createPassword, setCreatePassword] = useState("");
  const [createConfirm, setCreateConfirm] = useState("");
  const [createDevPassword, setCreateDevPassword] = useState("");
  const [createBusy, setCreateBusy] = useState(false);
  const [createMsg, setCreateMsg] = useState<string | null>(null);
  const [linkExpanded, setLinkExpanded] = useState(false);
  const [createExpanded, setCreateExpanded] = useState(false);

  const collapseLinkForm = useCallback(() => {
    setLinkExpanded(false);
    setLinkMsg(null);
    setLinkUsername("");
    setLinkPassword("");
  }, []);

  const collapseCreateForm = useCallback(() => {
    setCreateExpanded(false);
    setCreateMsg(null);
    setCreateUsername("");
    setCreatePreferredName("");
    setCreatePassword("");
    setCreateConfirm("");
    setCreateDevPassword("");
  }, []);

  const refreshOversee = useCallback(async () => {
    try {
      setOverseeLoading(true);
      setOverseeError(null);
      const res = await fetch("/api/oversee", { cache: "no-store", credentials: "include" });
      if (res.status === 401) {
        setOverseenAccounts([]);
        setOverseeError("Please sign in to manage oversee accounts.");
        return;
      }
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = await res.json();
      setOverseenAccounts(Array.isArray(data?.overseen) ? data.overseen : []);
    } catch (err) {
      console.error("Failed to load oversee accounts", err);
      setOverseeError("Failed to load oversee accounts.");
    } finally {
      setOverseeLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshOversee();
  }, [refreshOversee]);

  async function handleLinkExisting(e?: FormEvent) {
    e?.preventDefault();
    const normalizedUsername = linkUsername.trim().toLowerCase();
    if (!normalizedUsername || !linkPassword) {
      setLinkMsg("Enter the account's username and password.");
      return;
    }
    setLinkBusy(true);
    setLinkMsg(null);
    try {
      const res = await fetch("/api/oversee", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          action: "link",
          username: normalizedUsername,
          password: linkPassword,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || `Failed (${res.status})`);
      }
      setLinkMsg("Account added.");
      setLinkUsername("");
      setLinkPassword("");
      await refreshOversee();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to add account.";
      setLinkMsg(message);
    } finally {
      setLinkBusy(false);
    }
  }

  async function handleCreateOversee(e?: FormEvent) {
    e?.preventDefault();
    const normalizedUsername = createUsername.trim().toLowerCase();
    if (!normalizedUsername || createPassword.length < 6) {
      setCreateMsg("Username and password (min 6 chars) are required.");
      return;
    }
    if (createPassword !== createConfirm) {
      setCreateMsg("Passwords must match.");
      return;
    }
    if (!createDevPassword.trim()) {
      setCreateMsg("Dev password is required.");
      return;
    }
    setCreateBusy(true);
    setCreateMsg(null);
    try {
      const res = await fetch("/api/oversee", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          action: "create",
          username: normalizedUsername,
          preferredName: createPreferredName,
          password: createPassword,
          devPassword: createDevPassword,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || `Failed (${res.status})`);
      }
      setCreateMsg("Account created and linked.");
      setCreateUsername("");
      setCreatePreferredName("");
      setCreatePassword("");
      setCreateConfirm("");
      setCreateDevPassword("");
      await refreshOversee();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to create account.";
      setCreateMsg(message);
    } finally {
      setCreateBusy(false);
    }
  }

  async function handleRemoveOversee(targetUserId: number) {
    try {
      await fetch("/api/oversee", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ targetUserId }),
      });
      await refreshOversee();
    } catch (err) {
      console.error("Failed to remove oversee account", err);
    }
  }

  // ----- Theme (palette) persisted per account -----
  const [theme, setTheme] = useState<ThemeKey>("default");
  const [themeBusy, setThemeBusy] = useState(false);
  const [themeMsg, setThemeMsg] = useState<null | { ok: boolean; text: string }>(null);
  const [logoutBusy, setLogoutBusy] = useState(false);
  const [verifiedEmailsInput, setVerifiedEmailsInput] = useState("");
  const [familyVerifiedEmails, setFamilyVerifiedEmails] = useState<string[]>([]);
  const [verifiedEmailsBusy, setVerifiedEmailsBusy] = useState(false);
  const [verifiedEmailsMsg, setVerifiedEmailsMsg] = useState<string | null>(null);

  useEffect(() => {
    try {
      const match = document.cookie.match(/(?:^|;\s*)theme=([^;]+)/);
      if (match) {
        const val = decodeURIComponent(match[1]);
        setTheme(paletteToThemeKey(val));
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/user/verified-emails", {
          cache: "no-store",
          credentials: "include",
        });
        if (!res.ok || !active) return;
        const data = (await res.json()) as { emails?: string[]; familyEmails?: string[]; combined?: string[] };
        if (!active) return;
        const emails = Array.isArray(data?.emails) ? data.emails : [];
        const fam = Array.isArray(data?.familyEmails) ? data.familyEmails : [];
        setVerifiedEmailsInput(emails.join("\n"));
        setFamilyVerifiedEmails(fam);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  function parseVerifiedEmails(raw: string) {
    return raw
      .split(/[\n,]+/g)
      .map((entry) => entry.trim().toLowerCase())
      .filter((entry) => entry.length > 0);
  }

  async function saveVerifiedEmails() {
    if (verifiedEmailsBusy) return;
    setVerifiedEmailsBusy(true);
    setVerifiedEmailsMsg(null);
    const emails = parseVerifiedEmails(verifiedEmailsInput);
    try {
      const res = await fetch("/api/user/verified-emails", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ emails }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || `HTTP ${res.status}`);
      }
      const saved = Array.isArray(data?.emails) ? data.emails : emails;
      setVerifiedEmailsInput(saved.join("\n"));
      const fam = Array.isArray(data?.familyEmails) ? data.familyEmails : familyVerifiedEmails;
      setFamilyVerifiedEmails(fam);
      setVerifiedEmailsMsg("Saved.");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not save.";
      setVerifiedEmailsMsg(message);
    } finally {
      setVerifiedEmailsBusy(false);
      setTimeout(() => setVerifiedEmailsMsg(null), 2500);
    }
  }

  async function saveTheme() {
    if (themeBusy) return;
    setThemeBusy(true);
    setThemeMsg(null);
    try {
      const res = await fetch("/api/user/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ colorPalette: themeKeyToPaletteValue(theme) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || `HTTP ${res.status}`);
      }
      try {
        document.cookie = `theme=${theme}; path=/; max-age=31536000; samesite=lax`;
      } catch {
        /* ignore cookie write failures */
      }
      setThemeMsg({ ok: true, text: "Theme saved. Reloading…" });
      setTimeout(() => {
        window.location.reload();
      }, 350);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not save theme.";
      setThemeMsg({ ok: false, text: msg });
    } finally {
      setThemeBusy(false);
    }
  }

  // ----- Dev Page access -----
  const [hasDev, setHasDev] = useState(false);
  const [devBusy, setDevBusy] = useState(false);
  const [devMsg, setDevMsg] = useState<null | { ok: boolean; text: string }>(null);

  useEffect(() => {
    try {
      setHasDev(/(?:^|;\s*)ftv_dev=1(?:;|$)/.test(document.cookie));
    } catch {
      /* noop */
    }
  }, [loading]);

  async function gotoDev() {
    setDevMsg(null);
    if (hasDev) {
      router.push("/dev");
      return;
    }
    const password = window.prompt("Enter developer password:");
    if (!password) return;

    setDevBusy(true);
    try {
      const res = await fetch("/api/ftv/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        let detail = "";
        try {
          const j = await res.json();
          detail = j?.error || j?.message || "";
        } catch {
          try {
            detail = await res.text();
          } catch {
            /* noop */
          }
        }
        throw new Error(detail || `HTTP ${res.status}`);
      }
      // Cookie is set server-side on success
      setHasDev(true);
      setDevMsg({ ok: true, text: "Developer mode enabled." });
      router.push("/dev");
    } catch (e) {
      const message = e instanceof Error ? e.message : "Auth failed.";
      setDevMsg({ ok: false, text: message });
    } finally {
      setDevBusy(false);
    }
  }

  const card = "bg-neutral-800 rounded-2xl p-6 border border-neutral-700";

  async function handleLogout() {
    if (logoutBusy) return;
    setLogoutBusy(true);
    try {
      await signOut({ redirect: false });
      router.replace("/login");
    } catch {
      router.push("/login");
    } finally {
      setLogoutBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-neutral-900 text-white px-6 py-8">
      <Header title="Settings" />
      {loading ? (
        <div className={card}>Loading…</div>
      ) : (
        <div className="space-y-6">
          {hasOverseer && (
            <div className="rounded-2xl border border-[var(--bad-400)]/60 bg-[var(--bad-400)]/10 px-4 py-3 text-sm text-[var(--bad-100)]">
              <p>
                <span className="font-semibold text-[var(--bad-200)]">Heads up:</span> This account is
                currently overseen by <span className="text-white">{overseerDisplay}</span>. They can review
                your settings and linked account changes.
              </p>
              {overseenBy.length > 1 && (
                <ul className="mt-2 space-y-1 text-xs text-[var(--bad-50)]">
                  {overseenBy.map((o) => (
                    <li key={o.username}>
                      {(o.preferredName?.trim() || o.username) ?? "Overseer"}
                      <span className="text-[var(--bad-200)]"> ({o.username})</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {/* ---- Account Info ---- */}
          <section className={card}>
            <h2 className="text-lg font-semibold mb-4">Account Info</h2>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-sm text-neutral-400 mb-1">Username</label>
                <input
                  className={`w-full rounded-lg px-3 py-2 border ${
                    editingAccount
                      ? "bg-neutral-900 border-neutral-700 text-white"
                      : "bg-neutral-900/40 border-neutral-800 text-neutral-500 cursor-not-allowed"
                  }`}
                  value={username}
                  onChange={(e) => setUsername(e.target.value.toLowerCase())}
                  disabled={!editingAccount}
                  placeholder="username"
                />
              </div>

              <div>
                <label className="block text-sm text-neutral-400 mb-1">Preferred Name</label>
                <input
                  className={`w-full rounded-lg px-3 py-2 border ${
                    editingAccount
                      ? "bg-neutral-900 border-neutral-700 text-white"
                      : "bg-neutral-900/40 border-neutral-800 text-neutral-500 cursor-not-allowed"
                  }`}
                  value={preferredName}
                  onChange={(e) => setPreferredName(e.target.value)}
                  disabled={!editingAccount}
                  placeholder="How you want to be addressed"
                />
              </div>
            </div>

            <div className="mt-4 flex items-center gap-3">
              {!editingAccount ? (
                <button
                  onClick={() => {
                    setEditingAccount(true);
                    setSaveNamesMsg(null);
                  }}
                  className="px-4 py-2 rounded-lg border border-neutral-700 bg-black/90 hover:border-neutral-600"
                >
                  Edit
                </button>
              ) : (
                <button
                  onClick={saveNames}
                  disabled={saveNamesBusy}
                  className="px-4 py-2 rounded-lg border border-neutral-700 bg-black/90 hover:border-neutral-600 disabled:opacity-60"
                >
                  {saveNamesBusy ? "Saving…" : "Save"}
                </button>
              )}
              {saveNamesMsg ? (
                <span className={saveNamesMsg.ok ? "text-green-400" : "text-red-400"}>
                  {saveNamesMsg.text}
                </span>
              ) : null}
            </div>

            <hr className="my-6 border-neutral-700" />

            <h3 className="text-base font-medium mb-3">Change Password</h3>
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <label className="block text-sm text-neutral-400 mb-1">Current Password</label>
                <input
                  type="password"
                  className="w-full bg-neutral-900 border border-neutral-700 rounded-lg px-3 py-2"
                  value={curPw}
                  onChange={(e) => setCurPw(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm text-neutral-400 mb-1">New Password</label>
                <input
                  type="password"
                  className="w-full bg-neutral-900 border border-neutral-700 rounded-lg px-3 py-2"
                  value={newPw}
                  onChange={(e) => setNewPw(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm text-neutral-400 mb-1">Confirm New Password</label>
                <input
                  type="password"
                  className="w-full bg-neutral-900 border border-neutral-700 rounded-lg px-3 py-2"
                  value={newPw2}
                  onChange={(e) => setNewPw2(e.target.value)}
                />
              </div>
            </div>
            <div className="mt-4 flex items-center gap-3">
              <button
                onClick={changePassword}
                disabled={pwBusy}
                className="px-4 py-2 rounded-lg border border-neutral-700 bg-black/90 hover:border-neutral-600 disabled:opacity-60"
              >
                {pwBusy ? "Updating…" : "Update Password"}
              </button>
              {pwMsg ? (
                <span className={pwMsg.ok ? "text-green-400" : "text-red-400"}>{pwMsg.text}</span>
              ) : null}
            </div>
          </section>

          {/* ---- Verified sender emails ---- */}
          <section className={card}>
            <h2 className="text-lg font-semibold mb-2">Verified sender emails</h2>
            <p className="text-sm text-neutral-400 mb-4">
              Save the newsletter or alert addresses you trust. Family members share their verified senders with you automatically.
            </p>
            <textarea
              value={verifiedEmailsInput}
              onChange={(e) => setVerifiedEmailsInput(e.target.value)}
              rows={4}
              placeholder={"analyst@research.com\nalerts@example.com"}
              className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-500 focus:outline-none focus:ring-1 focus:ring-[var(--highlight-400)]"
              disabled={verifiedEmailsBusy}
            />
            <div className="mt-3 flex items-center gap-3">
              <button
                type="button"
                onClick={saveVerifiedEmails}
                disabled={verifiedEmailsBusy}
                className="px-4 py-2 rounded-lg border border-neutral-700 bg-black/90 hover:border-neutral-600 disabled:opacity-60"
              >
                {verifiedEmailsBusy ? "Saving…" : "Save verified emails"}
              </button>
              {verifiedEmailsMsg ? (
                <span className="text-sm text-neutral-300">{verifiedEmailsMsg}</span>
              ) : null}
            </div>
            {familyVerifiedEmails.length > 0 && (
              <div className="mt-4 rounded-xl border border-neutral-700 bg-neutral-900/50 p-3 text-sm text-neutral-200">
                <div className="text-xs uppercase tracking-wide text-neutral-500 mb-2">Family verified emails</div>
                <div className="flex flex-wrap gap-2">
                  {familyVerifiedEmails.map((email) => (
                    <span
                      key={email}
                      className="inline-flex items-center rounded-md border border-neutral-700 bg-neutral-800 px-2 py-1 text-xs text-neutral-100"
                    >
                      {email}
                    </span>
                  ))}
                </div>
                <p className="text-[11px] text-neutral-500 mt-2">
                  These come from family members and are used alongside your own when fetching emails.
                </p>
              </div>
            )}
          </section>

          {/* ---- Oversee ---- */}
          <section className={card}>
            <h2 className="text-lg font-semibold mb-2">Oversee accounts</h2>
            <p className="text-neutral-400 text-sm mb-4">
              Manage accounts you can monitor from your Portfolio page.
            </p>

            {overseeLoading ? (
              <p className="text-sm text-neutral-400">Loading oversee accounts…</p>
            ) : overseeError ? (
              <p className="text-sm text-red-400">{overseeError}</p>
            ) : overseenAccounts.length === 0 ? (
              <p className="text-sm text-neutral-400">
                No linked accounts yet. Use the forms below to add one.
              </p>
            ) : (
              <ul className="space-y-2 mb-4">
                {overseenAccounts.map((acc) => (
                  <li
                    key={acc.id}
                    className="flex items-center justify-between rounded-xl border border-neutral-700 bg-neutral-900/60 px-3 py-2 text-sm"
                  >
                    <div>
                      <div className="font-semibold text-neutral-100">
                        {acc.preferredName?.trim() || acc.username}
                      </div>
                      <div className="text-xs text-neutral-500">@{acc.username}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRemoveOversee(acc.id)}
                      className="px-3 py-1.5 rounded-lg border border-neutral-700 text-xs text-neutral-200 hover:border-red-500 hover:text-red-300"
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-xl border border-neutral-700 bg-neutral-900/60 p-3 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-semibold text-neutral-200">Link existing account</h3>
                    <p className="text-xs text-neutral-400">
                      Use credentials for an account you already oversee.
                    </p>
                  </div>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded-lg border border-neutral-600 bg-neutral-800/60 px-3 py-1.5 text-xs font-semibold text-neutral-100 hover:border-[var(--highlight-400)] disabled:cursor-not-allowed disabled:opacity-60"
                    aria-expanded={linkExpanded}
                    disabled={linkBusy}
                    onClick={() => {
                      if (linkExpanded) {
                        collapseLinkForm();
                      } else {
                        setLinkExpanded(true);
                        setLinkMsg(null);
                      }
                    }}
                  >
                    Link account
                    <span
                      aria-hidden="true"
                      className={`text-base leading-none transition-transform duration-150 ${linkExpanded ? "rotate-180" : ""}`}
                    >
                      ▾
                    </span>
                  </button>
                </div>
                {linkExpanded && (
                  <form className="space-y-2" onSubmit={handleLinkExisting}>
                    <input
                      type="text"
                      value={linkUsername}
                      onChange={(e) => setLinkUsername(e.target.value.toLowerCase())}
                      placeholder="Username"
                      className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-500 focus:outline-none focus:ring-1 focus:ring-[var(--highlight-400)]"
                      disabled={linkBusy}
                    />
                    <input
                      type="password"
                      value={linkPassword}
                      onChange={(e) => setLinkPassword(e.target.value)}
                      placeholder="Password"
                      className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-500 focus:outline-none focus:ring-1 focus:ring-[var(--highlight-400)]"
                      disabled={linkBusy}
                    />
                    <div className="flex justify-end gap-2 pt-1">
                      <button
                        type="button"
                        onClick={collapseLinkForm}
                        disabled={linkBusy}
                        className="rounded-lg border border-neutral-700 px-3 py-1.5 text-xs text-neutral-300 hover:border-neutral-500 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={linkBusy}
                        className="inline-flex items-center justify-center rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-sm font-medium text-neutral-100 hover:border-[var(--highlight-400)] disabled:opacity-60 disabled:cursor-not-allowed"
                      >
                        {linkBusy ? "Linking…" : "Link account"}
                      </button>
                    </div>
                    {linkMsg && <p className="text-xs text-neutral-300">{linkMsg}</p>}
                  </form>
                )}
              </div>

              <div className="rounded-xl border border-neutral-700 bg-neutral-900/60 p-3 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-semibold text-neutral-200">Create new account</h3>
                    <p className="text-xs text-neutral-400">Spin up a managed account from scratch.</p>
                  </div>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded-lg border border-neutral-600 bg-neutral-800/60 px-3 py-1.5 text-xs font-semibold text-neutral-100 hover:border-[var(--highlight-400)] disabled:cursor-not-allowed disabled:opacity-60"
                    aria-expanded={createExpanded}
                    disabled={createBusy}
                    onClick={() => {
                      if (createExpanded) {
                        collapseCreateForm();
                      } else {
                        setCreateExpanded(true);
                        setCreateMsg(null);
                      }
                    }}
                  >
                    Create account
                    <span
                      aria-hidden="true"
                      className={`text-base leading-none transition-transform duration-150 ${createExpanded ? "rotate-180" : ""}`}
                    >
                      ▾
                    </span>
                  </button>
                </div>
                {createExpanded && (
                  <form className="space-y-2" onSubmit={handleCreateOversee}>
                    <input
                      type="text"
                      value={createUsername}
                      onChange={(e) => setCreateUsername(e.target.value.toLowerCase())}
                      placeholder="Username"
                      className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-500 focus:outline-none focus:ring-1 focus:ring-[var(--highlight-400)]"
                      disabled={createBusy}
                    />
                    <input
                      type="text"
                      value={createPreferredName}
                      onChange={(e) => setCreatePreferredName(e.target.value)}
                      placeholder="Preferred name (optional)"
                      className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-500 focus:outline-none focus:ring-1 focus:ring-[var(--highlight-400)]"
                      disabled={createBusy}
                    />
                    <input
                      type="password"
                      value={createPassword}
                      onChange={(e) => setCreatePassword(e.target.value)}
                      placeholder="Password"
                      className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-500 focus:outline-none focus:ring-1 focus:ring-[var(--highlight-400)]"
                      disabled={createBusy}
                    />
                    <input
                      type="password"
                      value={createConfirm}
                      onChange={(e) => setCreateConfirm(e.target.value)}
                      placeholder="Confirm password"
                      className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-500 focus:outline-none focus:ring-1 focus:ring-[var(--highlight-400)]"
                      disabled={createBusy}
                    />
                    <input
                      type="password"
                      value={createDevPassword}
                      onChange={(e) => setCreateDevPassword(e.target.value)}
                      placeholder="Dev password"
                      className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-500 focus:outline-none focus:ring-1 focus:ring-[var(--highlight-400)]"
                      disabled={createBusy}
                    />
                    <div className="flex justify-end gap-2 pt-1">
                      <button
                        type="button"
                        onClick={collapseCreateForm}
                        disabled={createBusy}
                        className="rounded-lg border border-neutral-700 px-3 py-1.5 text-xs text-neutral-300 hover:border-neutral-500 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={createBusy}
                        className="inline-flex items-center justify-center rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-sm font-medium text-neutral-100 hover:border-[var(--highlight-400)] disabled:opacity-60 disabled:cursor-not-allowed"
                      >
                        {createBusy ? "Creating…" : "Create account"}
                      </button>
                    </div>
                    {createMsg && <p className="text-xs text-neutral-300">{createMsg}</p>}
                  </form>
                )}
              </div>
            </div>
          </section>

          {/* ---- Appearance (Color Palette) ---- */}
          <section className={card}>
            <h2 className="text-lg font-semibold mb-4">Appearance</h2>
            <p className="text-neutral-400 text-sm mb-3">
              Choose a color palette (good / mid / bad). Only the selected option shows a preview.
            </p>

            <div className="space-y-3">
              {THEMES.map((t) => {
                const active = theme === t.key;
                const borderStyle = active
                  ? { borderColor: t.swatches.good, boxShadow: `0 0 0 2px ${t.swatches.good}55` }
                  : undefined;

                return (
                  <button
                    type="button"
                    key={t.key}
                    onClick={() => {
                      setTheme(t.key);
                      setThemeMsg(null);
                    }}
                    className={`w-full flex items-center justify-between rounded-2xl p-3 sm:p-4 border transition
                      ${active ? "bg-black/90" : "bg-neutral-800 hover:border-neutral-600"}`
                    }
                    style={borderStyle}
                    aria-pressed={active}
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={`w-8 h-8 rounded-full border ${active ? "" : "border-neutral-600 bg-neutral-600/40"}`}
                        style={active ? { backgroundColor: t.swatches.good, borderColor: "#0b0f1a" } : undefined}
                        aria-hidden
                      />
                      <div className="text-left">
                        <div className="font-semibold">{t.label}</div>
                        {!active && (
                          <div className="text-xs text-neutral-400">Click to preview</div>
                        )}
                      </div>
                    </div>

                    {/* Preview chips: only show when active */}
                    {active && (
                      <div className="flex items-center gap-3 bg-black rounded-xl px-3 py-2">
                        <div
                          className="w-7 h-7 rounded-md border"
                          style={{ backgroundColor: t.swatches.good, borderColor: "#1f2937" }}
                          title="Good"
                        />
                        <div
                          className="w-7 h-7 rounded-md border"
                          style={{ backgroundColor: t.swatches.mid, borderColor: "#1f2937" }}
                          title="Mid"
                        />
                        <div
                          className="w-7 h-7 rounded-md border"
                          style={{ backgroundColor: t.swatches.bad, borderColor: "#1f2937" }}
                          title="Bad"
                        />
                      </div>
                    )}
                  </button>
                );
              })}
            </div>

            <div className="mt-4">
              <button
                onClick={saveTheme}
                disabled={themeBusy}
                className="px-4 py-2 rounded-lg border border-neutral-700 bg-black/90 hover:border-neutral-600 disabled:opacity-60"
              >
                {themeBusy ? "Saving…" : "Save"}
              </button>
              {themeMsg && (
                <p
                  className={`mt-3 text-sm ${
                    themeMsg.ok ? "text-[var(--good-400)]" : "text-red-400"
                  }`}
                >
                  {themeMsg.text}
                </p>
              )}
            </div>
          </section>


          {/* ---- Developer ---- */}
          <section className={card}>
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold mb-1">Developer</h2>
                <p className="text-neutral-400 text-sm">
                  {hasDev
                    ? "Developer mode active. Open the Dev Page to manage PDFs across users."
                    : "Open the Dev Page (you’ll be prompted for the developer password)."}
                </p>
              </div>
              <button
                onClick={gotoDev}
                disabled={devBusy}
                className="px-4 py-2 rounded-lg border border-neutral-700 bg-black/90 hover:border-neutral-600 disabled:opacity-60"
              >
                {devBusy ? "Opening…" : "Dev Page"}
              </button>
            </div>
            {devMsg ? (
              <div className={`mt-3 text-sm ${devMsg.ok ? "text-green-400" : "text-red-400"}`}>
                {devMsg.text}
              </div>
            ) : null}
          </section>

          {/* ---- Logout ---- */}
          <section className={card}>
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold mb-1">Sign out</h2>
                <p className="text-neutral-400 text-sm">End your session on this device.</p>
              </div>
              <button
                onClick={handleLogout}
                disabled={logoutBusy}
                className="px-4 py-2 rounded-lg border border-neutral-700 bg-black/90 hover:border-neutral-600 disabled:opacity-60"
              >
                {logoutBusy ? "Signing out…" : "Log out"}
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
