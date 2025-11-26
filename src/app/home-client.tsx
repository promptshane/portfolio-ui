"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import Header from "./components/header";

export default function HomeClient() {
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
        const fromLocal = apply(window.localStorage.getItem("profile:preferredName"));
        if (fromLocal && !cancelled) setName(fromLocal);
      } catch {
        /* ignore */
      }
    }

    hydrateName();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="min-h-screen bg-neutral-900 text-white px-6 py-8">
      <Header title="Home" />
      <div className="mb-8">
        <h1 className="text-3xl font-semibold">Welcome, {name || ""}</h1>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
        <Card title="Portfolio" href="/portfolio" description="View positions & performance" />
        <Card title="Watchlist" href="/watchlist" description="Track tickers you care about" />
        <Card title="Analysis" href="/analysis" description="Signals & diagnostics (WIP)" />
        <Card title="News" href="/news" description="Market headlines & stories" />
        <Card
          title="Discount Hub"
          href="/discount-hub"
          description="Buy/Hold/Sell guidance captured from research"
        />
        <Card title="Options" href="#" locked description="Find ideal contracts by edge & payoff" />
        <Card title="Notes" href="/notes" description="Store investment notes" />
        <Card title="Retirement" href="#" locked description="Project savings and withdrawals" />
        <Card title="Settings" href="/settings" description="Profile & preferences" />
      </div>
    </main>
  );
}

function Card({
  title,
  description,
  href,
  locked = false,
}: {
  title: string;
  description: string;
  href: string;
  locked?: boolean;
}) {
  const baseClasses =
    "bg-neutral-800 rounded-2xl p-6 border border-neutral-700 transition-[border-color,box-shadow]";
  const hoverClasses = locked
    ? "cursor-not-allowed relative hover:border-[var(--bad-400)] active:shadow-[0_0_0_2px_var(--bad-400)]"
    : "hover:border-[var(--highlight-400)] active:shadow-[0_0_0_2px_var(--highlight-400)]";
  return (
    <Link
      className={`${baseClasses} ${hoverClasses}`}
      href={locked ? "#" : href}
      aria-disabled={locked}
      title={locked ? "Locked" : undefined}
    >
      {locked && (
        <div
          className="absolute top-3 right-3 h-6 w-6 rounded-full bg-[color:var(--bad-400)/0.12] text-[var(--bad-400)] ring-1 ring-[color:var(--bad-400)/0.45] flex items-center justify-center"
          aria-hidden="true"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M12 2a5 5 0 00-5 5v3H6a2 2 0 00-2 2v7a2 2 0 002 2h12a2 2 0 002-2v-7a2 2 0 00-2-2h-1V7a5 5 0 00-5-5zm-3 8V7a3 3 0 016 0v3H9z"></path>
          </svg>
        </div>
      )}
      <div className="text-xl font-medium">{title}</div>
      <div className="text-neutral-400 text-sm mt-1">{description}</div>
    </Link>
  );
}
