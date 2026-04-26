// acreos/round3-integrations.jsx
// Wraps existing tier-B pages with Round-3 features (morning queue, MRR chart,
// live agent feed, autonomy slider, comp photos, atlas progressive disclosure,
// mobile inbox upgrade, first-run tooltips, settings sub-routes).
//
// Each wrapper composes the existing component + new pieces. We ALSO export a
// few standalone subcomponents (MorningQueue, CompPhotos, etc.) used inline.

const { useState: useIS, useEffect: useIE, useMemo: useIM } = React;

// ──────────────────────────────────────────────────────────
// MORNING QUEUE — 5-card stack triage, top of Command Center
// Each card is a deal that needs your call right now.
// j/k navigates · Enter opens · 1–5 quick-decides
// ──────────────────────────────────────────────────────────

const MORNING_DEALS = [
  {
    id: 'D-2196', parcel: '08-441-002', owner: 'C. Pritchard', county: 'Coconino, AZ', acres: 12.4, atlas: 89,
    headline: 'Counter accepted at $13,800 — owner asked for a 30-day close',
    body: 'Pritchard countered Tue at $13,800. Sophie checked title — clean. You have 4 days before this gets stale.',
    primary: 'Send paperwork', secondary: 'Reply with terms',
    confidence: 'high', agent: 'pax',
  },
  {
    id: 'D-2417', parcel: '21-088-103', owner: 'R. Martinez', county: 'Luna, NM', acres: 8.4, atlas: 76,
    headline: 'Replied 41h ago — Pax says nudge once more, then move on',
    body: 'Martinez sent a one-liner: "what\'s your best?" Pax drafted a $9,800 final with seller-finance hook.',
    primary: 'Send Pax\'s nudge', secondary: 'Skip · auto-archive',
    confidence: 'medium', agent: 'pax',
  },
  {
    id: 'D-2104', parcel: '12-008-117', owner: 'J. Okoro', county: 'Catron, NM', acres: 22.1, atlas: 82,
    headline: 'Atlas flagged a new comp — value just shifted +9%',
    body: 'Sale of 21-091-208 last week reset the comp band. Your $14K offer now reads conservative; Atlas suggests $16,200.',
    primary: 'Update offer', secondary: 'See new comp',
    confidence: 'high', agent: 'atlas',
  },
  {
    id: 'D-2058', parcel: '37-091-014', owner: 'D. Torres', county: 'Mohave, AZ', acres: 4.8, atlas: 71,
    headline: 'Borrower N-043 missed first payment — soft reminder sent',
    body: 'Sophie sent a soft note. 14 months on-time before this. Recommends a call before auto-escalation in 48h.',
    primary: 'Call Torres', secondary: 'Let Sophie handle it',
    confidence: 'low', agent: 'sophie',
  },
  {
    id: 'D-1991', parcel: '19-557-311', owner: 'L. Bramwell', county: 'Apache, AZ', acres: 16.0, atlas: 68,
    headline: 'Title commitment back — one easement worth a 2-min read',
    body: 'BLM utility easement, 1973. Sophie says non-blocking but you should eyeball it before close.',
    primary: 'Open commitment', secondary: 'Mark reviewed',
    confidence: 'medium', agent: 'sophie',
  },
];

const MorningQueue = ({ deals = MORNING_DEALS }) => {
  const [idx, setIdx] = useIS(0);
  const [done, setDone] = useIS([]);

  useIE(() => {
    const onKey = (e) => {
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'j' || e.key === 'ArrowDown') { e.preventDefault(); setIdx(i => Math.min(deals.length - 1, i + 1)); }
      else if (e.key === 'k' || e.key === 'ArrowUp') { e.preventDefault(); setIdx(i => Math.max(0, i - 1)); }
      else if (e.key === 'Enter' && !done.includes(deals[idx]?.id)) {
        e.preventDefault();
        const d = deals[idx];
        setDone(p => [...p, d.id]);
        window.toast && window.toast({
          label: `${d.primary} · ${d.id}.`,
          kind: 'success',
          onUndo: () => setDone(p => p.filter(x => x !== d.id))
        });
        if (window.__playSound) window.__playSound('tick');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [idx, done, deals]);

  const remaining = deals.filter(d => !done.includes(d.id));
  const progress = ((deals.length - remaining.length) / deals.length) * 100;

  if (remaining.length === 0) {
    return (
      <Card className="r3-mq-empty">
        <div className="r3-mq-empty-glyph">✓</div>
        <div className="r3-mq-empty-title">Queue clear.</div>
        <div className="r3-mq-empty-sub">{deals.length} decisions in {Math.round(deals.length * 1.4)} minutes. Pax handles replies from here.</div>
        <Button size="sm" variant="subtle" onClick={() => setDone([])}>Reset queue</Button>
      </Card>
    );
  }

  return (
    <div className="r3-mq">
      <div className="r3-mq-hd">
        <div>
          <div className="acr-eyebrow">Morning queue · 5 decisions</div>
          <h3 className="r3-mq-title">{remaining.length} to go · about {remaining.length * 90}s of your morning</h3>
        </div>
        <div className="r3-mq-progress">
          <div className="r3-mq-progress-bar"><div className="r3-mq-progress-fill" style={{ width: `${progress}%` }} /></div>
          <div className="r3-mq-progress-n">{deals.length - remaining.length} / {deals.length}</div>
        </div>
      </div>

      <div className="r3-mq-stack">
        {remaining.map((d, pos) => {
          const isCur = pos === Math.min(idx, remaining.length - 1);
          const offset = pos - Math.min(idx, remaining.length - 1);
          return (
            <div
              key={d.id}
              className={cx('r3-mq-card', isCur && 'r3-mq-card-cur')}
              style={{
                transform: `translateY(${offset * 8}px) scale(${1 - Math.abs(offset) * 0.03})`,
                opacity: offset < 0 ? 0 : Math.max(0.15, 1 - Math.abs(offset) * 0.22),
                zIndex: 10 - Math.abs(offset),
                pointerEvents: isCur ? 'auto' : 'none',
              }}
              onClick={() => setIdx(deals.indexOf(d))}
            >
              <div className="r3-mq-card-hd">
                <div className="r3-mq-card-meta">
                  <Pill tone={d.confidence === 'high' ? 'pos' : d.confidence === 'medium' ? 'brand' : 'neutral'}>
                    {d.agent === 'atlas' ? 'Atlas' : d.agent === 'pax' ? 'Pax' : 'Sophie'}
                  </Pill>
                  <span className="mono r3-mq-id">{d.parcel}</span>
                  <span className="muted">·</span>
                  <span className="muted">{d.owner} · {d.county}</span>
                </div>
                <span className="r3-mq-atlas">
                  <I.sparkle size={10} /> {d.atlas}
                </span>
              </div>
              <h4 className="r3-mq-headline">{d.headline}</h4>
              <p className="r3-mq-body">{d.body}</p>
              <div className="r3-mq-actions">
                <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); setDone(p => [...p, d.id]); }}>
                  {d.secondary}
                </Button>
                <Button variant="primary" size="sm" iconRight="arrow" onClick={(e) => {
                  e.stopPropagation();
                  setDone(p => [...p, d.id]);
                  window.toast && window.toast({ label: `${d.primary} · ${d.id}.`, kind: 'success' });
                  if (window.__playSound) window.__playSound('tick');
                }}>
                  {d.primary}
                </Button>
              </div>
              <div className="r3-mq-keys">
                <kbd>j</kbd><kbd>k</kbd> navigate · <kbd>↵</kbd> {d.primary.toLowerCase()}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ──────────────────────────────────────────────────────────
// COMP PHOTOS — satellite tile placeholders for Atlas comps
// Renders on Atlas-run, replaces / augments the comps table
// ──────────────────────────────────────────────────────────

const SatelliteTile = ({ label, distance, sold, $perAc, match, hue = 130 }) => {
  // Generate a deterministic "satellite" pattern
  const seed = label.charCodeAt(0) * 31 + label.charCodeAt(label.length - 1);
  const blocks = Array.from({ length: 18 }, (_, i) => {
    const r = Math.sin(seed + i * 1.3) * 1000;
    return {
      x: ((r % 100) + 100) % 100,
      y: ((Math.cos(seed + i * 0.7) * 100) + 100) % 100,
      w: 8 + (Math.abs(Math.sin(seed + i * 2.1)) * 18),
      h: 6 + (Math.abs(Math.cos(seed + i * 1.5)) * 14),
      shade: 0.2 + Math.abs(Math.sin(seed + i * 0.9)) * 0.5,
    };
  });
  return (
    <div className={cx('r3-comp-tile', match === 'high' && 'r3-comp-tile-hi')}>
      <div className="r3-comp-tile-img" style={{ background: `oklch(45% 0.05 ${hue})` }}>
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="r3-comp-tile-svg">
          <defs>
            <pattern id={`grid-${label}`} width="6" height="6" patternUnits="userSpaceOnUse">
              <path d="M 6 0 L 0 0 0 6" fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth="0.3"/>
            </pattern>
          </defs>
          {/* base terrain */}
          <rect width="100" height="100" fill={`oklch(42% 0.04 ${hue})`}/>
          <rect width="100" height="100" fill={`url(#grid-${label})`}/>
          {/* fields */}
          {blocks.map((b, i) => (
            <rect key={i}
              x={b.x} y={b.y} width={b.w} height={b.h}
              fill={`oklch(${48 + b.shade * 18}% 0.06 ${hue + b.shade * 30})`}
              opacity={0.7}
            />
          ))}
          {/* roads */}
          <path d="M 0 35 Q 30 32 60 38 T 100 36" stroke="rgba(255,255,255,0.18)" strokeWidth="0.6" fill="none"/>
          <path d="M 45 0 L 47 100" stroke="rgba(255,255,255,0.12)" strokeWidth="0.4" fill="none"/>
          {/* parcel boundary */}
          <rect x="38" y="38" width="26" height="22" fill="rgba(255,255,255,0.06)" stroke="oklch(72% 0.16 60)" strokeWidth="0.8"/>
          <text x="51" y="52" textAnchor="middle" fill="oklch(78% 0.12 60)" fontSize="6" fontWeight="600">{label}</text>
        </svg>
        <div className="r3-comp-tile-overlay">
          <Pill tone={match === 'high' ? 'pos' : 'neutral'}>{match}</Pill>
        </div>
      </div>
      <div className="r3-comp-tile-meta">
        <div className="r3-comp-tile-row">
          <span className="mono">{label}</span>
          <span className="acr-tabnum r3-comp-tile-price">${$perAc}/ac</span>
        </div>
        <div className="r3-comp-tile-sub">{distance} · sold {sold}</div>
      </div>
    </div>
  );
};

const CompPhotos = ({ comps }) => (
  <div className="r3-comp-grid">
    {comps.map((c, i) => (
      <SatelliteTile key={i} {...c} hue={120 + i * 14} />
    ))}
  </div>
);

// ──────────────────────────────────────────────────────────
// SETTINGS WITH SUB-ROUTES — left rail in the URL
// Wraps the existing Settings, but also accepts ?sub= deep links
// and surfaces the autonomy slider in place of the simple grid.
// ──────────────────────────────────────────────────────────

const SettingsC = ({ tweaks, setTweak }) => {
  const [active, setActive] = useIS('autonomy');
  const [autonomy, setAutonomy] = useIS(tweaks.autonomyLevel ?? 1);

  // Sub-route badge in the URL hash
  useIE(() => {
    const m = (window.location.hash || '').match(/sub=([\w-]+)/);
    if (m) setActive(m[1]);
  }, []);
  useIE(() => {
    const url = new URL(window.location.href);
    url.hash = `sub=${active}`;
    window.history.replaceState({}, '', url.toString());
  }, [active]);

  const setAutonomyAll = (v) => {
    setAutonomy(v);
    setTweak('autonomyLevel', v);
  };

  const sections = (window.SETTINGS_SECTIONS_R3 || [
    { group: 'Workspace', items: [
      { id: 'profile',    label: 'Profile',         icon: 'user' },
      { id: 'workspace',  label: 'Workspace',       icon: 'folder' },
      { id: 'billing',    label: 'Billing',         icon: 'coin', badge: 'Scale' },
      { id: 'team',       label: 'Team',            icon: 'users' },
    ]},
    { group: 'Intelligence', items: [
      { id: 'autonomy',   label: 'Autonomy',        icon: 'bolt' },
      { id: 'ai',         label: 'AcreOS Intelligence', icon: 'sparkle' },
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
  ]);

  return (
    <div className="set-page set-page-r3">
      <aside className="set-nav">
        {sections.map(g => (
          <div key={g.group}>
            <div className="set-nav-group">{g.group}</div>
            {g.items.map(it => {
              const Ic = I[it.icon] || I.dot;
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
        <div className="set-breadcrumb">
          <span className="muted">Settings</span>
          <span>→</span>
          <span>{sections.flatMap(g => g.items).find(i => i.id === active)?.label || active}</span>
        </div>

        {active === 'autonomy' && (
          <>
            {window.FirstRun ? (
              <FirstRun id="autonomy-slider" title="This is the autonomy stop." body="Drag to change how much AcreOS does on its own. Manual is safe; Autonomous lets the playbook run while you set guardrails." placement="bottom">
                <AutonomySlider value={autonomy} onChange={setAutonomyAll} />
              </FirstRun>
            ) : <AutonomySlider value={autonomy} onChange={setAutonomyAll} />}

            <Card className="r3-set-guardrails">
              <div className="set-h">
                <h3>Guardrails</h3>
                <p>What stops AcreOS from acting, regardless of autonomy level.</p>
              </div>
              <div className="set-row">
                <div className="set-row-l">
                  <div className="set-row-label">Approval threshold</div>
                  <div className="set-row-desc">Actions above this dollar value pause for your approval.</div>
                </div>
                <div className="set-row-r">
                  <div className="set-input-group">
                    <span className="set-input-prefix">$</span>
                    <input className="set-input acr-tabnum" defaultValue="5,000" />
                  </div>
                </div>
              </div>
              <div className="set-row">
                <div className="set-row-l">
                  <div className="set-row-label">Pause outside business hours</div>
                  <div className="set-row-desc">No outbound comms 7 PM – 8 AM local.</div>
                </div>
                <div className="set-row-r"><Toggle on={true} onChange={() => {}} /></div>
              </div>
              <div className="set-row">
                <div className="set-row-l">
                  <div className="set-row-label">Weekly briefing</div>
                  <div className="set-row-desc">Monday 7 AM summary of autonomous actions.</div>
                </div>
                <div className="set-row-r"><Toggle on={true} onChange={() => {}} /></div>
              </div>
            </Card>
          </>
        )}

        {active === 'appearance' && <AppearancePanel tweaks={tweaks} setTweak={setTweak} />}
        {active === 'providers' && <ProvidersPanel />}

        {active !== 'autonomy' && active !== 'appearance' && active !== 'providers' && (
          <Card padded={false}>
            <div className="set-h">
              <h3>{sections.flatMap(g => g.items).find(i => i.id === active)?.label}</h3>
              <p className="acr-muted">Sketched. The three panels in full detail (<b>Autonomy</b>, <b>Appearance</b>, <b>Data providers</b>) demonstrate the pattern. Sub-routes survive reload via the URL hash.</p>
            </div>
            <div style={{ padding: 28 }}>
              <EmptyState
                icon="cmd"
                eyebrow="Pattern preview"
                title="This panel follows the same shape."
                body="A page header, then SettingRow groupings, then secondary cards. Every panel is independently linkable."
                actions={[{ label: 'Back to Autonomy', onClick: () => setActive('autonomy'), variant: 'subtle' }]}
              />
            </div>
          </Card>
        )}
      </main>
    </div>
  );
};

Object.assign(window, {
  MorningQueue, CompPhotos, SatelliteTile,
  SettingsC,
});
