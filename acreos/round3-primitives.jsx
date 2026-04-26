// acreos/round3-primitives.jsx — Round 3 foundational primitives
// ──────────────────────────────────────────────────────────────────
// Includes: Toast/Undo system, sound design, page transitions,
// refined shimmer, first-run tooltips, custom icon set, MRR chart.

const { useState: useR3S, useEffect: useR3E, useRef: useR3R, useCallback: useR3C } = React;

// ──────────────────────────────────────────────────────────
// TOAST + UNDO SYSTEM
// One global queue. Toasts auto-dismiss after 5s; undo callback
// runs before commit completes (optimistic with reversal).
// ──────────────────────────────────────────────────────────

const ToastHost = () => {
  const [toasts, setToasts] = useR3S([]);
  useR3E(() => {
    const onShow = (e) => {
      const t = { id: Date.now() + Math.random(), ...e.detail };
      setToasts(prev => [...prev, t]);
      if (t.duration !== 0) {
        setTimeout(() => {
          setToasts(prev => prev.filter(x => x.id !== t.id));
        }, t.duration || 5000);
      }
    };
    window.addEventListener('acr-toast', onShow);
    return () => window.removeEventListener('acr-toast', onShow);
  }, []);
  const dismiss = (id) => setToasts(prev => prev.filter(t => t.id !== id));
  const undo = (t) => {
    if (t.onUndo) t.onUndo();
    window.dispatchEvent(new CustomEvent('acr-toast', { detail: { kind: 'info', label: 'Reverted.', duration: 2000 } }));
    dismiss(t.id);
  };
  return (
    <div className="r3-toasts" role="status" aria-live="polite">
      {toasts.map(t => (
        <div key={t.id} className={cx('r3-toast', `r3-toast-${t.kind || 'info'}`)}>
          <span className="r3-toast-dot" />
          <span className="r3-toast-label">{t.label}</span>
          {t.onUndo && (
            <button className="r3-toast-btn" onClick={() => undo(t)}>Undo</button>
          )}
          <button className="r3-toast-x" onClick={() => dismiss(t.id)} aria-label="Dismiss">×</button>
        </div>
      ))}
    </div>
  );
};

// Public API: window.toast({label, onUndo, kind, duration})
window.toast = (detail) => window.dispatchEvent(new CustomEvent('acr-toast', { detail }));

// ──────────────────────────────────────────────────────────
// SOUND DESIGN — 2 sounds, WebAudio-synthesized, no assets
// "tick" = ambient (AI did something in background)
// "chime" = needs your attention
// ──────────────────────────────────────────────────────────

let __audioCtx = null;
const ensureAudio = () => {
  if (__audioCtx) return __audioCtx;
  try {
    __audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  } catch (e) { return null; }
  return __audioCtx;
};

const playSound = (kind = 'tick') => {
  if (!window.__r3SoundOn) return;
  const ctx = ensureAudio();
  if (!ctx) return;
  if (ctx.state === 'suspended') ctx.resume();
  const now = ctx.currentTime;
  if (kind === 'tick') {
    // Soft, dry, 8kHz blip — barely perceptible
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(2600, now);
    o.frequency.exponentialRampToValueAtTime(1800, now + 0.06);
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(0.04, now + 0.005);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
    o.connect(g); g.connect(ctx.destination);
    o.start(now); o.stop(now + 0.1);
  } else if (kind === 'chime') {
    // Two-tone, warm, perfect-fifth-ish
    [880, 1320].forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(f, now + i * 0.08);
      g.gain.setValueAtTime(0, now + i * 0.08);
      g.gain.linearRampToValueAtTime(0.08, now + i * 0.08 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.001, now + i * 0.08 + 0.5);
      o.connect(g); g.connect(ctx.destination);
      o.start(now + i * 0.08); o.stop(now + i * 0.08 + 0.5);
    });
  }
};
window.__playSound = playSound;
window.__r3SoundOn = false; // off by default; toggle in Tweaks

// ──────────────────────────────────────────────────────────
// PAGE TRANSITION — 140ms cross-fade + slide on key change
// ──────────────────────────────────────────────────────────

const PageTransition = ({ pageKey, children }) => {
  const [k, setK] = useR3S(pageKey);
  const [phase, setPhase] = useR3S('in'); // in | out
  const pendingRef = useR3R(pageKey);
  useR3E(() => {
    if (pageKey === k) return;
    pendingRef.current = pageKey;
    setPhase('out');
    const t = setTimeout(() => {
      setK(pendingRef.current);
      setPhase('in');
    }, 100);
    return () => clearTimeout(t);
  }, [pageKey]);
  return (
    <div className={cx('r3-pagewrap', `r3-pagewrap-${phase}`)} key={k}>
      {children}
    </div>
  );
};

// ──────────────────────────────────────────────────────────
// FIRST-RUN TOOLTIP — one-time educational pop on key concepts
// ──────────────────────────────────────────────────────────

const seenKey = (k) => `acr-fr-${k}`;

const FirstRun = ({ id, title, body, position = 'bottom', children }) => {
  const [open, setOpen] = useR3S(false);
  const wrap = useR3R(null);
  useR3E(() => {
    if (typeof window === 'undefined') return;
    if (window.__r3ResetFR) {
      try { localStorage.removeItem(seenKey(id)); } catch (e) {}
    }
    let seen = false;
    try { seen = !!localStorage.getItem(seenKey(id)); } catch (e) {}
    if (!seen) {
      const t = setTimeout(() => setOpen(true), 600);
      return () => clearTimeout(t);
    }
  }, [id]);
  const dismiss = () => {
    try { localStorage.setItem(seenKey(id), '1'); } catch (e) {}
    setOpen(false);
  };
  return (
    <span className="r3-fr-wrap" ref={wrap}>
      {children}
      {open && (
        <div className={cx('r3-fr', `r3-fr-${position}`)} role="dialog" aria-label={title}>
          <div className="r3-fr-arrow" />
          <div className="r3-fr-eyebrow">First time you're seeing this</div>
          <div className="r3-fr-title">{title}</div>
          <div className="r3-fr-body">{body}</div>
          <div className="r3-fr-foot">
            <button className="r3-fr-btn" onClick={dismiss}>Got it</button>
          </div>
        </div>
      )}
    </span>
  );
};

// ──────────────────────────────────────────────────────────
// CUSTOM ICON SET — 30 hand-tuned icons in AcreOS visual language
// Same <Icon> wrapper as base; replaces generic line icons.
// Uses softer corners, varied stroke weight, more drawn feel.
// ──────────────────────────────────────────────────────────

const RIcon = ({ size = 16, children, fill = 'none', stroke = 'currentColor' }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill={fill}
    stroke={stroke}
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {children}
  </svg>
);

const R3_ICONS = {
  // Land + parcels — distinctive, evokes survey marks
  parcel: (p) => <RIcon {...p}><path d="M3.5 6.5 12 3l8.5 3.5v11L12 21l-8.5-3.5z"/><path d="M12 3v18M3.5 6.5 20.5 17.5M20.5 6.5 3.5 17.5" strokeWidth="0.9" opacity=".5"/></RIcon>,
  acre:   (p) => <RIcon {...p}><rect x="3" y="3" width="18" height="18" rx="1.5"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18" strokeWidth="0.7" opacity=".6"/></RIcon>,
  pin:    (p) => <RIcon {...p}><path d="M12 22c-4-5-7-8.5-7-12a7 7 0 0 1 14 0c0 3.5-3 7-7 12z"/><circle cx="12" cy="10" r="2.5"/></RIcon>,
  survey: (p) => <RIcon {...p}><path d="M12 3v18M3 12h18"/><path d="m6 6 12 12M18 6 6 18" strokeWidth="0.8" opacity=".5"/><circle cx="12" cy="12" r="2"/></RIcon>,
  deed:   (p) => <RIcon {...p}><path d="M5 3h11l4 4v14H5z"/><path d="M16 3v4h4M9 12h6M9 16h6M9 8h3"/><circle cx="16.5" cy="17.5" r="1.5" strokeWidth="0.9"/></RIcon>,
  // Money + finance
  coin2:  (p) => <RIcon {...p}><circle cx="12" cy="12" r="9"/><path d="M12 7v10M9.5 9.5h4a1.5 1.5 0 0 1 0 3h-3a1.5 1.5 0 0 0 0 3h4"/></RIcon>,
  scale:  (p) => <RIcon {...p}><path d="M12 3v18M5 8h14M5 8l-2 6h4zM19 8l-2 6h4z"/></RIcon>,
  ledger: (p) => <RIcon {...p}><rect x="3" y="4" width="18" height="16" rx="1.5"/><path d="M7 8h10M7 12h10M7 16h6" strokeWidth="1.2"/></RIcon>,
  // AI + agents
  spark2: (p) => <RIcon {...p}><path d="M12 3 13.5 9.5 20 11l-6.5 1.5L12 19l-1.5-6.5L4 11l6.5-1.5z"/></RIcon>,
  brain:  (p) => <RIcon {...p}><path d="M9 4a3 3 0 0 0-3 3v1a3 3 0 0 0-2 3v2a3 3 0 0 0 2 3v1a3 3 0 0 0 3 3"/><path d="M15 4a3 3 0 0 1 3 3v1a3 3 0 0 1 2 3v2a3 3 0 0 1-2 3v1a3 3 0 0 1-3 3"/><path d="M12 4v16M9 10h2M13 14h2"/></RIcon>,
  pulse:  (p) => <RIcon {...p}><path d="M3 12h4l2-7 4 14 2-7h6"/></RIcon>,
  thread: (p) => <RIcon {...p}><circle cx="6" cy="7" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="18" cy="17" r="2"/><path d="m7.5 8.5 3 3M13.5 13.5l3 3"/></RIcon>,
  // Comms
  envelope:(p) => <RIcon {...p}><rect x="3" y="5" width="18" height="14" rx="1.5"/><path d="m3 7 9 6 9-6"/></RIcon>,
  bubble: (p) => <RIcon {...p}><path d="M5 4h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-7l-4 4v-4H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"/></RIcon>,
  voice:  (p) => <RIcon {...p}><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3M9 21h6"/></RIcon>,
  // Pipeline & motion
  flow:   (p) => <RIcon {...p}><circle cx="5" cy="6" r="2.2"/><circle cx="19" cy="6" r="2.2"/><circle cx="5" cy="18" r="2.2"/><circle cx="19" cy="18" r="2.2"/><path d="M7 6h10M7 18h10M5 8v8M19 8v8" strokeWidth="1"/></RIcon>,
  funnel2:(p) => <RIcon {...p}><path d="M3 5h18l-7 9v6l-4-2v-4z"/></RIcon>,
  steps:  (p) => <RIcon {...p}><path d="M3 20h4v-4h4v-4h4V8h4V4"/></RIcon>,
  // Status
  pulse2: (p) => <RIcon {...p}><circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="6" opacity=".5"/><circle cx="12" cy="12" r="9" opacity=".25"/></RIcon>,
  shieldHalf:(p)=><RIcon {...p}><path d="M12 3 4 6v6c0 4 3 7 8 9 5-2 8-5 8-9V6z"/><path d="M12 3v18" strokeWidth="0.9" opacity=".4"/></RIcon>,
  bolt2:  (p) => <RIcon {...p}><path d="m13 3-8 11h6l-1 7 8-11h-6z"/></RIcon>,
  // Ops
  switch: (p) => <RIcon {...p}><rect x="3" y="8" width="18" height="8" rx="4"/><circle cx="16" cy="12" r="3" fill="currentColor" stroke="none"/></RIcon>,
  log:    (p) => <RIcon {...p}><path d="M5 4h14v16H5z"/><circle cx="8" cy="8" r="0.8" fill="currentColor"/><circle cx="8" cy="12" r="0.8" fill="currentColor"/><circle cx="8" cy="16" r="0.8" fill="currentColor"/><path d="M11 8h6M11 12h6M11 16h4"/></RIcon>,
  // Misc
  compass:(p) => <RIcon {...p}><circle cx="12" cy="12" r="9"/><path d="m9 15 2-6 4-2-2 6z" fill="currentColor" stroke="none" opacity=".6"/></RIcon>,
  layers2:(p) => <RIcon {...p}><path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5M3 18l9 5 9-5" opacity=".6"/></RIcon>,
  printer:(p) => <RIcon {...p}><path d="M7 8V4h10v4M7 18H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2"/><rect x="7" y="14" width="10" height="6"/></RIcon>,
  trophy: (p) => <RIcon {...p}><path d="M8 4h8v6a4 4 0 0 1-8 0z"/><path d="M16 7h3a2 2 0 0 1 0 4h-3M8 7H5a2 2 0 0 0 0 4h3M9 14v3h6v-3M7 21h10"/></RIcon>,
  pen:    (p) => <RIcon {...p}><path d="m15 4 5 5-11 11H4v-5z"/><path d="m13 6 5 5"/></RIcon>,
  loop:   (p) => <RIcon {...p}><path d="M3 12a9 9 0 0 1 15-6.7L21 8M21 12a9 9 0 0 1-15 6.7L3 16M21 3v5h-5M3 21v-5h5"/></RIcon>,
  satellite:(p) => <RIcon {...p}><path d="m4 13 7-7 4 4-7 7zM11 6l4 4M14 3l3 3M3 14l3 3M14 14a4 4 0 0 1 4 4M14 18a8 8 0 0 1 4-4"/></RIcon>,
};

window.RIcon = RIcon;
window.R3_ICONS = R3_ICONS;

// ──────────────────────────────────────────────────────────
// SHIMMER (replace pulse) — single 800ms sweep, no infinite loop
// ──────────────────────────────────────────────────────────
// Used by adding class .r3-shimmer to any skeleton

// ──────────────────────────────────────────────────────────
// MRR CHART — single SVG line chart for Founder Revenue
// ──────────────────────────────────────────────────────────

const MRRChart = ({ data, annotations = [] }) => {
  const w = 880, h = 280, pad = { l: 40, r: 24, t: 24, b: 36 };
  const max = Math.max(...data.map(d => d.v));
  const min = Math.min(...data.map(d => d.v)) * 0.95;
  const xStep = (w - pad.l - pad.r) / (data.length - 1);
  const y = (v) => pad.t + (h - pad.t - pad.b) * (1 - (v - min) / (max - min));
  const x = (i) => pad.l + i * xStep;
  const path = data.map((d, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(d.v)}`).join(' ');
  const area = `${path} L ${x(data.length-1)} ${h - pad.b} L ${x(0)} ${h - pad.b} Z`;
  const yTicks = 4;
  const tickVals = Array.from({ length: yTicks + 1 }, (_, i) => min + (max - min) * (i / yTicks));
  return (
    <div className="r3-chart-wrap">
      <svg viewBox={`0 0 ${w} ${h}`} className="r3-chart" role="img" aria-label="MRR over time">
        <defs>
          <linearGradient id="r3-mrr-grad" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--brand)" stopOpacity="0.18"/>
            <stop offset="100%" stopColor="var(--brand)" stopOpacity="0"/>
          </linearGradient>
        </defs>
        {tickVals.map((v, i) => (
          <g key={i}>
            <line x1={pad.l} x2={w - pad.r} y1={y(v)} y2={y(v)} stroke="var(--line-soft)" strokeWidth="0.5"/>
            <text x={pad.l - 8} y={y(v) + 3} textAnchor="end" fontSize="10" fill="var(--ink-3)" fontFamily="var(--font-mono)">${(v/1000).toFixed(0)}K</text>
          </g>
        ))}
        <path d={area} fill="url(#r3-mrr-grad)" />
        <path d={path} fill="none" stroke="var(--brand)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
        {data.map((d, i) => (i % 3 === 0 || i === data.length - 1) && (
          <g key={i}>
            <text x={x(i)} y={h - pad.b + 18} textAnchor="middle" fontSize="10" fill="var(--ink-3)">{d.label}</text>
          </g>
        ))}
        {annotations.map((a, i) => {
          const ax = x(a.index);
          const ay = y(data[a.index].v);
          return (
            <g key={i}>
              <line x1={ax} x2={ax} y1={ay} y2={ay - 26} stroke="var(--ink-2)" strokeWidth="0.8" strokeDasharray="2 2"/>
              <circle cx={ax} cy={ay} r="3.5" fill="var(--bg)" stroke="var(--brand)" strokeWidth="1.5"/>
              <rect x={ax - 60} y={ay - 46} width="120" height="20" rx="4" fill="var(--surface)" stroke="var(--line)" strokeWidth="0.5"/>
              <text x={ax} y={ay - 32} textAnchor="middle" fontSize="10" fill="var(--ink)" fontWeight="500">{a.label}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
};

// ──────────────────────────────────────────────────────────
// CSS for round 3 primitives
// ──────────────────────────────────────────────────────────

const R3_PRIMITIVES_CSS = `
/* TOAST */
.r3-toasts {
  position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
  display: flex; flex-direction: column; gap: 8px;
  z-index: 9999; pointer-events: none;
}
.r3-toast {
  pointer-events: auto;
  display: inline-flex; align-items: center; gap: 10px;
  background: var(--ink); color: var(--bg);
  padding: 10px 12px 10px 14px; border-radius: 10px;
  font: 500 13px/1 var(--font-sans);
  box-shadow: 0 12px 32px -8px rgba(0,0,0,.35), 0 0 0 0.5px rgba(255,255,255,.08);
  animation: r3-toast-in 220ms cubic-bezier(.22, 1, .36, 1);
  min-width: 240px; max-width: 480px;
}
.r3-toast-dot {
  width: 6px; height: 6px; border-radius: 50%;
  background: oklch(70% 0.16 60); flex-shrink: 0;
}
.r3-toast-success .r3-toast-dot { background: oklch(74% 0.14 145); }
.r3-toast-warn .r3-toast-dot { background: oklch(76% 0.14 70); }
.r3-toast-danger .r3-toast-dot { background: oklch(70% 0.18 28); }
.r3-toast-label { flex: 1; letter-spacing: -0.005em; }
.r3-toast-btn {
  background: rgba(255,255,255,.1); border: 0;
  color: var(--bg); font: 600 12px/1 var(--font-sans);
  padding: 6px 10px; border-radius: 6px; cursor: default;
  letter-spacing: 0;
}
.r3-toast-btn:hover { background: rgba(255,255,255,.18); }
.r3-toast-x {
  background: transparent; border: 0; color: rgba(255,255,255,.5);
  font: 400 18px/1 var(--font-sans); padding: 0 4px; cursor: default;
  margin-left: -4px;
}
.r3-toast-x:hover { color: var(--bg); }
@keyframes r3-toast-in {
  from { opacity: 0; transform: translateY(8px) scale(0.96); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}

/* PAGE TRANSITION */
.r3-pagewrap {
  opacity: 1; transform: translateY(0);
  transition: opacity 140ms ease, transform 140ms ease;
}
.r3-pagewrap-out { opacity: 0; transform: translateY(4px); }

/* FIRST-RUN TOOLTIP */
.r3-fr-wrap { position: relative; display: inline-flex; }
.r3-fr {
  position: absolute; z-index: 200; width: 280px;
  background: var(--ink); color: var(--bg);
  padding: 14px; border-radius: 10px;
  box-shadow: 0 16px 40px -8px rgba(0,0,0,.4);
  animation: r3-fr-in 280ms cubic-bezier(.22, 1, .36, 1);
}
.r3-fr-bottom { top: calc(100% + 12px); left: 50%; transform: translateX(-50%); }
.r3-fr-top    { bottom: calc(100% + 12px); left: 50%; transform: translateX(-50%); }
.r3-fr-right  { left: calc(100% + 12px); top: 50%; transform: translateY(-50%); }
.r3-fr-arrow {
  position: absolute; width: 10px; height: 10px;
  background: var(--ink); transform: rotate(45deg);
}
.r3-fr-bottom .r3-fr-arrow { top: -5px; left: calc(50% - 5px); }
.r3-fr-top .r3-fr-arrow    { bottom: -5px; left: calc(50% - 5px); }
.r3-fr-right .r3-fr-arrow  { left: -5px; top: calc(50% - 5px); }
.r3-fr-eyebrow {
  font: 500 10px/1 var(--font-sans); letter-spacing: 0.06em;
  text-transform: uppercase; color: rgba(255,255,255,.5);
  margin-bottom: 8px;
}
.r3-fr-title {
  font: 600 14.5px/1.3 var(--font-display); letter-spacing: -0.01em;
  color: var(--bg); margin-bottom: 6px;
}
.r3-fr-body {
  font: 400 12.5px/1.55 var(--font-sans); color: rgba(255,255,255,.78);
}
.r3-fr-foot { display: flex; justify-content: flex-end; margin-top: 12px; }
.r3-fr-btn {
  background: rgba(255,255,255,.1); border: 0;
  color: var(--bg); font: 600 12px/1 var(--font-sans);
  padding: 7px 12px; border-radius: 6px; cursor: default;
}
.r3-fr-btn:hover { background: rgba(255,255,255,.2); }
@keyframes r3-fr-in {
  from { opacity: 0; transform: translateX(-50%) translateY(6px); }
  to { opacity: 1; transform: translateX(-50%) translateY(0); }
}
.r3-fr-right { animation-name: r3-fr-in-r; }
@keyframes r3-fr-in-r {
  from { opacity: 0; transform: translateY(-50%) translateX(6px); }
  to { opacity: 1; transform: translateY(-50%) translateX(0); }
}

/* SHIMMER — replace pulsing */
.r3-shimmer, .sk {
  background: linear-gradient(
    90deg,
    var(--surface-2) 0%,
    color-mix(in oklch, var(--surface-2) 70%, var(--ink) 5%) 50%,
    var(--surface-2) 100%
  );
  background-size: 200% 100%;
  animation: r3-shimmer 1400ms ease-in-out infinite;
  border-radius: 4px;
}
@keyframes r3-shimmer {
  0% { background-position: 100% 0; }
  100% { background-position: -100% 0; }
}

/* MRR CHART */
.r3-chart-wrap {
  width: 100%; padding: 8px 4px 0;
  background: var(--surface);
}
.r3-chart {
  width: 100%; height: auto; display: block;
  font-family: var(--font-sans);
}
`;

Object.assign(window, {
  ToastHost, PageTransition, FirstRun,
  MRRChart, RIcon, R3_ICONS,
  R3_PRIMITIVES_CSS,
});
