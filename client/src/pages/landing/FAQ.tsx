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
    // Named four vendors, of which REISift and Pebble appear nowhere else in
    // this repository — the import path has no preset for ANY vendor. It is a
    // generic header map (LEAD_COLUMN_MAP) offered to the customer as
    // `columnHints`, plus a user-supplied fieldMap for whatever it did not
    // recognise (server/services/importExport.ts, server/routes-import-export
    // .ts). "Dedupes against owners already mailed" was also more than the
    // code does: findDuplicateLeads matches on name / email / phone / address
    // against leads you already have, with no reference to mail history.
    // Naming a system on a public page is read as "tested with my data"
    // (2026-09-04 review); the mechanism below is both true and stronger.
    a: "Yes. Import a CSV from any source — a skip-trace export, a county list, a plain spreadsheet. AcreOS recognizes the common column headers, lets you map the rest as you import, and skips contacts already in your pipeline.",
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
    // "Beanstalk" and "Note Servicing Center" appeared in this sentence and
    // NOWHERE else in client/, server/ or shared/ — there is no importer, no
    // preset and no integration for either. The CSV half is real and well
    // built (importNotesFromCSV / importAcquiredNotesFromCSV, NOTE_COLUMN_MAP
    // served as columnHints, a user fieldMap, and a Reg-Z §1026.43 gate on
    // originated notes), so it is what the answer now describes.
    // "Migration support is included on a 30-min call" is an unbounded human
    // commitment nothing in the product schedules or tracks; it is removed
    // rather than replaced with a different promise (2026-09-04 review).
    a: "Import them from a CSV — originated and purchased notes each have their own import, with the common columns recognized and the rest mapped as you go. From there AcreOS carries the loan: balances, posted payments, and the borrower record.",
  },
  {
    q: "Can a partner or assistant share access?",
    a: "Yes. Pro and Scale plans include multi-user with role-based permissions — a teammate can't see financials unless explicitly granted.",
  },
  {
    q: "How fast can a new operator get started?",
    // "Define the buy-box, and the first list pulls overnight" described an
    // engine that does not exist. There is no buy-box scan anywhere in
    // server/jobs or server/services, and countyAssessorIngestJob — the
    // county-list worker — is exported and never called, so no scheduled list
    // pull runs for a customer. copy.ts's own truth-note (lines 42-56) had
    // already retired the sibling "Monday at 6am" sentence for exactly this
    // reason; this one survived it.
    // What genuinely runs on a schedule: lead nurturing scores and stages
    // leads behind the org's leadScoring switch (server/jobs/leadCampaignJobs
    // .ts, both stances, pause-aware), and sequenceProcessor sends the drips
    // you turned on (runScheduledJobs.ts:291). Both are "rules you turned on
    // run by themselves"; messages still wait for a tap.
    a: "Same day. Import your first list and the rules you've switched on start working it — scoring and staging happen without you. Drips you turn on send on their own schedule. Every message Pax writes still waits for your tap.",
  },
  {
    q: "What happens on cancel?",
    // "AcreOS retains nothing after cancellation" was false and contradicted
    // this company's own binding privacy policy, which states 90 days for
    // account and lead data and seven years for financial records
    // (client/src/pages/privacy.tsx retention table). The deletion routine
    // agrees: server/services/orgDeletion.ts retains audit_events under GDPR
    // Art. 17(3)(b) and detaches rather than deletes the financial ledger.
    // A public promise the product cannot keep is the one kind of copy this
    // repo may never ship (2026-09-04 review).
    a: "Export everything to CSV in one click — leads, properties, deals and notes, or a full backup. No data hostage-taking. After you cancel, your account and lead data are deleted within 90 days; financial records are kept for seven years because lending regulation requires it.",
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
