/**
 * Prototype reference: /acreos-landing/sections-2.jsx → DayInLife (lines 6-72)
 *
 * Side-by-side comparison: a Tuesday before AcreOS vs with AcreOS.
 * Each column is a timeline of timestamped events. Foot rows summarize
 * the day's outcome — red for "before", green for "after".
 *
 * Voice is third-person/operator framing — describes the workday, not
 * the founder's life. Timeline events are calibrated to feel like a
 * real Tuesday for a working land operator.
 */

import { LANDING_COPY } from "./copy";

const BEFORE = [
  { t: "6:42 am", e: "11 unread texts from sellers waiting. Triage by hand." },
  { t: "8:15 am", e: "Pull comps for 3 leads in PropStream. Switch to spreadsheet." },
  { t: "9:30 am", e: "Skip-trace 14 owners. Half are duplicates from last month." },
  { t: "11:00 am", e: "Call Janet back. She sold to someone else yesterday." },
  { t: "1:20 pm", e: "Mail merge in Mailchimp. 8 mailers go to wrong addresses." },
  { t: "3:45 pm", e: "Update CRM by hand. Two callbacks slip through unlogged." },
  { t: "7:30 pm", e: "Borrower asks for a receipt. Hunt for it in Gmail until 9pm." },
  { t: "10:15 pm", e: "Tomorrow's mailing list still isn't comped." },
];

const AFTER = [
  { t: "6:42 am", e: "Open AcreOS. 14 replies overnight. 11 already drafted by Pax." },
  { t: "7:00 am", e: "Skim drafts. Send 9, edit 2, escalate 3 to call." },
  { t: "7:25 am", e: "22 leads comped overnight. 4 flagged as worth offering on." },
  { t: "8:30 am", e: "Three calls placed. Two seller meetings booked for Thursday." },
  { t: "10:00 am", e: "Tomorrow's mail reviewed and approved. 37 receipts sent overnight." },
  { t: "11:15 am", e: "Busy work done. Drive out to walk a parcel." },
  { t: "4:00 pm", e: "Sign two offers Pax drafted earlier in the day." },
  { t: "6:30 pm", e: "Dinner. AcreOS handles the rest of the queue." },
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
            <b>Result:</b> 3 deals closed. 2 missed because of slow replies. Burnout by Thursday.
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
            <b>Result:</b> 7 deals closed. 0 missed replies. Home for dinner.
          </div>
        </div>
      </div>
    </section>
  );
}
