/**
 * Positioning band — explicit, visible, between Hero and HowItWorks.
 *
 * Answers the first question every visitor has: "is this for me?"
 * Primary positioning is exclusive: built for Land Investors. The
 * other investor types are split honestly into two groups:
 *
 *   IN_PRODUCT  — core or beta maturity in shared/business-types.ts.
 *                 These operators can sign up today and find real
 *                 workflows, vocabulary, and deal tracking for their
 *                 specific way of operating. No CTAs — just named so
 *                 they know the platform sees them.
 *
 *   ROADMAP     — declared in the registry, UI suppressed. Named for
 *                 waitlist awareness, not active pitch.
 *
 * Copy comes from LANDING_COPY.positioning so both halves can be
 * adjusted in one place without touching this component.
 */

import { LANDING_COPY } from "./copy";

// Maturity verified against shared/business-types.ts on 2026-05-31.
// core:  note_investor, hybrid
// beta:  fix_and_flip, residential_wholesaler, subdivider, tax_lien_deed
const IN_PRODUCT_TYPES = [
  "Note investors",
  "Fix-and-flippers",
  "Wholesalers",
  "Subdividers",
  "Tax-delinquent buyers",
] as const;

// roadmap: buy_and_hold
const ROADMAP_TYPES = [
  "Buy-and-hold landlords",
] as const;

export function Positioning() {
  const c = LANDING_COPY.positioning;
  return (
    <section className="lp-positioning" aria-label="Who AcreOS is for">
      <div className="lp-positioning-inner">
        <div className="lp-positioning-primary">{c.primary}</div>
        <div className="lp-positioning-roadmap">{c.inProduct}</div>
        <ul
          className="lp-positioning-roadmap-list"
          aria-label="Investor types already in the product"
        >
          {IN_PRODUCT_TYPES.map((v) => (
            <li key={v} className="lp-positioning-roadmap-chip">
              {v}
            </li>
          ))}
        </ul>
        <div className="lp-positioning-roadmap lp-positioning-roadmap-footer">
          {c.roadmap}
        </div>
        <ul
          className="lp-positioning-roadmap-list lp-positioning-roadmap-list-muted"
          aria-label="Investor types on the roadmap"
        >
          {ROADMAP_TYPES.map((v) => (
            <li key={v} className="lp-positioning-roadmap-chip lp-positioning-roadmap-chip-muted">
              {v}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
