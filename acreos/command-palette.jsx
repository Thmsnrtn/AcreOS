// acreos/command-palette.jsx — ⌘K overlay

const { useState: useCState, useEffect: useCEffect, useRef: useCRef } = React;

const PALETTE_ITEMS = [
  { group: 'Navigate', items: [
    { id: 'go:home',      label: 'Command Center',   icon: 'home',     kbd: 'G H' },
    { id: 'go:pipeline',  label: 'Pipeline',         icon: 'pipeline', kbd: 'G P' },
    { id: 'go:atlas',     label: 'Atlas',            icon: 'sparkle',  kbd: 'G A' },
    { id: 'go:pax',       label: 'Ask AcreOS',       icon: 'wand',     kbd: 'G J' },
    { id: 'go:settings',  label: 'Settings',         icon: 'settings', kbd: 'G ,' },
  ]},
  { group: 'Actions', items: [
    { id: 'new:deal',     label: 'New deal',         icon: 'plus',     kbd: 'N D' },
    { id: 'new:mailer',   label: 'Queue a mailer',   icon: 'mail',     kbd: 'N M' },
    { id: 'new:call',     label: 'Log a call',       icon: 'phone',    kbd: 'N C' },
    { id: 'new:parcel',   label: 'Analyze a parcel', icon: 'map',      kbd: 'N P' },
  ]},
  { group: 'Ask AcreOS', items: [
    { id: 'ai:score',     label: 'Score the Apache parcel',       icon: 'sparkle' },
    { id: 'ai:draft',     label: 'Draft a counter to R. Martinez', icon: 'wand' },
    { id: 'ai:report',    label: 'Summarize the week',            icon: 'chart' },
  ]},
];

const CommandPalette = ({ onClose, onNavigate, onAmbient }) => {
  const [q, setQ] = useCState('');
  const [idx, setIdx] = useCState(0);
  const input = useCRef(null);

  useCEffect(() => { input.current && input.current.focus(); }, []);

  const filtered = PALETTE_ITEMS.map(g => ({
    ...g,
    items: g.items.filter(i => !q || i.label.toLowerCase().includes(q.toLowerCase()))
  })).filter(g => g.items.length > 0);

  const flat = filtered.flatMap(g => g.items);
  const activeId = flat[idx]?.id;

  const runItem = (id) => {
    if (id?.startsWith('go:')) onNavigate(id.slice(3));
    else if (id?.startsWith('ai:') || id?.startsWith('new:')) onAmbient();
    onClose();
  };

  useCEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowDown') { e.preventDefault(); setIdx(i => Math.min(i + 1, flat.length - 1)); }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setIdx(i => Math.max(i - 1, 0)); }
      if (e.key === 'Enter')     { e.preventDefault(); runItem(activeId); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeId, flat.length]);

  return (
    <div className="cp-backdrop" onClick={onClose}>
      <div className="cp-modal" onClick={e => e.stopPropagation()}>
        <div className="cp-input-wrap">
          <I.search size={16} />
          <input
            ref={input}
            className="cp-input"
            placeholder="Search or ask AcreOS…"
            value={q}
            onChange={e => { setQ(e.target.value); setIdx(0); }}
          />
          <Kbd>esc</Kbd>
        </div>
        <div className="cp-list">
          {filtered.map(g => (
            <div key={g.group}>
              <div className="cp-group">{g.group}</div>
              {g.items.map(it => {
                const Ic = I[it.icon] || I.dot;
                return (
                  <button key={it.id}
                    className={cx('cp-item', activeId === it.id && 'cp-item-active')}
                    onMouseEnter={() => setIdx(flat.findIndex(x => x.id === it.id))}
                    onClick={() => runItem(it.id)}>
                    <Ic size={15} />
                    <span>{it.label}</span>
                    {it.kbd && <span className="cp-kbd">{it.kbd.split(' ').map((k, i) => <Kbd key={i}>{k}</Kbd>)}</span>}
                  </button>
                );
              })}
            </div>
          ))}
          {flat.length === 0 && (
            <div className="cp-empty">
              <div style={{ fontWeight: 600, color: 'var(--ink)', marginBottom: 4 }}>Ask AcreOS "{q}"</div>
              <div>Press <Kbd>↵</Kbd> to send as a question to AcreOS Intelligence.</div>
            </div>
          )}
        </div>
        <div className="cp-foot">
          <span><Kbd>↑</Kbd><Kbd>↓</Kbd> navigate</span>
          <span><Kbd>↵</Kbd> open</span>
          <span><Kbd>⌘</Kbd><Kbd>J</Kbd> ask</span>
        </div>
      </div>
    </div>
  );
};

const CP_CSS = `
  .cp-backdrop { position: fixed; inset: 0; background: color-mix(in srgb, var(--bg-sunken) 60%, transparent); -webkit-backdrop-filter: blur(10px); backdrop-filter: blur(10px); z-index: 200; display: flex; align-items: flex-start; justify-content: center; padding: 14vh 24px 24px; animation: cp-in .15s ease; }
  @keyframes cp-in { from { opacity: 0; } to { opacity: 1; } }
  .cp-modal { width: 100%; max-width: 560px; background: var(--surface); border: 0.5px solid var(--line); border-radius: 14px; box-shadow: var(--shadow-3); overflow: hidden; display: flex; flex-direction: column; max-height: 70vh; animation: cp-pop .18s cubic-bezier(.3,.7,.4,1); }
  @keyframes cp-pop { from { transform: translateY(-6px) scale(.99); opacity: 0; } to { transform: none; opacity: 1; } }

  .cp-input-wrap { display: flex; align-items: center; gap: 10px; padding: 14px 16px; border-bottom: 0.5px solid var(--line); color: var(--ink-3); }
  .cp-input { flex: 1; border: 0; outline: 0; background: transparent; color: var(--ink); font: 400 15px/1 var(--font-sans); letter-spacing: -0.01em; }
  .cp-input::placeholder { color: var(--ink-3); }

  .cp-list { overflow-y: auto; padding: 6px; flex: 1; }
  .cp-group { font: 500 10.5px/1 var(--font-sans); letter-spacing: 0.08em; text-transform: uppercase; color: var(--ink-4); padding: 10px 12px 6px; }
  .cp-item { display: flex; align-items: center; gap: 10px; width: 100%; padding: 8px 10px; border-radius: 7px; background: transparent; border: 0; color: var(--ink-2); font: 500 13px/1 var(--font-sans); cursor: default; text-align: left; }
  .cp-item span { flex: 1; }
  .cp-item-active { background: var(--brand-soft); color: var(--ink); }
  .cp-item-active svg { color: var(--brand); }
  .cp-kbd { flex: 0; display: inline-flex; gap: 2px; }

  .cp-empty { padding: 32px 16px; text-align: center; color: var(--ink-3); font: 400 12.5px/1.5 var(--font-sans); }

  .cp-foot { display: flex; gap: 16px; padding: 10px 16px; border-top: 0.5px solid var(--line); background: var(--bg-sunken); font: 500 11px/1 var(--font-sans); color: var(--ink-3); }
  .cp-foot span { display: inline-flex; gap: 4px; align-items: center; }
`;

Object.assign(window, { CommandPalette, CP_CSS });
