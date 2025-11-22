import React from "react";
import type { PositionRow as PositionRowType } from "../../types";
import { dotClass, money } from "../../utils/format";

type Props = {
  row: PositionRowType;
  gridTemplate: string;
};

export default function PositionRow({ row: r, gridTemplate }: Props) {
  const retUp = r.retAbs >= 0;
  const scoreClass = (value: number | null | undefined) =>
    value == null ? "bg-black" : dotClass(value);
  const openAnalysis = () => {
    const upper = r.sym.trim().toUpperCase();
    if (!upper) return;
    window.open(`/analysis?ticker=${encodeURIComponent(upper)}`, "_blank", "noopener,noreferrer");
  };

  return (
    <div className={`grid ${gridTemplate} items-center gap-3 bg-neutral-825 rounded-2xl p-4 border border-neutral-800`}>
      <div className="text-left">
        <button
          type="button"
          onClick={openAnalysis}
          className="px-3 py-1.5 rounded-lg bg-black/90 border border-neutral-700 font-semibold tracking-wide transition-colors hover:border-[var(--good-500)] focus-visible:border-[var(--good-500)] focus-visible:outline-none min-w-[68px]"
        >
          {r.sym}
        </button>
      </div>

      <div className="text-center">
        <span className="inline-flex w-[110px] justify-center px-2 py-1.5 text-sm font-medium">
          {r.price != null ? `$${r.price.toFixed(2)}` : "—"}
        </span>
      </div>

      <div className="text-center">
        <span
          className={`inline-flex w-[150px] justify-center px-2 py-1.5 text-sm font-medium ${
            r.chg == null
              ? "text-neutral-400"
              : r.chg >= 0
              ? "text-[var(--good-400)]"
              : "text-[var(--bad-400)]"
          }`}
        >
          {r.chg == null
            ? "—"
            : r.chg >= 0
            ? `(+${r.chg.toFixed(2)}%)`
            : `(${r.chg.toFixed(2)}%)`}
        </span>
      </div>

      {/* Avg Cost */}
      <div className="text-center border-l border-neutral-700/40">
        <span className="inline-flex w-[170px] justify-center px-2 py-1.5 text-sm font-medium">
          ${r.avgCost.toFixed(2)}
        </span>
      </div>

      {/* Total Return */}
      <div className="text-center">
        <span
          className={`inline-flex w-[230px] justify-center px-2 py-1.5 text-sm font-semibold ${
            retUp ? "text-[var(--good-400)]" : "text-[var(--bad-400)]"
          }`}
        >
          {retUp ? "+" : "-"}
          {money(r.retAbs)} ({Math.abs(r.retPct).toFixed(2)}%)
        </span>
      </div>

      {/* Dots */}
      <div className="border-l border-neutral-700/40 px-2">
        <div className="grid grid-cols-3 place-items-center gap-4">
          <div
            className={`w-5 h-5 rounded-full ${scoreClass(r.fin)} border border-neutral-700 shadow-[0_0_0_3px_rgba(0,0,0,0.35)]`}
          />
          <div
            className={`w-5 h-5 rounded-full ${scoreClass(r.fair)} border border-neutral-700 shadow-[0_0_0_3px_rgba(0,0,0,0.35)]`}
          />
          <div
            className={`w-5 h-5 rounded-full ${scoreClass(r.mom)} border border-neutral-700 shadow-[0_0_0_3px_rgba(0,0,0,0.35)]`}
          />
        </div>
      </div>

      {/* Strength / Stability placeholders */}
      <div className="text-center border-l border-neutral-700/40">
        <span className="px-2.5 py-1 rounded-xl text-sm border border-neutral-700 text-neutral-400">
          X
        </span>
      </div>
      <div className="text-center">
        <span className="px-2.5 py-1 rounded-xl text-sm border border-neutral-700 text-neutral-400">
          Y
        </span>
      </div>

      {/* Current / Recommended */}
      <div className="text-center border-l border-neutral-700/40">
        <span className="px-3 py-1.5 rounded-lg bg-black/90 border border-neutral-700 text-white font-medium">
          {r.cur.toFixed(1)}%
        </span>
      </div>
      <div className="text-center">
        <span className="px-2.5 py-1.5 rounded-xl text-sm border border-neutral-700 text-neutral-400">
          Z
        </span>
      </div>
    </div>
  );
}
