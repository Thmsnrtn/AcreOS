/**
 * Positioning band — explicit, visible, between Hero and HowItWorks.
 *
 * Answers the first question every visitor has: "is this for me?"
 * Primary positioning is exclusive: built for Land Investors. The
 * other six verticals are roadmap-framed below, no CTAs — they're
 * named so adjacent operators know we see them, not pitched.
 *
 * Copy comes from LANDING_COPY.positioning so both halves can be
 * adjusted in one place.
 */

import { LANDING_COPY } from "./copy";

const ROADMAP_VERTICALS = [
  "Note investors",
  "Fix-and-flippers",
  "Wholesalers",
  "Subdividers",
  "Tax-delinquent buyers",
  "Buy-and-hold landlords",
] as const;

export function Positioning() {
  const c = LANDING_COPY.positioning;
  return (
    <section className="lp-positioning" aria-label="Who AcreOS is for">
      <div className="lp-positioning-inner">
        <div className="lp-positioning-primary">{c.primary}</div>
        <div className="lp-positioning-roadmap">{c.roadmap}</div>
        <ul
          className="lp-positioning-roadmap-list"
          aria-label="Verticals on the roadmap"
        >
          {ROADMAP_VERTICALS.map((v) => (
            <li key={v} className="lp-positioning-roadmap-chip">
              {v}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
