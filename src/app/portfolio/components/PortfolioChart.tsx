import { useMemo, useRef, useState } from "react";
import type { LineData, RangeKey } from "../types";
import { VIEW_W, VIEW_H, PAD, mapX, toPathPx, yForValue } from "../utils/chart";

type Props = {
  line: LineData;
  range: RangeKey;
  oneMonthInterval?: "1h" | "1d";
  seriesError?: boolean;
  fallbackChangePct?: number; // used when series has <2 points (behavior parity)
  /** Called with the snapped index while hovering; emits null on leave. */
  onIndexChange?: (i: number | null) => void;
};

const clampToInterval = (date: Date, minutes: number) => {
  const rounded = new Date(date);
  const minute = rounded.getMinutes();
  const snapped = Math.floor(minute / minutes) * minutes;
  rounded.setMinutes(snapped, 0, 0);
  return rounded;
};

const formatHoverLabel = (
  range: RangeKey,
  date: Date | undefined,
  opts?: { oneMonthInterval?: "1h" | "1d" }
) => {
  if (!date) return "";
  switch (range) {
    case "1D": {
      const snapped = clampToInterval(date, 5);
      return snapped.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    }
    case "1W":
      return date.toLocaleString([], {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
    case "1M":
      if (opts?.oneMonthInterval === "1d") {
        return date.toLocaleDateString([], {
          month: "short",
          day: "numeric",
        });
      }
      return date.toLocaleString([], {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
    default:
      return date.toLocaleDateString([], {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
  }
};

export default function PortfolioChart({
  line,
  range,
  oneMonthInterval = "1h",
  seriesError,
  fallbackChangePct = 0,
  onIndexChange,
}: Props) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const pathD = useMemo(() => toPathPx(line.points), [line.points]);

  // keep both CSS-px X (for time label) and viewBox X (for SVG shapes)
  const [hover, setHover] = useState<null | { i: number; xCss: number; xVb: number }>(null);

  const handleMove = (clientX: number, target: Element) => {
    if (!line.points.length) {
      if (onIndexChange) onIndexChange(null);
      return;
    }
    const svgEl = target as HTMLElement;
    const svgRect = svgEl.getBoundingClientRect();
    const containerEl = svgEl.parentElement as HTMLElement | null;
    const containerRect = containerEl ? containerEl.getBoundingClientRect() : svgRect;

    let xCssInSvg = clientX - svgRect.left;
    xCssInSvg = Math.max(0, Math.min(xCssInSvg, svgRect.width));
    let xVb = (xCssInSvg / Math.max(1, svgRect.width)) * VIEW_W;
    xVb = Math.max(PAD, Math.min(xVb, VIEW_W - PAD));

    const t = (xVb - PAD) / (VIEW_W - 2 * PAD);
    const computedIndex = Math.round(t * Math.max(0, line.points.length - 1));
    const safeIndex = Math.max(0, Math.min(computedIndex, line.points.length - 1));

    // SNAP: align to exact data-point X for both viewBox and CSS coords
    const snappedXv = mapX(line.points[safeIndex][0]);
    const snappedCssInSvg = (snappedXv / VIEW_W) * svgRect.width;

    // Convert SVG-relative CSS px to container-relative px for the absolutely positioned label
    const labelLeft = (svgRect.left - containerRect.left) + snappedCssInSvg;

    setHover({ i: safeIndex, xCss: labelLeft, xVb: snappedXv });
    if (onIndexChange) onIndexChange(safeIndex);
  };

  const onMouseMove: React.MouseEventHandler<SVGSVGElement> = (e) =>
    handleMove(e.clientX, e.currentTarget);
  const onClick: React.MouseEventHandler<SVGSVGElement> = (e) =>
    handleMove(e.clientX, e.currentTarget);
  const onMouseLeave = () => {
    setHover(null);
    if (onIndexChange) onIndexChange(null);
  };

  // Baseline (start-of-day or zero if relative)
  const baselineVal = line.isRelative ? 0 : (line.values[0] ?? 0);
  const dashedY = yForValue(baselineVal, line.min, line.max);

  // Stroke color: up/down based on series (parity with original)
  const lastRel = line.values.length ? line.values.at(-1)! : 0;
  const pctFromSeries =
    line.isRelative
      ? (lastRel / Math.max(1e-9, line.baseline ?? 1)) * 100
      : line.values.length >= 2
        ? ((line.values.at(-1)! - line.values[0]) / Math.max(1e-9, line.values[0])) * 100
        : fallbackChangePct;
  const isUp = line.isRelative ? lastRel >= 0 : pctFromSeries >= 0;
  const strokeColor = isUp ? "var(--good-300)" : "var(--bad-400)";

  const idx = hover ? hover.i : Math.max(0, line.values.length - 1);

  const hoverLabel = formatHoverLabel(range, line.times[idx], { oneMonthInterval });

  return (
    <div className="relative h-full w-full">
      {seriesError && (
        <div className="absolute right-4 top-3 text-[10px] text-neutral-400">
          showing synthetic
        </div>
      )}

      {/* Hover time only (no box, centered on crosshair) */}
      {hover && line.points.length > 0 && hoverLabel && (
        <div
          className="pointer-events-none absolute -translate-x-1/2 text-xs text-neutral-300"
          style={{ left: hover.xCss, top: -6, whiteSpace: "nowrap" }}
        >
          {hoverLabel}
        </div>
      )}

      <svg
        ref={svgRef}
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        preserveAspectRatio="none"
        className="h-full w-full"
        onMouseMove={onMouseMove}
        onMouseLeave={onMouseLeave}
        onClick={onClick}
      >
        <defs>
          <linearGradient id="areaFillUp" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--good-300)" stopOpacity="0.35" />
            <stop offset="100%" stopColor="var(--good-300)" stopOpacity="0.0" />
          </linearGradient>
          <linearGradient id="areaFillDown" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--bad-400)" stopOpacity="0.35" />
            <stop offset="100%" stopColor="var(--bad-400)" stopOpacity="0.0" />
          </linearGradient>
        </defs>

        {/* Dashed baseline (day start) — neutral so it stands out */}
        <line
          x1={PAD}
          x2={VIEW_W - PAD}
          y1={dashedY}
          y2={dashedY}
          stroke="#94a3b8"
          strokeOpacity="0.7"
          strokeDasharray="6 6"
          strokeWidth="1"
        />

        {pathD && (
          <>
            <path
              d={`${pathD} L ${VIEW_W - PAD} ${VIEW_H - PAD} L ${PAD} ${VIEW_H - PAD} Z`}
              fill={`url(#${isUp ? "areaFillUp" : "areaFillDown"})`}
              stroke="none"
            />
            <path
              d={pathD}
              fill="none"
              stroke={strokeColor}
              strokeWidth="1.0"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          </>
        )}

        {/* Crosshair (snapped) */}
        {hover && line.points.length > 0 && idx >= 0 && idx < line.points.length && (
          <>
            <line
              x1={hover.xVb}
              x2={hover.xVb}
              y1={PAD}
              y2={VIEW_H - PAD}
              stroke="#ffffff33"
              strokeWidth="1"
            />
            {idx >= 0 && idx < line.points.length && (
              <line
                x1={PAD}
                x2={VIEW_W - PAD}
                y1={PAD + line.points[idx][1] * (VIEW_H - 2 * PAD)}
                y2={PAD + line.points[idx][1] * (VIEW_H - 2 * PAD)}
                stroke="#ffffff33"
                strokeWidth="1"
              />
            )}
          </>
        )}
      </svg>
    </div>
  );
}
