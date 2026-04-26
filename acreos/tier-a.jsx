// acreos/tier-a.jsx — Tier A foundations: AIOutput, responsive, a11y, confirmation

const { useState: useAS, useEffect: useAE, useRef: useAR } = React;

// ──────────────────────────────────────────────────────────
// A1 · Unified AI Output primitive
// One shape for Atlas, Pax, Sophie. Always answers: who, how sure, why.
// ──────────────────────────────────────────────────────────

const AGENTS = {
  atlas:  { label: 'Atlas',  color: 'var(--brand)', tag: 'Analysis' },
  pax:    { label: 'Pax',    color: 'var(--accent)', tag: 'Assist' },
  sophie: { label: 'Sophie', color: 'var(--pos)', tag: 'Support' },
};

// confidence: 'high' | 'medium' | 'low' | 'thin'
const CONF = {
  high:   { label: 'High',        hint: 'Well-grounded',   tone: 'pos'     },
  medium: { label: 'Medium',      hint: 'Some uncertainty',tone: 'neutral' },
  low:    { label: 'Low',         hint: 'Early signal',    tone: 'warn'    },
  thin:   { label: 'Thin data',   hint: 'Not enough evidence', tone: 'neg' },
};

/**
 * <AIOutput
 *    agent="atlas|pax|sophie"
 *    shape="inline|card|hero"
 *    confidence="high|medium|low|thin"
 *    confidenceDetail="4 comps within 8mi"
 *    headline="Offer Pritchard at $11,500"
 *    body="…"
 *    inputs={[{label:'Comps', value:'4 sales'}, …]}  // shown in Why
 *    grounding={[{label, href?}]}                     // source chips
 *    autonomy={{level:2, willAutoSend:true}}          // trust badge
 *    actions={[{label, variant, onClick, confirm?}]}
 *    timestamp="3m"
 * />
 */
const AIOutput = ({
  agent = 'atlas',
  shape = 'card',
  confidence = 'medium',
  confidenceDetail,
  headline,
  body,
  inputs = [],
  grounding = [],
  autonomy,
  actions = [],
  timestamp,
  children,
}) => {
  const [whyOpen, setWhyOpen] = useAS(false);
  const [pendingAction, setPendingAction] = useAS(null);
  const a = AGENTS[agent] || AGENTS.atlas;
  const c = CONF[confidence] || CONF.medium;

  const Header = (
    <div className="aio-hd">
      <span className="aio-agent" style={{ ['--agent-color']: a.color }}>
        <span className="aio-dot" />
        <b>{a.label}</b>
        <span className="aio-tag">{a.tag}</span>
      </span>
      <span className="aio-meta">
        <Pill tone={c.tone}>{c.label}{confidenceDetail ? ` · ${confidenceDetail}` : ''}</Pill>
        {autonomy && (
          <Pill tone={autonomy.willAutoSend ? 'warn' : 'neutral'}>
            <I.shield size={10}/> L{autonomy.level}{autonomy.willAutoSend ? ' · auto at L3' : ''}
          </Pill>
        )}
        {timestamp && <span className="aio-ts">{timestamp}</span>}
      </span>
    </div>
  );

  // inline = one-liner, no card (for chat replies that are direct answers)
  if (shape === 'inline') {
    return (
      <div className="aio-inline">
        <span className="aio-dot" style={{ background: a.color }} />
        <div className="aio-inline-body">
          <span className="aio-inline-agent">{a.label}</span>
          <span>{headline || body}</span>
        </div>
      </div>
    );
  }

  const Grounding = (inputs.length > 0 || grounding.length > 0) && (
    <div className={cx('aio-why', whyOpen && 'aio-why-open')}>
      {inputs.length > 0 && (
        <div className="aio-why-section">
          <div className="aio-why-label">Inputs used</div>
          <dl className="aio-why-list">
            {inputs.map((inp, i) => (
              <React.Fragment key={i}><dt>{inp.label}</dt><dd>{inp.value}</dd></React.Fragment>
            ))}
          </dl>
        </div>
      )}
      {grounding.length > 0 && (
        <div className="aio-why-section">
          <div className="aio-why-label">Sources</div>
          <div className="aio-why-chips">
            {grounding.map((g, i) => (
              <a key={i} href={g.href || '#'} onClick={e=>e.preventDefault()} className="aio-chip">
                <I.link size={10}/> {g.label}
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );

  const ActionsRow = actions.length > 0 && (
    pendingAction ? (
      <div className="aio-confirm">
        <div className="aio-confirm-body">
          <I.shield size={14}/>
          <div>
            <b>{pendingAction.confirm?.title || 'Confirm?'}</b>
            <div className="aio-confirm-detail">{pendingAction.confirm?.detail}</div>
          </div>
        </div>
        <div className="aio-confirm-actions">
          <Button size="sm" variant="ghost" onClick={()=>setPendingAction(null)}>Cancel</Button>
          <Button size="sm" variant="primary" onClick={()=>{ pendingAction.onClick?.(); setPendingAction(null); }}>
            {pendingAction.confirm?.cta || 'Confirm'}
          </Button>
        </div>
      </div>
    ) : (
      <div className="aio-actions">
        {actions.map((ax, i) => (
          <Button
            key={i}
            size="sm"
            variant={ax.variant || (i === actions.length - 1 ? 'primary' : 'subtle')}
            icon={ax.icon}
            onClick={() => ax.confirm ? setPendingAction(ax) : ax.onClick?.()}
          >
            {ax.label}
          </Button>
        ))}
      </div>
    )
  );

  // hero shape: larger, for the anchor of a page
  // card shape: standard
  return (
    <div className={cx('aio', `aio-${shape}`)} style={{ ['--agent-color']: a.color }}>
      {Header}
      {headline && <div className="aio-headline">{headline}</div>}
      {body && <div className="aio-body">{body}</div>}
      {children}
      {(inputs.length > 0 || grounding.length > 0) && (
        <button
          className="aio-why-toggle"
          aria-expanded={whyOpen}
          onClick={()=>setWhyOpen(v=>!v)}
        >
          <I.chevDn size={11} style={{ transform: whyOpen ? 'rotate(180deg)' : 'none' }}/>
          {whyOpen ? 'Hide reasoning' : 'Why this'}
          {!whyOpen && <span className="aio-why-count">{inputs.length + grounding.length}</span>}
        </button>
      )}
      {Grounding}
      {ActionsRow}
    </div>
  );
};

// ──────────────────────────────────────────────────────────
// A4 · Reusable confirmation strip (standalone, non-AI contexts)
// ──────────────────────────────────────────────────────────
const ConfirmAction = ({ label, variant = 'primary', icon, title, detail, cta, typeWord, onConfirm }) => {
  const [open, setOpen] = useAS(false);
  const [typed, setTyped] = useAS('');
  const ok = !typeWord || typed.trim().toUpperCase() === typeWord.toUpperCase();
  if (!open) return <Button variant={variant} icon={icon} onClick={()=>setOpen(true)}>{label}</Button>;
  return (
    <div className="confirm-strip">
      <div className="confirm-body">
        <I.shield size={14}/>
        <div>
          <b>{title}</b>
          {detail && <div className="confirm-detail">{detail}</div>}
          {typeWord && (
            <div className="confirm-type">
              <label className="confirm-type-label">Type <code>{typeWord}</code> to confirm</label>
              <input
                className="confirm-type-input"
                value={typed}
                onChange={e=>setTyped(e.target.value)}
                autoFocus
                aria-label={`Type ${typeWord} to confirm`}
              />
            </div>
          )}
        </div>
      </div>
      <div className="confirm-actions">
        <Button size="sm" variant="ghost" onClick={()=>{ setOpen(false); setTyped(''); }}>Cancel</Button>
        <Button size="sm" variant="primary" disabled={!ok} onClick={()=>{ onConfirm?.(); setOpen(false); setTyped(''); }}>
          {cta || 'Confirm'}
        </Button>
      </div>
    </div>
  );
};

// ──────────────────────────────────────────────────────────
// A2 · Responsive helpers
// ──────────────────────────────────────────────────────────
const useViewport = () => {
  const [w, setW] = useAS(typeof window !== 'undefined' ? window.innerWidth : 1280);
  useAE(() => {
    const onR = () => setW(window.innerWidth);
    window.addEventListener('resize', onR);
    return () => window.removeEventListener('resize', onR);
  }, []);
  return { w, mobile: w < 768, tablet: w >= 768 && w < 1080, desktop: w >= 1080 };
};

// Mobile bottom tab bar
const MobileTabBar = ({ active, onNavigate, onOpenPalette, onAmbient }) => (
  <nav className="m-tabbar" aria-label="Primary">
    <button className={cx('m-tab', active==='home' && 'm-tab-on')} onClick={()=>onNavigate('home')} aria-current={active==='home'?'page':undefined}>
      <I.home size={20}/><span>Today</span>
    </button>
    <button className={cx('m-tab', active==='inbox' && 'm-tab-on')} onClick={()=>onNavigate('inbox')} aria-current={active==='inbox'?'page':undefined}>
      <I.inbox size={20}/><span>Inbox</span>
    </button>
    <button className="m-tab m-tab-ask" onClick={onAmbient}>
      <span className="m-tab-ask-dot"><I.sparkle size={18}/></span>
      <span>Ask</span>
    </button>
    <button className={cx('m-tab', active==='pipeline' && 'm-tab-on')} onClick={()=>onNavigate('pipeline')} aria-current={active==='pipeline'?'page':undefined}>
      <I.pipeline size={20}/><span>Deals</span>
    </button>
    <button className="m-tab" onClick={onOpenPalette}>
      <I.menu size={20}/><span>More</span>
    </button>
  </nav>
);

// ──────────────────────────────────────────────────────────
// A3 · Skip-link + a11y utilities
// ──────────────────────────────────────────────────────────
const SkipToContent = () => (
  <a className="skip-link" href="#acr-main-content">Skip to main content</a>
);

// ──────────────────────────────────────────────────────────
// CSS
// ──────────────────────────────────────────────────────────
const TIER_A_CSS = `
  /* =========== A1 · AIOutput =========== */
  .aio {
    background: var(--surface);
    border: 0.5px solid var(--line);
    border-left: 2px solid var(--agent-color);
    border-radius: 12px;
    padding: 16px 18px;
    box-shadow: var(--shadow-1);
    display: flex; flex-direction: column; gap: 10px;
  }
  .aio-hero {
    padding: 24px 28px;
    border-radius: 16px;
    background: linear-gradient(180deg, color-mix(in srgb, var(--agent-color) 6%, var(--surface)), var(--surface));
    border-left-width: 3px;
  }

  .aio-hd {
    display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap;
    font-size: 12px;
  }
  .aio-agent { display: inline-flex; align-items: center; gap: 6px; color: var(--ink-2); }
  .aio-agent b { color: var(--agent-color); font-weight: 600; font-size: 12.5px; }
  .aio-agent .aio-tag {
    font: 500 10.5px/1 var(--font-sans); letter-spacing: 0.06em; text-transform: uppercase;
    color: var(--ink-3); padding-left: 6px; border-left: 1px solid var(--line); margin-left: 4px;
  }
  .aio-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--agent-color); }
  .aio-meta { display: inline-flex; gap: 6px; align-items: center; }
  .aio-ts { color: var(--ink-3); font-size: 11.5px; }

  .aio-headline {
    font: 600 16px/1.3 var(--font-display); letter-spacing: -0.015em; color: var(--ink);
  }
  .aio-hero .aio-headline { font-size: 22px; line-height: 1.25; letter-spacing: -0.02em; }
  .aio-body { font-size: 13.5px; line-height: 1.55; color: var(--ink-2); }
  .aio-hero .aio-body { font-size: 14.5px; line-height: 1.6; }

  .aio-why-toggle {
    display: inline-flex; align-items: center; gap: 6px; align-self: flex-start;
    background: transparent; border: 0; padding: 4px 8px; margin-left: -8px;
    color: var(--ink-3); font: 500 12px/1 var(--font-sans); border-radius: 6px;
    cursor: pointer; transition: color .1s, background .1s;
  }
  .aio-why-toggle:hover { background: var(--surface-2); color: var(--ink); }
  .aio-why-toggle:focus-visible { box-shadow: var(--ring); outline: none; }
  .aio-why-count {
    background: var(--surface-2); color: var(--ink-3); padding: 1px 6px;
    border-radius: 999px; font-size: 10.5px; margin-left: 2px;
  }

  .aio-why {
    display: grid; grid-template-rows: 0fr; transition: grid-template-rows .2s ease, margin .2s;
    overflow: hidden;
  }
  .aio-why > * { min-height: 0; }
  .aio-why-open { grid-template-rows: 1fr; margin-top: -4px; }
  .aio-why-section { padding: 10px 12px; background: var(--surface-2); border-radius: 8px; margin-bottom: 8px; }
  .aio-why-section:last-child { margin-bottom: 0; }
  .aio-why-label {
    font: 500 10.5px/1 var(--font-sans); letter-spacing: 0.06em;
    text-transform: uppercase; color: var(--ink-3); margin-bottom: 6px;
  }
  .aio-why-list {
    display: grid; grid-template-columns: auto 1fr; gap: 4px 14px; margin: 0;
    font-size: 12.5px;
  }
  .aio-why-list dt { color: var(--ink-3); }
  .aio-why-list dd { margin: 0; color: var(--ink); font-variant-numeric: tabular-nums; }
  .aio-why-chips { display: flex; gap: 6px; flex-wrap: wrap; }
  .aio-chip {
    display: inline-flex; align-items: center; gap: 4px;
    background: var(--surface); border: 0.5px solid var(--line);
    color: var(--ink-2); font-size: 11.5px; padding: 3px 8px; border-radius: 6px;
    text-decoration: none;
  }
  .aio-chip:hover { border-color: var(--agent-color); color: var(--agent-color); }
  .aio-chip:focus-visible { box-shadow: var(--ring); outline: none; }

  .aio-actions { display: flex; gap: 6px; justify-content: flex-end; flex-wrap: wrap; }

  .aio-inline {
    display: flex; gap: 8px; align-items: flex-start;
    padding: 8px 10px; border-radius: 8px; background: var(--surface-2);
    font-size: 13px; color: var(--ink-2); line-height: 1.5;
  }
  .aio-inline .aio-dot { margin-top: 6px; flex-shrink: 0; }
  .aio-inline-agent { font-weight: 600; color: var(--ink); margin-right: 4px; }

  /* =========== A4 · Confirm strip =========== */
  .aio-confirm, .confirm-strip {
    display: flex; align-items: center; justify-content: space-between; gap: 12px;
    padding: 10px 14px; background: var(--warn-soft); border-radius: 8px;
    border: 0.5px solid color-mix(in srgb, var(--warn) 30%, transparent);
  }
  .aio-confirm-body, .confirm-body {
    display: flex; gap: 10px; align-items: flex-start; color: var(--ink);
    font-size: 12.5px;
  }
  .aio-confirm-body b, .confirm-body b { display: block; font: 600 13px/1.3 var(--font-sans); letter-spacing: -0.005em; }
  .aio-confirm-detail, .confirm-detail { color: var(--ink-2); font-size: 12px; margin-top: 2px; }
  .aio-confirm-actions, .confirm-actions { display: flex; gap: 6px; flex-shrink: 0; }
  .confirm-type { margin-top: 8px; display: flex; align-items: center; gap: 8px; }
  .confirm-type-label { font-size: 11.5px; color: var(--ink-2); }
  .confirm-type-label code {
    background: var(--surface); padding: 1px 6px; border-radius: 4px;
    font: 600 11px/1 var(--font-mono); color: var(--ink);
  }
  .confirm-type-input {
    border: 0.5px solid var(--line); background: var(--surface); color: var(--ink);
    padding: 4px 8px; border-radius: 6px; font: 500 12px/1 var(--font-mono);
    width: 100px;
  }
  .confirm-type-input:focus-visible { outline: none; box-shadow: var(--ring); border-color: var(--brand); }

  /* =========== A3 · Focus + skip link =========== */
  .skip-link {
    position: absolute; top: 8px; left: 8px; padding: 8px 14px;
    background: var(--ink); color: var(--bg); border-radius: 8px;
    font: 500 13px/1 var(--font-sans); z-index: 100;
    transform: translateY(-150%); transition: transform .15s;
    text-decoration: none;
  }
  .skip-link:focus { transform: translateY(0); }

  button:focus-visible, a:focus-visible, [role="button"]:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible {
    outline: none;
    box-shadow: var(--ring);
  }

  /* Kill the cursor:default we applied globally; only kbd/static stays */
  .acr-btn, .acr-nav-item, .acr-icon-btn, .inbox-item, .inbox-tab, .kb-card, .tbl-row,
  .seg-b, .chip, .qa-btn, .aio-why-toggle, .aio-chip { cursor: pointer; }

  /* =========== A2 · Responsive =========== */

  /* Mobile tab bar (hidden ≥ 768px) */
  .m-tabbar { display: none; }
  .acr-mobile-only { display: none; }

  @media (max-width: 767px) {
    .acr-sidebar { display: none; }
    .acr-app { grid-template-columns: 1fr; }
    .acr-content { padding: 16px 14px 96px; }
    .acr-topbar { padding: 10px 14px; gap: 10px; }
    .acr-page-title { font-size: 16px; }
    .acr-crumbs { display: none; }
    .acr-mobile-only { display: inline-flex; }

    /* Mobile drawer */
    .acr-drawer-scrim {
      position: fixed; inset: 0; background: color-mix(in srgb, #000 38%, transparent);
      -webkit-backdrop-filter: blur(2px); backdrop-filter: blur(2px);
      z-index: 60; animation: acr-fade-in .18s ease-out both;
    }
    .acr-drawer {
      position: fixed; top: 0; bottom: 0; left: 0; z-index: 61;
      width: min(282px, 84vw);
      background: var(--sidebar-bg);
      border-right: 0.5px solid var(--line);
      box-shadow: 0 24px 64px color-mix(in srgb, #000 28%, transparent);
      animation: acr-drawer-in .22s cubic-bezier(.3,.7,.4,1) both;
      overflow: hidden;
    }
    .acr-drawer .acr-sidebar {
      display: flex !important; position: static; width: 100% !important;
      height: 100%; padding: 14px 10px;
    }
    @keyframes acr-fade-in { from { opacity: 0 } to { opacity: 1 } }
    @keyframes acr-drawer-in { from { transform: translateX(-100%) } to { transform: translateX(0) } }

    .m-tabbar {
      position: fixed; bottom: 0; left: 0; right: 0;
      display: grid; grid-template-columns: repeat(5, 1fr);
      background: color-mix(in srgb, var(--surface) 92%, transparent);
      -webkit-backdrop-filter: blur(20px); backdrop-filter: blur(20px);
      border-top: 0.5px solid var(--line);
      padding: 6px 6px calc(6px + env(safe-area-inset-bottom, 0px));
      z-index: 30;
    }
    .m-tab {
      display: flex; flex-direction: column; align-items: center; gap: 2px;
      background: transparent; border: 0; color: var(--ink-3);
      font: 500 10px/1 var(--font-sans); padding: 8px 4px; min-height: 48px;
      border-radius: 10px; cursor: pointer;
    }
    .m-tab span { letter-spacing: 0.01em; }
    .m-tab-on { color: var(--brand); }
    .m-tab:focus-visible { outline: none; background: var(--surface-2); }
    .m-tab-ask { position: relative; }
    .m-tab-ask-dot {
      display: inline-flex; align-items: center; justify-content: center;
      width: 42px; height: 42px; border-radius: 50%;
      background: var(--brand); color: var(--brand-ink);
      box-shadow: 0 6px 18px color-mix(in srgb, var(--brand) 36%, transparent);
      margin-bottom: -2px; margin-top: -8px;
    }
    .m-tab-ask { color: var(--ink); }

    /* Tables → stacked cards */
    .tbl { display: block; }
    .tbl thead { display: none; }
    .tbl tbody, .tbl tr { display: block; }
    .tbl tr {
      border: 0.5px solid var(--line); border-radius: 10px; padding: 10px 12px;
      margin-bottom: 8px; background: var(--surface);
      display: grid; grid-template-columns: 1fr auto; gap: 4px 12px; align-items: center;
    }
    .tbl td {
      display: block; padding: 2px 0; border: 0; font-size: 13px;
    }
    .tbl td:first-child { grid-column: 1; font-weight: 600; color: var(--ink); }
    .tbl td.num { text-align: left; }
    .tbl-row:hover td { background: transparent; }

    /* Parcel detail */
    .parcel-grid { grid-template-columns: 1fr; }
    .parcel-hd { flex-direction: column; align-items: flex-start; }
    .parcel-hd .pg-actions { flex-wrap: wrap; width: 100%; }
    .parcel-hd .pg-actions .acr-btn { flex: 1 1 auto; min-height: 44px; }
    .atlas-row { grid-template-columns: 1fr; gap: 14px; }
    .atlas-score-big { border-right: 0; border-bottom: 0.5px solid var(--line); padding: 0 0 14px; text-align: left; }

    /* Kanban */
    .kb { grid-template-columns: 1fr; }

    /* Founder */
    .founder-metrics { grid-template-columns: 1fr 1fr; }
    .founder-grid { grid-template-columns: 1fr; }
    .founder-hero { flex-direction: column; align-items: flex-start; }
    .founder-title { font-size: 24px; }

    /* Inbox → single column with back */
    .inbox { grid-template-columns: 1fr; min-height: 0; }
    .inbox-left, .inbox-right { display: none; }
    .inbox[data-view="list"] .inbox-left { display: flex; }
    .inbox[data-view="msg"] .inbox-right { display: flex; }

    /* Pax */
    .pax-shell { grid-template-columns: 1fr; }
    .pax-context { display: none; }

    /* Command Center */
    .cc-grid { grid-template-columns: 1fr; }
    .cc-metrics { grid-template-columns: repeat(2, 1fr); }

    /* Touch targets */
    .acr-btn { min-height: 40px; padding: 0 14px; }
    .acr-btn-sm { min-height: 34px; }
    .pg-hd { flex-direction: column; align-items: flex-start; gap: 10px; }
    .pg-actions { width: 100%; flex-wrap: wrap; }
    .pg-title { font-size: 20px; }

    /* Grids collapse */
    .bb-grid, .cp-grid, .int-grid, .doc-grid { grid-template-columns: 1fr; }
    .kpi-row { grid-template-columns: 1fr 1fr; }
    .cal-week { grid-template-columns: 1fr; }

    /* Tweaks panel edges */
    .tweaks-panel { max-width: calc(100vw - 16px); right: 8px !important; bottom: 80px !important; }
  }

  /* Tablet */
  @media (min-width: 768px) and (max-width: 1079px) {
    .acr-sidebar { width: 72px; padding: 14px 8px; align-items: center; }
    .acr-sidebar .acr-sidebar-hd > button[class="acr-ws"],
    .acr-sidebar .acr-nav-group-title,
    .acr-sidebar .acr-nav-label,
    .acr-sidebar .acr-nav-badge,
    .acr-sidebar .acr-logo-word,
    .acr-sidebar .acr-search-trigger > span,
    .acr-sidebar .acr-user-meta { display: none; }
    .acr-sidebar .acr-nav-item { justify-content: center; padding: 9px; }
    .acr-sidebar .acr-search-trigger { justify-content: center; padding: 8px; }

    .parcel-grid { grid-template-columns: 1fr; }
    .founder-metrics { grid-template-columns: repeat(3, 1fr); }
    .founder-grid { grid-template-columns: 1fr; }
    .kb { grid-template-columns: repeat(3, 1fr); }
    .pax-shell { grid-template-columns: 1fr 280px; }
    .cc-grid { grid-template-columns: 1fr; }
  }

  /* Reduced motion */
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after {
      animation-duration: 0.01ms !important;
      transition-duration: 0.01ms !important;
    }
  }
`;

Object.assign(window, {
  AIOutput, AGENTS, CONF,
  ConfirmAction,
  useViewport, MobileTabBar,
  SkipToContent,
  TIER_A_CSS,
});
