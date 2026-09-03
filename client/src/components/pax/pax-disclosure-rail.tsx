import { Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { PAX_STANDING_LINE } from "@shared/pax-glossary";

/**
 * PaxDisclosureRail — the standing, always-present "tool, not advisor" line on
 * the Pax surface.
 *
 * Why this exists
 * ───────────────
 * Our five-pillar doctrine's pillar #1 is "AcreOS is a tool, never an advisor,"
 * and customer immutable #7 is "always disclose AI use clearly." Both are
 * enforced server-side (the Pax post-validator even cites immutable #7 when it
 * catches a persona leak). But the primary conversational surface
 * (`client/src/pages/pax.tsx`) historically carried NO standing customer-visible
 * disclosure — only a one-time first-session greeting banner. This rail closes
 * the gap between our *enforced* posture and our *disclosed* posture: a quiet,
 * non-dismissible line that lives with the conversation every time it is open.
 *
 * Voice + a11y
 * ────────────
 * Calm, not nagging — single line, muted tokens, no close button (it is a
 * standing disclosure, not an alert to dismiss). Copy is sourced from a single
 * exported constant so the voice-linter and Risk can audit exactly one string.
 * Styling mirrors `disclaimer-banner.tsx` (muted surface, `Info` glyph,
 * `text-xs text-muted-foreground`) so it reads as part of the same family.
 */

/**
 * The Pax standing line (shared/pax-glossary.ts — the ONE file for every
 * customer-visible Pax string) plus the "verify" clause. Anyone revising the
 * "tool, not advisor" language touches the glossary, not this file.
 */
export const PAX_DISCLOSURE_COPY = `${PAX_STANDING_LINE} Verify before you act.`;

interface PaxDisclosureRailProps {
  className?: string;
}

export function PaxDisclosureRail({ className }: PaxDisclosureRailProps) {
  return (
    <div
      role="note"
      aria-label="AI disclosure: Pax is a tool, not an advisor"
      data-testid="pax-disclosure-rail"
      className={cn(
        "flex items-start gap-2 rounded-md bg-muted/50 border border-border/50 px-3 py-2",
        className,
      )}
    >
      <Info
        className="w-3.5 h-3.5 text-muted-foreground mt-0.5 flex-shrink-0"
        aria-hidden="true"
      />
      <p className="text-xs text-muted-foreground leading-snug">
        {PAX_DISCLOSURE_COPY}
      </p>
    </div>
  );
}
