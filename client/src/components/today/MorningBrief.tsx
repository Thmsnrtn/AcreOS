/**
 * MorningBrief — collapsed preamble above the Decision Queue (Tier 3C).
 *
 * Originally a always-expanded paragraph card (Chesky); now a one-line
 * collapsed disclosure so the brief frames the queue without competing with
 * it. The full text is one tap/click/Enter away; the collapsed line shows
 * the start of the brief so the surface still carries signal at rest.
 *
 * Server composes the brief (see server/routes-today.ts → composeBrief);
 * this component only presents it. Not a separate destination — it lives
 * directly above the queue as its preamble.
 *
 * The Pax heartbeat (6px brand-dot pulse, 2.4s period) is rendered next to
 * the word "Pax" — this is the FIRST appearance of Pax on Today, so per the
 * design rule the heartbeat shows here and nowhere else on the page.
 */
import { useState } from "react";
import { Link } from "wouter";
import { ChevronDown } from "lucide-react";

interface MorningBriefProps {
  brief: string | null;
}

export function MorningBrief({ brief }: MorningBriefProps) {
  const [expanded, setExpanded] = useState(false);
  if (!brief) return null;
  const contentId = "morning-brief-content";
  return (
    <section
      aria-label="Morning brief"
      data-testid="section-morning-brief"
      className="rounded-card border border-[color:var(--acr-line-soft)] bg-acr-surface"
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-controls={contentId}
        data-testid="button-morning-brief-toggle"
        className="w-full flex items-center gap-2 p-4 md:p-3.5 text-left min-h-11 sm:min-h-9 rounded-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span
          className="acr-pax-heartbeat shrink-0"
          aria-hidden="true"
          data-testid="pax-heartbeat"
        />
        <span className="acr-eyebrow shrink-0">Pax · Morning brief</span>
        {!expanded && (
          <span className="text-sm text-acr-ink-3 truncate min-w-0 flex-1" aria-hidden="true">
            {brief}
          </span>
        )}
        <ChevronDown
          className={`w-4 h-4 text-acr-ink-3 shrink-0 ml-auto transition-transform ${expanded ? "rotate-180" : ""}`}
          aria-hidden="true"
        />
      </button>
      {expanded && (
        <div id={contentId} className="px-4 pb-4 md:px-3.5 md:pb-3.5">
          <p className="text-[15px] leading-relaxed text-acr-ink-2 max-w-prose">
            {brief}
          </p>
          <div className="mt-2">
            <Link
              href="/settings/pax"
              className="inline-flex min-h-11 items-center px-2 -mx-2 -my-3 text-xs text-acr-ink-3 hover:text-acr-brand active:text-acr-brand underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
              data-testid="link-pax-controls-from-brief"
            >
              Pax controls →
            </Link>
          </div>
        </div>
      )}
    </section>
  );
}
