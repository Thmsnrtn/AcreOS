// acreos/guided-tour.jsx — first-run coachmark tour, triggered by ?tour=1

const { useState: useTState, useEffect: useTEffect, useRef: useTRef } = React;

const TOUR_STEPS = [
  {
    id: 'sidebar-home',
    selector: '[data-tour-nav="home"]',
    title: 'This is your Command Center',
    body: "Every morning, the agents post their overnight work here. New parcels Atlas found, mailers Pax queued, deals Sophie tracked. Open it first thing.",
    placement: 'right',
  },
  {
    id: 'sidebar-inbox',
    selector: '[data-tour-nav="inbox"]',
    title: 'Inbox · seller conversations',
    body: "When sellers text or call back, Pax handles the first reply and routes the rest into your Inbox. Recordings, transcripts, and Pax's draft response are all here.",
    placement: 'right',
  },
  {
    id: 'sidebar-pipeline',
    selector: '[data-tour-nav="pipeline"]',
    title: 'Your deal pipeline',
    body: "From first response through close. Drag-and-drop or let Sophie advance stages automatically based on what she sees in your inbox and contracts.",
    placement: 'right',
  },
  {
    id: 'sidebar-parcels',
    selector: '[data-tour-nav="parcels"]',
    title: 'Parcel records',
    body: "Atlas's nightly pull lands here. Every parcel has a score, comp data, owner skip-trace, and a one-click 'send offer' that drafts a mailer in your voice.",
    placement: 'right',
  },
  {
    id: 'sidebar-pax',
    selector: '[data-tour-nav="pax"]',
    title: 'Ask AcreOS — your copilot',
    body: "Pull up Pax to ask anything: 'show me parcels under $40k in Coconino with road access' or 'draft a follow-up to the Sandoval seller.' He has all your data and acts in your voice.",
    placement: 'right',
  },
  {
    id: 'palette',
    selector: '[data-tour-nav="settings"]',
    title: 'Press ⌘K from anywhere',
    body: "The command palette is the fastest way to do anything in AcreOS. Search parcels, jump pages, draft offers, change autonomy — all from one bar.",
    placement: 'right',
  },
  {
    id: 'wrap',
    selector: 'body',
    centered: true,
    title: "That's the tour.",
    body: "Atlas is pulling your first list overnight. Tomorrow morning, log in here and start with the Command Center. Pax will handle replies the moment they come in.",
    cta: 'Start using AcreOS',
  },
];

function GuidedTour() {
  const [active, setActive] = useTState(false);
  const [stepIdx, setStepIdx] = useTState(0);
  const [rect, setRect] = useTState(null);
  const popRef = useTRef(null);

  // Auto-start when ?tour=1 or localStorage flag present
  useTEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const want = params.get('tour') === '1' || localStorage.getItem('acreos-tour-pending') === '1';
    if (want) {
      setTimeout(() => setActive(true), 600);
      try { localStorage.removeItem('acreos-tour-pending'); } catch (e) {}
    }
    // Allow Tweaks panel to re-launch
    window.__acrLaunchTour = () => { setStepIdx(0); setActive(true); };
  }, []);

  const step = TOUR_STEPS[stepIdx];

  // Track target rect
  useTEffect(() => {
    if (!active || !step) return;

    if (step.onEnter) step.onEnter();

    const measure = () => {
      if (step.centered) { setRect({ centered: true }); return; }
      const el = document.querySelector(step.selector);
      if (!el) { setRect(null); return; }
      const r = el.getBoundingClientRect();
      setRect({ x: r.left, y: r.top, w: r.width, h: r.height });
    };
    measure();
    const ro = new ResizeObserver(measure);
    document.body && ro.observe(document.body);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    const t = setInterval(measure, 200);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
      clearInterval(t);
      if (step.onLeave) step.onLeave();
    };
  }, [active, stepIdx]);

  if (!active) return null;

  const next = () => {
    if (stepIdx < TOUR_STEPS.length - 1) setStepIdx(stepIdx + 1);
    else dismiss();
  };
  const prev = () => stepIdx > 0 && setStepIdx(stepIdx - 1);
  const dismiss = () => { setActive(false); setStepIdx(0); };

  // Compute popover position, clamped to viewport
  let popStyle = {};
  if (rect && rect.centered) {
    popStyle = { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' };
  } else if (rect) {
    const POP_W = 340;
    const POP_H_EST = 220;
    const MARGIN = 16;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const placement = step.placement || 'right';

    let top, left;
    if (placement === 'right') {
      left = rect.x + rect.w + 16;
      top = rect.y + rect.h / 2 - POP_H_EST / 2;
    } else if (placement === 'bottom') {
      left = rect.x + rect.w / 2 - POP_W / 2;
      top = rect.y + rect.h + 16;
    } else if (placement === 'top') {
      left = rect.x + rect.w / 2 - POP_W / 2;
      top = rect.y - POP_H_EST - 16;
    } else {
      left = rect.x - POP_W - 16;
      top = rect.y + rect.h / 2 - POP_H_EST / 2;
    }

    // If right placement would overflow, flip to left
    if (placement === 'right' && left + POP_W + MARGIN > vw) {
      left = rect.x - POP_W - 16;
    }
    // Clamp horizontally
    left = Math.max(MARGIN, Math.min(left, vw - POP_W - MARGIN));
    // Clamp vertically
    top = Math.max(MARGIN, Math.min(top, vh - POP_H_EST - MARGIN));

    popStyle = { top, left };
  }

  // Highlight cutout style
  const cutoutStyle = (rect && !rect.centered) ? {
    top: rect.y - 6,
    left: rect.x - 6,
    width: rect.w + 12,
    height: rect.h + 12,
  } : null;

  return (
    <div className="acr-tour" role="dialog" aria-label="Guided tour">
      <div className="acr-tour-veil" onClick={dismiss}></div>
      {cutoutStyle && (
        <div className="acr-tour-cutout" style={cutoutStyle}></div>
      )}
      <div className="acr-tour-pop" style={popStyle} ref={popRef}>
        <div className="acr-tour-pop-head">
          <span className="acr-tour-pop-eyebrow">
            <span className="acr-tour-pop-dot"></span>
            Tour · step {stepIdx + 1} of {TOUR_STEPS.length}
          </span>
          <button className="acr-tour-pop-close" onClick={dismiss} aria-label="Close tour">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18"/>
            </svg>
          </button>
        </div>
        <h3 className="acr-tour-pop-title">{step.title}</h3>
        <p className="acr-tour-pop-body">{step.body}</p>
        <div className="acr-tour-pop-foot">
          <div className="acr-tour-dots">
            {TOUR_STEPS.map((_, i) => (
              <span key={i} className={i === stepIdx ? 'is-on' : i < stepIdx ? 'is-done' : ''}></span>
            ))}
          </div>
          <div className="acr-tour-actions">
            {stepIdx > 0 && <button className="acr-tour-btn-ghost" onClick={prev}>Back</button>}
            <button className="acr-tour-btn-skip" onClick={dismiss}>Skip</button>
            <button className="acr-tour-btn" onClick={next}>
              {stepIdx === TOUR_STEPS.length - 1 ? (step.cta || 'Done') : 'Next'}
              {stepIdx < TOUR_STEPS.length - 1 && (
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginLeft: 4 }}>
                  <path d="M5 12h14M13 6l6 6-6 6"/>
                </svg>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const TOUR_CSS = `
.acr-tour {
  position: fixed; inset: 0;
  z-index: 9999;
  pointer-events: none;
  font-family: var(--font-sans);
}
.acr-tour-veil {
  position: absolute; inset: 0;
  background: rgba(20, 12, 4, 0.55);
  backdrop-filter: blur(2px);
  -webkit-backdrop-filter: blur(2px);
  pointer-events: auto;
  animation: acr-tour-veil-in .25s ease;
}
@keyframes acr-tour-veil-in { from { opacity: 0; } to { opacity: 1; } }
.acr-tour-cutout {
  position: absolute;
  border-radius: 10px;
  box-shadow:
    0 0 0 9999px rgba(20,12,4,0.55),
    0 0 0 2px var(--brand, #C2531C),
    0 0 0 6px rgba(194,83,28,0.25);
  background: transparent;
  pointer-events: none;
  transition: top .25s cubic-bezier(.16,.84,.44,1), left .25s cubic-bezier(.16,.84,.44,1), width .25s, height .25s;
  animation: acr-tour-cut-in .3s ease;
}
@keyframes acr-tour-cut-in { from { transform: scale(0.92); opacity: 0; } to { transform: none; opacity: 1; } }
.acr-tour-pop {
  position: absolute;
  width: 340px;
  background: var(--surface, #FFFBF1);
  color: var(--ink, #241607);
  border: 0.5px solid var(--line, rgba(80,40,15,0.14));
  border-radius: 14px;
  box-shadow: 0 18px 48px rgba(20,12,4,0.28), 0 2px 6px rgba(20,12,4,0.12);
  padding: 18px 20px 16px;
  pointer-events: auto;
  animation: acr-tour-pop-in .3s cubic-bezier(.16,.84,.44,1);
}
@keyframes acr-tour-pop-in { from { transform: translateY(6px) scale(.97); opacity: 0; } to { opacity: 1; } }
.acr-tour-pop-head {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 10px;
}
.acr-tour-pop-eyebrow {
  display: inline-flex; align-items: center; gap: 7px;
  font: 600 10px/1 var(--font-sans); letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--brand, #C2531C);
}
.acr-tour-pop-dot {
  width: 6px; height: 6px; border-radius: 50%;
  background: var(--brand, #C2531C);
  animation: acr-tour-pulse 1.4s ease-in-out infinite;
}
@keyframes acr-tour-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
.acr-tour-pop-close {
  width: 22px; height: 22px;
  display: inline-flex; align-items: center; justify-content: center;
  border-radius: 6px;
  color: var(--ink-3, #8F7A52);
  cursor: default;
}
.acr-tour-pop-close:hover { background: var(--surface-2, #F3EAD4); color: var(--ink, #241607); }
.acr-tour-pop-title {
  font: 500 19px/1.25 var(--font-display, 'Fraunces', serif);
  letter-spacing: -0.015em;
  color: var(--ink, #241607);
  margin: 0 0 6px;
  font-variation-settings: 'opsz' 32;
  text-wrap: balance;
}
.acr-tour-pop-body {
  font: 400 13.5px/1.5 var(--font-sans);
  color: var(--ink-2, #5A4424);
  margin: 0 0 16px;
  text-wrap: pretty;
}
.acr-tour-pop-foot {
  display: flex; align-items: center; justify-content: space-between;
  gap: 12px;
}
.acr-tour-dots {
  display: inline-flex; gap: 4px;
}
.acr-tour-dots span {
  width: 5px; height: 5px; border-radius: 50%;
  background: var(--surface-2, #F3EAD4);
  transition: all .2s;
}
.acr-tour-dots span.is-done { background: var(--ink-4, #BAAA85); }
.acr-tour-dots span.is-on {
  background: var(--brand, #C2531C);
  width: 14px; border-radius: 99px;
}
.acr-tour-actions {
  display: inline-flex; gap: 6px;
}
.acr-tour-btn, .acr-tour-btn-ghost, .acr-tour-btn-skip {
  font: 600 12.5px/1 var(--font-sans);
  padding: 8px 12px;
  border-radius: 7px;
  cursor: default;
  display: inline-flex; align-items: center;
}
.acr-tour-btn {
  background: var(--ink, #241607);
  color: var(--bg-3, #FFFBF1);
}
.acr-tour-btn:hover { background: #1a0f04; }
.acr-tour-btn-ghost {
  background: transparent;
  color: var(--ink-2, #5A4424);
}
.acr-tour-btn-ghost:hover { background: var(--surface-2, #F3EAD4); }
.acr-tour-btn-skip {
  background: transparent;
  color: var(--ink-3, #8F7A52);
  font-weight: 500;
}
.acr-tour-btn-skip:hover { color: var(--ink, #241607); }
`;

Object.assign(window, { GuidedTour, TOUR_CSS });
