// acreos/primitives.jsx — shared UI atoms

const cx = (...xs) => xs.filter(Boolean).join(' ');
const fmtK = (n) => n >= 1e6 ? `$${(n/1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n/1e3).toFixed(1)}K` : `$${n}`;
const fmtInt = (n) => n.toLocaleString('en-US');

// ─────────────────────────────────────────────── Surface / Card
const Card = ({ children, padded = true, interactive = false, style, className, ...p }) => (
  <div
    {...p}
    className={cx('acr-card', padded && 'acr-card-pad', interactive && 'acr-card-int', className)}
    style={style}
  >
    {children}
  </div>
);

// ─────────────────────────────────────────────── Button
const Button = ({ variant = 'secondary', size = 'md', icon, iconRight, children, className, ...p }) => {
  const sz = size === 'sm' ? 14 : 15;
  const IconL = icon && I[icon];
  const IconR = iconRight && I[iconRight];
  return (
    <button {...p} className={cx('acr-btn', `acr-btn-${variant}`, `acr-btn-${size}`, className)}>
      {IconL && <IconL size={sz} />}
      {children && <span>{children}</span>}
      {IconR && <IconR size={sz} />}
    </button>
  );
};

// ─────────────────────────────────────────────── Pill / Badge
const Pill = ({ tone = 'neutral', children, dot = false }) => (
  <span className={cx('acr-pill', `acr-pill-${tone}`)}>
    {dot && <span className="acr-pill-dot" />}
    {children}
  </span>
);

// ─────────────────────────────────────────────── Key
const Kbd = ({ children }) => <kbd className="acr-kbd">{children}</kbd>;

// ─────────────────────────────────────────────── Scrollable section
const SectionTitle = ({ eyebrow, title, action, children }) => (
  <div className="acr-section">
    <div className="acr-section-hd">
      <div>
        {eyebrow && <div className="acr-eyebrow">{eyebrow}</div>}
        <div className="acr-section-title">{title}</div>
      </div>
      {action}
    </div>
    {children}
  </div>
);

// ─────────────────────────────────────────────── Sparkline
const Sparkline = ({ data, height = 44, color = 'var(--brand)', fillOpacity = 0.14 }) => {
  const w = 260, h = height;
  const min = Math.min(...data), max = Math.max(...data);
  const rng = Math.max(1, max - min);
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - ((v - min) / rng) * (h - 4) - 2;
    return [x, y];
  });
  const path = pts.map(([x, y], i) => (i ? `L${x.toFixed(1)} ${y.toFixed(1)}` : `M${x.toFixed(1)} ${y.toFixed(1)}`)).join(' ');
  const area = `${path} L${w} ${h} L0 ${h} Z`;
  return (
    <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id="spk-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor={color} stopOpacity={fillOpacity}/>
          <stop offset="100%" stopColor={color} stopOpacity="0"/>
        </linearGradient>
      </defs>
      <path d={area} fill="url(#spk-fill)" />
      <path d={path} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
};

// ─────────────────────────────────────────────── Avatar (text initials)
const Avatar = ({ name, size = 28, tone = 'neutral' }) => {
  const initials = (name || '?').split(' ').map(s => s[0]).slice(0, 2).join('').toUpperCase();
  return (
    <span className={cx('acr-avatar', `acr-avatar-${tone}`)} style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }}>
      {initials}
    </span>
  );
};

// ─────────────────────────────────────────────── Shared CSS
const ACR_CSS = `
  :root { color-scheme: light dark; }
  body { color: var(--ink); background: var(--bg); transition: background .25s ease, color .25s ease; }

  .acr-card {
    background: var(--surface);
    border: 0.5px solid var(--line);
    border-radius: 14px;
    box-shadow: var(--shadow-1);
  }
  .acr-card-pad { padding: 20px; }
  .acr-card-int { cursor: default; transition: border-color .15s, box-shadow .15s, transform .15s; }
  .acr-card-int:hover { border-color: var(--line); box-shadow: var(--shadow-2); }

  .acr-btn {
    display: inline-flex; align-items: center; gap: 6px;
    font: 500 13px/1 var(--font-sans); letter-spacing: -0.005em;
    border-radius: 8px; border: 0.5px solid transparent;
    padding: 0 12px; height: 32px; cursor: default;
    transition: background .12s, border-color .12s, color .12s, box-shadow .12s;
    white-space: nowrap;
  }
  .acr-btn-sm { height: 26px; padding: 0 10px; font-size: 12px; border-radius: 7px; }
  .acr-btn-lg { height: 38px; padding: 0 16px; font-size: 13.5px; border-radius: 9px; }

  .acr-btn-primary { background: var(--brand); color: var(--brand-ink); box-shadow: 0 1px 0 rgba(255,255,255,.15) inset, var(--shadow-1); }
  .acr-btn-primary:hover { filter: brightness(1.04); box-shadow: 0 1px 0 rgba(255,255,255,.2) inset, var(--shadow-2); }

  .acr-btn-secondary { background: var(--surface); color: var(--ink); border-color: var(--line); box-shadow: var(--shadow-1); }
  .acr-btn-secondary:hover { background: var(--surface-2); border-color: var(--line); }

  .acr-btn-ghost { background: transparent; color: var(--ink-2); }
  .acr-btn-ghost:hover { background: var(--surface-2); color: var(--ink); }

  .acr-btn-subtle { background: var(--surface-2); color: var(--ink); }
  .acr-btn-subtle:hover { background: var(--bg-sunken); }

  .acr-btn:focus-visible { outline: none; box-shadow: var(--ring); }

  .acr-pill {
    display: inline-flex; align-items: center; gap: 5px;
    font: 500 11px/1 var(--font-sans); letter-spacing: 0;
    padding: 3px 8px; border-radius: 999px;
    background: var(--surface-2); color: var(--ink-2);
    border: 0.5px solid var(--line-soft);
  }
  .acr-pill-dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
  .acr-pill-pos { color: var(--pos); background: var(--pos-soft); border-color: transparent; }
  .acr-pill-neg { color: var(--neg); background: var(--neg-soft); border-color: transparent; }
  .acr-pill-warn{ color: var(--warn); background: var(--warn-soft); border-color: transparent; }
  .acr-pill-brand { color: var(--brand); background: var(--brand-soft); border-color: transparent; }
  .acr-pill-ghost { background: transparent; border-color: var(--line); }

  .acr-kbd {
    display: inline-flex; align-items: center; justify-content: center;
    min-width: 18px; height: 18px; padding: 0 5px;
    font: 500 11px/1 var(--font-mono); color: var(--ink-3);
    background: var(--surface-2); border: 0.5px solid var(--line);
    border-radius: 5px; box-shadow: 0 1px 0 var(--line-soft);
  }

  .acr-eyebrow {
    font: 500 10.5px/1 var(--font-sans); letter-spacing: 0.08em;
    text-transform: uppercase; color: var(--ink-3); margin-bottom: 6px;
  }
  .acr-section-hd { display: flex; align-items: flex-end; justify-content: space-between; margin-bottom: 12px; }
  .acr-section-title { font: 600 15px/1.2 var(--font-display); letter-spacing: -0.01em; color: var(--ink); }

  .acr-avatar {
    display: inline-flex; align-items: center; justify-content: center;
    border-radius: 50%; background: var(--surface-2); color: var(--ink-2);
    font-weight: 600; font-size: 11px; border: 0.5px solid var(--line-soft);
    flex-shrink: 0;
  }
  .acr-avatar-brand { background: var(--brand-soft); color: var(--brand); }
  .acr-avatar-accent { background: color-mix(in srgb, var(--accent) 14%, transparent); color: var(--accent); }
  .acr-avatar-pos { background: var(--pos-soft); color: var(--pos); }

  /* Focus ring baseline */
  :focus-visible { outline: none; }

  /* Utility */
  .acr-hairline { height: 1px; background: var(--line); }
  .acr-muted { color: var(--ink-3); }
  .acr-tabnum { font-variant-numeric: tabular-nums; }
`;

Object.assign(window, { cx, fmtK, fmtInt, Card, Button, Pill, Kbd, SectionTitle, Sparkline, Avatar, ACR_CSS });
