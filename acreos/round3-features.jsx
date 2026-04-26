// acreos/round3-features.jsx — Round 3 feature components
// ──────────────────────────────────────────────────────────────────

const { useState: useFS, useEffect: useFE, useRef: useFR, useMemo: useFM } = React;

// ──────────────────────────────────────────────────────────
// KEYBOARD TABLE NAV — j/k Enter Cmd+Enter
// Wrap a table; pass row count and onSelect.
// ──────────────────────────────────────────────────────────

const useTableKeys = ({ count, onOpen, onAction, enabled = true }) => {
  const [idx, setIdx] = useFS(-1);
  useFE(() => {
    if (!enabled) return;
    const onKey = (e) => {
      // Don't capture inside inputs
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.key === 'j' || e.key === 'ArrowDown') {
        e.preventDefault();
        setIdx(i => Math.min(count - 1, i + 1));
      } else if (e.key === 'k' || e.key === 'ArrowUp') {
        e.preventDefault();
        setIdx(i => Math.max(0, i - 1));
      } else if (e.key === 'Enter' && idx >= 0) {
        e.preventDefault();
        if ((e.metaKey || e.ctrlKey) && onAction) onAction(idx);
        else if (onOpen) onOpen(idx);
      } else if (e.key === 'Escape') {
        setIdx(-1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled, count, idx, onOpen, onAction]);
  return [idx, setIdx];
};

// ──────────────────────────────────────────────────────────
// DEAL CLOSED MOMENT — quiet, dignified celebration card
// ──────────────────────────────────────────────────────────

const DealClosedMoment = ({ deal, onDismiss }) => {
  const [show, setShow] = useFS(false);
  useFE(() => {
    setShow(true);
    if (window.__playSound) window.__playSound('chime');
  }, []);
  const dismiss = () => { setShow(false); setTimeout(onDismiss, 240); };
  return (
    <div className={cx('r3-moment-bg', show && 'r3-moment-bg-on')} onClick={dismiss}>
      <div className={cx('r3-moment', show && 'r3-moment-on')} onClick={e => e.stopPropagation()}>
        <div className="r3-moment-glow" />
        <div className="r3-moment-eyebrow">Deal closed · {deal?.id || 'D-2196'}</div>
        <div className="r3-moment-num">{deal?.amount || '$11,500'}</div>
        <div className="r3-moment-sub">{deal?.parcel || '08-441-002'} · {deal?.county || 'Coconino, AZ'}</div>
        <div className="r3-moment-line" />
        <div className="r3-moment-stats">
          <div><div className="r3-moment-stat-n">37</div><div className="r3-moment-stat-l">days from list to close</div></div>
          <div><div className="r3-moment-stat-n">3</div><div className="r3-moment-stat-l">touches to acceptance</div></div>
          <div><div className="r3-moment-stat-n">1.4×</div><div className="r3-moment-stat-l">below comp median</div></div>
        </div>
        <div className="r3-moment-quote">
          "Atlas flagged this in the Aug 14 list. Pax drafted three of four replies. You closed it."
        </div>
        <div className="r3-moment-actions">
          <button className="r3-moment-btn-ghost" onClick={dismiss}>Close</button>
          <button className="r3-moment-btn" onClick={dismiss}>Start dispositions</button>
        </div>
      </div>
    </div>
  );
};

// ──────────────────────────────────────────────────────────
// DAY-1 EMPTY COMMAND CENTER
// What a brand-new tenant sees on first login — guided 0→1
// ──────────────────────────────────────────────────────────

const Day1CommandCenter = ({ onExitDay1 }) => {
  const steps = [
    { id: 'buybox',  done: false, title: 'Define your first buy-box', body: 'Tell Atlas what good looks like — county, acreage, price band. We\'ll start scanning the moment you save.', cta: 'Define buy-box', icon: 'funnel2' },
    { id: 'list',    done: false, title: 'Pull your first list',     body: 'We pulled 1,847 owners that match your buy-box. Skip-trace runs automatically.',                              cta: 'Review list',     icon: 'layers2' },
    { id: 'reach',   done: false, title: 'Send your first touch',    body: 'A 3-step direct-mail + SMS sequence. Pax handles replies; you handle yes\'s and no\'s.',                       cta: 'Launch campaign', icon: 'envelope' },
    { id: 'autonomy',done: false, title: 'Pick your autonomy level', body: 'Manual is safe. Co-pilot is faster. Supervised is when you trust us. You can change this any time.',          cta: 'Set autonomy',    icon: 'shieldHalf' },
  ];
  return (
    <div className="pg r3-day1">
      <header className="pg-hd">
        <div>
          <div className="acr-eyebrow">Welcome to AcreOS</div>
          <h1 className="pg-title r3-day1-title">Let's get you to your first deal.</h1>
          <p className="r3-day1-sub">Most operators close their first parcel within 18 days of finishing setup. Here's the path.</p>
        </div>
        <button className="r3-day1-skip" onClick={onExitDay1}>Skip setup · use sample data →</button>
      </header>

      <div className="r3-day1-steps">
        {steps.map((s, i) => {
          const Ic = (window.R3_ICONS && window.R3_ICONS[s.icon]) || I.dot;
          return (
            <div key={s.id} className="r3-day1-step">
              <div className="r3-day1-step-n">{i + 1}</div>
              <div className="r3-day1-step-ic"><Ic size={20}/></div>
              <div className="r3-day1-step-body">
                <div className="r3-day1-step-title">{s.title}</div>
                <div className="r3-day1-step-text">{s.body}</div>
              </div>
              <button className="r3-day1-step-cta">{s.cta} →</button>
            </div>
          );
        })}
      </div>

      <Card className="r3-day1-foot">
        <div className="r3-day1-foot-l">
          <div className="acr-eyebrow">Or start somewhere else</div>
          <div className="r3-day1-foot-title">Already have a deal in flight?</div>
          <div className="r3-day1-foot-sub">Import from a CSV, paste a parcel ID, or forward an email — we'll pick it up from there.</div>
        </div>
        <div className="pg-actions">
          <Button variant="subtle">Import CSV</Button>
          <Button variant="subtle">Paste parcel</Button>
          <Button variant="primary">Forward email</Button>
        </div>
      </Card>
    </div>
  );
};

// ──────────────────────────────────────────────────────────
// "WHY I LOST" capture — modal forced when deal moves to Lost
// ──────────────────────────────────────────────────────────

const LostReasonCapture = ({ deal, onSubmit, onCancel }) => {
  const reasons = [
    { id: 'priced-low',   label: 'I bid too low',          detail: 'Owner countered, we couldn\'t close the gap.' },
    { id: 'unresponsive', label: 'Owner went quiet',       detail: 'No reply after 3+ touches over 14 days.' },
    { id: 'sold-other',   label: 'Sold to someone else',   detail: 'Confirmed sold elsewhere — public record or owner confirmed.' },
    { id: 'title-issue',  label: 'Title problem',          detail: 'Encumbrance, lien, or chain-of-title issue we couldn\'t clear.' },
    { id: 'access',       label: 'Access / utilities',     detail: 'No legal access, no utilities, deal-killer on diligence.' },
    { id: 'changed-mind', label: 'Owner changed mind',     detail: 'Decided not to sell after we\'d agreed.' },
    { id: 'wrong-fit',    label: 'Wrong for our buy-box',  detail: 'Got into diligence and realized it doesn\'t fit what we hold.' },
  ];
  const [picked, setPicked] = useFS(null);
  const [note, setNote] = useFS('');
  return (
    <div className="r3-modal-bg" onClick={onCancel}>
      <div className="r3-modal" onClick={e => e.stopPropagation()}>
        <div className="r3-modal-hd">
          <div>
            <div className="acr-eyebrow">Closing as Lost</div>
            <h2 className="r3-modal-title">Why didn't we close {deal?.id || 'D-2417'}?</h2>
            <p className="r3-modal-sub">One question. Atlas needs this to get smarter — and you'll thank yourself in three months.</p>
          </div>
          <button className="r3-modal-x" onClick={onCancel} aria-label="Cancel">×</button>
        </div>
        <div className="r3-lost-grid">
          {reasons.map(r => (
            <button
              key={r.id}
              className={cx('r3-lost-opt', picked === r.id && 'r3-lost-opt-on')}
              onClick={() => setPicked(r.id)}
            >
              <div className="r3-lost-opt-label">{r.label}</div>
              <div className="r3-lost-opt-detail">{r.detail}</div>
              {picked === r.id && <div className="r3-lost-opt-check">✓</div>}
            </button>
          ))}
        </div>
        <div className="r3-lost-note">
          <label className="acr-eyebrow">One sentence on what we'd do differently (optional)</label>
          <textarea
            className="r3-lost-textarea"
            placeholder="e.g. We should have led with a higher first offer — owner was sophisticated."
            value={note}
            onChange={e => setNote(e.target.value)}
            rows={2}
          />
        </div>
        <div className="r3-modal-foot">
          <button className="r3-moment-btn-ghost" onClick={onCancel}>Not now</button>
          <button
            className="r3-moment-btn"
            disabled={!picked}
            style={{ opacity: picked ? 1 : 0.4 }}
            onClick={() => {
              window.toast({ label: `Saved · ${reasons.find(r=>r.id===picked).label.toLowerCase()}.`, kind: 'success' });
              if (window.__playSound) window.__playSound('tick');
              onSubmit({ reason: picked, note });
            }}
          >
            Mark as Lost
          </button>
        </div>
      </div>
    </div>
  );
};

// ──────────────────────────────────────────────────────────
// QUICK OFFER COMPOSER — Cmd+N anywhere → 8-second offer
// ──────────────────────────────────────────────────────────

const QuickOffer = ({ onClose }) => {
  const [parcel, setParcel] = useFS('');
  const [amount, setAmount] = useFS('11500');
  const [terms, setTerms] = useFS('24mo');
  const [step, setStep] = useFS(0); // 0 parcel · 1 amount · 2 terms · 3 confirm
  const inputRef = useFR(null);
  useFE(() => { inputRef.current?.focus(); }, [step]);
  const termsPresets = [
    { id: 'cash',   label: 'Cash · 14 days', detail: 'No financing, fast close.' },
    { id: '24mo',   label: '24-month note',  detail: '12% APR · ~$540/mo' },
    { id: '36mo',   label: '36-month note',  detail: '11% APR · ~$385/mo' },
    { id: '60mo',   label: '60-month note',  detail: '10.5% APR · ~$245/mo' },
  ];
  const next = () => setStep(s => Math.min(3, s + 1));
  const back = () => setStep(s => Math.max(0, s - 1));
  const onKey = (e) => {
    if (e.key === 'Enter' && step < 3) { e.preventDefault(); next(); }
    if (e.key === 'Escape') onClose();
  };
  const send = () => {
    window.toast({
      label: `Offer queued · ${parcel || 'parcel'} · $${Number(amount).toLocaleString()}.`,
      kind: 'success',
      onUndo: () => window.toast({ label: 'Offer canceled.' })
    });
    if (window.__playSound) window.__playSound('chime');
    onClose();
  };
  return (
    <div className="r3-modal-bg r3-qo-bg" onClick={onClose}>
      <div className="r3-qo" onClick={e => e.stopPropagation()} onKeyDown={onKey}>
        <div className="r3-qo-hd">
          <div className="acr-eyebrow">Quick offer · ⌘N</div>
          <div className="r3-qo-steps">
            {[0,1,2,3].map(i => <span key={i} className={cx('r3-qo-dot', step >= i && 'r3-qo-dot-on')} />)}
          </div>
        </div>

        {step === 0 && (
          <div className="r3-qo-step">
            <label className="r3-qo-label">Parcel ID or address</label>
            <input
              ref={inputRef}
              className="r3-qo-input"
              placeholder="e.g. 08-441-002 or 'pritchard'"
              value={parcel}
              onChange={e => setParcel(e.target.value)}
            />
            <div className="r3-qo-hint">Press <kbd>↵</kbd> to continue · <kbd>esc</kbd> to cancel</div>
            {parcel.length > 1 && (
              <div className="r3-qo-suggest">
                <button className="r3-qo-sg" onClick={() => { setParcel('08-441-002'); next(); }}>
                  <span className="mono">08-441-002</span>
                  <span className="muted">Pritchard · Coconino, AZ · 12.4ac</span>
                </button>
              </div>
            )}
          </div>
        )}

        {step === 1 && (
          <div className="r3-qo-step">
            <label className="r3-qo-label">Offer amount</label>
            <div className="r3-qo-amount">
              <span className="r3-qo-currency">$</span>
              <input
                ref={inputRef}
                className="r3-qo-input r3-qo-amount-input"
                value={amount}
                onChange={e => setAmount(e.target.value.replace(/[^\d]/g, ''))}
                inputMode="numeric"
              />
            </div>
            <div className="r3-qo-hint">Atlas suggests <b>$11,500</b> · expect counter ~$13,800 · <kbd>↵</kbd> to continue</div>
          </div>
        )}

        {step === 2 && (
          <div className="r3-qo-step">
            <label className="r3-qo-label">Terms</label>
            <div className="r3-qo-terms">
              {termsPresets.map(t => (
                <button
                  key={t.id}
                  className={cx('r3-qo-term', terms === t.id && 'r3-qo-term-on')}
                  onClick={() => { setTerms(t.id); next(); }}
                >
                  <div className="r3-qo-term-label">{t.label}</div>
                  <div className="r3-qo-term-detail">{t.detail}</div>
                </button>
              ))}
            </div>
            <div className="r3-qo-hint">Pick one or press <kbd>↵</kbd> to use highlighted</div>
          </div>
        )}

        {step === 3 && (
          <div className="r3-qo-step">
            <div className="r3-qo-confirm">
              <div className="r3-qo-confirm-title">Send offer to Pritchard</div>
              <div className="r3-qo-confirm-row"><span className="muted">Parcel</span><span className="mono">{parcel || '08-441-002'}</span></div>
              <div className="r3-qo-confirm-row"><span className="muted">Amount</span><b>${Number(amount).toLocaleString()}</b></div>
              <div className="r3-qo-confirm-row"><span className="muted">Terms</span><span>{termsPresets.find(t=>t.id===terms)?.label}</span></div>
              <div className="r3-qo-confirm-row"><span className="muted">Channel</span><span>Direct mail · arrives Tue</span></div>
            </div>
            <div className="r3-qo-actions">
              <button className="r3-moment-btn-ghost" onClick={back}>← Back</button>
              <button className="r3-moment-btn" onClick={send}>Send now</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// ──────────────────────────────────────────────────────────
// AUTONOMY SLIDER — visceral, drag to change levels
// ──────────────────────────────────────────────────────────

const AutonomySlider = ({ value = 1, onChange }) => {
  const levels = [
    { v: 0, label: 'Manual',     icon: 'shieldHalf', desc: 'AI suggests. You do everything.',                stat: '0 actions/day · 100% by you' },
    { v: 1, label: 'Co-pilot',   icon: 'pen',        desc: 'AI drafts. You review and send.',                stat: '~12 drafts/day · you send 12' },
    { v: 2, label: 'Supervised', icon: 'spark2',     desc: 'AI sends low-risk. You approve high-risk.',      stat: '~38 actions/day · you approve 8' },
    { v: 3, label: 'Autonomous', icon: 'bolt2',      desc: 'AI runs the playbook. You set guardrails.',      stat: '~71 actions/day · you review weekly' },
  ];
  const cur = levels[value];
  return (
    <Card className="r3-auto-card">
      <div className="r3-auto-hd">
        <div>
          <div className="acr-eyebrow">Autonomy</div>
          <div className="r3-auto-title">{cur.label}</div>
          <div className="r3-auto-desc">{cur.desc}</div>
        </div>
        <div className="r3-auto-stat">{cur.stat}</div>
      </div>
      <div className="r3-auto-track">
        <div className="r3-auto-fill" style={{ width: `${(value / 3) * 100}%` }} />
        {levels.map((l, i) => (
          <button
            key={i}
            className={cx('r3-auto-stop', i === value && 'r3-auto-stop-on', i < value && 'r3-auto-stop-passed')}
            onClick={() => { onChange?.(i); if (window.__playSound) window.__playSound('tick'); }}
            style={{ left: `${(i / 3) * 100}%` }}
            aria-label={l.label}
          >
            <span className="r3-auto-stop-label">{l.label}</span>
          </button>
        ))}
      </div>
      <div className="r3-auto-impact">
        <div className="r3-auto-impact-row">
          <span className="muted">Impact today, at this level:</span>
        </div>
        <div className="r3-auto-impact-bars">
          {[
            { label: 'Replies sent', max: 28, val: [0, 12, 22, 28][value] },
            { label: 'Offers drafted', max: 14, val: [0, 8, 12, 14][value] },
            { label: 'Decisions made for you', max: 71, val: [0, 0, 8, 71][value] },
          ].map((b, i) => (
            <div key={i} className="r3-auto-bar-wrap">
              <div className="r3-auto-bar-label">{b.label}</div>
              <div className="r3-auto-bar"><div className="r3-auto-bar-fill" style={{ width: `${(b.val/b.max)*100}%` }} /></div>
              <div className="r3-auto-bar-n">{b.val}</div>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
};

// ──────────────────────────────────────────────────────────
// LIVE AGENT FEED — firehose across all tenants (founder only)
// ──────────────────────────────────────────────────────────

const FAKE_FEED = [
  { agent: 'Atlas', tenant: 'Norton Holdings',     action: 'analyzed parcel 08-441-002 · score 89',  ms: 142 },
  { agent: 'Pax',   tenant: 'Meridian Land Co',    action: 'drafted reply to J. Pritchard',          ms: 384 },
  { agent: 'Sophie',tenant: 'Cobalt Acres',        action: 'OCR\'d title commitment · 14 pages',      ms: 1208 },
  { agent: 'Atlas', tenant: 'Foothills Land Co.',  action: 'flagged comp anomaly on 12-008-117',     ms: 89 },
  { agent: 'Pax',   tenant: 'Westridge Holdings',  action: 'auto-sent SMS reply to R. Martinez',     ms: 31 },
  { agent: 'Atlas', tenant: 'Plainstate LLC',      action: 'analyzed parcel 19-557-311 · score 72',  ms: 167 },
  { agent: 'Pax',   tenant: 'Norton Holdings',     action: 'drafted offer counter at $13,800',       ms: 412 },
  { agent: 'Sophie',tenant: 'Meridian Land Co',    action: 'extracted seller details from W-9',      ms: 287 },
  { agent: 'Atlas', tenant: 'Cobalt Acres',        action: 'pulled comps · 4 sales within 1.2mi',    ms: 624 },
  { agent: 'Pax',   tenant: 'Foothills Land Co.',  action: 'triaged inbox · 12 messages',            ms: 88 },
  { agent: 'Atlas', tenant: 'Westridge Holdings',  action: 'analyzed parcel 37-091-014 · score 81',  ms: 154 },
  { agent: 'Pax',   tenant: 'Plainstate LLC',      action: 'auto-sent intro mail · 240 contacts',    ms: 1840 },
];

const LiveFeed = () => {
  const [items, setItems] = useFS(() => FAKE_FEED.map((f, i) => ({ ...f, id: i, t: Date.now() - i * 1200 })));
  const [paused, setPaused] = useFS(false);
  useFE(() => {
    if (paused) return;
    const tick = setInterval(() => {
      const next = FAKE_FEED[Math.floor(Math.random() * FAKE_FEED.length)];
      setItems(prev => [{ ...next, id: Date.now() + Math.random(), t: Date.now() }, ...prev].slice(0, 40));
      if (window.__playSound && Math.random() < 0.25) window.__playSound('tick');
    }, 1400 + Math.random() * 800);
    return () => clearInterval(tick);
  }, [paused]);
  const fmtAgo = (t) => {
    const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
    if (s < 5) return 'now';
    if (s < 60) return `${s}s ago`;
    if (s < 3600) return `${Math.floor(s/60)}m ago`;
    return `${Math.floor(s/3600)}h ago`;
  };
  return (
    <Card className="r3-feed">
      <div className="r3-feed-hd">
        <div>
          <div className="acr-eyebrow" style={{color:'var(--brand)'}}>⌁ Live agent feed</div>
          <h3 className="r3-feed-title">{paused ? 'Paused' : 'Streaming'} · last 40 actions across all tenants</h3>
        </div>
        <div className="pg-actions">
          <button className={cx('chip', !paused && 'chip-on')} onClick={() => setPaused(p => !p)}>
            <span className={cx('r3-feed-pulse', !paused && 'r3-feed-pulse-on')} />
            {paused ? 'Resume' : 'Live'}
          </button>
        </div>
      </div>
      <div className="r3-feed-list">
        {items.map((it, i) => (
          <div key={it.id} className={cx('r3-feed-row', i === 0 && !paused && 'r3-feed-row-new')}>
            <div className="r3-feed-time">{fmtAgo(it.t)}</div>
            <div className={cx('r3-feed-agent', `r3-feed-agent-${it.agent.toLowerCase()}`)}>{it.agent}</div>
            <div className="r3-feed-tenant">{it.tenant}</div>
            <div className="r3-feed-action">{it.action}</div>
            <div className="r3-feed-ms">{it.ms}ms</div>
          </div>
        ))}
      </div>
    </Card>
  );
};

// ──────────────────────────────────────────────────────────
// "WITHOUT ACREOS" — before/after toggle on Command Center
// ──────────────────────────────────────────────────────────

const BeforeAfterToggle = ({ on, onChange }) => (
  <button
    className={cx('r3-ba-toggle', on && 'r3-ba-toggle-on')}
    onClick={() => onChange?.(!on)}
    aria-pressed={on}
  >
    <span className="r3-ba-dot" />
    <span className="r3-ba-label">{on ? 'Showing what you\'d see WITHOUT AcreOS' : 'Show what this looks like without AcreOS'}</span>
  </button>
);

Object.assign(window, {
  useTableKeys,
  DealClosedMoment, Day1CommandCenter, LostReasonCapture,
  QuickOffer, AutonomySlider, LiveFeed, BeforeAfterToggle,
});
