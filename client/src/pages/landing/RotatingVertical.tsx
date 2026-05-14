import { useEffect, useState } from "react";

/**
 * Animated label that cycles through the verticals AcreOS serves.
 * Visually: each label scrolls up and fades, replaced by the next from
 * below. Reduces the perception of "land-only" positioning while
 * preserving the canonical "Land Investors" framing as the lead.
 *
 * The list mirrors PERSONAS in client/src/lib/personaVocabulary.ts so
 * the surface stays accurate as we expand vertical coverage. "Land
 * Investors" is intentionally first so the prevailing positioning
 * doesn't get visually displaced — it just gets visible peers.
 *
 * The animation respects prefers-reduced-motion: when the user has
 * reduced-motion set, the label simply replaces (no transform), still
 * cycling but without the scroll-and-fade.
 */

export const VERTICAL_LABELS = [
  "Land Investors",
  "Note Investors",
  "Fix-and-Flippers",
  "Wholesalers",
  "Subdividers",
  "Tax-Delinquent Buyers",
  "Buy-and-Hold Landlords",
] as const;

interface RotatingVerticalProps {
  /** Milliseconds between rotations. Default 2600. */
  intervalMs?: number;
}

export function RotatingVertical({ intervalMs = 2600 }: RotatingVerticalProps) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const t = setInterval(() => {
      setIndex((i) => (i + 1) % VERTICAL_LABELS.length);
    }, intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);

  return (
    <span
      className="lp-vertical-rotator"
      aria-label={`for ${VERTICAL_LABELS.join(", ")}`}
    >
      {/* Hidden sizer keeps the line width stable at the widest label so
         the rest of the headline doesn't jump as labels cycle. */}
      <span className="lp-vertical-rotator-sizer" aria-hidden="true">
        {VERTICAL_LABELS.reduce((a, b) => (a.length >= b.length ? a : b))}
      </span>
      <span className="lp-vertical-rotator-window" aria-hidden="true">
        <span
          key={index}
          className="lp-vertical-rotator-label"
          data-testid="rotating-vertical-label"
        >
          {VERTICAL_LABELS[index]}
        </span>
      </span>
    </span>
  );
}
