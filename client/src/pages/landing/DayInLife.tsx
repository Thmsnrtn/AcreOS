/**
 * Prototype reference: /acreos-landing/sections-2.jsx → DayInLife (lines 6-72)
 *
 * Side-by-side comparison: a Tuesday before AcreOS vs with AcreOS.
 * Each column is a timeline of timestamped events. Foot rows summarize
 * the day's outcome — red for "before", green for "after".
 *
 * Voice is third-person/operator framing — describes the workday, not
 * the founder's life. Timeline events are calibrated to feel like a
 * real Tuesday for a working real-estate operator — equally true for
 * a land flipper, a note buyer, or a fix-and-flipper. The events are
 * intentionally vertical-agnostic; per-vertical "day in the life"
 * variants live on the future /verticals/<slug> pages.
 */

import { LANDING_COPY } from "./copy";

const BEFORE = [
  { t: "6:42 am", e: "11 unread seller texts. Sorted manually across SMS, Gmail, and CRM." },
  { t: "8:15 am", e: "Comps pulled for 3 leads in PropStream. Exported to spreadsheet." },
  { t: "9:30 am", e: "14 owners skip-traced. Duplicates from prior batches not flagged." },
  { t: "11:00 am", e: "Follow-up call to a 4-day-old lead. No status logged in CRM." },
  { t: "1:20 pm", e: "Mail merge run in Mailchimp. 8 mailers bounce — address column misaligned." },
  { t: "3:45 pm", e: "CRM updated by hand. 2 callbacks logged from memory; 1 missed." },
  { t: "7:30 pm", e: "Borrower receipt search across Gmail threads. Found after 90 minutes." },
  { t: "10:15 pm", e: "Tomorrow's mailing list still not comped or deduped." },
];

const AFTER = [
  { t: "6:42 am", e: "Inbox opens to 14 overnight replies. 11 drafted by Pax, queued for review." },
  { t: "7:00 am", e: "Drafts triaged in one view. 9 sent, 2 edited, 3 escalated — all logged." },
  { t: "7:25 am", e: "22 leads comped overnight. 4 surfaced as in-buy-box with confidence scores." },
  { t: "8:30 am", e: "3 calls placed from the lead queue. 2 meetings booked into calendar automatically." },
  { t: "10:00 am", e: "Tomorrow's mail batch reviewed and approved. 37 servicing receipts sent overnight." },
  { t: "11:15 am", e: "Inbox at zero. Pipeline state current. Operator capacity freed for field work." },
  { t: "4:00 pm", e: "2 offers signed from Pax-drafted templates. Audit log captures source data." },
  { t: "6:30 pm", e: "Background queue continues: comps, drafts, receipts, follow-ups." },
];

export function DayInLife() {
  const c = LANDING_COPY.day;
  return (
    <section className="lp-section lp-day" id="day">
      <div className="lp-eyebrow">{c.eyebrow}</div>
      <h2 className="lp-section-title">{c.title}</h2>
      <p className="lp-section-sub">{c.sub}</p>

      <div className="lp-day-grid">
        <div className="lp-day-col lp-day-before">
          <div className="lp-day-col-head">
            <span className="lp-day-col-label">Before AcreOS</span>
            <span className="lp-day-col-meta">~62 hr week</span>
          </div>
          {BEFORE.map((x, i) => (
            <div key={i} className="lp-day-row">
              <span className="lp-day-time">{x.t}</span>
              <span className="lp-day-event">{x.e}</span>
            </div>
          ))}
          <div className="lp-day-foot lp-day-foot-bad">
            <b>Result:</b> 7 tools touched. 4 manual handoffs. Pipeline state updated after-hours.
          </div>
        </div>

        <div className="lp-day-col lp-day-after">
          <div className="lp-day-col-head">
            <span className="lp-day-col-label lp-day-col-label-after">With AcreOS</span>
            <span className="lp-day-col-meta">~22 hr week</span>
          </div>
          {AFTER.map((x, i) => (
            <div key={i} className="lp-day-row">
              <span className="lp-day-time">{x.t}</span>
              <span className="lp-day-event">{x.e}</span>
            </div>
          ))}
          <div className="lp-day-foot lp-day-foot-good">
            <b>Result:</b> One tool. Zero manual sync. Pipeline state current as of last action.
          </div>
        </div>
      </div>
    </section>
  );
}
