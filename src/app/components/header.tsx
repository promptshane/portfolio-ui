// src/app/components/header.tsx
"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import React from "react";

type HeaderProps = {
  title?: string;
  subtitle?: React.ReactNode;
  leftSlot?: React.ReactNode;

  // Optional custom right-side content (e.g., Sort + Database)
  rightSlot?: React.ReactNode;

  // Legacy single-button props (kept for existing pages)
  rightButtonLabel?: string;       // e.g., "Edit" / "Save"
  rightActive?: boolean;           // highlight when active
  onRightButtonClick?: () => void; // handler for Portfolio/Watchlist, unchanged

  // Optional back-button mode (used on Profile page)
  useBackButton?: boolean;
};

export default function Header({
  title,
  subtitle,
  leftSlot,
  rightSlot,
  rightButtonLabel,
  rightActive = false,
  onRightButtonClick,
  useBackButton = false,
}: HeaderProps) {
  const pathname = usePathname();
  const router = useRouter();
  const onHome = pathname === "/";

  const homeBtn =
    !onHome ? (
      <Link
        href="/"
        aria-label="Go to homepage"
        title="Home"
        className="inline-flex items-center justify-center w-10 h-10 rounded-lg border border-neutral-700 bg-neutral-800 hover:border-[var(--good-400)] focus:outline-none focus:ring-2 focus:ring-[var(--good-400)]"
      >
        <svg
          viewBox="0 0 24 24"
          className="w-5 h-5"
          fill="currentColor"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path d="M12 3.172 3 10v10a1 1 0 0 0 1 1h6v-6h4v6h6a1 1 0 0 0 1-1V10l-9-6.828Z" />
        </svg>
      </Link>
    ) : (
      <div className="w-10 h-10" />
    );

  const backBtn = (
    <button
      type="button"
      aria-label="Go back"
      title="Back"
      onClick={() => router.back()}
      className="inline-flex items-center justify-center w-10 h-10 rounded-lg border border-neutral-700 bg-neutral-800 hover:border-[var(--good-400)] focus:outline-none focus:ring-2 focus:ring-[var(--good-400)]"
    >
      <svg
        viewBox="0 0 24 24"
        className="w-5 h-5"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          d="M15 4L7 12l8 8"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );

  const primaryLeftControl = useBackButton ? backBtn : homeBtn;
  const leftControl = leftSlot ? (
    <div className="flex items-center gap-2">
      {primaryLeftControl}
      {leftSlot}
    </div>
  ) : (
    primaryLeftControl
  );

  const rightContent = rightSlot ? (
    rightSlot
  ) : rightButtonLabel ? (
    <button
      onClick={onRightButtonClick}
      className={`px-3 py-2 rounded-lg border ${
        rightActive
          ? "bg-[var(--good-500)] border-[var(--good-500)] hover:brightness-110"
          : "bg-black/90 border-neutral-700 hover:border-neutral-600"
      }`}
    >
      {rightButtonLabel}
    </button>
  ) : (
    <div className="w-[90px]" />
  );

  return (
    <header className="mb-6">
      <div className="relative flex items-center justify-between">
        {/* Left control (Back/Home or spacer) */}
        {leftControl}

        {/* Centered title (independent of left/right widths) */}
        {title && (
          <div className="absolute inset-x-0 flex flex-col items-center pointer-events-none">
            <h1 className="text-xl font-semibold text-center pointer-events-none">
              {title}
            </h1>
            {subtitle ? (
              <p className="text-xs text-neutral-400 mt-0.5">{subtitle}</p>
            ) : null}
          </div>
        )}

        {/* Right side (slot or legacy button) */}
        {rightContent}
      </div>
    </header>
  );
}
