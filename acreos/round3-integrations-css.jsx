// acreos/round3-integrations-css.jsx — CSS for the integration wrappers,
// plus print stylesheets and the weekly-digest email design.

const R3_INTEGRATIONS_CSS = `
/* ──────────────────────────────────────────────────────────
   MORNING QUEUE — top of Command Center
   ────────────────────────────────────────────────────────── */
.r3-mq {
  display: flex; flex-direction: column; gap: 14px;
  margin-bottom: 4px;
}
.r3-mq-hd {
  display: flex; justify-content: space-between; align-items: flex-end;
  gap: 24px;
}
.r3-mq-title {
  font: 600 18px/1.3 var(--font-display); letter-spacing: -0.018em;
  color: var(--ink); margin: 4px 0 0; text-wrap: pretty;
}
.r3-mq-progress {
  display: flex; flex-direction: column; gap: 6px; align-items: flex-end;
  min-width: 180px;
}
.r3-mq-progress-bar {
  height: 4px; width: 160px; background: var(--surface-2);
  border-radius: 2px; overflow: hidden;
}
.r3-mq-progress-fill {
  height: 100%; background: var(--brand);
  transition: width 240ms cubic-bezier(.22, 1, .36, 1);
}
.r3-mq-progress-n {
  font: 600 11px/1 var(--font-mono); color: var(--ink-3);
  letter-spacing: 0.02em;
}

.r3-mq-stack {
  position: relative; height: 220px;
  perspective: 800px;
}
.r3-mq-card {
  position: absolute; inset: 0;
  background: var(--surface);
  border: 0.5px solid var(--line);
  border-radius: 14px;
  padding: 18px 20px 14px;
  box-shadow: var(--shadow-1);
  display: flex; flex-direction: column; gap: 10px;
  transition: transform 280ms cubic-bezier(.22, 1, .36, 1), opacity 200ms;
  cursor: default;
}
.r3-mq-card-cur {
  border-color: color-mix(in srgb, var(--brand) 40%, var(--line));
  box-shadow: 0 8px 24px -8px color-mix(in srgb, var(--brand) 24%, transparent), var(--shadow-1);
}
.r3-mq-card-hd {
  display: flex; justify-content: space-between; align-items: center; gap: 12px;
}
.r3-mq-card-meta {
  display: inline-flex; align-items: center; gap: 8px;
  font: 500 12px/1 var(--font-sans); color: var(--ink-2);
  flex-wrap: wrap;
}
.r3-mq-id { color: var(--ink-2); }
.r3-mq-atlas {
  display: inline-flex; align-items: center; gap: 4px;
  font: 600 11px/1 var(--font-mono); color: var(--brand);
  padding: 4px 7px; border-radius: 6px;
  background: var(--brand-soft);
}
.r3-mq-headline {
  font: 600 17px/1.32 var(--font-display); letter-spacing: -0.018em;
  color: var(--ink); margin: 0; text-wrap: pretty;
}
.r3-mq-body {
  font: 400 13px/1.55 var(--font-sans); color: var(--ink-2);
  margin: 0; text-wrap: pretty; flex: 1;
}
.r3-mq-actions {
  display: flex; gap: 8px; justify-content: flex-end;
  margin-top: 2px;
}
.r3-mq-keys {
  font: 500 10.5px/1 var(--font-sans); color: var(--ink-4);
  letter-spacing: 0.02em;
}
.r3-mq-keys kbd {
  display: inline-block; padding: 2px 5px; margin-right: 3px;
  font: 600 10px/1 var(--font-mono);
  background: var(--surface-2); border: 0.5px solid var(--line);
  border-radius: 4px; color: var(--ink-2);
}

.r3-mq-empty {
  text-align: center; padding: 32px 24px;
  display: flex; flex-direction: column; align-items: center; gap: 8px;
  background: linear-gradient(180deg,
    color-mix(in srgb, var(--pos) 5%, var(--surface)),
    var(--surface));
  border-color: color-mix(in srgb, var(--pos) 24%, var(--line));
}
.r3-mq-empty-glyph {
  width: 44px; height: 44px; border-radius: 50%;
  background: var(--pos-soft); color: var(--pos);
  display: inline-flex; align-items: center; justify-content: center;
  font: 600 22px/1 var(--font-display);
  margin-bottom: 4px;
}
.r3-mq-empty-title {
  font: 600 18px/1.2 var(--font-display); letter-spacing: -0.015em;
  color: var(--ink);
}
.r3-mq-empty-sub {
  font: 400 13px/1.55 var(--font-sans); color: var(--ink-2);
  max-width: 420px;
}

@media (max-width: 720px) {
  .r3-mq-hd { flex-direction: column; align-items: flex-start; gap: 8px; }
  .r3-mq-progress { align-items: flex-start; }
  .r3-mq-stack { height: 240px; }
  .r3-mq-card { padding: 14px 16px 12px; }
  .r3-mq-headline { font-size: 16px; }
}

/* ──────────────────────────────────────────────────────────
   COMP PHOTOS — satellite tiles for Atlas comps
   ────────────────────────────────────────────────────────── */
.r3-comp-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 14px;
}
@media (max-width: 1080px) { .r3-comp-grid { grid-template-columns: repeat(2, 1fr); } }
@media (max-width: 540px)  { .r3-comp-grid { grid-template-columns: 1fr; } }

.r3-comp-tile {
  background: var(--surface); border: 0.5px solid var(--line);
  border-radius: 12px; overflow: hidden;
  box-shadow: var(--shadow-1);
  display: flex; flex-direction: column;
  transition: border-color .15s, transform .15s;
}
.r3-comp-tile:hover { border-color: color-mix(in srgb, var(--brand) 40%, var(--line)); transform: translateY(-1px); }
.r3-comp-tile-hi { border-color: color-mix(in srgb, var(--pos) 30%, var(--line)); }
.r3-comp-tile-img {
  position: relative; aspect-ratio: 4 / 3;
  overflow: hidden;
}
.r3-comp-tile-svg { width: 100%; height: 100%; display: block; }
.r3-comp-tile-overlay {
  position: absolute; top: 8px; left: 8px;
}
.r3-comp-tile-meta {
  padding: 10px 12px;
}
.r3-comp-tile-row {
  display: flex; justify-content: space-between; align-items: baseline;
  font: 500 12.5px/1 var(--font-sans); color: var(--ink);
}
.r3-comp-tile-price {
  font: 600 13px/1 var(--font-mono); color: var(--ink);
}
.r3-comp-tile-sub {
  font: 500 11.5px/1.2 var(--font-sans); color: var(--ink-3);
  margin-top: 4px;
}

/* ──────────────────────────────────────────────────────────
   FOUNDER REVENUE CHART FOOT
   ────────────────────────────────────────────────────────── */
.r3-chart-foot {
  display: grid; grid-template-columns: repeat(4, 1fr);
  border-top: 0.5px solid var(--line-soft);
  padding: 14px 0;
}
.r3-chart-foot > div {
  padding: 4px 18px;
  border-right: 0.5px solid var(--line-soft);
  display: flex; flex-direction: column; gap: 4px;
}
.r3-chart-foot > div:last-child { border-right: 0; }
.r3-chart-foot-v {
  font: 600 18px/1.1 var(--font-display); letter-spacing: -0.015em;
  color: var(--ink);
}
@media (max-width: 720px) {
  .r3-chart-foot { grid-template-columns: repeat(2, 1fr); }
}

/* ──────────────────────────────────────────────────────────
   FOUNDER HOME C — live feed wrap
   ────────────────────────────────────────────────────────── */
.founder-c { display: flex; flex-direction: column; gap: 24px; }
.founder-c-feed-wrap { margin-bottom: -4px; }

/* ──────────────────────────────────────────────────────────
   COMMAND CENTER C — adds spacing between morning queue and main
   ────────────────────────────────────────────────────────── */
.cc-c { display: flex; flex-direction: column; gap: 28px; }

/* ──────────────────────────────────────────────────────────
   ATLAS RUN C — comp photos add-on
   ────────────────────────────────────────────────────────── */
.atlas-run-c { display: flex; flex-direction: column; gap: 24px; }

/* ──────────────────────────────────────────────────────────
   PROGRESSIVE DISCLOSURE
   ────────────────────────────────────────────────────────── */
.r3-disc {
  background: var(--surface); border: 0.5px solid var(--line);
  border-radius: 12px; overflow: hidden;
  transition: border-color .15s;
}
.r3-disc-on { border-color: var(--line); }
.r3-disc-hd {
  width: 100%; display: flex; align-items: center; gap: 14px;
  padding: 14px 18px; background: transparent; border: 0;
  cursor: default; text-align: left;
}
.r3-disc-hd:hover { background: var(--surface-2); }
.r3-disc-hd-l { flex: 1; min-width: 0; }
.r3-disc-title {
  font: 600 15px/1.3 var(--font-display); letter-spacing: -0.012em;
  color: var(--ink); margin: 2px 0 0;
}
.r3-disc-summary {
  font: 400 12.5px/1.5 var(--font-sans); color: var(--ink-2);
  margin-top: 4px; text-wrap: pretty;
}
.r3-disc-chev {
  width: 24px; height: 24px; border-radius: 6px;
  background: var(--surface-2);
  display: inline-flex; align-items: center; justify-content: center;
  color: var(--ink-3); transition: transform .18s;
}
.r3-disc-on .r3-disc-chev { transform: rotate(180deg); }
.r3-disc-body {
  padding: 0 18px 18px;
  border-top: 0.5px solid var(--line-soft);
}

/* ──────────────────────────────────────────────────────────
   SETTINGS C — sub-route breadcrumb + autonomy area
   ────────────────────────────────────────────────────────── */
.set-page-r3 .set-main {
  display: flex; flex-direction: column; gap: 16px;
}
.set-breadcrumb {
  display: inline-flex; align-items: center; gap: 8px;
  font: 500 12px/1 var(--font-sans); color: var(--ink-2);
  letter-spacing: 0;
}
.set-breadcrumb .muted { color: var(--ink-3); }
.r3-set-guardrails { padding: 0; }

/* ──────────────────────────────────────────────────────────
   MOBILE INBOX UPGRADE
   ────────────────────────────────────────────────────────── */
.r3-mob-inbox {
  display: flex; flex-direction: column; height: 100%;
  position: relative;
}
.r3-mob-inbox-list {
  display: flex; flex-direction: column;
  border-top: 0.5px solid var(--line);
  background: var(--surface);
}
.r3-mob-item {
  display: flex; flex-direction: column; gap: 4px;
  padding: 12px 16px;
  background: transparent; border: 0; border-bottom: 0.5px solid var(--line-soft);
  text-align: left; cursor: default; color: var(--ink);
}
.r3-mob-item-on {
  background: var(--brand-soft);
  border-left: 2px solid var(--brand);
  padding-left: 14px;
}
.r3-mob-item-hd {
  display: flex; justify-content: space-between;
  font: 600 13px/1 var(--font-sans); color: var(--ink);
}
.r3-mob-item-from { font-weight: 600; }
.r3-mob-item-time { font: 500 11px/1 var(--font-sans); color: var(--ink-3); }
.r3-mob-item-sub {
  font: 400 12px/1.4 var(--font-sans); color: var(--ink-2);
  text-overflow: ellipsis; overflow: hidden; white-space: nowrap;
}
.r3-mob-item-tag {
  display: inline-flex; align-items: center; gap: 4px;
  font: 600 10.5px/1 var(--font-sans); color: var(--brand);
  padding-top: 2px;
}

.r3-mob-inbox-detail {
  display: flex; flex-direction: column; flex: 1; min-height: 0;
  background: var(--bg);
  position: relative;
}
.r3-mob-detail-hd {
  display: flex; align-items: center; gap: 12px;
  padding: 14px 16px;
  background: var(--surface); border-bottom: 0.5px solid var(--line);
}
.r3-mob-back {
  width: 28px; height: 28px; border-radius: 7px;
  background: var(--surface-2); border: 0;
  display: inline-flex; align-items: center; justify-content: center;
  color: var(--ink-2); cursor: default;
}
.r3-mob-detail-from { font: 600 14px/1.2 var(--font-display); color: var(--ink); }
.r3-mob-detail-sub  { font: 400 12px/1.3 var(--font-sans); color: var(--ink-3); margin-top: 2px; }

.r3-mob-detail-body {
  padding: 14px 16px 80px; display: flex; flex-direction: column; gap: 16px;
}
.r3-mob-quote {
  background: var(--surface); border: 0.5px solid var(--line);
  border-radius: 12px; padding: 14px 16px;
  font: 400 13px/1.55 var(--font-sans); color: var(--ink-2);
  text-wrap: pretty;
}
.r3-mob-quote-sig {
  font: 500 11px/1 var(--font-sans); color: var(--ink-3);
  margin-top: 8px;
}

/* Pax draft as PRIMARY surface */
.r3-mob-pax {
  background: var(--surface); border: 0.5px solid var(--brand);
  border-radius: 12px; padding: 14px 16px 12px;
  box-shadow: 0 4px 16px -4px color-mix(in srgb, var(--brand) 24%, transparent);
  position: relative; overflow: hidden;
}
.r3-mob-pax::before {
  content: ''; position: absolute; top: 0; left: 0; right: 0; height: 2px;
  background: linear-gradient(90deg, var(--brand), var(--accent));
}
.r3-mob-pax-hd {
  display: flex; justify-content: space-between; align-items: center;
  margin-bottom: 8px; gap: 8px;
}
.r3-mob-pax-hd .muted {
  font: 500 11px/1 var(--font-sans); color: var(--ink-3);
}
.r3-mob-pax-body {
  font: 400 13.5px/1.55 var(--font-sans); color: var(--ink);
  margin: 0 0 12px; text-wrap: pretty;
}
.r3-mob-pax-actions {
  display: flex; gap: 6px; justify-content: flex-end;
}

/* Voice CTA — pinned to bottom of detail */
.r3-mob-voice {
  position: fixed; left: 16px; right: 16px; bottom: 80px;
  display: inline-flex; align-items: center; justify-content: center; gap: 10px;
  padding: 14px 18px; border-radius: 999px;
  background: var(--ink); color: var(--bg); border: 0;
  font: 600 13.5px/1 var(--font-sans);
  box-shadow: 0 12px 32px -8px rgba(0,0,0,.4);
  cursor: default; z-index: 80;
}
.r3-mob-voice-pulse {
  width: 8px; height: 8px; border-radius: 50%;
  background: oklch(70% 0.18 28);
  animation: r3-pulse 1.4s ease-in-out infinite;
}
@keyframes r3-pulse {
  0%, 100% { opacity: .4; transform: scale(1); }
  50% { opacity: 1; transform: scale(1.3); }
}

.r3-mob-voice-modal {
  position: fixed; inset: 0; z-index: 200;
  background: rgba(0,0,0,.6); backdrop-filter: blur(8px);
  display: flex; align-items: flex-end; justify-content: center;
  padding: 24px;
}
.r3-mob-voice-card {
  background: var(--surface); border-radius: 16px;
  padding: 24px 20px 20px; width: 100%; max-width: 420px;
  display: flex; flex-direction: column; gap: 18px;
  box-shadow: 0 24px 64px -8px rgba(0,0,0,.5);
}
.r3-mob-voice-wave {
  display: flex; align-items: center; justify-content: center; gap: 3px;
  height: 60px;
}
.r3-mob-voice-wave span {
  display: inline-block; width: 3px; border-radius: 2px;
  background: var(--brand);
  animation: r3-wave 600ms ease-in-out infinite alternate;
}
@keyframes r3-wave {
  from { transform: scaleY(0.4); }
  to   { transform: scaleY(1); }
}
.r3-mob-voice-text {
  font: 500 14.5px/1.5 var(--font-display); color: var(--ink);
  text-align: center; letter-spacing: -0.01em;
  text-wrap: pretty;
}
.r3-mob-voice-actions {
  display: flex; gap: 8px; justify-content: space-between;
}

/* ──────────────────────────────────────────────────────────
   PRINT — Parcel + Offer
   ────────────────────────────────────────────────────────── */
@media print {
  /* Hide app chrome */
  .acr-sidebar, .acr-topbar, .acr-mobile-tab, .r3-toasts, .acr-drawer,
  .tweaks-panel, [data-tweaks-toggle], .acr-skip-link, .pg-actions,
  .acr-cc-hero-actions, .cc-b-hero-actions, .founder-hero .pg-actions,
  .r3-mob-voice, .acr-cc-metrics .acr-metric-delta {
    display: none !important;
  }

  body { background: white !important; color: black !important; }
  .acr-app { display: block !important; }
  .acr-main { margin-left: 0 !important; }
  .acr-content { padding: 0 !important; max-width: 100% !important; }

  /* Print-friendly type */
  * { color: black !important; box-shadow: none !important; }
  h1, h2, h3 { page-break-after: avoid; }
  .pg, .pg-hd { gap: 12px !important; }

  /* Card chrome lighter */
  .acr-card, .set-card, .pg-card, .fa-card,
  .r3-mq-card, .r3-comp-tile {
    background: white !important; border: 0.5px solid #888 !important;
    border-radius: 6px !important;
  }

  /* Atlas hero / parcel hero — keep, simplify */
  .ai-output-hero, .ai-output {
    border: 1px solid #333 !important; padding: 12px !important;
    page-break-inside: avoid;
  }

  /* Tables print clean */
  .tbl { width: 100% !important; }
  .tbl th, .tbl td {
    border-bottom: 0.5px solid #999 !important;
    padding: 6px 8px !important; font-size: 11px !important;
  }
  .tbl-row { page-break-inside: avoid; }

  /* Footer on every page */
  .pg::after {
    content: 'AcreOS · printed ' attr(data-printed);
    display: block; padding: 14px 0 0;
    font: 500 9px/1.4 var(--font-mono);
    color: #666 !important;
    border-top: 0.3px solid #ccc;
    margin-top: 24px;
  }

  /* Page break helpers */
  .r3-print-pagebreak { page-break-before: always; }

  /* Remove transitions */
  *, *::before, *::after { transition: none !important; animation: none !important; }
}
`;

// ──────────────────────────────────────────────────────────
// WEEKLY DIGEST — email design (renderable in HTML, printable too)
// Standalone preview component for the Tweaks panel + a route
// ──────────────────────────────────────────────────────────

const WeeklyDigestEmail = () => {
  return (
    <div className="r3-digest-frame">
      <div className="r3-digest-chrome">
        <div><b>From:</b> AcreOS &lt;weekly@acreos.app&gt;</div>
        <div><b>Subject:</b> Your week, in numbers · Apr 24 → Apr 30</div>
      </div>
      <div className="r3-digest">
        <header className="r3-digest-hero">
          <div className="r3-digest-eyebrow">YOUR WEEK · APR 24 – APR 30</div>
          <h1 className="r3-digest-title">3 closed. 4 in-flight. 1 needs you.</h1>
          <p className="r3-digest-sub">Tuesday's storm pushed mail back a day. We caught it up Thursday.</p>
        </header>

        <section className="r3-digest-num">
          <div><div className="r3-digest-num-v">$34,200</div><div className="r3-digest-num-l">Closed this week</div><div className="r3-digest-num-d">↑ 18% vs last</div></div>
          <div><div className="r3-digest-num-v">142</div><div className="r3-digest-num-l">Mailers sent</div><div className="r3-digest-num-d">+8 vs avg</div></div>
          <div><div className="r3-digest-num-v">11.4%</div><div className="r3-digest-num-l">Reply rate</div><div className="r3-digest-num-d">↑ 1.2pp</div></div>
        </section>

        <section className="r3-digest-section">
          <h2 className="r3-digest-h2">What closed</h2>
          <div className="r3-digest-deal">
            <div className="r3-digest-deal-hd">
              <div><b>D-2196</b> · <span className="mono">08-441-002</span></div>
              <div className="r3-digest-deal-amt">$11,500</div>
            </div>
            <div className="r3-digest-deal-body">Coconino, AZ · 12.4ac · Pritchard. 37 days from list to close. 3 touches to acceptance.</div>
          </div>
          <div className="r3-digest-deal">
            <div className="r3-digest-deal-hd">
              <div><b>D-2104</b> · <span className="mono">12-008-117</span></div>
              <div className="r3-digest-deal-amt">$14,200</div>
            </div>
            <div className="r3-digest-deal-body">Catron, NM · 22.1ac · Okoro. 24-month seller-finance · $540/mo. 14 days from offer to signed.</div>
          </div>
          <div className="r3-digest-deal">
            <div className="r3-digest-deal-hd">
              <div><b>D-2058</b> · <span className="mono">37-091-014</span></div>
              <div className="r3-digest-deal-amt">$8,500</div>
            </div>
            <div className="r3-digest-deal-body">Mohave, AZ · 4.8ac · Torres. Cash · 11 days · clean title.</div>
          </div>
        </section>

        <section className="r3-digest-section">
          <h2 className="r3-digest-h2">What Pax handled while you slept</h2>
          <ul className="r3-digest-list">
            <li><b>23 replies drafted</b> — 19 sent after your review, 4 you sent yourself.</li>
            <li><b>4 follow-ups</b> on warm leads — 2 came back warm, 2 went cold.</li>
            <li><b>1 escalation</b> — Borrower N-043 missed first payment. Sophie sent the soft reminder Wednesday.</li>
          </ul>
        </section>

        <section className="r3-digest-section">
          <h2 className="r3-digest-h2">What needs you Monday</h2>
          <div className="r3-digest-need">
            <div className="r3-digest-need-tag">⚠ One thing</div>
            <div className="r3-digest-need-title">Pritchard counter is sitting at $13,800.</div>
            <div className="r3-digest-need-body">Atlas sees a 78% chance of close at this number. Owner is pinged for a third time tomorrow morning.</div>
          </div>
        </section>

        <section className="r3-digest-section">
          <h2 className="r3-digest-h2">What's coming</h2>
          <div className="r3-digest-flight">
            <div><b>4 deals in-flight.</b> Combined value <b>$58,400</b>. Earliest expected close: Tue.</div>
            <div><b>1,847 new owners</b> in your buy-box this week. Skip-trace ran overnight.</div>
            <div><b>$520 spent</b> on Atlas runs (147 parcels). $0.07 per analysis.</div>
          </div>
        </section>

        <footer className="r3-digest-foot">
          <div>AcreOS · sent every Monday at 7 AM, your time.</div>
          <div className="r3-digest-foot-links">
            <a href="#">Unsubscribe</a> · <a href="#">Adjust autonomy</a> · <a href="#">Open AcreOS →</a>
          </div>
        </footer>
      </div>
    </div>
  );
};

const R3_DIGEST_CSS = `
.r3-digest-frame {
  max-width: 600px; margin: 0 auto;
  background: #f4f1ec; padding: 24px;
  border-radius: 14px; border: 0.5px solid var(--line);
}
.r3-digest-chrome {
  background: var(--surface-2); border-radius: 8px 8px 0 0;
  padding: 10px 14px;
  font: 500 12px/1.6 var(--font-mono); color: var(--ink-2);
  border-bottom: 0.5px solid var(--line);
}
.r3-digest {
  background: #fdfcfa; padding: 36px 36px 24px;
  font-family: Georgia, "New York", serif;
  color: #1a1a1a;
  border-radius: 0 0 8px 8px;
  border: 0.5px solid var(--line);
  border-top: 0;
}
.r3-digest-eyebrow {
  font: 600 10.5px/1 var(--font-sans); letter-spacing: 0.12em;
  color: #8a7a5a; margin-bottom: 12px;
}
.r3-digest-title {
  font: 700 28px/1.2 Georgia, serif; letter-spacing: -0.015em;
  color: #1a1a1a; margin: 0 0 8px; text-wrap: pretty;
}
.r3-digest-sub {
  font: 400 14px/1.5 Georgia, serif; color: #555;
  margin: 0; font-style: italic;
}

.r3-digest-num {
  display: grid; grid-template-columns: repeat(3, 1fr);
  gap: 0; margin: 28px 0; padding: 18px 0;
  border-top: 1.5px solid #1a1a1a;
  border-bottom: 0.5px solid #ccc;
}
.r3-digest-num > div {
  padding: 0 14px; border-right: 0.5px solid #ddd;
}
.r3-digest-num > div:last-child { border-right: 0; }
.r3-digest-num-v { font: 700 26px/1.1 Georgia, serif; color: #1a1a1a; letter-spacing: -0.02em; }
.r3-digest-num-l { font: 400 11.5px/1.2 var(--font-sans); color: #777; margin-top: 4px; }
.r3-digest-num-d { font: 500 11px/1 var(--font-sans); color: #2a7a3a; margin-top: 6px; }

.r3-digest-section { margin: 24px 0; }
.r3-digest-h2 {
  font: 600 11px/1 var(--font-sans); letter-spacing: 0.08em; text-transform: uppercase;
  color: #8a7a5a; margin: 0 0 12px; padding-bottom: 6px;
  border-bottom: 0.5px solid #ddd;
}

.r3-digest-deal {
  padding: 12px 0; border-bottom: 0.5px solid #eee;
}
.r3-digest-deal:last-child { border-bottom: 0; }
.r3-digest-deal-hd {
  display: flex; justify-content: space-between;
  font: 500 14px/1.2 Georgia, serif; color: #1a1a1a;
}
.r3-digest-deal-amt { font: 700 16px/1 Georgia, serif; color: #1a1a1a; }
.r3-digest-deal-body { font: 400 13px/1.5 Georgia, serif; color: #555; margin-top: 4px; }
.r3-digest-deal .mono { font-family: var(--font-mono); font-size: 12px; color: #666; }

.r3-digest-list {
  list-style: none; padding: 0; margin: 0;
  font: 400 14px/1.65 Georgia, serif; color: #333;
}
.r3-digest-list li {
  padding: 8px 0 8px 22px; position: relative;
  border-bottom: 0.5px solid #eee;
}
.r3-digest-list li:last-child { border-bottom: 0; }
.r3-digest-list li::before {
  content: '·'; position: absolute; left: 8px; top: 8px;
  font-size: 18px; color: #8a7a5a;
}

.r3-digest-need {
  background: #fef9e7; border-left: 3px solid #c89c2c;
  padding: 14px 16px; border-radius: 0 6px 6px 0;
}
.r3-digest-need-tag {
  font: 600 10.5px/1 var(--font-sans); letter-spacing: 0.06em;
  color: #8a6a1a; text-transform: uppercase; margin-bottom: 6px;
}
.r3-digest-need-title { font: 600 16px/1.3 Georgia, serif; color: #1a1a1a; margin-bottom: 6px; }
.r3-digest-need-body  { font: 400 13.5px/1.55 Georgia, serif; color: #444; }

.r3-digest-flight {
  font: 400 14px/1.7 Georgia, serif; color: #333;
  display: flex; flex-direction: column; gap: 6px;
}

.r3-digest-foot {
  margin-top: 32px; padding-top: 18px;
  border-top: 0.5px solid #ddd;
  font: 500 11px/1.5 var(--font-sans); color: #888;
  display: flex; justify-content: space-between; flex-wrap: wrap; gap: 8px;
}
.r3-digest-foot-links a { color: #555; text-decoration: underline; text-underline-offset: 2px; }

@media (max-width: 600px) {
  .r3-digest { padding: 24px 20px; }
  .r3-digest-title { font-size: 22px; }
  .r3-digest-num { grid-template-columns: 1fr; gap: 14px; padding: 14px 0; }
  .r3-digest-num > div { border-right: 0; border-bottom: 0.5px solid #ddd; padding-bottom: 14px; }
  .r3-digest-num > div:last-child { border-bottom: 0; }
}
`;

Object.assign(window, {
  R3_INTEGRATIONS_CSS,
  WeeklyDigestEmail,
  R3_DIGEST_CSS,
});
