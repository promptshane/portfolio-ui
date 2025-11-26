"use client";

import Header from "../components/header";

export default function RetirementPage() {
  return (
    <main className="min-h-screen bg-neutral-900 text-white px-6 py-8">
      <Header title="Retirement" subtitle="Coming soon" />
      <div className="mt-6 rounded-2xl border border-neutral-700 bg-neutral-850 p-6 text-center text-neutral-300">
        <div className="mx-auto mb-3 inline-flex h-12 w-12 items-center justify-center rounded-full border border-[color:var(--bad-400)/0.6] text-[var(--bad-200)]">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M12 2a5 5 0 00-5 5v3H6a2 2 0 00-2 2v7a2 2 0 002 2h12a2 2 0 002-2v-7a2 2 0 00-2-2h-1V7a5 5 0 00-5-5zm-3 8V7a3 3 0 016 0v3H9z"></path>
          </svg>
        </div>
        <div className="text-lg font-semibold text-white">Locked</div>
        <p className="mt-2 text-sm text-neutral-400">
          The retirement planner is still in progress. Check back soon for projections and withdrawal planning.
        </p>
      </div>
    </main>
  );
}
