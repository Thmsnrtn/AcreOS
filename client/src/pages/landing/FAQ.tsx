/**
 * Prototype reference: /acreos-landing/sections-3.jsx → FAQ (lines 118-149)
 *
 * Accordion with 8 items. Single-open behavior (clicking another item
 * closes the previous). First item open by default. Plus/minus icon
 * rotates between collapsed and expanded; brand color when expanded.
 */

import { useState } from "react";
import { LANDING_COPY } from "./copy";

const ITEMS = [
  {
    q: "Can existing lists be imported?",
    a: "Yes. AcreOS imports CSVs from PropStream, REISift, Pebble, DataTree, or any source, and dedupes against owners already mailed.",
  },
  {
    q: "Where does the data come from?",
    a: "County assessors, recorder offices, and licensed parcel datasets in all 50 states. We disclose the source on every Atlas analysis.",
  },
  {
    q: "Can I turn off the AI agents?",
    a: "Yes. Each agent has its own autonomy slider — Off, Suggest, Review-then-send, or Auto-send. Default is Suggest. You're always in control.",
  },
  {
    q: "Does this replace my CRM?",
    a: "Yes. AcreOS includes a CRM purpose-built for land — pipeline stages, contact records, callback queues, and Pax inbox in one place.",
  },
  {
    q: "What about existing notes / loans?",
    a: "AcreOS imports and services notes from Beanstalk, Note Servicing Center, or a CSV. Migration support is included on a 30-min call.",
  },
  {
    q: "Can I use this with a partner or VA?",
    a: "Yes. Pro and Scale plans include multi-user with role-based permissions — your VA can't see financials unless you grant it.",
  },
  {
    q: "How fast can I get started?",
    a: "Same day. Define your buy-box in 4 minutes, and your first list pulls overnight. Mail can go out the next morning.",
  },
  {
    q: "What happens on cancel?",
    a: "Export everything to CSV in one click. No data hostage-taking — AcreOS retains nothing after cancellation.",
  },
];

export function FAQ() {
  const c = LANDING_COPY.faq;
  const [openIdx, setOpenIdx] = useState<number | null>(0);

  return (
    <section className="lp-section" id="faq">
      <div className="lp-eyebrow">{c.eyebrow}</div>
      <h2 className="lp-section-title">{c.title}</h2>
      <div className="lp-faq-list">
        {ITEMS.map((it, i) => {
          const open = openIdx === i;
          return (
            <div key={i} className={`lp-faq-item ${open ? "lp-faq-open" : ""}`}>
              <button
                className="lp-faq-q"
                onClick={() => setOpenIdx(open ? null : i)}
                aria-expanded={open}
                aria-controls={`faq-a-${i}`}
              >
                <span>{it.q}</span>
                <span className="lp-faq-icon" aria-hidden="true">
                  {open ? "–" : "+"}
                </span>
              </button>
              {open && (
                <div id={`faq-a-${i}`} className="lp-faq-a">
                  {it.a}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
