// acreos-landing/sections-2.jsx
// Day in life · Features · Quotes

const { useState: useState2 } = React;

// ─────────────────────────────────────────────────────────── DAY IN LIFE
function DayInLife({ copy }) {
  const c = copy.day;

  const before = [
    { t: '6:42 am', e: 'Wake up. 11 unread texts from sellers. Start triaging.' },
    { t: '8:15 am', e: 'Pull comps for 3 leads in PropStream. Switch to spreadsheet.' },
    { t: '9:30 am', e: 'Skip-trace 14 owners. Half are duplicates from last month.' },
    { t: '11:00 am', e: 'Call Janet back. She sold to someone else yesterday.' },
    { t: '1:20 pm', e: 'Mail merge in Mailchimp. Realize 8 mailers went to wrong addresses.' },
    { t: '3:45 pm', e: 'Update CRM by hand. Forget to log two callbacks.' },
    { t: '7:30 pm', e: 'Borrower emails about a payment receipt. Find it in Gmail at 9pm.' },
    { t: '10:15 pm', e: 'Realize you didn\'t comp tomorrow\'s mailing list yet.' },
  ];

  const after = [
    { t: '6:42 am', e: 'Open AcreOS. 14 replies overnight. 11 already drafted by Pax.' },
    { t: '7:00 am', e: 'Skim drafts. Send 9, edit 2, escalate 3 to call.' },
    { t: '7:25 am', e: 'Atlas has comped 22 leads. 4 flagged as worth your time.' },
    { t: '8:30 am', e: 'Make 3 calls. Two seller meetings booked for Thursday.' },
    { t: '10:00 am', e: 'Review tomorrow\'s mail. Approve. Sophie sent 37 receipts overnight.' },
    { t: '11:15 am', e: 'Done with the busy work. Drive out to walk a parcel.' },
    { t: '4:00 pm', e: 'Sign two offers Pax drafted while you were on the road.' },
    { t: '6:30 pm', e: 'Family dinner. AcreOS handles the rest.' },
  ];

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
          {before.map((x, i) => (
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
          {after.map((x, i) => (
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

// ─────────────────────────────────────────────────────────── FEATURES
function Features({ copy }) {
  const c = copy.features;
  const features = [
    { cat: 'Find', t: 'Buy-box agent', d: 'Define your criteria once. AcreOS watches every parcel listing in your counties — forever.', i: 'box' },
    { cat: 'Find', t: 'Pulled lists', d: 'Skip-traced, deduped, sorted by likelihood. Ready every Monday morning.', i: 'list' },
    { cat: 'Analyze', t: 'Atlas comps', d: 'Real comparable sales, not Zillow guesses. With confidence scores.', i: 'scale' },
    { cat: 'Analyze', t: 'Parcel intel', d: 'Wetlands, easements, access, soil, slope. All on one screen.', i: 'satellite' },
    { cat: 'Reach', t: 'Mail platform', d: 'Multi-touch campaigns. Tracked. A/B tested. Full creative control.', i: 'mail' },
    { cat: 'Reach', t: 'Pax Inbox', d: 'SMS, email, voicemail in one thread. Drafts ready for every reply.', i: 'inbox' },
    { cat: 'Close', t: 'Offer composer', d: 'Generate written offers in 30 seconds. Atlas defends the price.', i: 'doc' },
    { cat: 'Close', t: 'E-sign + escrow', d: 'Send contracts, track signatures, hand off to title — without leaving the app.', i: 'pen' },
    { cat: 'Service', t: 'Sophie ledger', d: 'Auto-pay, receipts, late notices, 1098s. Your seller-finance back office.', i: 'ledger' },
    { cat: 'Operate', t: 'Automation builder', d: 'No-code workflows. Trigger anything off any event. Pause anything in one click.', i: 'flow' },
    { cat: 'Operate', t: 'Audit log', d: 'Every agent action — what, when, why, what data it used. Full transparency.', i: 'audit' },
    { cat: 'Operate', t: 'Team + roles', d: 'Bring on a VA, a partner, or your spouse. Granular permissions.', i: 'team' },
  ];

  const cats = [...new Set(features.map(f => f.cat))];

  return (
    <section className="lp-section" id="features">
      <div className="lp-eyebrow">{c.eyebrow}</div>
      <h2 className="lp-section-title">{c.title}</h2>
      <p className="lp-section-sub">{c.sub}</p>

      <div className="lp-features-grid">
        {features.map((f, i) => (
          <div key={i} className="lp-feature-card">
            <div className="lp-feature-cat">{f.cat}</div>
            <FeatureGlyph kind={f.i} />
            <h3 className="lp-feature-title">{f.t}</h3>
            <p className="lp-feature-desc">{f.d}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function FeatureGlyph({ kind }) {
  const stroke = '#C2531C';
  const props = { width: 28, height: 28, viewBox: '0 0 24 24', fill: 'none', stroke, strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' };
  const paths = {
    box: <><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 3v18"/></>,
    list: <><path d="M4 6h16M4 12h16M4 18h10"/><circle cx="20" cy="18" r="1.5" fill={stroke}/></>,
    scale: <><path d="M12 3v18M5 8h14M5 8l-2 6a3 3 0 006 0l-2-6M19 8l-2 6a3 3 0 006 0l-2-6"/></>,
    satellite: <><circle cx="12" cy="12" r="8"/><path d="M4 12h16M12 4c2.5 3 2.5 13 0 16M12 4c-2.5 3-2.5 13 0 16"/></>,
    mail: <><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></>,
    inbox: <><path d="M3 13h5l2 3h4l2-3h5"/><path d="M3 13l3-8h12l3 8v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6z"/></>,
    doc: <><path d="M14 3H6a2 2 0 00-2 2v14a2 2 0 002 2h12a2 2 0 002-2V9z"/><path d="M14 3v6h6M9 14h6M9 17h4"/></>,
    pen: <><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18M2 2l7.586 7.586"/><circle cx="11" cy="11" r="2"/></>,
    ledger: <><rect x="4" y="3" width="16" height="18" rx="1"/><path d="M8 7h8M8 11h8M8 15h5"/></>,
    flow: <><circle cx="6" cy="6" r="2"/><circle cx="18" cy="6" r="2"/><circle cx="6" cy="18" r="2"/><circle cx="18" cy="18" r="2"/><path d="M8 6h8M6 8v8M18 8v8"/></>,
    audit: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    team: <><circle cx="9" cy="8" r="3"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><circle cx="17" cy="9" r="2.5"/><path d="M14 20c0-2.7 1.3-5 3-5s3 2 3 5"/></>,
  };
  return <svg {...props} className="lp-feature-glyph">{paths[kind]}</svg>;
}

// ─────────────────────────────────────────────────────────── QUOTES
function Quotes({ copy }) {
  const c = copy.quotes;
  const quotes = [
    { q: 'Pax replied to a seller in 90 seconds at 11pm on a Sunday. We closed that deal Tuesday. That single deal paid for AcreOS for two years.', n: 'Marcus K.', r: 'Solo investor · Texas' },
    { q: 'I used to spend Sundays running comps. Now Atlas hands me a list of 5 worth offering on. I get my Sunday back.', n: 'Janelle R.', r: 'Partner-led, 3-person team · AZ + NM' },
    { q: 'The audit log is the killer feature. Every action my agents take, I can see why. No black box.', n: 'David O.', r: 'Investor + lender · 80 active notes' },
    { q: 'I came over from REISift + Pebble + Mailchimp + a spreadsheet. AcreOS replaced all four. The bill went down, the deals went up.', n: 'Tasha B.', r: 'Full-time investor · CO' },
    { q: 'Sophie services my notes better than I did. I used to miss late payments by a week.', n: 'Roy G.', r: 'Seller-finance investor · 60+ notes' },
    { q: 'Thomas wrote me back at 10pm with a feature in production a week later. That doesn\'t happen with normal SaaS.', n: 'Anya S.', r: 'New investor · 6 months in' },
  ];

  return (
    <section className="lp-section" id="quotes">
      <div className="lp-eyebrow">{c.eyebrow}</div>
      <h2 className="lp-section-title">{c.title}</h2>

      <div className="lp-quotes-grid">
        {quotes.map((q, i) => (
          <figure key={i} className="lp-quote-card">
            <div className="lp-quote-mark" aria-hidden="true">"</div>
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

window.Section2 = { DayInLife, Features, Quotes };
