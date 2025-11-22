import React from "react";
import type { PositionRow } from "../../types";
import PositionRowComp from "./PositionRow";

type Props = {
  rows: PositionRow[];
};

const GRID_TEMPLATE =
  "grid-cols-[minmax(72px,1fr)_minmax(90px,0.8fr)_minmax(140px,1fr)_minmax(150px,1.1fr)_minmax(220px,1.5fr)_minmax(260px,2.2fr)_minmax(70px,0.7fr)_minmax(70px,0.7fr)_minmax(80px,0.8fr)_minmax(90px,0.8fr)]";

export default function PositionsTable({ rows }: Props) {
  return (
    <>
      {/* Table header */}
      <div className={`grid ${GRID_TEMPLATE} text-gray-400 text-xs mb-3 px-2`}>
        <div className="text-left">Stock</div>
        <div className="text-center">Price</div>
        <div className="text-center">Change</div>

        <div className="text-center border-l border-neutral-700/40">Avg Cost</div>
        <div className="text-center">Total Return</div>

        <div className="text-center border-l border-neutral-700/40 px-2">
          <div className="grid grid-cols-3 gap-4 text-[10px] tracking-[0.16em] uppercase">
            <span>Financial</span>
            <span>Fair Value</span>
            <span>Momentum</span>
          </div>
        </div>

        <div className="text-center border-l border-neutral-700/40">Strength</div>
        <div className="text-center">Stability</div>
        <div className="text-center border-l border-neutral-700/40">Current</div>
        <div className="text-center">Recommended</div>
      </div>

      {/* Display rows */}
      <div className="space-y-3">
        {rows.map((r) => (
          <PositionRowComp
            key={r.sym}
            row={r}
            gridTemplate={GRID_TEMPLATE}
          />
        ))}
      </div>
    </>
  );
}
