// acreos/settings.jsx — settings surface

const { useState: useSState } = React;

const SETTINGS_SECTIONS = [
  { group: 'Workspace', items: [
    { id: 'profile',    label: 'Profile',         icon: 'user' },
    { id: 'workspace',  label: 'Workspace',       icon: 'folder' },
    { id: 'billing',    label: 'Billing',         icon: 'coin', badge: 'Scale' },
    { id: 'team',       label: 'Team',            icon: 'users' },
  ]},
  { group: 'Intelligence', items: [
    { id: 'ai',         label: 'AcreOS Intelligence', icon: 'sparkle' },
    { id: 'autonomy',   label: 'Autonomy',        icon: 'bolt' },
    { id: 'criteria',   label: 'Buy-box',         icon: 'pin' },
  ]},
  { group: 'Integrations', items: [
    { id: 'providers',  label: 'Data providers',  icon: 'layers' },
    { id: 'mail',       label: 'Mail & messaging', icon: 'mail' },
    { id: 'payments',   label: 'Payments',        icon: 'shield' },
  ]},
  { group: 'Appearance', items: [
    { id: 'appearance', label: 'Appearance',      icon: 'sun' },
    { id: 'shortcuts',  label: 'Shortcuts',       icon: 'cmd' },
  ]},
];

const SettingRow = ({ label, description, children, stacked = false }) => (
  <div className={cx('set-row', stacked && 'set-row-stack')}>
    <div className="set-row-l">
      <div className="set-row-label">{label}</div>
      {description && <div className="set-row-desc">{description}</div>}
    </div>
    <div className="set-row-r">{children}</div>
  </div>
);

const Toggle = ({ on, onChange }) => (
  <button className={cx('set-toggle', on && 'set-toggle-on')} onClick={() => onChange(!on)} aria-pressed={on}>
    <span className="set-toggle-knob" />
  </button>
);

const Select = ({ value, options, onChange }) => (
  <div className="set-select">
    <select value={value} onChange={e => onChange(e.target.value)}>
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
    <I.chevDn size={12} />
  </div>
);

const AutonomyPanel = () => {
  const [level, setLevel] = useSState(2);
  const [threshold, setThreshold] = useSState('5000');
  const [pauseOutside, setPauseOutside] = useSState(true);

  const levels = [
    { n: 0, label: 'Observe',   desc: 'Suggest only — nothing acts without you.' },
    { n: 1, label: 'Draft',     desc: 'Drafts replies, offers, and mailers. You review each.' },
    { n: 2, label: 'Execute',   desc: 'Acts on routine tasks. Asks above threshold.' },
    { n: 3, label: 'Autonomous',desc: 'Runs the business. Daily briefing only.' },
  ];

  return (
    <div className="set-card">
      <div className="set-h">
        <h3>Autonomy</h3>
        <p>How much AcreOS does on its own. Founder override is always available.</p>
      </div>

      <div className="auto-scale">
        {levels.map(l => (
          <button key={l.n} onClick={() => setLevel(l.n)}
                  className={cx('auto-step', level === l.n && 'auto-step-active')}>
            <div className="auto-step-n">{l.n}</div>
            <div className="auto-step-label">{l.label}</div>
            <div className="auto-step-desc">{l.desc}</div>
          </button>
        ))}
      </div>

      <div className="set-h set-h-sub">
        <h4>Guardrails</h4>
      </div>
      <SettingRow label="Approval threshold" description="Actions above this value pause for your approval.">
        <div className="set-input-group">
          <span className="set-input-prefix">$</span>
          <input className="set-input acr-tabnum" value={threshold} onChange={e => setThreshold(e.target.value)} />
        </div>
      </SettingRow>
      <SettingRow label="Pause outside business hours" description="Do not send outbound comms between 7 PM and 8 AM local.">
        <Toggle on={pauseOutside} onChange={setPauseOutside} />
      </SettingRow>
      <SettingRow label="Weekly briefing" description="Monday 7 AM summary of autonomous actions.">
        <Toggle on={true} onChange={() => {}} />
      </SettingRow>
    </div>
  );
};

const AppearancePanel = ({ tweaks, setTweak }) => (
  <div className="set-card">
    <div className="set-h">
      <h3>Appearance</h3>
      <p>Choose a direction. You can live-tune from the Tweaks panel.</p>
    </div>

    <SettingRow label="Direction" description="Five aesthetic personalities, each with light + dark." stacked>
      <div className="set-themes">
        {Object.entries(THEMES).map(([id, t]) => (
          <button key={id} onClick={() => setTweak('theme', id)}
                  className={cx('set-theme', tweaks.theme === id && 'set-theme-active')}>
            <div className="set-theme-swatch">
              <div style={{ background: t.light['--bg'] }} />
              <div style={{ background: t.light['--brand'] }} />
              <div style={{ background: t.light['--ink'] }} />
              <div style={{ background: t.dark['--bg'] }} />
            </div>
            <div className="set-theme-name">{t.name}</div>
            <div className="set-theme-tag">{t.tagline}</div>
          </button>
        ))}
      </div>
    </SettingRow>

    <SettingRow label="Mode" description="Follows system if Auto is chosen.">
      <div className="set-seg">
        {[
          { id: 'light', label: 'Light', icon: 'sun' },
          { id: 'dark',  label: 'Dark',  icon: 'moon' },
          { id: 'auto',  label: 'Auto',  icon: 'spark' },
        ].map(m => {
          const Ic = I[m.icon];
          const active = (m.id === 'light' && !tweaks.dark) || (m.id === 'dark' && tweaks.dark) || (m.id === 'auto' && false);
          return (
            <button key={m.id}
              className={cx('set-seg-btn', active && 'set-seg-btn-active')}
              onClick={() => m.id === 'light' ? setTweak('dark', false) : m.id === 'dark' ? setTweak('dark', true) : null}>
              <Ic size={13} /><span>{m.label}</span>
            </button>
          );
        })}
      </div>
    </SettingRow>

    <SettingRow label="Density" description="Compact in CRM, spacious in Atlas — adapts per surface.">
      <Select value="adaptive" options={[
        { value: 'compact', label: 'Compact' },
        { value: 'comfortable', label: 'Comfortable' },
        { value: 'adaptive', label: 'Adaptive (recommended)' },
      ]} onChange={() => {}} />
    </SettingRow>

    <SettingRow label="Reduce motion" description="Minimize non-essential animations.">
      <Toggle on={false} onChange={() => {}} />
    </SettingRow>
  </div>
);

const ProvidersPanel = () => {
  const providers = [
    { name: 'Regrid',    cat: 'Parcel data',      status: 'active',    plan: 'Pro · $240/mo',   icon: 'map'     },
    { name: 'ATTOM',     cat: 'Property data',    status: 'active',    plan: 'Metered',          icon: 'layers'  },
    { name: 'BatchData', cat: 'Skip trace',       status: 'active',    plan: 'Pay-per-lookup',  icon: 'search'  },
    { name: 'Lob',       cat: 'Direct mail',      status: 'active',    plan: 'Volume',          icon: 'mail'    },
    { name: 'Twilio',    cat: 'SMS (optional)',   status: 'inactive',  plan: '—',               icon: 'phone'   },
    { name: 'FEMA · USDA · BLM', cat: 'Government data', status: 'active', plan: 'Free', icon: 'shield' },
  ];
  return (
    <div className="set-card">
      <div className="set-h"><h3>Data providers</h3><p>Registered providers. Priority, circuit breakers, and caching are handled automatically.</p></div>
      <div className="prov-grid">
        {providers.map(p => {
          const Ic = I[p.icon];
          return (
            <div key={p.name} className="prov-card">
              <div className="prov-icon"><Ic size={16} /></div>
              <div className="prov-body">
                <div className="prov-name">{p.name}</div>
                <div className="prov-cat">{p.cat}</div>
              </div>
              <div className="prov-meta">
                <Pill tone={p.status === 'active' ? 'pos' : 'neutral'} dot>{p.status}</Pill>
                <div className="prov-plan">{p.plan}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

const Settings = ({ tweaks, setTweak }) => {
  const [active, setActive] = useSState('autonomy');

  return (
    <div className="set-page">
      <aside className="set-nav">
        {SETTINGS_SECTIONS.map(g => (
          <div key={g.group}>
            <div className="set-nav-group">{g.group}</div>
            {g.items.map(it => {
              const Ic = I[it.icon];
              return (
                <button key={it.id} onClick={() => setActive(it.id)}
                        className={cx('set-nav-item', active === it.id && 'set-nav-item-active')}>
                  <Ic size={14} />
                  <span>{it.label}</span>
                  {it.badge && <Pill tone="brand">{it.badge}</Pill>}
                </button>
              );
            })}
          </div>
        ))}
      </aside>
      <main className="set-main">
        {active === 'autonomy' && <AutonomyPanel />}
        {active === 'appearance' && <AppearancePanel tweaks={tweaks} setTweak={setTweak} />}
        {active === 'providers' && <ProvidersPanel />}
        {active !== 'autonomy' && active !== 'appearance' && active !== 'providers' && (
          <div className="set-card">
            <div className="set-h">
              <h3>{SETTINGS_SECTIONS.flatMap(g => g.items).find(i => i.id === active)?.label}</h3>
              <p className="acr-muted">This panel is sketched — the three shown in full detail (<b>Autonomy</b>, <b>Appearance</b>, <b>Data providers</b>) demonstrate the pattern.</p>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

const SET_CSS = `
  .set-page { display: grid; grid-template-columns: 220px minmax(0,1fr); gap: 32px; align-items: flex-start; }
  @media (max-width: 960px) { .set-page { grid-template-columns: 1fr; } }

  .set-nav { position: sticky; top: 86px; display: flex; flex-direction: column; gap: 14px; }
  .set-nav-group { font: 500 10.5px/1 var(--font-sans); letter-spacing: 0.07em; text-transform: uppercase; color: var(--ink-4); padding: 4px 10px 8px; }
  .set-nav-item { display: flex; align-items: center; gap: 9px; padding: 6px 10px; border-radius: 7px; background: transparent; border: 0; color: var(--ink-2); font: 500 13px/1 var(--font-sans); cursor: default; width: 100%; text-align: left; transition: background .1s; }
  .set-nav-item:hover { background: var(--surface-2); color: var(--ink); }
  .set-nav-item-active { background: var(--surface); color: var(--ink); box-shadow: var(--shadow-1), inset 0 0 0 0.5px var(--line); font-weight: 600; }
  .set-nav-item span { flex: 1; }

  .set-main { max-width: 820px; }
  .set-card { background: var(--surface); border: 0.5px solid var(--line); border-radius: 14px; box-shadow: var(--shadow-1); overflow: hidden; }
  .set-h { padding: 24px 28px 16px; border-bottom: 0.5px solid var(--line-soft); }
  .set-h-sub { padding-top: 20px; padding-bottom: 12px; }
  .set-h h3 { font: 600 20px/1.2 var(--font-display); letter-spacing: -0.02em; color: var(--ink); margin: 0; }
  .set-h h4 { font: 600 13px/1 var(--font-sans); letter-spacing: -0.005em; color: var(--ink); margin: 0 0 2px; }
  .set-h p { font: 400 13px/1.5 var(--font-sans); color: var(--ink-2); margin: 6px 0 0; max-width: 580px; }

  .set-row { display: flex; gap: 24px; padding: 16px 28px; align-items: center; border-top: 0.5px solid var(--line-soft); }
  .set-row-stack { flex-direction: column; align-items: stretch; }
  .set-row:first-of-type { border-top: 0; }
  .set-row-l { flex: 1; min-width: 0; }
  .set-row-label { font: 500 13px/1.2 var(--font-sans); color: var(--ink); letter-spacing: -0.005em; }
  .set-row-desc { font: 400 12px/1.5 var(--font-sans); color: var(--ink-3); margin-top: 3px; }
  .set-row-r { flex-shrink: 0; }
  .set-row-stack .set-row-r { margin-top: 12px; }

  .set-toggle { width: 32px; height: 19px; border-radius: 999px; background: var(--surface-2); border: 0.5px solid var(--line); padding: 0; cursor: default; transition: background .15s; position: relative; }
  .set-toggle-knob { position: absolute; top: 1px; left: 1px; width: 15px; height: 15px; border-radius: 50%; background: #fff; box-shadow: 0 1px 2px rgba(0,0,0,.2); transition: left .15s cubic-bezier(.3,.7,.4,1); }
  .set-toggle-on { background: var(--brand); border-color: var(--brand); }
  .set-toggle-on .set-toggle-knob { left: 14px; }

  .set-select { position: relative; }
  .set-select select { appearance: none; background: var(--surface); border: 0.5px solid var(--line); border-radius: 8px; padding: 6px 28px 6px 10px; font: 500 12.5px/1 var(--font-sans); color: var(--ink); cursor: default; outline: none; }
  .set-select select:focus { box-shadow: var(--ring); }
  .set-select svg { position: absolute; right: 10px; top: 50%; transform: translateY(-50%); color: var(--ink-3); pointer-events: none; }

  .set-input-group { display: inline-flex; align-items: center; background: var(--surface); border: 0.5px solid var(--line); border-radius: 8px; padding: 0 10px; }
  .set-input-prefix { color: var(--ink-3); font: 500 12.5px/1 var(--font-sans); }
  .set-input { border: 0; outline: 0; background: transparent; color: var(--ink); font: 500 12.5px/1 var(--font-sans); padding: 7px 6px; width: 90px; text-align: right; }

  .set-seg { display: inline-flex; padding: 2px; gap: 2px; background: var(--surface-2); border-radius: 8px; }
  .set-seg-btn { display: inline-flex; align-items: center; gap: 5px; padding: 5px 10px; border-radius: 6px; border: 0; background: transparent; color: var(--ink-2); font: 500 12px/1 var(--font-sans); cursor: default; }
  .set-seg-btn:hover { color: var(--ink); }
  .set-seg-btn-active { background: var(--surface); color: var(--ink); box-shadow: var(--shadow-1), inset 0 0 0 0.5px var(--line-soft); font-weight: 600; }

  /* Autonomy scale */
  .auto-scale { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; padding: 20px 28px 4px; }
  @media (max-width: 800px) { .auto-scale { grid-template-columns: 1fr 1fr; } }
  .auto-step { background: var(--surface-2); border: 0.5px solid var(--line-soft); border-radius: 10px; padding: 12px; text-align: left; cursor: default; display: flex; flex-direction: column; gap: 3px; transition: background .12s, border-color .12s; }
  .auto-step:hover { border-color: var(--line); }
  .auto-step-active { background: var(--brand-soft); border-color: color-mix(in srgb, var(--brand) 30%, transparent); box-shadow: var(--ring); }
  .auto-step-n { font: 600 10.5px/1 var(--font-mono); color: var(--ink-3); }
  .auto-step-active .auto-step-n { color: var(--brand); }
  .auto-step-label { font: 600 13.5px/1.2 var(--font-display); letter-spacing: -0.01em; color: var(--ink); margin-top: 2px; }
  .auto-step-desc { font: 400 11.5px/1.4 var(--font-sans); color: var(--ink-2); margin-top: 3px; text-wrap: pretty; }

  /* Theme chooser */
  .set-themes { display: grid; grid-template-columns: repeat(5, 1fr); gap: 10px; }
  @media (max-width: 1100px) { .set-themes { grid-template-columns: repeat(3, 1fr); } }
  @media (max-width: 720px) { .set-themes { grid-template-columns: 1fr; } }
  .set-theme { background: var(--surface-2); border: 0.5px solid var(--line-soft); border-radius: 10px; padding: 10px; text-align: left; cursor: default; }
  .set-theme:hover { border-color: var(--line); }
  .set-theme-active { border-color: var(--brand); box-shadow: var(--ring); }
  .set-theme-swatch { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; height: 36px; border-radius: 6px; overflow: hidden; margin-bottom: 10px; }
  .set-theme-swatch > div { height: 100%; }
  .set-theme-name { font: 600 12.5px/1.2 var(--font-display); color: var(--ink); letter-spacing: -0.005em; }
  .set-theme-tag  { font: 400 11px/1.4 var(--font-sans); color: var(--ink-3); margin-top: 2px; }

  /* Providers */
  .prov-grid { display: grid; grid-template-columns: 1fr; }
  .prov-card { display: flex; align-items: center; gap: 14px; padding: 14px 28px; border-top: 0.5px solid var(--line-soft); }
  .prov-card:first-child { border-top: 0; }
  .prov-icon { width: 34px; height: 34px; border-radius: 8px; background: var(--surface-2); color: var(--ink-2); display: inline-flex; align-items: center; justify-content: center; }
  .prov-body { flex: 1; min-width: 0; }
  .prov-name { font: 600 13px/1.2 var(--font-sans); color: var(--ink); letter-spacing: -0.005em; }
  .prov-cat  { font: 500 11.5px/1 var(--font-sans); color: var(--ink-3); margin-top: 3px; }
  .prov-meta { display: flex; flex-direction: column; align-items: flex-end; gap: 5px; }
  .prov-plan { font: 500 11.5px/1 var(--font-sans); color: var(--ink-3); }
`;

Object.assign(window, { Settings, SET_CSS, AppearancePanel, ProvidersPanel, AutonomyPanel, Toggle });
window.SETTINGS_SECTIONS_R3 = SETTINGS_SECTIONS;
