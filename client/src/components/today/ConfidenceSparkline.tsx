/**
 * ConfidenceSparkline — 40×16 sparkline of Pax's historical confidence on
 * items of this type. The rightmost dot is the current value (in --acr-brand).
 *
 * Until real history is wired server-side, this gracefully degrades:
 *   - no `history` (undefined or fewer than 2 points) → a flat baseline
 *     (a thin horizontal rule at the value's y-position).
 *
 * Pure SVG, no library — keeps the row paint cheap and avoids hydration
 * mismatches inside the staggered DecisionQueue list.
 */

interface ConfidenceSparklineProps {
  /** Sequence of confidences in [0, 1]; chronological, oldest first. */
  history?: number[];
  /** Optional fallback current value so the dot lands somewhere honest
   *  when history is empty. Fractional [0, 1]. */
  current?: number;
}

const W = 40;
const H = 16;
const PAD_Y = 3;
const SCALE_MIN = 0.5;
const SCALE_MAX = 1.0;

function clamp(v: number): number {
  if (!Number.isFinite(v)) return SCALE_MIN;
  if (v < SCALE_MIN) return SCALE_MIN;
  if (v > SCALE_MAX) return SCALE_MAX;
  return v;
}

function yFor(v: number): number {
  // Invert: 1.0 sits at top (PAD_Y), 0.5 sits near bottom (H - PAD_Y).
  const norm = (clamp(v) - SCALE_MIN) / (SCALE_MAX - SCALE_MIN);
  return H - PAD_Y - norm * (H - 2 * PAD_Y);
}

export function ConfidenceSparkline({ history, current }: ConfidenceSparklineProps) {
  const points = Array.isArray(history) ? history.filter((n) => Number.isFinite(n)) : [];
  const flat = points.length < 2;
  const last = points.length > 0 ? points[points.length - 1] : (current ?? SCALE_MIN);
  const y = yFor(last);

  return (
    <svg
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={
        flat
          ? `No Pax confidence history yet`
          : `Pax confidence history, latest ${Math.round(clamp(last) * 100)}%`
      }
      data-testid="confidence-sparkline"
      shapeRendering="geometricPrecision"
    >
      {flat ? (
        <line
          x1={0}
          x2={W - 2}
          y1={y}
          y2={y}
          stroke="var(--acr-line-soft)"
          strokeWidth={1}
        />
      ) : (
        <polyline
          fill="none"
          stroke="var(--acr-line)"
          strokeWidth={1}
          points={points
            .map((p, i) => {
              const x = (i / (points.length - 1)) * (W - 2);
              return `${x.toFixed(2)},${yFor(p).toFixed(2)}`;
            })
            .join(" ")}
        />
      )}
      {/* Rightmost dot — current value, --acr-brand */}
      <circle cx={W - 2} cy={y} r={1.5} fill="var(--acr-brand)" />
    </svg>
  );
}
