/**
 * ConfidenceBar — 60px wide horizontal bar on the [50%, 100%] range.
 *
 * Visual language for Pax-sourced rows in the Decision Queue. Tufte-grade:
 * the bar tells you THREE things in one glance — the current confidence
 * (filled width), the user's auto-handle threshold (tick), and the floor
 * the scale starts from (the rail's left edge is 50%, not 0%, because Pax
 * never surfaces anything below 50% — starting at 0 would crush every bar
 * into the right half and waste the scale).
 *
 * Tokens only — no hardcoded colors.
 */

interface ConfidenceBarProps {
  /** Current confidence as a fraction in [0, 1]. */
  value: number;
  /** Auto-handle threshold as a fraction in [0, 1]. */
  threshold: number;
}

const SCALE_MIN = 0.5;
const SCALE_MAX = 1.0;

function clampPct(v: number): number {
  if (!Number.isFinite(v)) return SCALE_MIN;
  if (v < SCALE_MIN) return SCALE_MIN;
  if (v > SCALE_MAX) return SCALE_MAX;
  return v;
}

function toScalePct(v: number): number {
  // Map [0.5, 1.0] → [0, 100].
  return ((clampPct(v) - SCALE_MIN) / (SCALE_MAX - SCALE_MIN)) * 100;
}

export function ConfidenceBar({ value, threshold }: ConfidenceBarProps) {
  const valuePct = toScalePct(value);
  const thresholdPct = toScalePct(threshold);
  const valueLabel = Math.round(clampPct(value) * 100);

  return (
    <div
      role="meter"
      aria-valuemin={Math.round(SCALE_MIN * 100)}
      aria-valuemax={Math.round(SCALE_MAX * 100)}
      aria-valuenow={valueLabel}
      aria-label={`Pax confidence ${valueLabel}%`}
      className="relative inline-flex items-center"
      style={{ width: 60, height: 6 }}
      data-testid="confidence-bar"
    >
      {/* Rail */}
      <span
        aria-hidden="true"
        className="absolute inset-0 rounded-full"
        style={{ background: "var(--acr-line-soft)" }}
      />
      {/* Fill */}
      <span
        aria-hidden="true"
        className="absolute left-0 top-0 bottom-0 rounded-full"
        style={{
          width: `${valuePct}%`,
          background: "var(--acr-brand)",
        }}
      />
      {/* Threshold tick — 1px vertical mark in --acr-pos */}
      <span
        aria-hidden="true"
        className="absolute"
        style={{
          left: `${thresholdPct}%`,
          top: -1,
          bottom: -1,
          width: 1,
          background: "var(--acr-pos)",
        }}
      />
    </div>
  );
}
