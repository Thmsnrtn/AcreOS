/**
 * Positioning band — explicit, visible, between Hero and HowItWorks.
 *
 * Answers the first question every visitor has: "is this for me?"
 * Primary positioning is exclusive: built for Land Investors. The
 * other investor types split into three tiers, each carrying its
 * honest maturity signal:
 *
 *   CORE     — Note Investor. Full workflow templates, Finance hero,
 *              complete Pax vocabulary. Solid chip, no qualifier needed.
 *
 *   BETA     — Fix-and-flippers, Wholesalers, Tax-delinquent buyers.
 *              Real pages and workflows — the outer shell is still
 *              maturing. Chip shows a "Beta" micro-label so a first-time
 *              visitor isn't surprised by gaps. (DriveMode and
 *              CourthouseMode routes are being wired by Iris; the
 *              underlying features exist.)
 *
 *   ROADMAP  — Subdividers (parcel editor + CC&R templates exist but
 *              Finance and Pax integration are land-investor generic —
 *              too thin to call beta), Buy-and-hold landlords (declared
 *              in registry, UI suppressed). Muted chips signal waitlist
 *              awareness, not an active pitch.
 *
 * Maturity verdicts from Rafe Castellan's verification report (2026-06-01)
 * and shared/business-types.ts. The landing can be more conservative than
 * the code declaration — Subdivider is "beta" in the registry but is shown
 * here as roadmap because the Finance and Pax gaps make it dishonest to
 * market as functional to a first-time visitor.
 *
 * Copy comes from LANDING_COPY.positioning so both halves can be
 * adjusted in one place without touching this component.
 */

import { LANDING_COPY } from "./copy";

// Maturity verified against Rafe CCO report 2026-06-01 + business-types.ts.
// core:    note_investor (full workflow; Finance hero; Pax complete)
const CORE_TYPES = [
  "Note investors",
] as const;

// beta:    fix_and_flip, residential_wholesaler, tax_lien_deed
// (Real workflows + onboarding; DriveMode/CourthouseMode routing pending Iris)
const BETA_TYPES = [
  "Fix-and-flippers",
  "Wholesalers",
  "Tax-delinquent buyers",
] as const;

// roadmap: subdivider (shakiest — Finance generic, Pax falls to developer),
//          buy_and_hold (UI suppressed in registry)
const ROADMAP_TYPES = [
  "Subdividers",
  "Buy-and-hold landlords",
] as const;

export function Positioning() {
  const c = LANDING_COPY.positioning;
  return (
    <section className="lp-positioning" aria-label="Who AcreOS is for">
      <div className="lp-positioning-inner">
        <div className="lp-positioning-primary">{c.primary}</div>
        <div className="lp-positioning-roadmap">{c.inProduct}</div>

        {/* Core tier — solid chips, no qualifier */}
        <ul
          className="lp-positioning-roadmap-list"
          aria-label="Investor types with full workflow support"
        >
          {CORE_TYPES.map((v) => (
            <li key={v} className="lp-positioning-roadmap-chip lp-positioning-chip-core">
              {v}
            </li>
          ))}
        </ul>

        {/* Beta tier — lighter chips with "Beta" micro-label */}
        <ul
          className="lp-positioning-roadmap-list lp-positioning-list-beta"
          aria-label="Investor types in beta"
        >
          {BETA_TYPES.map((v) => (
            <li key={v} className="lp-positioning-roadmap-chip lp-positioning-chip-beta">
              {v}
              <span className="lp-positioning-chip-badge" aria-label="Beta">Beta</span>
            </li>
          ))}
        </ul>

        {/* Roadmap tier — muted chips */}
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
