/**
 * MorningBrief — single paragraph above the Decision Queue (Chesky).
 *
 * Replaces the Pax autonomy slider that previously occupied the same slot.
 * The slider was a monthly-tune control, not a daily-use one — it now lives
 * at /settings/pax. This surface gives the user a calm, persona-typed
 * read-out of "what happened overnight" before they dive into decisions.
 *
 * Server composes the brief (see server/routes-today.ts → composeBrief);
 * we just present the string with the right rhythm + a subtle Pax-controls
 * link in the footer for users who want to tune the threshold.
 *
 * The Pax heartbeat (6px brand-dot pulse, 2.4s period) is rendered next to
 * the word "Pax" — this is the FIRST appearance of Pax on Today, so per the
 * design rule the heartbeat shows here and nowhere else on the page.
 */
import { Link } from "wouter";

interface MorningBriefProps {
  brief: string | null;
}

export function MorningBrief({ brief }: MorningBriefProps) {
  if (!brief) return null;
  return (
    <section
      aria-label="Morning brief"
      data-testid="section-morning-brief"
      className="rounded-card border border-[color:var(--acr-line-soft)] bg-acr-surface p-4 md:p-5"
    >
      <div className="flex items-center gap-2 mb-1.5">
        <span
          className="acr-pax-heartbeat"
          aria-hidden="true"
          data-testid="pax-heartbeat"
        />
        <span className="acr-eyebrow">Pax · Morning brief</span>
      </div>
      <p className="text-[15px] leading-relaxed text-acr-ink-2 max-w-prose">
        {brief}
      </p>
      <div className="mt-2">
        <Link
          href="/settings/pax"
          className="text-xs text-acr-ink-3 hover:text-acr-brand underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
          data-testid="link-pax-controls-from-brief"
        >
          Pax controls →
        </Link>
      </div>
    </section>
  );
}
