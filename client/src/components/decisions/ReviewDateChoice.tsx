/**
 * "When will you know how this went?" — the one question that makes a recorded
 * decision gradeable.
 *
 * A decision with a review date is asked about once, on Today, when the date
 * arrives (`OutcomePrompt` reads `/api/decisions/due`). Without one it never
 * prompts, so its outcome is never recorded and calibration never learns from
 * it. The blind-offer wizard hard-coded `reviewDueAt: null` until 2026-10-04,
 * which meant no land offer it recorded could ever be graded.
 * `tests/unit/clientNeverHardcodesNoReviewDate.test.ts` now forbids that shape
 * in every client file.
 *
 * Deliberately a few fixed chips rather than a date picker: a picker is friction
 * at the exact moment friction makes someone skip the question, and the honest
 * answers are coarse anyway. NOTHING IS PRE-SELECTED. The server refuses to
 * invent a review date, and a chip selected by default would manufacture one on
 * the operator's behalf. "No set date" is an answer of equal weight, not a skip.
 *
 * Extracted from the flip analyzer, where it was first written.
 */
import { Button } from "@/components/ui/button";

export const REVIEW_CHOICES: ReadonlyArray<{ label: string; days: number | null }> = [
  { label: "In 2 weeks", days: 14 },
  { label: "In 30 days", days: 30 },
  { label: "In 90 days", days: 90 },
  { label: "No set date", days: null },
];

/**
 * The ISO date to send for an ANSWERED question, or null for "no set date".
 *
 * It does not accept `undefined` (not answered yet). A caller must narrow
 * first, so an unanswered question cannot quietly become "never review" — the
 * type checker refuses the call that would let it.
 */
export function reviewDueAtFromDays(days: number | null, now: number = Date.now()): string | null {
  if (days === null) return null;
  return new Date(now + days * 86_400_000).toISOString();
}

export function ReviewDateChoice({
  value,
  onChange,
  testIdPrefix = "review-in",
  className,
}: {
  /** `undefined` until the operator answers; `null` is the answer "no set date". */
  value: number | null | undefined;
  onChange: (days: number | null) => void;
  testIdPrefix?: string;
  className?: string;
}) {
  return (
    <fieldset className={className}>
      <legend className="text-sm font-medium">When will you know how this went?</legend>
      <p className="mt-1 text-sm text-muted-foreground">
        We'll ask you once, on Today, so what actually happened gets recorded while you still
        remember it.
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        {REVIEW_CHOICES.map((c) => (
          <Button
            key={c.label}
            type="button"
            size="sm"
            variant={value === c.days ? "secondary" : "outline"}
            aria-pressed={value === c.days}
            onClick={() => onChange(c.days)}
            data-testid={`${testIdPrefix}-${c.days ?? "none"}`}
          >
            {c.label}
          </Button>
        ))}
      </div>
    </fieldset>
  );
}
