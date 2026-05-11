/**
 * Positioning band — explicit, visible, between Hero and HowItWorks.
 *
 * Answers the first question every visitor has: "is this for me?"
 * Primary positioning is exclusive: built for Land Investors. Roadmap
 * framing keeps the other verticals visible (note investors,
 * fix-and-flippers, etc.) without diluting focus or letting the
 * landing read as "the all-in-one suite for real estate investors."
 *
 * Copy comes from LANDING_COPY.positioning so both halves can be
 * adjusted in one place.
 */

import { LANDING_COPY } from "./copy";

export function Positioning() {
  const c = LANDING_COPY.positioning;
  return (
    <section className="lp-positioning" aria-label="Who AcreOS is for">
      <div className="lp-positioning-inner">
        <div className="lp-positioning-primary">{c.primary}</div>
        <div className="lp-positioning-roadmap">{c.roadmap}</div>
      </div>
    </section>
  );
}
