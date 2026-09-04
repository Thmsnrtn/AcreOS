/**
 * Prototype reference: /acreos-landing/sections-2.jsx → Quotes (lines 136-169)
 *
 * Replaces the prior testimonial grid with a set of product-mechanic
 * statements. With a small founding cohort, testimonial-style social
 * proof anti-sells on a public landing page. Each card describes one
 * concrete thing the system does, anchored to a verb and a visible
 * artifact (draft, log, alert, file).
 *
 * The card layout, decorative quote-mark glyph, divider, and avatar
 * circle are retained — the avatar now carries a short token mark
 * ("PAX", "LOG", etc.) instead of an initial, since these are not
 * person-quotes.
 */

import { LANDING_COPY } from "./copy";

type MechCard = {
  /** Single-sentence mechanic statement, in third-person. */
  q: string;
  /** Short scope label (e.g. "Lead reply pipeline"). */
  n: string;
  /** Surface or artifact the mechanic produces. */
  r: string;
  /** Short numeric/glyph token rendered in the card's avatar circle. */
  tag: string;
};

const MECHANICS: MechCard[] = [
  {
    q: "One tap on any inbound message drafts the reply — reviewed by the operator before anything sends.",
    n: "Lead reply pipeline",
    r: "Inbox → Pax draft on demand",
    tag: "01",
  },
  {
    q: "Comps pulled, scored, and ranked overnight against the operator's buy-box. In-box leads surfaced by morning.",
    n: "Overnight comp run",
    r: "Lead list → ranked queue",
    tag: "02",
  },
  {
    // activity_log carries userId / teamMemberId for a person and agentType for
    // Pax, so the attribution named here is the one the row actually holds.
    q: "Every deal traced from first touch to closed file — parcels by APN, notes by loan number, rehabs by property ID. Each action timestamped and attributed to the person who did it, or to Pax.",
    n: "Deal audit trail",
    r: "Per-deal activity log",
    tag: "03",
  },
  {
    q: "Mailers merged from the lead list with address validation and deduplication before send. Bounces logged back to the lead record.",
    n: "Mail campaigns",
    r: "Lead list → print queue",
    tag: "04",
  },
  {
    q: "Notes serviced on schedule: receipts generated, late payments flagged, borrower statements produced at month-end.",
    n: "Note servicing",
    r: "Note ledger → receipts",
    tag: "05",
  },
  {
    q: "Pipeline state visible from one screen. Stage transitions, callbacks, and offers logged without manual data entry.",
    n: "Pipeline view",
    r: "All-deal status board",
    tag: "06",
  },
];

export function Quotes() {
  const c = LANDING_COPY.quotes;
  return (
    <section className="lp-section" id="quotes">
      <div className="lp-eyebrow">{c.eyebrow}</div>
      <h2 className="lp-section-title">{c.title}</h2>

      <div className="lp-quotes-grid">
        {MECHANICS.map((m, i) => (
          <figure key={i} className="lp-quote-card">
            <div className="lp-quote-mark" aria-hidden="true">
              {"“"}
            </div>
            <blockquote className="lp-quote-text">{m.q}</blockquote>
            <figcaption className="lp-quote-foot">
              <div className="lp-quote-avatar">{m.tag}</div>
              <div>
                <div className="lp-quote-name">{m.n}</div>
                <div className="lp-quote-role">{m.r}</div>
              </div>
            </figcaption>
          </figure>
        ))}
      </div>
    </section>
  );
}
