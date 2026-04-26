// acreos/v2.jsx — v2.x polish: navigation, native page states, mobile sidebar, Atlas run page

const { useState: useV2S, useEffect: useV2E } = React;

// ──────────────────────────────────────────────────────────
// v2.4 · Global navigation hook
// Pages can call window.__nav('parcels') to navigate.
// app.jsx exposes this; here we just read it.
// ──────────────────────────────────────────────────────────
const nav = (id) => window.__nav && window.__nav(id);

// ──────────────────────────────────────────────────────────
// v2.1 · Native empty-state wrappers for key pages
// These wrap existing pages, showing native EmptyState when data is empty
// (using a "demo empty" toggle on each page header).
// ──────────────────────────────────────────────────────────

const PageEmptyHeader = ({ eyebrow, title, onDemo, demoOn }) => (
  <header className="pg-hd">
    <div>
      <div className="acr-eyebrow">{eyebrow}</div>
      <h1 className="pg-title">{title}</h1>
    </div>
    <div className="pg-actions">
      <Button size="sm" variant={demoOn ? 'primary' : 'subtle'} onClick={onDemo}>
        {demoOn ? 'Show data' : 'Show empty'}
      </Button>
    </div>
  </header>
);

// ──────────────────────────────────────────────────────────
// v2.3 · Atlas analysis run — standalone deep-dive page
// ──────────────────────────────────────────────────────────

const AtlasRun = () => {
  const [step, setStep] = useV2S(4);
  const steps = [
    { id: 0, name: 'Parcel boundary', src: 'DataTree', t: '0.4s', state: 'done' },
    { id: 1, name: 'Owner record',    src: 'DataTree · skip-trace', t: '1.1s', state: 'done' },
    { id: 2, name: 'Comp pull',       src: 'LandVision · 4 sales', t: '2.3s', state: 'done' },
    { id: 3, name: 'Title check',     src: 'Internal · liens',     t: '0.8s', state: 'done' },
    { id: 4, name: 'Score & recommend', src: 'Atlas v3.2',         t: '1.6s', state: step >= 4 ? 'done' : 'running' },
  ];
  const totalT = steps.reduce((s, x) => s + parseFloat(x.t), 0).toFixed(1);

  return (
    <div className="pg atlas-run">
      <header className="pg-hd">
        <div>
          <div className="acr-eyebrow">Atlas · run #4827</div>
          <h1 className="pg-title">Pritchard parcel · 9.8 acres · Luna NM</h1>
          <div className="parcel-sub">Started 4 minutes ago · {totalT}s total · 5 of 5 steps complete</div>
        </div>
        <div className="pg-actions">
          <Button size="sm" variant="ghost" icon="folder">Export run</Button>
          <Button size="sm" variant="subtle" icon="arrow" onClick={() => nav('parcels')}>Open parcel</Button>
        </div>
      </header>

      <AIOutput
        agent="atlas"
        shape="hero"
        confidence="high"
        confidenceDetail="all 5 steps clean · 4 comps within 8mi"
        headline="Score 89 · Offer at $11,500 · expect counter $13,800"
        body="Comp-based value $18,200 (range $16.4K–$21.8K). 63% offer is standard for Luna County; absentee owner replied <48h previously. Seller-finance option adds 6–8% to acceptance probability."
        inputs={[
          { label: 'Comp median', value: '$1,830/ac' },
          { label: 'Value range', value: '$16,400 – $21,800' },
          { label: 'Owner profile', value: 'Absentee · 3 parcels' },
          { label: 'Title', value: 'Clean · last checked Oct 18' },
          { label: 'Run cost', value: '$0.07' },
        ]}
        grounding={[
          { label: '4 comp sales' },
          { label: 'DataTree owner' },
          { label: 'FEMA flood' },
          { label: 'Prior thread' },
        ]}
        autonomy={{ level: 2, willAutoSend: false }}
        timestamp="just now"
        actions={[
          { label: 'Re-run', variant: 'ghost', icon: 'play' },
          { label: 'Draft offer', icon: 'plus' },
        ]}
      />

      <SectionTitle eyebrow="Run trace" title="What Atlas did, in order">
        <Card padded={false}>
          <div className="trace">
            {steps.map((s, i) => (
              <div key={s.id} className="trace-row">
                <div className={cx('trace-dot', s.state === 'done' ? 'trace-done' : 'trace-running')}>
                  {s.state === 'done' ? <I.check size={11}/> : <span className="trace-spin"/>}
                </div>
                <div className="trace-body">
                  <div className="trace-name">{i + 1}. {s.name}</div>
                  <div className="trace-src muted">{s.src}</div>
                </div>
                <div className="trace-t acr-tabnum">{s.t}</div>
              </div>
            ))}
          </div>
        </Card>
      </SectionTitle>

      <SectionTitle eyebrow="Reasoning" title="Why Atlas landed here">
        <Card>
          <div className="reasoning">
            <div className="reason-row">
              <div className="reason-q">Why $11,500 and not market value?</div>
              <div className="reason-a">63% of comp-median is the historical mean for accepted offers in Luna County (n=42 over 18mo). Going higher costs margin; going lower drops acceptance below 25%.</div>
            </div>
            <div className="reason-row">
              <div className="reason-q">Why expect a counter at $13,800?</div>
              <div className="reason-a">Pritchard countered at $15K on a similar parcel in Nov 2024. Sellers in this band typically counter +20-25% above opening. Meet-in-middle is your strongest close path.</div>
            </div>
            <div className="reason-row">
              <div className="reason-q">Why is confidence "high"?</div>
              <div className="reason-a">4 comps within 8 miles, sold within 180 days, similar acreage (±20%). Title clean. Owner data fresh ({'<'}24h). No conflicting signals.</div>
            </div>
          </div>
        </Card>
      </SectionTitle>

      <div className="atlas-twocol">
        <SectionTitle eyebrow="Location" title="Where this parcel sits">
          <Card padded={false}>
            <div className="atlas-map">
              <svg viewBox="0 0 360 220" preserveAspectRatio="xMidYMid slice" className="atlas-map-svg" aria-hidden="true">
                <defs>
                  <pattern id="atlas-grid" width="24" height="24" patternUnits="userSpaceOnUse">
                    <path d="M 24 0 L 0 0 0 24" fill="none" stroke="currentColor" strokeWidth="0.5" opacity="0.18"/>
                  </pattern>
                </defs>
                <rect width="360" height="220" fill="var(--surface-2)"/>
                <rect width="360" height="220" fill="url(#atlas-grid)" color="var(--ink-3)"/>
                {/* roads */}
                <path d="M 0 70 Q 80 80 180 60 T 360 80" fill="none" stroke="var(--ink-3)" strokeWidth="1.2" opacity="0.6"/>
                <path d="M 200 0 L 195 220" fill="none" stroke="var(--ink-3)" strokeWidth="0.8" opacity="0.4"/>
                {/* adjacent parcels */}
                <rect x="120" y="80" width="60" height="44" fill="none" stroke="var(--line)" strokeWidth="0.5"/>
                <rect x="180" y="80" width="48" height="44" fill="none" stroke="var(--line)" strokeWidth="0.5"/>
                <rect x="120" y="124" width="48" height="40" fill="none" stroke="var(--line)" strokeWidth="0.5"/>
                <rect x="168" y="124" width="60" height="40" fill="none" stroke="var(--line)" strokeWidth="0.5"/>
                {/* subject parcel */}
                <rect x="148" y="92" width="68" height="46" fill="var(--brand-soft)" stroke="var(--brand)" strokeWidth="1.5"/>
                <circle cx="182" cy="115" r="4" fill="var(--brand)"/>
                <circle cx="182" cy="115" r="10" fill="var(--brand)" opacity="0.18"/>
              </svg>
              <div className="atlas-map-overlay">
                <div className="atlas-map-loc">
                  <div className="acr-eyebrow">Section 14, T18S R5W</div>
                  <div style={{ font: '600 14px/1.3 var(--font-display)', color: 'var(--ink)' }}>Luna County, NM</div>
                </div>
                <div className="atlas-map-stats">
                  <div><span className="acr-muted">Access</span> County rd · graded</div>
                  <div><span className="acr-muted">Power</span> 0.8 mi to nearest pole</div>
                  <div><span className="acr-muted">Water</span> No well · permitted area</div>
                  <div><span className="acr-muted">Slope</span> 2–4% · usable</div>
                </div>
              </div>
            </div>
          </Card>
        </SectionTitle>

        <SectionTitle eyebrow="Owner" title="C. Pritchard · Tucson, AZ">
          <Card>
            <div className="owner-block">
              <div className="owner-row"><span className="acr-muted">Owner of record</span><span>Caroline Pritchard</span></div>
              <div className="owner-row"><span className="acr-muted">Mailing address</span><span>4218 E Speedway, Tucson AZ</span></div>
              <div className="owner-row"><span className="acr-muted">Acquired</span><span>Mar 2017 · inheritance</span></div>
              <div className="owner-row"><span className="acr-muted">Tenure</span><span>8.1 years · absentee</span></div>
              <div className="owner-row"><span className="acr-muted">Other parcels</span><span>2 in Luna · 1 in Catron</span></div>
              <div className="owner-row"><span className="acr-muted">Tax status</span><span style={{ color: 'var(--pos)' }}>Current</span></div>
              <div className="owner-row"><span className="acr-muted">Last contact</span><span>Email · Nov 14 · replied 2h</span></div>
            </div>
            <div className="owner-signals">
              <div className="acr-eyebrow" style={{ marginBottom: 6 }}>Motivation signals</div>
              <ul className="signal-list">
                <li><I.check size={11} style={{ color: 'var(--pos)' }}/> Replied to last outreach within 2h</li>
                <li><I.check size={11} style={{ color: 'var(--pos)' }}/> Sold a Catron parcel Aug 2024 — actively dispositioning</li>
                <li><I.check size={11} style={{ color: 'var(--pos)' }}/> Out-of-state owner, 8+ years, no improvements</li>
                <li><I.x size={11} style={{ color: 'var(--ink-3)' }}/> No tax delinquency or lis pendens</li>
              </ul>
            </div>
          </Card>
        </SectionTitle>
      </div>

      <SectionTitle eyebrow="Comparables" title="4 sales within 8 miles · last 180 days" action={<Button size="sm" variant="ghost">View all 12</Button>}>
        <Card padded={false}>
          <table className="tbl tbl-comps">
            <thead><tr>
              <th>#</th><th>Parcel</th><th>Distance</th><th>Acres</th>
              <th className="num">Sold</th><th className="num">$/ac</th><th>Sold</th><th>Match</th>
            </tr></thead>
            <tbody>
              {[
                ['C1', '21-088-103', '2.4 mi', 8.4,  15400, 1833, 'Oct 02', 'high'],
                ['C2', '21-091-208', '4.7 mi', 12.0, 21800, 1817, 'Sep 18', 'high'],
                ['C3', '21-104-067', '6.1 mi', 9.2,  17500, 1902, 'Aug 30', 'medium'],
                ['C4', '21-091-441', '7.8 mi', 7.8,  14200, 1821, 'Jul 12', 'medium'],
              ].map((r, i) => (
                <tr key={i} className="tbl-row">
                  <td className="mono">{r[0]}</td>
                  <td className="mono">{r[1]}</td>
                  <td>{r[2]}</td>
                  <td className="acr-tabnum">{r[3]}</td>
                  <td className="num acr-tabnum">{fmtK(r[4])}</td>
                  <td className="num acr-tabnum">${r[5]}</td>
                  <td>{r[6]}</td>
                  <td><Pill tone={r[7] === 'high' ? 'pos' : 'neutral'}>{r[7]}</Pill></td>
                </tr>
              ))}
              <tr className="tbl-row tbl-row-total">
                <td colSpan={4}><b>Median</b></td>
                <td className="num"><b className="acr-tabnum">$16,450</b></td>
                <td className="num"><b className="acr-tabnum">$1,830</b></td>
                <td colSpan={2} className="acr-muted">used as anchor</td>
              </tr>
            </tbody>
          </table>
        </Card>
      </SectionTitle>

      <SectionTitle eyebrow="Title & encumbrances" title="What we found on record">
        <Card padded={false}>
          <div className="title-checks">
            {[
              { ok: true,  label: 'Deed chain',         val: 'Clean · 3 transfers since 1968' },
              { ok: true,  label: 'Tax records',        val: '$148/yr · paid current' },
              { ok: true,  label: 'Liens',              val: 'None on record' },
              { ok: true,  label: 'Lis pendens',        val: 'None' },
              { ok: false, label: 'Easements',          val: '1 utility easement (BLM, 1973) — non-blocking' },
              { ok: true,  label: 'HOA / restrictions', val: 'None' },
              { ok: true,  label: 'FEMA flood',         val: 'Zone X · not in floodplain' },
              { ok: true,  label: 'Mineral rights',     val: 'Severed · standard for region' },
            ].map((t, i) => (
              <div key={i} className="title-row">
                <div className={cx('title-dot', t.ok ? 'title-ok' : 'title-warn')}>
                  {t.ok ? <I.check size={11}/> : <I.x size={11}/>}
                </div>
                <div className="title-name">{t.label}</div>
                <div className="title-val muted">{t.val}</div>
              </div>
            ))}
          </div>
        </Card>
      </SectionTitle>

      <div className="atlas-bottom">
        <Card>
          <div className="acr-eyebrow">Next step</div>
          <div className="atlas-next-title">Send opening offer at <b className="acr-tabnum">$11,500</b>?</div>
          <p className="muted" style={{ fontSize: 13, lineHeight: 1.55, marginTop: 6 }}>
            Pax will draft a cash offer letter and queue it for your review. Below your $5K auto-send ceiling, so you'll approve before it goes.
          </p>
          <div className="pg-actions" style={{ marginTop: 12 }}>
            <Button variant="primary" icon="arrow">Draft & review</Button>
            <Button variant="subtle" icon="folder">Save run only</Button>
            <Button variant="ghost" icon="x">Pass on this</Button>
          </div>
        </Card>
      </div>
    </div>
  );
};

// ──────────────────────────────────────────────────────────
// v2.2 · Mobile sidebar drawer
// On mobile, the sidebar lives behind a hamburger; tapping the brand opens it.
// ──────────────────────────────────────────────────────────
const MobileSidebarDrawer = ({ open, onClose, children }) => {
  if (!open) return null;
  return (
    <div className="msd-scrim" onClick={onClose}>
      <div className="msd-panel" onClick={(e) => e.stopPropagation()}>
        <div className="msd-close-bar">
          <button className="msd-close" onClick={onClose} aria-label="Close menu">
            <I.x size={16} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
};

// ──────────────────────────────────────────────────────────
// v2.5 · Pax interactivity helpers — alt copy for "Regenerate"
// ──────────────────────────────────────────────────────────
const REGEN_VARIANTS = [
  "Thanks for the counter, {name}. We can meet at $13,800 with 24-month terms, 12% APR, $500/mo. I'll send paperwork today if that works.",
  "Appreciate the counter, {name}. $13,800 works on our end with seller-finance: 24mo, 12% APR, $500/mo down. Want me to send the agreement now?",
  "{name} — middle ground at $13,800 is doable. 24-month note, $500/mo, 12% APR. Let me know and I'll have docs over by tomorrow morning.",
  "Hi {name}. We can do $13,800 — 24-month seller-finance at 12% APR, $500/mo. Standard terms, clean title, close within 30 days. Sound right?",
];

window.__regenIndex = 0;
const nextRegenDraft = (name = 'Carol') => {
  window.__regenIndex = (window.__regenIndex + 1) % REGEN_VARIANTS.length;
  return REGEN_VARIANTS[window.__regenIndex].replaceAll('{name}', name);
};

// ──────────────────────────────────────────────────────────
// CSS
// ──────────────────────────────────────────────────────────
const V2_CSS = `
  /* v2.4 clickable table rows */
  .tbl-row-clickable { cursor: pointer; }
  .tbl-row-clickable:hover { background: var(--surface-2); }

  /* v2.3 Atlas run */
  .atlas-run { display: flex; flex-direction: column; gap: 24px; }
  .trace { padding: 4px 0; }
  .trace-row {
    display: grid; grid-template-columns: 28px 1fr auto;
    gap: 12px; align-items: center;
    padding: 12px 16px;
    border-bottom: 0.5px solid var(--line-soft);
  }
  .trace-row:last-child { border-bottom: 0; }
  .trace-dot {
    width: 22px; height: 22px; border-radius: 50%;
    display: inline-flex; align-items: center; justify-content: center;
    flex-shrink: 0;
  }
  .trace-done { background: var(--pos-soft); color: var(--pos); }
  .trace-running { background: var(--brand-soft); color: var(--brand); }
  .trace-spin {
    width: 10px; height: 10px; border-radius: 50%;
    border: 2px solid currentColor; border-top-color: transparent;
    animation: trace-spin 0.8s linear infinite;
  }
  @keyframes trace-spin { to { transform: rotate(360deg); } }
  .trace-name { font: 500 13px/1.3 var(--font-sans); color: var(--ink); }
  .trace-src { font-size: 11.5px; margin-top: 2px; }
  .trace-t { color: var(--ink-3); font-size: 12px; min-width: 40px; text-align: right; }

  .reasoning { display: flex; flex-direction: column; gap: 14px; }
  .reason-row {
    display: grid; grid-template-columns: 1fr 2fr; gap: 20px;
    padding-top: 14px; border-top: 0.5px solid var(--line-soft);
  }
  .reason-row:first-child { padding-top: 0; border-top: 0; }
  .reason-q { font: 600 13.5px/1.45 var(--font-display); color: var(--ink); letter-spacing: -0.005em; text-wrap: pretty; }
  .reason-a { font-size: 13px; line-height: 1.6; color: var(--ink-2); text-wrap: pretty; }
  @media (max-width: 767px) {
    .reason-row { grid-template-columns: 1fr; gap: 6px; }
  }

  /* Atlas two-column for Location + Owner */
  .atlas-twocol { display: grid; grid-template-columns: 1.1fr 0.9fr; gap: 24px; align-items: flex-start; }
  @media (max-width: 1080px) { .atlas-twocol { grid-template-columns: 1fr; } }

  /* Stylised parcel map (SVG placeholder, intentional) */
  .atlas-map { position: relative; aspect-ratio: 16 / 10; overflow: hidden; border-radius: 12px; }
  .atlas-map-svg { width: 100%; height: 100%; display: block; }
  .atlas-map-overlay {
    position: absolute; inset: 0; padding: 14px 16px;
    display: flex; flex-direction: column; justify-content: space-between;
    background: linear-gradient(to top, color-mix(in srgb, var(--surface) 92%, transparent) 0%, transparent 30%, transparent 70%, color-mix(in srgb, var(--surface) 78%, transparent) 100%);
    pointer-events: none;
  }
  .atlas-map-loc { display: flex; flex-direction: column; gap: 2px; }
  .atlas-map-stats {
    display: grid; grid-template-columns: 1fr 1fr; gap: 4px 16px;
    font: 500 12px/1.4 var(--font-sans); color: var(--ink-2);
    background: color-mix(in srgb, var(--surface) 84%, transparent);
    -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px);
    padding: 10px 12px; border-radius: 10px;
    border: 0.5px solid var(--line-soft);
  }

  /* Owner block */
  .owner-block { display: flex; flex-direction: column; }
  .owner-row {
    display: flex; justify-content: space-between; gap: 16px;
    font: 500 12.5px/1.4 var(--font-sans); color: var(--ink);
    padding: 8px 0; border-top: 0.5px solid var(--line-soft);
  }
  .owner-row:first-child { border-top: 0; padding-top: 0; }
  .owner-signals { margin-top: 16px; padding-top: 16px; border-top: 0.5px solid var(--line-soft); }
  .signal-list {
    list-style: none; padding: 0; margin: 0;
    display: flex; flex-direction: column; gap: 6px;
    font: 500 12.5px/1.45 var(--font-sans); color: var(--ink-2);
  }
  .signal-list li { display: flex; align-items: center; gap: 8px; }

  /* Comps table (extends .tbl) */
  .tbl-comps tbody tr.tbl-row-total {
    background: var(--surface-2);
    border-top: 0.5px solid var(--line);
  }
  .tbl-comps tbody tr.tbl-row-total td { color: var(--ink); }

  /* Title checks */
  .title-checks { display: grid; grid-template-columns: 1fr 1fr; }
  @media (max-width: 768px) { .title-checks { grid-template-columns: 1fr; } }
  .title-row {
    display: grid; grid-template-columns: 22px 130px 1fr;
    gap: 10px; align-items: center;
    padding: 11px 16px;
    border-bottom: 0.5px solid var(--line-soft);
    font: 500 12.5px/1.4 var(--font-sans);
  }
  .title-row:nth-child(2n) { border-left: 0.5px solid var(--line-soft); }
  @media (max-width: 768px) { .title-row:nth-child(2n) { border-left: 0; } }
  .title-dot {
    width: 18px; height: 18px; border-radius: 50%;
    display: inline-flex; align-items: center; justify-content: center;
  }
  .title-ok { background: var(--pos-soft); color: var(--pos); }
  .title-warn { background: var(--warn-soft, color-mix(in srgb, var(--ink-3) 18%, transparent)); color: var(--ink-2); }
  .title-name { color: var(--ink); font-weight: 500; }
  .title-val { color: var(--ink-3); }

  /* Bottom CTA */
  .atlas-bottom { margin-top: 4px; }
  .atlas-next-title { font: 600 18px/1.3 var(--font-display); letter-spacing: -0.015em; color: var(--ink); margin-top: 4px; text-wrap: pretty; }

  /* v2.2 Mobile sidebar drawer */
  .msd-scrim {
    position: fixed; inset: 0; z-index: 80;
    background: color-mix(in srgb, var(--bg) 60%, transparent);
    backdrop-filter: blur(4px);
    display: none;
  }
  @media (max-width: 767px) { .msd-scrim { display: block; } }
  .msd-panel {
    position: absolute; top: 0; left: 0; bottom: 0;
    width: 280px; background: var(--surface);
    border-right: 0.5px solid var(--line);
    box-shadow: 0 0 40px rgba(0,0,0,0.18);
    display: flex; flex-direction: column;
    animation: msd-in 0.25s cubic-bezier(.2,.8,.2,1);
  }
  @keyframes msd-in { from { transform: translateX(-100%); } to { transform: none; } }
  .msd-close-bar {
    display: flex; justify-content: flex-end; padding: 10px;
    border-bottom: 0.5px solid var(--line-soft);
  }
  .msd-close {
    width: 32px; height: 32px; border-radius: 8px;
    background: transparent; border: 0.5px solid var(--line);
    color: var(--ink-2); cursor: pointer;
    display: inline-flex; align-items: center; justify-content: center;
  }
  .msd-close:hover { background: var(--surface-2); color: var(--ink); }
`;

Object.assign(window, {
  AtlasRun,
  MobileSidebarDrawer,
  PageEmptyHeader,
  nextRegenDraft,
  V2_CSS,
});
