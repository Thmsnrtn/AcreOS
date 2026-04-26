/**
 * Prototype reference: /acreos-landing/sections-2.jsx → DayInLife (lines 6-72)
 *
 * Side-by-side comparison: a Tuesday before AcreOS vs with AcreOS.
 * Each column is a timeline of timestamped events. Foot rows summarize
 * the day's outcome — red for "before", green for "after".
 *
 * The narrative is the founder's lived experience (200 deals closed,
 * last 50 on AcreOS) translated into a representative day. Don't edit
 * the timeline events — they're calibrated to feel like a real Tuesday,
 * not a marketing fantasy.
 */

import { LANDING_COPY } from "./copy";

const BEFORE = [
  { t: "6:42 am", e: "Wake up. 11 unread texts from sellers. Start triaging." },
  { t: "8:15 am", e: "Pull comps for 3 leads in PropStream. Switch to spreadsheet." },
  { t: "9:30 am", e: "Skip-trace 14 owners. Half are duplicates from last month." },
  { t: "11:00 am", e: "Call Janet back. She sold to someone else yesterday." },
  { t: "1:20 pm", e: "Mail merge in Mailchimp. Realize 8 mailers went to wrong addresses." },
  { t: "3:45 pm", e: "Update CRM by hand. Forget to log two callbacks." },
  { t: "7:30 pm", e: "Borrower emails about a payment receipt. Find it in Gmail at 9pm." },
  { t: "10:15 pm", e: "Realize you didn't comp tomorrow's mailing list yet." },
];

const AFTER = [
  { t: "6:42 am", e: "Open AcreOS. 14 replies overnight. 11 already drafted by Pax." },
  { t: "7:00 am", e: "Skim drafts. Send 9, edit 2, escalate 3 to call." },
  { t: "7:25 am", e: "Atlas has comped 22 leads. 4 flagged as worth your time." },
  { t: "8:30 am", e: "Make 3 calls. Two seller meetings booked for Thursday." },
  { t: "10:00 am", e: "Review tomorrow's mail. Approve. Sophie sent 37 receipts overnight." },
  { t: "11:15 am", e: "Done with the busy work. Drive out to walk a parcel." },
  { t: "4:00 pm", e: "Sign two offers Pax drafted while you were on the road." },
  { t: "6:30 pm", e: "Family dinner. AcreOS handles the rest." },
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
            <b>Result:</b> 3 deals closed. 2 missed because of slow replies. Burned out by Thursday.
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
            <b>Result:</b> 7 deals closed. 0 missed replies. Home for dinner every night.
          </div>
        </div>
      </div>
    </section>
  );
}
