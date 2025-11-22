import React from "react";
import type { Holding } from "../types";

type Props = {
  draft: Holding[];
  setDraft: React.Dispatch<React.SetStateAction<Holding[]>>;
  newSym: string;
  setNewSym: (v: string) => void;
  newShares: string;
  setNewShares: (v: string) => void;
  newAvg: string;
  setNewAvg: (v: string) => void;
};

export default function EditHoldingsPanel({
  draft,
  setDraft,
  newSym,
  setNewSym,
  newShares,
  setNewShares,
  newAvg,
  setNewAvg,
}: Props) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-12 text-gray-400 text-xs mb-2 px-2">
        <div className="col-span-3 text-left">Ticker</div>
        <div className="col-span-3 text-left">Shares</div>
        <div className="col-span-3 text-left">Avg cost</div>
        <div className="col-span-3 text-right">Actions</div>
      </div>

      <div className="grid grid-cols-12 gap-3 items-center bg-neutral-825 rounded-2xl py-3 px-4 border border-neutral-800">
        <div className="col-span-3">
          <input
            className="w-full px-3 py-2 rounded-lg bg-black/90 border border-neutral-700 uppercase"
            placeholder="Ticker (e.g., MSFT)"
            value={newSym}
            onChange={(e) => setNewSym(e.target.value.toUpperCase())}
          />
        </div>
        <div className="col-span-3">
          <input
            className="w-full px-3 py-2 rounded-lg bg-black/90 border border-neutral-700"
            placeholder="Shares"
            inputMode="decimal"
            value={newShares}
            onChange={(e) => setNewShares(e.target.value)}
          />
        </div>
        <div className="col-span-3">
          <input
            className="w-full px-3 py-2 rounded-lg bg-black/90 border border-neutral-700"
            placeholder="Avg cost"
            inputMode="decimal"
            value={newAvg}
            onChange={(e) => setNewAvg(e.target.value)}
          />
        </div>
        <div className="col-span-3 flex justify-end">
          <button
            onClick={() => {
              const sym = newSym.toUpperCase().trim();
              if (!sym) return;
              const shares = Number(newShares || 0);
              const avgCost = Number(newAvg || 0);
              if (shares <= 0) return;
              setDraft((prev) => {
                const i = prev.findIndex((h) => h.sym === sym);
                if (i >= 0) {
                  const copy = [...prev];
                  copy[i] = { sym, shares, avgCost };
                  return copy;
                }
                return [...prev, { sym, shares, avgCost }];
              });
              setNewSym("");
              setNewShares("");
              setNewAvg("");
            }}
            className="px-3 py-2 rounded-lg border hover:brightness-110"
            style={{ backgroundColor: "var(--good-500)", borderColor: "var(--good-500)" }}
          >
            Add
          </button>
        </div>
      </div>

      {draft.map((h, idx) => (
        <div
          key={h.sym + idx}
          className="grid grid-cols-12 gap-3 items-center bg-neutral-825 rounded-2xl py-3 px-4 border border-neutral-800"
        >
          <div className="col-span-3">
            <input
              className="w-full px-3 py-2 rounded-lg bg-black/90 border border-neutral-700 uppercase"
              value={h.sym}
              onChange={(e) => {
                const value = e.target.value;
                setDraft((prev) => {
                  const next = [...prev];
                  next[idx] = { ...next[idx], sym: value.toUpperCase() };
                  return next;
                });
              }}
            />
          </div>
          <div className="col-span-3">
            <input
              className="w-full px-3 py-2 rounded-lg bg-black/90 border border-neutral-700"
              inputMode="decimal"
              value={String(h.shares)}
              onChange={(e) => {
                const value = e.target.value;
                setDraft((prev) => {
                  const next = [...prev];
                  next[idx] = { ...next[idx], shares: value === "" ? 0 : Number(value) };
                  return next;
                });
              }}
            />
          </div>
          <div className="col-span-3">
            <input
              className="w-full px-3 py-2 rounded-lg bg-black/90 border border-neutral-700"
              inputMode="decimal"
              value={String(h.avgCost)}
              onChange={(e) => {
                const value = e.target.value;
                setDraft((prev) => {
                  const next = [...prev];
                  next[idx] = { ...next[idx], avgCost: value === "" ? 0 : Number(value) };
                  return next;
                });
              }}
            />
          </div>
          <div className="col-span-3 flex justify-end">
            <button
              onClick={() => setDraft((prev) => prev.filter((x) => x.sym !== h.sym))}
              className="px-3 py-2 rounded-lg border hover:brightness-110"
              style={{ backgroundColor: "var(--bad-500)", borderColor: "var(--bad-500)" }}
            >
              Remove
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
