// acreos/pax.jsx — the ambient AI surface
// One assistant, three modes (Operate / Analyze / Support), contextual.

const { useState: usePState, useRef: usePRef, useEffect: usePEffect } = React;

const AGENT_MODES = [
{ id: 'operate', label: 'Operate', sub: 'Pax', icon: 'wand', color: 'var(--accent)' },
{ id: 'analyze', label: 'Analyze', sub: 'Atlas', icon: 'sparkle', color: 'var(--brand)' },
{ id: 'support', label: 'Support', sub: 'Sophie', icon: 'shield', color: 'var(--pos)' }];


const SUGGESTED_PROMPTS = {
  operate: [
  'Queue a mailer for the 3 new Park, WY parcels',
  'Draft a $13.8K counter to R. Martinez',
  'Approve today\'s mail batch',
  'Pause the Apache campaign'],

  analyze: [
  'Score all new Costilla parcels above 5 acres',
  'Run comps on D-2198 within 2 miles',
  'Re-value Hudspeth parcel with the new comp set',
  'Which counties have the best reply rates this quarter?'],

  support: [
  'Draft a reply to Borrower #043 about late payment',
  'Summarize all open tickets',
  'What\'s our refund policy for Scale plan?']

};

const CONVERSATION = [
{ role: 'user', mode: 'analyze', text: 'Atlas, is the Apache parcel (D-2198) worth pursuing at $58K?' },
{ role: 'agent', mode: 'analyze', text: null, rich: 'atlas-analysis' },
{ role: 'user', mode: 'operate', text: 'Queue a seller-finance offer template with 24-month terms.' },
{ role: 'agent', mode: 'operate', text: null, rich: 'pax-draft' }];


// Three alternative recommendations Atlas cycles through on regenerate
const ATLAS_VARIANTS = [
  {
    pill: 'Score 79', tone: 'brand',
    body: <>Asking <b>$58K</b> sits <b style={{ color: 'var(--pos)' }}>7% below</b> median comp. Access is via county-maintained dirt road; no utilities. Owner absent since 2013 — strong motivation signal.</>,
    rec: <>Open at <b className="acr-tabnum" style={{ color: 'var(--ink)' }}>$41.5K</b> cash, fallback <b className="acr-tabnum" style={{ color: 'var(--ink)' }}>$48K</b> with 24-mo seller finance at 9%.</>,
    primary: 'Send offer at $41.5K',
  },
  {
    pill: 'Score 79 · re-run', tone: 'brand',
    body: <>Re-ran with the 30-day comp window. Three new closings tightened the band — <b>$1,510–$1,640/ac</b>. The aggressive cash play has <b style={{ color: 'var(--pos)' }}>62% acceptance</b> historically for absentee &gt; 10 yrs.</>,
    rec: <>Open at <b className="acr-tabnum" style={{ color: 'var(--ink)' }}>$38.0K</b> cash, fallback <b className="acr-tabnum" style={{ color: 'var(--ink)' }}>$46K</b> with 30-mo SF at 8.5%.</>,
    primary: 'Send aggressive at $38K',
  },
  {
    pill: 'Score 81 · adjusted', tone: 'brand',
    body: <>Pulled BLM access overlay — parcel sits <b>0.6 mi</b> from the trailhead, adds recreational premium. Two recent BLM-adjacent comps closed at <b>$1,720/ac</b>.</>,
    rec: <>Open at <b className="acr-tabnum" style={{ color: 'var(--ink)' }}>$44K</b> cash, fallback <b className="acr-tabnum" style={{ color: 'var(--ink)' }}>$52K</b> with 24-mo SF at 9%. Lead with rec value in cover letter.</>,
    primary: 'Send offer at $44K',
  },
];

const AtlasAnalysisCard = () => {
  const [v, setV] = usePState(0);
  const cur = ATLAS_VARIANTS[v];
  return (
    <div className="pax-rich" key={v}>
      <div className="pax-rich-hd">
        <div className="pax-rich-title">
          <I.sparkle size={12} style={{ color: 'var(--brand)' }} />
          <span>Atlas analysis · Apache County, AZ · 40.00 ac</span>
        </div>
        <Pill tone={cur.tone}>{cur.pill}</Pill>
      </div>
      <div className="pax-rich-grid">
        <div className="pax-rich-stat"><div className="acr-metric-label">Est. value</div><div className="pax-rich-val acr-tabnum">$62.4K</div></div>
        <div className="pax-rich-stat"><div className="acr-metric-label">Comp spread</div><div className="pax-rich-val acr-tabnum">$1,425 – $1,680/ac</div></div>
        <div className="pax-rich-stat"><div className="acr-metric-label">Days absentee</div><div className="pax-rich-val acr-tabnum">4,127</div></div>
        <div className="pax-rich-stat"><div className="acr-metric-label">Flood / FEMA</div><div className="pax-rich-val">Zone X · low</div></div>
      </div>
      <div className="pax-rich-body">
        <p>{cur.body}</p>
        <p className="acr-muted" style={{ marginBottom: 0 }}>Recommended: {cur.rec}</p>
      </div>
      <div className="pax-rich-actions">
        <Button variant="primary" size="sm">{cur.primary}</Button>
        <Button variant="subtle" size="sm">Seller-finance version</Button>
        <Button variant="ghost" size="sm" icon="wand" onClick={() => setV((v + 1) % ATLAS_VARIANTS.length)}>Regenerate</Button>
      </div>
    </div>
  );
};


const PAX_DRAFT_VARIANTS = [
  { pill: '24-mo · 9% APR', body: <>Thank you for your counter. We'd like to propose <b>$13,800</b> with <b>24-month seller financing at 9% APR</b> — $1,000 down, $587/mo — closing in 30 days, clean title. I've attached a term sheet for your review.</> },
  { pill: '36-mo · 8% APR', body: <>Thank you for your counter. We can stretch terms to <b>36 months at 8% APR</b> — same $13,800 price, $750 down, $432/mo. That gets your monthly under your stated $500 ceiling and keeps the deal moving this week.</> },
  { pill: 'Cash · short close', body: <>Thank you for your counter. If terms aren't a hard requirement, we can offer <b>$12,400 all cash, 14-day close</b>. No financing contingency, no inspection delays — funds wired to escrow on signing.</> },
];

const PaxDraftCard = () => {
  const [v, setV] = usePState(0);
  const cur = PAX_DRAFT_VARIANTS[v];
  return (
    <div className="pax-rich" key={v}>
      <div className="pax-rich-hd">
        <div className="pax-rich-title">
          <I.wand size={12} style={{ color: 'var(--accent)' }} />
          <span>Pax drafted · Seller-finance LOI template</span>
        </div>
        <Pill tone="neutral">{cur.pill}</Pill>
      </div>
      <div className="pax-letter">
        <div className="pax-letter-line"><span className="acr-muted">To</span> R. Martinez · 1842 Cerro Vista, Costilla, CO</div>
        <div className="pax-letter-line"><span className="acr-muted">Re</span> Parcel 37-091-014 · 5.12 acres</div>
        <div className="pax-letter-divider" />
        <p>Dear Ms. Martinez,</p>
        <p>{cur.body}</p>
        <p>We can fund immediately upon signing.</p>
      </div>
      <div className="pax-rich-actions">
        <Button variant="primary" size="sm" icon="check">Send as-is</Button>
        <Button variant="subtle" size="sm">Edit terms</Button>
        <Button variant="ghost" size="sm" icon="wand" onClick={() => setV((v + 1) % PAX_DRAFT_VARIANTS.length)}>Regenerate</Button>
      </div>
    </div>
  );
};


const PaxMessage = ({ m }) => {
  if (m.role === 'user') {
    return (
      <div className="pax-msg pax-msg-user">
        <div className="pax-bubble pax-bubble-user">{m.text}</div>
      </div>);

  }
  return (
    <div className="pax-msg pax-msg-agent">
      <div className="pax-agent-icon" style={{ color: AGENT_MODES.find((x) => x.id === m.mode)?.color }}>
        {m.mode === 'analyze' ? <I.sparkle size={13} /> : m.mode === 'operate' ? <I.wand size={13} /> : <I.shield size={13} />}
      </div>
      <div className="pax-bubble pax-bubble-agent">
        {m.text && <p style={{ margin: 0 }}>{m.text}</p>}
        {m.rich === 'atlas-analysis' && <AtlasAnalysisCard />}
        {m.rich === 'pax-draft' && <PaxDraftCard />}
      </div>
    </div>);

};

const Pax = () => {
  const [mode, setMode] = usePState(() => {
    try { return localStorage.getItem('acr.pax.mode') || 'operate'; } catch { return 'operate'; }
  });
  const [input, setInput] = usePState('');
  const ta = usePRef(null);

  usePEffect(() => {ta.current && ta.current.focus();}, []);
  usePEffect(() => {
    try { localStorage.setItem('acr.pax.mode', mode); } catch {}
  }, [mode]);

  const current = AGENT_MODES.find((a) => a.id === mode);
  // Show the conversation slice that matches the selected mode.
  // If nothing matches (e.g. support), show the most recent two messages.
  const visibleConvo = (() => {
    const filtered = CONVERSATION.filter(m => m.mode === mode);
    return filtered.length ? filtered : CONVERSATION.slice(-2);
  })();

  return (
    <div className="pax-page">
      <div className="pax-shell">
        {/* Left context rail */}
        <aside className="pax-context">
          <div className="acr-eyebrow">Context</div>
          <div className="pax-ctx-card">
            <div className="pax-ctx-title">D-2198 · Apache County</div>
            <div className="pax-ctx-sub">40 ac · Blue Ridge LLC · $58K</div>
            <div className="pax-ctx-row"><span className="acr-muted">Score</span><span>79 · medium</span></div>
            <div className="pax-ctx-row"><span className="acr-muted">Stage</span><span>Analyzing</span></div>
            <div className="pax-ctx-row"><span className="acr-muted">Last touch</span><span>26h ago</span></div>
          </div>

          <div className="acr-eyebrow" style={{ marginTop: 18 }}>Recent threads</div>
          <div className="pax-threads">
            {[
            { t: 'Pricing strategy for Hudspeth', when: 'Today' },
            { t: 'Draft counter — R. Martinez', when: 'Today' },
            { t: 'Review Q1 mail performance', when: 'Yesterday' },
            { t: 'Onboard new VA · call script', when: 'Mon' },
            { t: 'Tax-lien angle for Luna', when: 'Apr 18' }].
            map((t, i) =>
            <button key={i} className={cx('pax-thread', i === 1 && 'pax-thread-active')}>
                <div className="pax-thread-t">{t.t}</div>
                <div className="pax-thread-w">{t.when}</div>
              </button>
            )}
          </div>

          <div className="pax-autonomy">
            <div className="pax-autonomy-hd">
              <I.leaf size={13} style={{ color: 'var(--pos)' }} />
              <span>Autonomy</span>
            </div>
            <div className="pax-autonomy-body">AcreOS will act without asking for routine tasks. User approval required above $5K.

            </div>
            <Button variant="subtle" size="sm">Adjust</Button>
          </div>
        </aside>

        {/* Main conversation */}
        <main className="pax-main">
          <div className="pax-main-hd">
            <div>
              <div className="acr-eyebrow">AcreOS Intelligence</div>
              <h1 className="pax-h1">How can I help?</h1>
              <p className="pax-sub">One assistant across the platform. It picks the right mode — you can override.</p>
            </div>
          </div>

          {/* Mode segmented */}
          <div className="pax-mode">
            {AGENT_MODES.map((a) => {
              const Ic = I[a.icon];
              return (
                <button key={a.id} onClick={() => setMode(a.id)}
                className={cx('pax-mode-btn', mode === a.id && 'pax-mode-btn-active')}
                style={mode === a.id ? { '--m': a.color } : undefined}>
                  <Ic size={13} />
                  <span>{a.label}</span>
                  <span className="pax-mode-sub">· {a.sub}</span>
                </button>);

            })}
            <div className="pax-mode-auto">
              <Pill tone="ghost" dot>Auto</Pill>
            </div>
          </div>

          {/* Conversation */}
          <div className="pax-thread-body">
            {visibleConvo.map((m, i) => <PaxMessage key={mode + '-' + i} m={m} />)}
            {mode === 'support' && (
              <div className="pax-msg pax-msg-agent">
                <div className="pax-agent-icon" style={{ color: 'var(--pos)' }}><I.shield size={13} /></div>
                <div className="pax-bubble pax-bubble-agent">
                  <p style={{ margin: 0 }}>
                    Sophie here. I can answer product questions, walk through any feature, or open a ticket if something's broken. What's on your mind?
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Composer */}
          <div className="pax-composer-wrap">
            <div className="pax-suggestions">
              {SUGGESTED_PROMPTS[mode].map((s, i) =>
              <button key={i} className="pax-suggestion" onClick={() => setInput(s)}>{s}</button>
              )}
            </div>
            <div className="pax-composer">
              <div className="pax-composer-mode" style={{ color: current.color }}>
                {React.createElement(I[current.icon], { size: 14 })}
                <span>{current.sub}</span>
              </div>
              <textarea
                ref={ta}
                className="pax-input"
                placeholder={`Ask ${current.sub} anything…`}
                rows={1}
                value={input}
                onChange={(e) => setInput(e.target.value)} />
              
              <div className="pax-composer-r">
                <button className="pax-icon-btn" title="Attach"><I.folder size={14} /></button>
                <button className="pax-icon-btn" title="Context"><I.pin size={14} /></button>
                <Button variant="primary" size="sm" icon="arrow" />
              </div>
            </div>
            <div className="pax-hint">
              <Kbd>⌘</Kbd><Kbd>↵</Kbd> to send · <Kbd>⌘</Kbd><Kbd>/</Kbd> to switch mode · <Kbd>⌘</Kbd><Kbd>K</Kbd> for commands
            </div>
          </div>
        </main>
      </div>
    </div>);

};

const PAX_CSS = `
  .pax-page { height: 100%; }
  .pax-shell { display: grid; grid-template-columns: 280px minmax(0,1fr); gap: 24px; align-items: flex-start; }
  @media (max-width: 1100px) { .pax-shell { grid-template-columns: 1fr; } .pax-context { display: none; } }

  /* Context rail */
  .pax-context { position: sticky; top: 86px; display: flex; flex-direction: column; gap: 6px; }
  .pax-ctx-card { background: var(--surface); border: 0.5px solid var(--line); border-radius: 12px; padding: 14px; box-shadow: var(--shadow-1); margin-top: 2px; }
  .pax-ctx-title { font: 600 13px/1.25 var(--font-display); letter-spacing: -0.01em; color: var(--ink); }
  .pax-ctx-sub   { font: 500 11.5px/1.25 var(--font-sans); color: var(--ink-3); margin-top: 2px; margin-bottom: 10px; }
  .pax-ctx-row   { display: flex; justify-content: space-between; padding: 5px 0; font: 500 12px/1 var(--font-sans); color: var(--ink-2); border-top: 0.5px solid var(--line-soft); }

  .pax-threads { display: flex; flex-direction: column; gap: 1px; margin-top: 6px; }
  .pax-thread { text-align: left; background: transparent; border: 0; padding: 8px 10px; border-radius: 7px; color: var(--ink-2); cursor: default; }
  .pax-thread:hover { background: var(--surface-2); }
  .pax-thread-active { background: var(--surface); box-shadow: var(--shadow-1), inset 0 0 0 0.5px var(--line); }
  .pax-thread-t { font: 500 12.5px/1.3 var(--font-sans); color: var(--ink); letter-spacing: -0.005em; }
  .pax-thread-w { font: 500 11px/1 var(--font-sans); color: var(--ink-3); margin-top: 3px; }

  .pax-autonomy { margin-top: 18px; padding: 12px 14px; border-radius: 12px; border: 0.5px dashed var(--line); background: var(--pos-soft); }
  .pax-autonomy-hd { display: flex; align-items: center; gap: 6px; font: 600 12px/1 var(--font-sans); color: var(--ink); }
  .pax-autonomy-body { font: 400 11.5px/1.5 var(--font-sans); color: var(--ink-2); margin: 8px 0 10px; }

  /* Main */
  .pax-main { display: flex; flex-direction: column; gap: 18px; min-height: calc(100vh - 140px); }
  .pax-main-hd { margin-bottom: 4px; }
  .pax-h1 { font: 600 32px/1.1 var(--font-display); letter-spacing: -0.03em; color: var(--ink); margin: 4px 0 4px; text-wrap: pretty; }
  .pax-sub { font: 400 13.5px/1.5 var(--font-sans); color: var(--ink-2); margin: 0; max-width: 580px; text-wrap: pretty; }

  /* Mode segmented */
  .pax-mode {
    display: inline-flex; padding: 3px; gap: 2px;
    background: var(--surface); border: 0.5px solid var(--line); border-radius: 10px;
    box-shadow: var(--shadow-1); align-self: flex-start; align-items: center;
  }
  .pax-mode-btn {
    display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px;
    border-radius: 7px; border: 0; background: transparent;
    font: 500 12.5px/1 var(--font-sans); color: var(--ink-2); cursor: default;
    transition: background .1s, color .1s;
  }
  .pax-mode-btn:hover { background: var(--surface-2); color: var(--ink); }
  .pax-mode-btn-active {
    background: var(--surface-2); color: var(--ink); font-weight: 600;
    box-shadow: inset 0 0 0 0.5px var(--line-soft);
    position: relative;
  }
  .pax-mode-btn-active::before {
    content: ''; position: absolute; left: 8px; bottom: 3px; height: 2px; width: calc(100% - 16px);
    background: var(--m); border-radius: 2px;
  }
  .pax-mode-sub { color: var(--ink-3); font-weight: 500; }
  .pax-mode-auto { padding: 0 8px; border-left: 0.5px solid var(--line-soft); margin-left: 4px; }

  /* Conversation */
  .pax-thread-body { display: flex; flex-direction: column; gap: 18px; padding: 4px 0 16px; flex: 1; }
  .pax-msg { display: flex; gap: 10px; max-width: 820px; }
  .pax-msg-user { justify-content: flex-end; align-self: flex-end; }
  .pax-msg-agent { align-self: flex-start; }
  .pax-bubble { border-radius: 14px; padding: 12px 14px; font: 400 13.5px/1.55 var(--font-sans); color: var(--ink); text-wrap: pretty; }
  .pax-bubble-user { background: var(--ink); color: var(--bg); max-width: 560px; border-bottom-right-radius: 4px; }
  .pax-bubble-agent { background: var(--surface); border: 0.5px solid var(--line); box-shadow: var(--shadow-1); }
  .pax-agent-icon { width: 28px; height: 28px; border-radius: 8px; display: inline-flex; align-items: center; justify-content: center; background: var(--surface-2); border: 0.5px solid var(--line-soft); flex-shrink: 0; margin-top: 2px; }

  /* Rich cards inside bubbles */
  .pax-rich { display: flex; flex-direction: column; gap: 10px; min-width: 420px; }
  .pax-rich-hd { display: flex; justify-content: space-between; align-items: center; padding-bottom: 6px; border-bottom: 0.5px solid var(--line-soft); }
  .pax-rich-title { display: inline-flex; gap: 6px; align-items: center; font: 600 12px/1 var(--font-sans); color: var(--ink); letter-spacing: -0.005em; }
  .pax-rich-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px 20px; padding: 4px 0; }
  .pax-rich-stat .acr-metric-label { font-size: 10.5px; margin-bottom: 3px; }
  .pax-rich-val { font: 600 14px/1.1 var(--font-display); letter-spacing: -0.01em; color: var(--ink); }
  .pax-rich-body { font: 400 12.5px/1.55 var(--font-sans); color: var(--ink-2); }
  .pax-rich-body p { margin: 0 0 8px; }
  .pax-rich-actions { display: flex; gap: 6px; flex-wrap: wrap; }

  .pax-letter {
    background: var(--bg-sunken); border: 0.5px solid var(--line-soft);
    border-radius: 10px; padding: 14px 16px; font: 400 12.5px/1.55 var(--font-sans); color: var(--ink-2);
  }
  .pax-letter p { margin: 0 0 8px; }
  .pax-letter-line { display: flex; gap: 10px; font: 500 11.5px/1.4 var(--font-sans); }
  .pax-letter-divider { height: 0.5px; background: var(--line); margin: 8px 0 10px; }

  /* Composer */
  .pax-composer-wrap { position: sticky; bottom: 0; padding-top: 12px; padding-bottom: 4px; background: linear-gradient(to top, var(--bg) 60%, transparent); display: flex; flex-direction: column; gap: 8px; }
  .pax-suggestions { display: flex; gap: 6px; flex-wrap: wrap; }
  .pax-suggestion {
    background: var(--surface); border: 0.5px solid var(--line); border-radius: 999px;
    padding: 5px 12px; font: 500 12px/1.2 var(--font-sans); color: var(--ink-2);
    cursor: default; transition: background .1s, color .1s, border-color .1s;
  }
  .pax-suggestion:hover { background: var(--surface-2); color: var(--ink); }

  .pax-composer {
    display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 10px;
    background: var(--surface); border: 0.5px solid var(--line);
    border-radius: 14px; padding: 8px 10px 8px 14px; box-shadow: var(--shadow-2);
  }
  .pax-composer:focus-within { box-shadow: var(--shadow-2), var(--ring); }
  .pax-composer-mode { display: inline-flex; align-items: center; gap: 5px; font: 600 11.5px/1 var(--font-sans); padding-right: 10px; border-right: 0.5px solid var(--line-soft); height: 22px; }
  .pax-input { resize: none; border: 0; outline: 0; background: transparent; color: var(--ink); font: 400 13.5px/1.5 var(--font-sans); min-height: 22px; padding: 2px 0; max-height: 180px; }
  .pax-input::placeholder { color: var(--ink-3); }
  .pax-composer-r { display: inline-flex; gap: 4px; align-items: center; }
  .pax-icon-btn { width: 28px; height: 28px; border-radius: 7px; border: 0; background: transparent; color: var(--ink-3); display: inline-flex; align-items: center; justify-content: center; cursor: default; }
  .pax-icon-btn:hover { background: var(--surface-2); color: var(--ink); }

  .pax-hint { font: 500 11px/1.4 var(--font-sans); color: var(--ink-3); padding: 0 4px; display: flex; gap: 4px; align-items: center; flex-wrap: wrap; }
  .pax-hint .acr-kbd { margin: 0 1px; }
`;

Object.assign(window, { Pax, PAX_CSS });