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
    a: "County assessors, recorder offices, and licensed parcel datasets in all 50 states. We disclose the source on every Pax analysis.",
  },
  {
    q: "Can the AI assistant be turned off?",
    a: "Yes. Pause everything with one tap, or set Pax to ask before it changes anything. Pax never sends a message to anyone until you tap Approve.",
  },
  {
    q: "Does this replace an existing CRM?",
    a: "Yes. AcreOS includes a CRM purpose-built for property investing — pipeline stages, contact records, callback queues, and a lead inbox with Pax drafts in one place.",
  },
  {
    q: "What about existing notes and loans?",
    a: "AcreOS imports and services notes from Beanstalk, Note Servicing Center, or a CSV. Migration support is included on a 30-min call.",
  },
  {
    q: "Can a partner or assistant share access?",
    a: "Yes. Pro and Scale plans include multi-user with role-based permissions — a teammate can't see financials unless explicitly granted.",
  },
  {
    q: "How fast can a new operator get started?",
    a: "Same day. Define the buy-box, and the first list pulls overnight. Mail can go out the next morning.",
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
              {/* Heading wrapper gives screen-reader users a navigable
                  h3 per question (h2 section title → h3 questions);
                  visual styling lives entirely on the button. */}
              <h3 className="lp-faq-h">
                <button
                  type="button"
                  id={`faq-q-${i}`}
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
              </h3>
              {open && (
                <div
                  id={`faq-a-${i}`}
                  role="region"
                  aria-labelledby={`faq-q-${i}`}
                  className="lp-faq-a"
                >
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
