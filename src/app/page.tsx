// src/app/page.tsx
"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import Header from "./components/header";

export default function HomePage() {
  const [name, setName] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    const cacheName = (value: string) => {
      try {
        window.localStorage.setItem("profile:preferredName", value);
      } catch {
        /* ignore quota */
      }
    };

    async function hydrateName() {
      const apply = (value?: string | null) => {
        const trimmed = (value ?? "").trim();
        return trimmed || null;
      };
      try {
        const res = await fetch("/api/user/profile", { cache: "no-store" });
        if (res.ok) {
          const data = await res.json();
          const fromProfile = apply(data?.preferredName) || apply(data?.username);
          if (!cancelled && fromProfile) {
            setName(fromProfile);
            cacheName(fromProfile);
            return;
          }
        }
      } catch {
        /* fall back */
      }
      try {
        const sessRes = await fetch("/api/auth/session", { cache: "no-store" });
        if (!sessRes.ok) throw new Error("session fetch failed");
        const session = await sessRes.json();
        const fallback =
          apply(session?.user?.preferredName) ||
          apply(session?.user?.username) ||
          apply(session?.user?.name) ||
          "there";
        if (!cancelled) {
          const finalName = fallback ?? "there";
          setName(finalName);
          cacheName(finalName);
        }
      } catch {
        if (!cancelled) setName("there");
      }
    }
    void hydrateName();
    return () => {
      cancelled = true;
    };
  }, []);

  // Keep the same thin hover border; add a thicker outline briefly on click (active)
  const tileClass =
    "bg-neutral-800 rounded-2xl p-6 border border-neutral-700 hover:border-[var(--highlight-400)] active:shadow-[0_0_0_2px_var(--highlight-400)] transition-[border-color,box-shadow]";

  // Locked tiles: use the "bad" theme color for hover/active highlight (to match the lock)
  const lockedTileClass =
    "bg-neutral-800 rounded-2xl p-6 border border-neutral-700 hover:border-[var(--bad-400)] active:shadow-[0_0_0_2px_var(--bad-400)] transition-[border-color,box-shadow]";

  // Theme-colored lock badge using the “bad” highlight color (down move)
  const LockBadge = () => (
    <div
      className="absolute top-3 right-3 h-6 w-6 rounded-full bg-[color:var(--bad-400)/0.12] text-[var(--bad-400)] ring-1 ring-[color:var(--bad-400)/0.45] flex items-center justify-center"
      aria-hidden
    >
      {/* Filled lock uses currentColor so it adopts the theme */}
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="currentColor"
        aria-hidden="true"
      >
        <path d="M12 2a5 5 0 00-5 5v3H6a2 2 0 00-2 2v7a2 2 0 002 2h12a2 2 0 002-2v-7a2 2 0 00-2-2h-1V7a5 5 0 00-5-5zm-3 8V7a3 3 0 016 0v3H9z" />
      </svg>
    </div>
  );

  return (
    <main className="min-h-screen bg-neutral-900 text-white px-6 py-8">
      <Header title="Home" />
      <div className="mb-8">
        <h1 className="text-3xl font-semibold">Welcome, {name}</h1>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {/* Top row */}
        <Link href="/portfolio" className={tileClass}>
          <div className="text-xl font-medium">Portfolio</div>
          <div className="text-neutral-400 text-sm mt-1">
            View positions &amp; performance
          </div>
        </Link>

        <Link href="/watchlist" className={tileClass}>
          <div className="text-xl font-medium">Watchlist</div>
          <div className="text-neutral-400 text-sm mt-1">
            Track tickers you care about
          </div>
        </Link>

        <Link href="/analysis" className={tileClass}>
          <div className="text-xl font-medium">Analysis</div>
          <div className="text-neutral-400 text-sm mt-1">
            Signals &amp; diagnostics (WIP)
          </div>
        </Link>

        {/* Middle row */}
        <Link href="/news" className={tileClass}>
          <div className="text-xl font-medium">News</div>
          <div className="text-neutral-400 text-sm mt-1">
            Market headlines &amp; stories
          </div>
        </Link>

        {/* LOCKED: The Hedge */}
        <Link
          href="#"
          className={`${lockedTileClass} cursor-not-allowed relative`}
          onClick={(e) => e.preventDefault()}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") e.preventDefault();
          }}
          aria-disabled={true}
          title="Locked"
        >
          <LockBadge />
          <div className="text-xl font-medium">The Hedge</div>
          <div className="text-neutral-400 text-sm mt-1">
            Build your ideal risk-balanced portfolio
          </div>
        </Link>

        {/* LOCKED: Options */}
        <Link
          href="#"
          className={`${lockedTileClass} cursor-not-allowed relative`}
          onClick={(e) => e.preventDefault()}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") e.preventDefault();
          }}
          aria-disabled={true}
          title="Locked"
        >
          <LockBadge />
          <div className="text-xl font-medium">Options</div>
          <div className="text-neutral-400 text-sm mt-1">
            Find ideal contracts by edge &amp; payoff
          </div>
        </Link>

        {/* Bottom row */}
        {/* Notes */}
        <Link href="/notes" className={tileClass}>
          <div className="text-xl font-medium">Notes</div>
          <div className="text-neutral-400 text-sm mt-1">
            Share quick investment notes and compare ideas with your circle.
          </div>
        </Link>

        {/* LOCKED: Crypto */}
        <Link
          href="#"
          className={`${lockedTileClass} cursor-not-allowed relative`}
          onClick={(e) => e.preventDefault()}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") e.preventDefault();
          }}
          aria-disabled={true}
          title="Locked"
        >
          <LockBadge />
          <div className="text-xl font-medium">Crypto</div>
          <div className="text-neutral-400 text-sm mt-1">
            Track coins, allocations &amp; risk
          </div>
        </Link>

        <Link href="/settings" className={tileClass}>
          <div className="text-xl font-medium">Settings</div>
          <div className="text-neutral-400 text-sm mt-1">
            Profile &amp; preferences
          </div>
        </Link>
      </div>
    </main>
  );
}
