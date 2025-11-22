export const dotClass = (x: number) =>
  x >= 67 ? "bg-[var(--good-500)]" : x >= 34 ? "bg-[var(--mid-400)]" : "bg-[var(--bad-500)]";

export const money = (n: number) =>
  `$${Math.abs(n).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
