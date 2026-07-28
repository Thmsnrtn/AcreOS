/**
 * LetterTrackRecord — the Letter's collapsed-by-default track-record card
 * (trust audit, 2026-07-28).
 *
 * The brief API already computed the trust ledger, calibration and learning
 * evidence — this card finally RENDERS it instead of dropping it. Doctrine:
 *   - Collapsed by default ("Track record — tap to open"): a weekly-cadence
 *     read, never a daily indictment.
 *   - Every line arrives pre-worded from the server (narrate.ts) where the
 *     small-n guard lives ("Too early to score…") — this component never
 *     re-words, never softens, never adds a number of its own.
 *   - A piece with no real data renders NOTHING — no padding, no guessed
 *     green.
 */
import { useState } from "react";
import { ChevronDown, ChevronRight, Scale } from "lucide-react";

export interface TrackRecordEntry {
  domain: string;
  n: number;
  good: number;
  bad: number;
  /** Pre-worded server-side (narrate.trackRecordLine) — rendered verbatim. */
  line: string;
}

export interface TrustLedgerEntry {
  domain: string;
  level: string;
  cleanCycleCount: number;
  threshold: number;
}

// Plain words for the autonomy levels — never render the raw enum at a CEO.
const LEVEL_WORDS: Record<string, string> = {
  observe: "watching only — it takes no actions itself",
  draft: "drafting — it prepares work for your approval",
  execute_gated: "acting, with each step checked",
  autonomous_gated: "acting on its own, within set limits",
};

function trustLine(t: TrustLedgerEntry): string {
  const words = LEVEL_WORDS[t.level] ?? t.level;
  const cap = t.domain.length ? t.domain[0].toUpperCase() + t.domain.slice(1) : t.domain;
  return `${cap} is ${words}; ${t.cleanCycleCount} of ${t.threshold} clean runs toward the next step.`;
}

export function LetterTrackRecord({
  trackRecord,
  trustLedger,
  calibrationLine,
  learningLines,
}: {
  trackRecord: TrackRecordEntry[];
  trustLedger: TrustLedgerEntry[];
  calibrationLine: string | null;
  learningLines: string[];
}) {
  const [open, setOpen] = useState(false);
  const hasAnything =
    trackRecord.length > 0 ||
    trustLedger.length > 0 ||
    calibrationLine != null ||
    learningLines.length > 0;
  // Nothing real to show → render nothing at all (never an empty shell).
  if (!hasAnything) return null;

  return (
    <div className="rounded-lg border border-border bg-card" data-testid="letter-track-record">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 rounded-lg p-3 text-left text-sm font-medium hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        data-testid="letter-track-record-toggle"
      >
        <Scale className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="min-w-0 flex-1">
          {open ? "Track record — tap to close" : "Track record — tap to open"}
        </span>
        {open ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        )}
      </button>

      {open && (
        <div className="space-y-4 border-t border-border p-3">
          {trackRecord.length > 0 && (
            <section>
              <h3 className="text-xs font-medium text-muted-foreground">What I've done, and how it went</h3>
              <ul role="list" className="mt-1.5 space-y-1">
                {trackRecord.map((t) => (
                  <li key={t.domain} className="text-sm text-foreground">
                    {t.line}
                  </li>
                ))}
              </ul>
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                Counted from recorded outcomes — your own verdicts where you gave one, otherwise
                automatic checks. Nothing here is estimated.
              </p>
            </section>
          )}

          {trustLedger.length > 0 && (
            <section>
              <h3 className="text-xs font-medium text-muted-foreground">How much rope each area has earned</h3>
              <ul role="list" className="mt-1.5 space-y-1">
                {trustLedger.map((t) => (
                  <li key={t.domain} className="text-sm text-foreground">
                    {trustLine(t)}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {calibrationLine != null && (
            <section>
              <h3 className="text-xs font-medium text-muted-foreground">How good my own predictions are</h3>
              <p className="mt-1.5 text-sm text-foreground">{calibrationLine}</p>
            </section>
          )}

          {learningLines.length > 0 && (
            <section>
              <h3 className="text-xs font-medium text-muted-foreground">What's been working</h3>
              <ul role="list" className="mt-1.5 space-y-1">
                {learningLines.map((line, i) => (
                  <li key={i} className="text-sm text-foreground">
                    {line}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
