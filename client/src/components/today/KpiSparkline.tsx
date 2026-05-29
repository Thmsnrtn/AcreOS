/**
 * KpiSparkline — Tufte-style micro-chart for a single KPI tile.
 *
 * Renders a 90-day series as a thin line, with a faint typical-range band
 * (min/max) behind it, and the current (rightmost) value as a small dot
 * in --acr-brand. No axes, no grid, no tooltips — the sparkline lives at
 * the resolution of "show me the shape" beside a real numeric value.
 *
 * Returns null if data is empty so callers can opt into a fake-data-free
 * "no sparkline" branch rather than rendering a flat line.
 */

import { useId } from "react";

interface KpiSparklineProps {
  data: number[];
  width?: number;
  height?: number;
  label: string;
}

export function KpiSparkline({
  data,
  width = 60,
  height = 16,
  label,
}: KpiSparklineProps) {
  const uid = useId();
  if (!Array.isArray(data) || data.length < 2) return null;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;

  // Normalize to a small vertical padding so the line + band don't touch edges.
  const pad = 1.5;
  const innerH = height - pad * 2;
  const stepX = data.length > 1 ? width / (data.length - 1) : width;

  const points = data.map((v, i) => {
    const x = i * stepX;
    const y = pad + innerH - ((v - min) / range) * innerH;
    return [x, y] as const;
  });

  const pathD = points
    .map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`)
    .join(" ");

  // Typical-range band = min..max (honest, no statistical pretension).
  // Drawn as a single full-height rect so the line floats inside it.
  const last = points[points.length - 1];

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`${label}: 90-day trend, ${data.length} samples, range ${min.toFixed(0)} to ${max.toFixed(0)}, current ${data[data.length - 1].toFixed(0)}`}
      className="overflow-visible"
      data-testid={`sparkline-${uid}`}
    >
      <rect
        x={0}
        y={pad}
        width={width}
        height={innerH}
        fill="var(--acr-line-soft)"
        opacity={0.5}
      />
      <path
        d={pathD}
        fill="none"
        stroke="var(--acr-ink-3, currentColor)"
        strokeWidth={1}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={0.7}
      />
      <circle
        cx={last[0]}
        cy={last[1]}
        r={1.75}
        fill="var(--acr-brand)"
      />
    </svg>
  );
}
