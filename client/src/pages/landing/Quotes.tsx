/**
 * Prototype reference: /acreos-landing/sections-2.jsx → Quotes (lines 136-169)
 *
 * Six testimonial cards in 3-column grid (2 at <1080px, 1 at <720px).
 * Each card: large brand-color decorative quote-mark in upper right,
 * 16px serif-flavored body text, divider, avatar circle + name + role.
 * Avatars use the first letter of the testimonial name on a tan
 * surface-2 background.
 *
 * Quotes are verbatim from the prototype — these are real beta-cohort
 * voices the founder collected; no editing.
 */

import { LANDING_COPY } from "./copy";

const QUOTES = [
  {
    q: "Pax replied to a seller in 90 seconds at 11pm on a Sunday. We closed that deal Tuesday. That single deal paid for AcreOS for two years.",
    n: "Marcus K.",
    r: "Solo investor · Texas",
  },
  {
    q: "I used to spend Sundays running comps. Now Atlas hands me a list of 5 worth offering on. I get my Sunday back.",
    n: "Janelle R.",
    r: "Partner-led, 3-person team · AZ + NM",
  },
  {
    q: "The audit log is the killer feature. Every action my agents take, I can see why. No black box.",
    n: "David O.",
    r: "Investor + lender · 80 active notes",
  },
  {
    q: "I came over from REISift + Pebble + Mailchimp + a spreadsheet. AcreOS replaced all four. The bill went down, the deals went up.",
    n: "Tasha B.",
    r: "Full-time investor · CO",
  },
  {
    q: "Sophie services my notes better than I did. I used to miss late payments by a week.",
    n: "Roy G.",
    r: "Seller-finance investor · 60+ notes",
  },
  {
    q: "Thomas wrote me back at 10pm with a feature in production a week later. That doesn't happen with normal SaaS.",
    n: "Anya S.",
    r: "New investor · 6 months in",
  },
];

export function Quotes() {
  const c = LANDING_COPY.quotes;
  return (
    <section className="lp-section" id="quotes">
      <div className="lp-eyebrow">{c.eyebrow}</div>
      <h2 className="lp-section-title">{c.title}</h2>

      <div className="lp-quotes-grid">
        {QUOTES.map((q, i) => (
          <figure key={i} className="lp-quote-card">
            <div className="lp-quote-mark" aria-hidden="true">
              {"“"}
            </div>
            <blockquote className="lp-quote-text">{q.q}</blockquote>
            <figcaption className="lp-quote-foot">
              <div className="lp-quote-avatar">{q.n[0]}</div>
              <div>
                <div className="lp-quote-name">{q.n}</div>
                <div className="lp-quote-role">{q.r}</div>
              </div>
            </figcaption>
          </figure>
        ))}
      </div>
    </section>
  );
}
