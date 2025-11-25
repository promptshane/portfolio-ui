"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Header from "../components/header";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Developer Notes",
};

type User = {
  id: string;
  username?: string;
  preferredName?: string;
};

type UserTickersRow = {
  userId: string;
  username?: string;
  watchlist: string[];
  portfolio: string[];
};

type FtvDocMeta = {
  symbol: string;
  uploadedAt?: string;
  confirmedAt?: string;
  url?: string;
  ftvEstimate?: number;
  ftvAsOf?: string;
};

type DocsResp = { ok: boolean; latest?: FtvDocMeta; error?: string };
type UsersResp = { ok: boolean; users: User[]; error?: string };
type UserTickersResp = { ok: boolean; data: UserTickersRow[]; error?: string };

function formatDateTime(s?: string) {
  if (!s) return "";
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? s : d.toLocaleString();
}

function uniqTickers(list: string[]) {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of list) {
    const sym = (raw || "").trim().toUpperCase();
    if (!sym) continue;
    if (!seen.has(sym)) {
      seen.add(sym);
      out.push(sym);
    }
  }
  return out.sort();
}

export default function DevPage() {
  const [hasDev, setHasDev] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [authMsg, setAuthMsg] = useState<string | null>(null);

  const [users, setUsers] = useState<User[]>([]);
  const [usersBusy, setUsersBusy] = useState(false);
  const [usersErr, setUsersErr] = useState<string | null>(null);
  const [userSearch, setUserSearch] = useState("");

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loadBusy, setLoadBusy] = useState(false);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  const [tickers, setTickers] = useState<string[]>([]);
  const [docs, setDocs] = useState<Record<string, FtvDocMeta | null>>({});
  const [busyMap, setBusyMap] = useState<Record<string, boolean>>({});
  const [docErr, setDocErr] = useState<string | null>(null);

  const [filterUnconfirmed, setFilterUnconfirmed] = useState(false);
  const [filterMissing, setFilterMissing] = useState(false);
  const [symSearch, setSymSearch] = useState("");

  const hiddenFileInput = useRef<HTMLInputElement | null>(null);
  const pendingUploadSymbol = useRef<string | null>(null);

  // --- detect dev cookie (ftv_dev=1) ---
  useEffect(() => {
    try {
      setHasDev(/(?:^|;\s*)ftv_dev=1(?:;|$)/.test(document.cookie));
    } catch {
      setHasDev(false);
    }
  }, []);

  // --- fetch users once authed ---
  useEffect(() => {
    if (!hasDev) return;
    (async () => {
      setUsersBusy(true);
      setUsersErr(null);
      try {
        const res = await fetch("/api/admin/users", { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: UsersResp = await res.json();
        if (!data.ok) throw new Error(data.error || "Failed to load users");
        setUsers(data.users || []);
      } catch (e: any) {
        setUsersErr(e?.message || "Failed to load users");
      } finally {
        setUsersBusy(false);
      }
    })();
  }, [hasDev]);

  async function enableDev() {
    setAuthMsg(null);
    const password = window.prompt("Enter developer password:");
    if (!password) return;
    setAuthBusy(true);
    try {
      const res = await fetch("/api/ftv/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        let msg = `HTTP ${res.status}`;
        try {
          const j = await res.json();
          msg = j?.error || j?.message || msg;
        } catch { /* noop */ }
        throw new Error(msg);
      }
      setHasDev(true);
      setAuthMsg("Developer mode enabled.");
    } catch (e: any) {
      setAuthMsg(e?.message || "Auth failed.");
    } finally {
      setAuthBusy(false);
    }
  }

  function toggleUser(id: string) {
    setSelected(prev => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  const filteredUsers = useMemo(() => {
    const q = userSearch.trim().toLowerCase();
    if (!q) return users;
    return users.filter(u =>
      (u.username || "").toLowerCase().includes(q) ||
      (u.preferredName || "").toLowerCase().includes(q) ||
      (u.id || "").toLowerCase().includes(q)
    );
  }, [users, userSearch]);

  async function loadTickers() {
    setLoadErr(null);
    setDocErr(null);
    const ids = Array.from(selected);
    if (!ids.length) {
      setTickers([]);
      setDocs({});
      return;
    }
    setLoadBusy(true);
    try {
      const res = await fetch("/api/admin/user-tickers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ userIds: ids }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: UserTickersResp = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to load tickers");
      const all: string[] = [];
      for (const row of data.data || []) {
        all.push(...(row.watchlist || []), ...(row.portfolio || []));
      }
      const uniq = uniqTickers(all);
      setTickers(uniq);
      const base: Record<string, FtvDocMeta | null> = {};
      for (const s of uniq) base[s] = null;
      setDocs(base);
    } catch (e: any) {
      setLoadErr(e?.message || "Failed to load tickers");
    } finally {
      setLoadBusy(false);
    }
  }

  async function fetchDoc(symbol: string) {
    setDocErr(null);
    setBusyMap(m => ({ ...m, [symbol]: true }));
    try {
      const res = await fetch(`/api/ftv/docs?symbol=${encodeURIComponent(symbol)}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: DocsResp = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to load doc");
      setDocs(prev => ({ ...prev, [symbol]: data.latest ? { ...data.latest, symbol } : { symbol } }));
    } catch (e: any) {
      setDocErr(e?.message || `Failed to load ${symbol}`);
    } finally {
      setBusyMap(m => ({ ...m, [symbol]: false }));
    }
  }

  function requestUpload(symbol: string) {
    pendingUploadSymbol.current = symbol;
    hiddenFileInput.current?.click();
  }

  async function handleUploadInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    const symbol = pendingUploadSymbol.current;
    pendingUploadSymbol.current = null;
    if (!file || !symbol) return;
    e.target.value = "";

    setBusyMap(m => ({ ...m, [symbol]: true }));
    setDocErr(null);
    try {
      const fd = new FormData();
      fd.append("symbol", symbol.toUpperCase());
      fd.append("file", file);
      const res = await fetch("/api/ftv/upload", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok || !data?.ok) throw new Error(data?.error || "Upload failed");
      await fetchDoc(symbol);
    } catch (err: any) {
      setDocErr(err?.message || `Upload failed for ${symbol}`);
    } finally {
      setBusyMap(m => ({ ...m, [symbol]: false }));
    }
  }

  async function confirmDoc(symbol: string) {
    setBusyMap(m => ({ ...m, [symbol]: true }));
    setDocErr(null);
    try {
      const res = await fetch(`/api/ftv/docs?symbol=${encodeURIComponent(symbol)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "confirm" }),
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) throw new Error(data?.error || "Confirm failed");
      await fetchDoc(symbol);
    } catch (e: any) {
      setDocErr(e?.message || `Confirm failed for ${symbol}`);
    } finally {
      setBusyMap(m => ({ ...m, [symbol]: false }));
    }
  }

  useEffect(() => {
    const initial = tickers.slice(0, 15);
    for (const s of initial) {
      if (!docs[s]) fetchDoc(s);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tickers.join("|")]);

  const filteredTickers = useMemo(() => {
    const q = symSearch.trim().toUpperCase();
    return tickers.filter(s => {
      if (q && !s.includes(q)) return false;
      const d = docs[s];
      const hasPdf = !!d?.url;
      const isConfirmed = !!d?.confirmedAt;
      if (filterMissing && hasPdf) return false;
      if (filterUnconfirmed && isConfirmed) return false;
      return true;
    });
  }, [tickers, docs, symSearch, filterMissing, filterUnconfirmed]);

  const card = "bg-neutral-800 rounded-2xl p-4 border border-neutral-700";

  return (
    <main className="min-h-screen bg-neutral-900 text-white px-6 py-8">
      <Header title="Developer Notes" />

      {!hasDev && (
        <section className={`${card} mb-6`}>
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold mb-1">Developer mode required</h2>
              <p className="text-neutral-400 text-sm">
                Enter the developer password to access this page.
              </p>
            </div>
            <button
              onClick={enableDev}
              disabled={authBusy}
              className="px-4 py-2 rounded-lg border border-neutral-700 bg-black/90 hover:border-neutral-600 disabled:opacity-60"
            >
              {authBusy ? "Enabling…" : "Enable"}
            </button>
          </div>
          {authMsg && <div className="mt-3 text-sm text-neutral-300">{authMsg}</div>}
        </section>
      )}

      {hasDev && (
        <>
          {/* Users */}
          <section className={`${card} mb-6`}>
            <h2 className="text-lg font-semibold mb-3">Select Users</h2>

            <div className="flex items-center gap-3 mb-3">
              <input
                value={userSearch}
                onChange={(e) => setUserSearch(e.target.value)}
                placeholder="Search users…"
                className="w-72 max-w-full bg-neutral-900 border border-neutral-700 rounded-lg px-3 py-2 text-sm"
              />
              <button
                onClick={() => setSelected(new Set(users.map(u => u.id)))}
                disabled={!users.length}
                className="px-3 py-1.5 rounded-lg border border-neutral-700 bg-black/90 hover:border-neutral-600 text-sm"
              >
                Select all
              </button>
              <button
                onClick={() => setSelected(new Set())}
                className="px-3 py-1.5 rounded-lg border border-neutral-700 bg-black/90 hover:border-neutral-600 text-sm"
              >
                Clear
              </button>
              <div className="text-sm text-neutral-400 ml-auto">
                {selected.size} selected
              </div>
            </div>

            <div className="max-h-[220px] overflow-auto rounded-xl border border-neutral-700">
              {usersBusy ? (
                <div className="p-3 text-neutral-400 text-sm">Loading users…</div>
              ) : usersErr ? (
                <div className="p-3 text-red-400 text-sm">Error: {usersErr}</div>
              ) : !filteredUsers.length ? (
                <div className="p-3 text-neutral-400 text-sm">No users.</div>
              ) : (
                <table className="w-full text-sm">
                  <tbody>
                    {filteredUsers.map(u => {
                      const label =
                        u.preferredName?.trim() ||
                        u.username?.trim() ||
                        u.id;
                      const checked = selected.has(u.id);
                      return (
                        <tr key={u.id} className="border-b border-neutral-800">
                          <td className="p-2">
                            <label className="flex items-center gap-3 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggleUser(u.id)}
                                className="accent-green-500"
                              />
                              <span className="text-neutral-200">{label}</span>
                              {u.username && u.preferredName && (
                                <span className="text-neutral-400">(@{u.username})</span>
                              )}
                            </label>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>

            <div className="mt-3 flex items-center gap-3">
              <button
                onClick={loadTickers}
                disabled={!selected.size || loadBusy}
                className="px-4 py-2 rounded-lg border border-neutral-700 bg-black/90 hover:border-neutral-600 disabled:opacity-60"
              >
                {loadBusy ? "Loading…" : "Load Tickers"}
              </button>
              {loadErr && <span className="text-red-400 text-sm">{loadErr}</span>}
            </div>
          </section>

          {/* Tickers */}
          <section className={`${card}`}>
            <div className="flex flex-wrap items-center gap-3 mb-4">
              <h2 className="text-lg font-semibold">Tickers</h2>
              <input
                value={symSearch}
                onChange={(e) => setSymSearch(e.target.value.toUpperCase())}
                placeholder="Filter symbols…"
                className="bg-neutral-900 border border-neutral-700 rounded-lg px-3 py-1.5 text-sm"
              />
              <label className="flex items-center gap-2 text-sm ml-2">
                <input
                  type="checkbox"
                  className="accent-green-500"
                  checked={filterMissing}
                  onChange={(e) => setFilterMissing(e.target.checked)}
                />
                Missing PDF
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="accent-green-500"
                  checked={filterUnconfirmed}
                  onChange={(e) => setFilterUnconfirmed(e.target.checked)}
                />
                Unconfirmed
              </label>
              <div className="text-sm text-neutral-400 ml-auto">
                {filteredTickers.length} shown / {tickers.length} total
              </div>
            </div>

            {docErr && <div className="mb-3 text-sm text-red-400">Error: {docErr}</div>}

            {!tickers.length ? (
              <div className="text-neutral-400 text-sm">No tickers loaded yet.</div>
            ) : !filteredTickers.length ? (
              <div className="text-neutral-400 text-sm">No matches for current filters.</div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {filteredTickers.map(sym => {
                  const d = docs[sym];
                  const busy = !!busyMap[sym];
                  const hasPdf = !!d?.url;
                  const isConfirmed = !!d?.confirmedAt;

                  return (
                    <div key={sym} className="rounded-xl border border-neutral-700 bg-neutral-900/40 p-3">
                      <div className="flex items-center justify-between">
                        <div className="text-base font-semibold">{sym}</div>
                        <div className="flex items-center gap-2">
                          {isConfirmed ? (
                            <span className="text-xs px-2 py-0.5 rounded bg-[var(--good-400)]/20 border border-[var(--good-400)] text-[var(--good-400)]">
                              Confirmed
                            </span>
                          ) : (
                            <span className="text-xs px-2 py-0.5 rounded bg-[var(--bad-500)]/20 border border-[var(--bad-400)] text-[var(--bad-400)]">
                              Unconfirmed
                            </span>
                          )}
                          {hasPdf ? (
                            <span className="text-xs px-2 py-0.5 rounded bg-[var(--good-400)]/20 border border-[var(--good-400)] text-[var(--good-400)]">
                              PDF Attached
                            </span>
                          ) : (
                            <span className="text-xs px-2 py-0.5 rounded bg-[var(--bad-500)]/20 border border-[var(--bad-400)] text-[var(--bad-400)]">
                              PDF Missing
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="mt-2 text-xs text-neutral-300 space-y-1">
                        <div>
                          <span className="text-neutral-400">Last upload: </span>
                          <span className="text-neutral-100">{formatDateTime(d?.uploadedAt) || "—"}</span>
                        </div>
                        <div>
                          <span className="text-neutral-400">Confirmed: </span>
                          <span className="text-neutral-100">{formatDateTime(d?.confirmedAt) || "—"}</span>
                        </div>
                        <div className="truncate">
                          <span className="text-neutral-400">PDF: </span>
                          {d?.url ? (
                            <a
                              href={d.url}
                              target="_blank"
                              rel="noreferrer"
                              className="underline text-neutral-100 hover:text-white"
                            >
                              Open
                            </a>
                          ) : (
                            <span className="text-neutral-500">—</span>
                          )}
                        </div>
                        {typeof d?.ftvEstimate === "number" && (
                          <div>
                            <span className="text-neutral-400">FVE: </span>
                            <span className="text-neutral-100">${d.ftvEstimate.toFixed(2)}</span>
                            {d.ftvAsOf && <span className="text-neutral-400"> (as of {new Date(d.ftvAsOf).toLocaleDateString()})</span>}
                          </div>
                        )}
                      </div>

                      <div className="mt-3 flex items-center gap-2">
                        <button
                          onClick={() => fetchDoc(sym)}
                          disabled={busy}
                          className="px-3 py-1.5 rounded-lg border border-neutral-700 bg-black/90 hover:border-neutral-600 disabled:opacity-60 text-sm"
                          title="Refresh this ticker's doc info"
                        >
                          {busy ? "…" : "Refresh"}
                        </button>
                        <button
                          onClick={() => requestUpload(sym)}
                          disabled={busy}
                          className="px-3 py-1.5 rounded-lg border border-neutral-700 bg-black/90 hover:border-neutral-600 disabled:opacity-60 text-sm"
                          title="Upload a new PDF for this ticker"
                        >
                          Upload
                        </button>
                        <button
                          onClick={() => confirmDoc(sym)}
                          disabled={busy} // allow confirming even if no PDF exists
                          className="px-3 py-1.5 rounded-lg border border-neutral-700 bg-black/90 hover:border-neutral-600 disabled:opacity-60 text-sm"
                          title={hasPdf ? "Mark the latest PDF as confirmed/current" : "Confirm that no PDF is available"}
                        >
                          Confirm
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* hidden file input used for uploads */}
          <input
            ref={hiddenFileInput}
            type="file"
            accept="application/pdf"
            className="hidden"
            onChange={handleUploadInput}
          />
        </>
      )}
    </main>
  );
}
