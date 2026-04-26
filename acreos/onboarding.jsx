// acreos/onboarding.jsx — first-run welcome overlay

const { useState: useOState } = React;

const ONBOARD_STEPS = [
  { id: 'welcome',    label: 'Welcome'    },
  { id: 'buybox',     label: 'Buy-box'    },
  { id: 'autonomy',   label: 'Autonomy'   },
  { id: 'connect',    label: 'Connect'    },
  { id: 'ready',      label: 'Ready'      },
];

const Onboarding = ({ onClose }) => {
  const [stepIdx, setStepIdx] = useOState(0);
  const [acres, setAcres] = useOState([5, 40]);
  const [states, setStates] = useOState(['CO', 'NM', 'AZ']);
  const [autonomy, setAutonomy] = useOState(2);

  const step = ONBOARD_STEPS[stepIdx];

  const next = () => stepIdx < ONBOARD_STEPS.length - 1 ? setStepIdx(stepIdx + 1) : onClose();
  const back = () => stepIdx > 0 && setStepIdx(stepIdx - 1);

  return (
    <div className="onb-backdrop">
      <div className="onb-modal">
        <div className="onb-progress">
          {ONBOARD_STEPS.map((s, i) => (
            <div key={s.id} className={cx('onb-dot', i <= stepIdx && 'onb-dot-done', i === stepIdx && 'onb-dot-current')}>
              <span>{s.label}</span>
            </div>
          ))}
        </div>

        <div className="onb-body">
          {step.id === 'welcome' && (
            <div className="onb-center">
              <div className="onb-mark">
                <svg width="64" height="64" viewBox="0 0 32 32" aria-hidden="true">
                  <defs>
                    <linearGradient id="onb-mark" x1="0" y1="0" x2="32" y2="32"><stop offset="0%" stopColor="var(--brand)"/><stop offset="100%" stopColor="var(--accent)"/></linearGradient>
                  </defs>
                  <path d="M5 6 L27 4 L29 18 L24 27 L7 26 L3 14 Z" fill="url(#onb-mark)" />
                  <path d="M16 9 L22 22 L18.75 22 L17.5 19 L14 19 L12.75 22 L9.5 22 Z M15 17 L17 17 L16 14 Z" fill="var(--surface)" fillOpacity="0.95"/>
                </svg>
              </div>
              <h1 className="onb-h1">Your land business, one system.</h1>
              <p className="onb-sub">AcreOS is the operating system for your deals — sourcing, analyzing, mailing, closing. We'll set it up in 90 seconds.</p>
              <div className="onb-pillars">
                <div><I.sparkle size={14} style={{ color: 'var(--brand)' }}/><span>Intelligence that acts, not just advises</span></div>
                <div><I.map size={14} style={{ color: 'var(--accent)' }}/><span>Parcel-level data from 8 providers, unified</span></div>
                <div><I.leaf size={14} style={{ color: 'var(--pos)' }}/><span>Autonomous with founder guardrails</span></div>
              </div>
            </div>
          )}

          {step.id === 'buybox' && (
            <div>
              <div className="onb-eyebrow">Step 2 of 5</div>
              <h2 className="onb-h2">What are you looking for?</h2>
              <p className="onb-p">Atlas uses your buy-box to score every new parcel in your target markets.</p>

              <div className="onb-field">
                <label className="onb-label">Parcel size · acres</label>
                <div className="onb-range">
                  <span className="acr-tabnum">{acres[0]}</span>
                  <div className="onb-slider-track">
                    <div className="onb-slider-fill" style={{ left: `${acres[0]}%`, right: `${100 - acres[1]}%` }} />
                  </div>
                  <span className="acr-tabnum">{acres[1]}</span>
                </div>
              </div>

              <div className="onb-field">
                <label className="onb-label">Target markets</label>
                <div className="onb-chips">
                  {['CO','NM','AZ','TX','NV','UT','WY','OK','MT','ID','KS','NE'].map(s => (
                    <button key={s} onClick={() => setStates(states.includes(s) ? states.filter(x => x !== s) : [...states, s])}
                            className={cx('onb-chip', states.includes(s) && 'onb-chip-on')}>{s}</button>
                  ))}
                </div>
              </div>

              <div className="onb-field">
                <label className="onb-label">Strategy</label>
                <div className="onb-strategy">
                  {[
                    { id: 'flip',    title: 'Buy & resell',        desc: 'Short hold. Discount to retail.' },
                    { id: 'finance', title: 'Seller finance',      desc: 'Monthly cash flow. Higher yield.' },
                    { id: 'hold',    title: 'Long-term hold',      desc: 'Appreciation play.' },
                  ].map((s, i) => (
                    <button key={s.id} className={cx('onb-strat', i === 1 && 'onb-strat-on')}>
                      <div className="onb-strat-t">{s.title}</div>
                      <div className="onb-strat-d">{s.desc}</div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {step.id === 'autonomy' && (
            <div>
              <div className="onb-eyebrow">Step 3 of 5</div>
              <h2 className="onb-h2">How autonomously should AcreOS run?</h2>
              <p className="onb-p">You can change this any time. We recommend <b style={{ color: 'var(--ink)' }}>Execute</b> — AcreOS handles routine work, pauses above your threshold.</p>

              <div className="onb-autonomy">
                {[
                  { n: 0, label: 'Observe',    desc: 'Suggest only. Nothing acts.' },
                  { n: 1, label: 'Draft',      desc: 'Drafts everything. You review.' },
                  { n: 2, label: 'Execute',    desc: 'Acts on routine. Asks above $5K.', rec: true },
                  { n: 3, label: 'Autonomous', desc: 'Runs it. Daily briefing.' },
                ].map(l => (
                  <button key={l.n} onClick={() => setAutonomy(l.n)}
                          className={cx('onb-auto', autonomy === l.n && 'onb-auto-on')}>
                    {l.rec && <Pill tone="brand">Recommended</Pill>}
                    <div className="onb-auto-label">{l.label}</div>
                    <div className="onb-auto-desc">{l.desc}</div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {step.id === 'connect' && (
            <div>
              <div className="onb-eyebrow">Step 4 of 5</div>
              <h2 className="onb-h2">Connect your tools</h2>
              <p className="onb-p">You can skip and come back to any of these. Mail and data are required before your first campaign.</p>

              <div className="onb-conns">
                {[
                  { name: 'Regrid',     desc: 'Parcel data',    req: true,  done: true },
                  { name: 'BatchData',  desc: 'Skip trace',     req: true,  done: true },
                  { name: 'Lob',        desc: 'Direct mail',    req: true,  done: false },
                  { name: 'Stripe',     desc: 'Payments',       req: false, done: false },
                  { name: 'Twilio',     desc: 'SMS · optional', req: false, done: false },
                ].map(c => (
                  <div key={c.name} className="onb-conn">
                    <div className="onb-conn-l">
                      <div className="onb-conn-name">{c.name}</div>
                      <div className="onb-conn-d">{c.desc}{c.req && <span className="acr-muted"> · required</span>}</div>
                    </div>
                    {c.done ? <Pill tone="pos" dot>Connected</Pill> : <Button variant="subtle" size="sm">Connect</Button>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {step.id === 'ready' && (
            <div className="onb-center">
              <div className="onb-check">
                <I.check size={30} />
              </div>
              <h1 className="onb-h1">You're set.</h1>
              <p className="onb-sub">AcreOS is already scanning your markets. You'll have your first scored parcels in a few minutes.</p>
              <div className="onb-preview">
                <div className="acr-eyebrow">While you were setting up</div>
                <div className="onb-preview-stats">
                  <div><div className="onb-ps-v acr-tabnum">1,284</div><div className="onb-ps-l">new parcels found</div></div>
                  <div><div className="onb-ps-v acr-tabnum">47</div><div className="onb-ps-l">scored above 80</div></div>
                  <div><div className="onb-ps-v acr-tabnum">9</div><div className="onb-ps-l">ready for outreach</div></div>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="onb-foot">
          <Button variant="ghost" size="md" onClick={onClose}>Skip for now</Button>
          <div style={{ display: 'flex', gap: 8 }}>
            {stepIdx > 0 && <Button variant="subtle" size="md" onClick={back}>Back</Button>}
            <Button variant="primary" size="md" iconRight={stepIdx === ONBOARD_STEPS.length - 1 ? 'check' : 'arrow'} onClick={next}>
              {stepIdx === 0 ? 'Get started' : stepIdx === ONBOARD_STEPS.length - 1 ? 'Open AcreOS' : 'Continue'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

const ONB_CSS = `
  .onb-backdrop { position: fixed; inset: 0; background: color-mix(in srgb, var(--bg-sunken) 85%, transparent); -webkit-backdrop-filter: blur(16px); backdrop-filter: blur(16px); z-index: 100; display: flex; align-items: center; justify-content: center; padding: 24px; animation: onb-in .25s ease; }
  @keyframes onb-in { from { opacity: 0; } to { opacity: 1; } }
  .onb-modal { background: var(--surface); border: 0.5px solid var(--line); border-radius: 18px; box-shadow: var(--shadow-3); width: 100%; max-width: 680px; max-height: 90vh; display: flex; flex-direction: column; overflow: hidden; animation: onb-pop .3s cubic-bezier(.3,.7,.4,1); }
  @keyframes onb-pop { from { transform: translateY(8px) scale(.99); opacity: 0; } to { transform: none; opacity: 1; } }

  .onb-progress { display: flex; gap: 4px; padding: 16px 24px 0; }
  .onb-dot { flex: 1; height: 3px; border-radius: 2px; background: var(--surface-2); position: relative; }
  .onb-dot-done { background: var(--brand); }
  .onb-dot span { position: absolute; top: 8px; left: 0; font: 500 10px/1 var(--font-sans); letter-spacing: 0.05em; text-transform: uppercase; color: var(--ink-4); }
  .onb-dot-current span { color: var(--brand); }

  .onb-body { padding: 42px 44px 28px; overflow-y: auto; }
  .onb-center { text-align: center; display: flex; flex-direction: column; align-items: center; gap: 10px; }
  .onb-mark { width: 64px; height: 64px; display: flex; align-items: center; justify-content: center; margin-bottom: 6px; filter: drop-shadow(0 6px 18px var(--glow)); }
  .onb-check { width: 56px; height: 56px; border-radius: 50%; background: var(--pos-soft); color: var(--pos); display: inline-flex; align-items: center; justify-content: center; margin-bottom: 6px; }

  .onb-eyebrow { font: 500 10.5px/1 var(--font-sans); letter-spacing: 0.08em; text-transform: uppercase; color: var(--ink-3); margin-bottom: 10px; }
  .onb-h1 { font: 600 32px/1.15 var(--font-display); letter-spacing: -0.03em; color: var(--ink); margin: 0; }
  .onb-h2 { font: 600 24px/1.2 var(--font-display); letter-spacing: -0.025em; color: var(--ink); margin: 0 0 8px; }
  .onb-sub { font: 400 14.5px/1.5 var(--font-sans); color: var(--ink-2); margin: 2px 0 0; max-width: 440px; text-wrap: pretty; }
  .onb-p   { font: 400 13.5px/1.55 var(--font-sans); color: var(--ink-2); margin: 0 0 24px; text-wrap: pretty; }

  .onb-pillars { display: flex; flex-direction: column; gap: 10px; margin-top: 20px; }
  .onb-pillars > div { display: flex; align-items: center; gap: 10px; font: 500 13px/1.4 var(--font-sans); color: var(--ink-2); background: var(--surface-2); border: 0.5px solid var(--line-soft); border-radius: 10px; padding: 10px 14px; }

  .onb-field { margin-bottom: 20px; }
  .onb-label { display: block; font: 500 12px/1 var(--font-sans); color: var(--ink-2); margin-bottom: 8px; letter-spacing: -0.005em; }
  .onb-range { display: flex; align-items: center; gap: 12px; font: 500 13px/1 var(--font-sans); color: var(--ink); }
  .onb-slider-track { flex: 1; height: 6px; border-radius: 999px; background: var(--surface-2); position: relative; }
  .onb-slider-fill { position: absolute; top: 0; bottom: 0; background: var(--brand); border-radius: 999px; }
  .onb-slider-fill::before, .onb-slider-fill::after { content: ''; position: absolute; top: 50%; transform: translateY(-50%); width: 16px; height: 16px; border-radius: 50%; background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,.25); border: 0.5px solid var(--line); }
  .onb-slider-fill::before { left: -8px; } .onb-slider-fill::after { right: -8px; }

  .onb-chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .onb-chip { padding: 6px 12px; border-radius: 999px; background: var(--surface-2); border: 0.5px solid var(--line-soft); font: 500 12px/1 var(--font-mono); color: var(--ink-2); cursor: default; transition: background .1s, color .1s; }
  .onb-chip:hover { background: var(--bg-sunken); color: var(--ink); }
  .onb-chip-on { background: var(--brand); border-color: var(--brand); color: var(--brand-ink); }

  .onb-strategy { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
  @media (max-width: 560px) { .onb-strategy { grid-template-columns: 1fr; } }
  .onb-strat { background: var(--surface-2); border: 0.5px solid var(--line-soft); border-radius: 10px; padding: 12px; text-align: left; cursor: default; }
  .onb-strat-on { border-color: var(--brand); background: var(--brand-soft); box-shadow: var(--ring); }
  .onb-strat-t { font: 600 13px/1.2 var(--font-display); color: var(--ink); letter-spacing: -0.005em; }
  .onb-strat-d { font: 400 11.5px/1.4 var(--font-sans); color: var(--ink-3); margin-top: 4px; }

  .onb-autonomy { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; }
  .onb-auto { background: var(--surface-2); border: 0.5px solid var(--line-soft); border-radius: 12px; padding: 14px; text-align: left; cursor: default; position: relative; }
  .onb-auto > .acr-pill { position: absolute; top: 10px; right: 10px; }
  .onb-auto-on { border-color: var(--brand); background: var(--brand-soft); box-shadow: var(--ring); }
  .onb-auto-label { font: 600 15px/1.2 var(--font-display); color: var(--ink); letter-spacing: -0.01em; }
  .onb-auto-desc { font: 400 12px/1.4 var(--font-sans); color: var(--ink-2); margin-top: 4px; }

  .onb-conns { display: flex; flex-direction: column; border-top: 0.5px solid var(--line-soft); }
  .onb-conn { display: flex; justify-content: space-between; align-items: center; padding: 14px 2px; border-bottom: 0.5px solid var(--line-soft); gap: 14px; }
  .onb-conn-name { font: 600 13px/1.2 var(--font-sans); color: var(--ink); }
  .onb-conn-d { font: 400 12px/1.4 var(--font-sans); color: var(--ink-3); margin-top: 2px; }

  .onb-preview { margin-top: 24px; padding: 16px 20px; background: var(--bg-sunken); border-radius: 12px; width: 100%; max-width: 440px; }
  .onb-preview-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-top: 8px; }
  .onb-ps-v { font: 600 22px/1 var(--font-display); letter-spacing: -0.02em; color: var(--ink); }
  .onb-ps-l { font: 500 11px/1 var(--font-sans); color: var(--ink-3); margin-top: 3px; }

  .onb-foot { display: flex; justify-content: space-between; align-items: center; padding: 14px 24px; border-top: 0.5px solid var(--line); background: var(--bg-sunken); }
`;

Object.assign(window, { Onboarding, ONB_CSS });
