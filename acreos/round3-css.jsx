// acreos/round3-css.jsx — All Round 3 CSS in one place
const R3_FEATURES_CSS = `
/* DEAL CLOSED MOMENT */
.r3-moment-bg {
  position: fixed; inset: 0; z-index: 9000;
  background: rgba(0,0,0,0); backdrop-filter: blur(0px);
  display: flex; align-items: center; justify-content: center;
  transition: background 280ms ease, backdrop-filter 280ms ease;
}
.r3-moment-bg-on { background: rgba(0,0,0,.42); backdrop-filter: blur(8px); }
.r3-moment {
  position: relative; max-width: 460px; width: 92vw;
  background: var(--surface); border: 0.5px solid var(--line);
  border-radius: 16px; padding: 32px 28px 24px;
  box-shadow: 0 32px 80px -20px rgba(0,0,0,.5);
  opacity: 0; transform: translateY(20px) scale(0.96);
  transition: opacity 320ms cubic-bezier(.22,1,.36,1), transform 320ms cubic-bezier(.22,1,.36,1);
  overflow: hidden;
}
.r3-moment-on { opacity: 1; transform: translateY(0) scale(1); }
.r3-moment-glow {
  position: absolute; top: -80px; left: 50%; transform: translateX(-50%);
  width: 280px; height: 160px;
  background: radial-gradient(ellipse at center, var(--brand) 0%, transparent 70%);
  opacity: 0.18; pointer-events: none;
}
.r3-moment-eyebrow { font: 500 11px/1 var(--font-sans); letter-spacing: 0.06em; text-transform: uppercase; color: var(--brand); margin-bottom: 14px; position: relative; }
.r3-moment-num { font: 600 44px/1 var(--font-display); letter-spacing: -0.03em; color: var(--ink); position: relative; }
.r3-moment-sub { font: 400 13px/1.4 var(--font-sans); color: var(--ink-3); margin-top: 6px; position: relative; }
.r3-moment-line { height: 0.5px; background: var(--line); margin: 22px -28px; }
.r3-moment-stats { display: flex; gap: 24px; }
.r3-moment-stat-n { font: 600 22px/1 var(--font-display); color: var(--ink); }
.r3-moment-stat-l { font: 400 11px/1.3 var(--font-sans); color: var(--ink-3); margin-top: 4px; max-width: 100px; }
.r3-moment-quote { font: 400 13.5px/1.55 var(--font-serif); color: var(--ink-2); font-style: italic; margin: 22px 0 4px; padding-left: 12px; border-left: 2px solid var(--brand); }
.r3-moment-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 22px; }
.r3-moment-btn { background: var(--ink); color: var(--bg); border: 0; padding: 9px 16px; border-radius: 8px; font: 600 13px/1 var(--font-sans); cursor: default; }
.r3-moment-btn:hover { background: oklch(from var(--ink) l c h / 0.9); }
.r3-moment-btn:disabled { cursor: not-allowed; }
.r3-moment-btn-ghost { background: transparent; color: var(--ink-2); border: 0.5px solid var(--line); padding: 9px 16px; border-radius: 8px; font: 500 13px/1 var(--font-sans); cursor: default; }
.r3-moment-btn-ghost:hover { background: var(--surface-2); }

/* DAY-1 COMMAND CENTER */
.r3-day1 { max-width: 880px; margin: 0 auto; }
.r3-day1-title { font-family: var(--font-serif); font-weight: 500; font-size: 38px; letter-spacing: -0.02em; line-height: 1.1; }
.r3-day1-sub { font: 400 14px/1.6 var(--font-sans); color: var(--ink-2); max-width: 540px; margin-top: 10px; }
.r3-day1-skip { background: transparent; border: 0; color: var(--ink-3); font: 500 12.5px/1 var(--font-sans); cursor: default; padding: 8px 0; }
.r3-day1-skip:hover { color: var(--ink); }
.r3-day1-steps { display: flex; flex-direction: column; gap: 8px; margin-top: 8px; }
.r3-day1-step {
  display: grid; grid-template-columns: 32px 32px 1fr auto; align-items: center;
  gap: 16px; padding: 18px 20px;
  background: var(--surface); border: 0.5px solid var(--line); border-radius: 12px;
  transition: border-color 120ms, background 120ms;
}
.r3-day1-step:hover { background: var(--surface-2); border-color: var(--line-strong, var(--ink-3)); }
.r3-day1-step-n { font: 500 13px/1 var(--font-mono); color: var(--ink-3); }
.r3-day1-step-ic { color: var(--brand); }
.r3-day1-step-title { font: 600 14.5px/1.3 var(--font-sans); color: var(--ink); letter-spacing: -0.005em; }
.r3-day1-step-text { font: 400 12.5px/1.55 var(--font-sans); color: var(--ink-3); margin-top: 3px; max-width: 540px; }
.r3-day1-step-cta { background: transparent; border: 0; color: var(--brand); font: 600 12.5px/1 var(--font-sans); cursor: default; padding: 8px 12px; border-radius: 6px; }
.r3-day1-step-cta:hover { background: color-mix(in oklch, var(--brand) 10%, transparent); }
.r3-day1-foot { margin-top: 28px; display: flex; justify-content: space-between; align-items: center; gap: 20px; flex-wrap: wrap; }
.r3-day1-foot-title { font: 600 15px/1.3 var(--font-display); color: var(--ink); margin-top: 4px; }
.r3-day1-foot-sub { font: 400 12.5px/1.5 var(--font-sans); color: var(--ink-3); margin-top: 4px; max-width: 380px; }

/* MODAL (lost-reason + quick offer) */
.r3-modal-bg {
  position: fixed; inset: 0; z-index: 9100;
  background: rgba(0,0,0,.42); backdrop-filter: blur(6px);
  display: flex; align-items: center; justify-content: center;
  animation: r3-modal-bg-in 200ms ease;
}
@keyframes r3-modal-bg-in { from { background: rgba(0,0,0,0); backdrop-filter: blur(0); } }
.r3-modal {
  background: var(--surface); border: 0.5px solid var(--line);
  border-radius: 14px; padding: 24px 26px;
  width: 540px; max-width: 92vw;
  box-shadow: 0 24px 60px -16px rgba(0,0,0,.4);
  animation: r3-modal-in 240ms cubic-bezier(.22,1,.36,1);
}
@keyframes r3-modal-in {
  from { opacity: 0; transform: translateY(12px) scale(0.97); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}
.r3-modal-hd { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; }
.r3-modal-title { font: 500 22px/1.2 var(--font-serif); letter-spacing: -0.015em; margin: 6px 0 6px; color: var(--ink); }
.r3-modal-sub { font: 400 13px/1.5 var(--font-sans); color: var(--ink-2); max-width: 420px; }
.r3-modal-x { background: transparent; border: 0; color: var(--ink-3); font: 400 22px/1 var(--font-sans); padding: 0 6px; cursor: default; }
.r3-modal-x:hover { color: var(--ink); }
.r3-modal-foot { display: flex; gap: 8px; justify-content: flex-end; margin-top: 18px; padding-top: 16px; border-top: 0.5px solid var(--line-soft); }

/* LOST REASON */
.r3-lost-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-top: 18px; }
@media (max-width: 600px) { .r3-lost-grid { grid-template-columns: 1fr; } }
.r3-lost-opt { position: relative; text-align: left; padding: 12px 14px; background: transparent; border: 0.5px solid var(--line); border-radius: 8px; cursor: default; transition: border-color 120ms, background 120ms; }
.r3-lost-opt:hover { background: var(--surface-2); }
.r3-lost-opt-on { border-color: var(--brand); background: color-mix(in oklch, var(--brand) 8%, transparent); }
.r3-lost-opt-label { font: 600 13px/1.3 var(--font-sans); color: var(--ink); }
.r3-lost-opt-detail { font: 400 11.5px/1.45 var(--font-sans); color: var(--ink-3); margin-top: 3px; }
.r3-lost-opt-check { position: absolute; top: 10px; right: 12px; color: var(--brand); font: 600 14px/1 var(--font-sans); }
.r3-lost-note { margin-top: 16px; }
.r3-lost-textarea { width: 100%; box-sizing: border-box; margin-top: 6px; resize: none; padding: 10px 12px; border: 0.5px solid var(--line); border-radius: 8px; background: var(--surface); color: var(--ink); font: 400 13px/1.5 var(--font-sans); outline: 0; }
.r3-lost-textarea:focus { border-color: var(--brand); box-shadow: var(--ring); }

/* QUICK OFFER */
.r3-qo-bg { align-items: flex-start; padding-top: 12vh; }
.r3-qo { background: var(--surface); border: 0.5px solid var(--line); border-radius: 14px; padding: 20px 22px; width: 520px; max-width: 92vw; box-shadow: 0 24px 60px -16px rgba(0,0,0,.4); animation: r3-modal-in 240ms cubic-bezier(.22,1,.36,1); }
.r3-qo-hd { display: flex; justify-content: space-between; align-items: center; margin-bottom: 18px; }
.r3-qo-steps { display: inline-flex; gap: 5px; }
.r3-qo-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--line); }
.r3-qo-dot-on { background: var(--brand); }
.r3-qo-step { display: flex; flex-direction: column; gap: 8px; }
.r3-qo-label { font: 500 11px/1 var(--font-sans); letter-spacing: 0.06em; text-transform: uppercase; color: var(--ink-3); }
.r3-qo-input { border: 0; outline: 0; background: transparent; color: var(--ink); font: 500 22px/1.3 var(--font-display); letter-spacing: -0.01em; padding: 4px 0; border-bottom: 1px solid var(--line); width: 100%; box-sizing: border-box; }
.r3-qo-input:focus { border-bottom-color: var(--brand); }
.r3-qo-amount { display: flex; align-items: baseline; gap: 4px; }
.r3-qo-currency { font: 500 22px/1 var(--font-display); color: var(--ink-3); }
.r3-qo-amount-input { font-variant-numeric: tabular-nums; }
.r3-qo-hint { font: 400 11.5px/1.5 var(--font-sans); color: var(--ink-3); margin-top: 6px; }
.r3-qo-hint kbd { font: 500 10.5px/1 var(--font-mono); background: var(--surface-2); border: 0.5px solid var(--line); padding: 2px 5px; border-radius: 4px; color: var(--ink-2); }
.r3-qo-suggest { margin-top: 6px; }
.r3-qo-sg { display: flex; justify-content: space-between; gap: 10px; padding: 10px 12px; background: var(--surface-2); border: 0.5px solid var(--line); border-radius: 8px; width: 100%; box-sizing: border-box; cursor: default; text-align: left; }
.r3-qo-sg:hover { border-color: var(--brand); }
.r3-qo-terms { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
@media (max-width: 600px) { .r3-qo-terms { grid-template-columns: 1fr; } }
.r3-qo-term { padding: 10px 12px; background: transparent; border: 0.5px solid var(--line); border-radius: 8px; cursor: default; text-align: left; }
.r3-qo-term:hover { background: var(--surface-2); }
.r3-qo-term-on { border-color: var(--brand); background: color-mix(in oklch, var(--brand) 8%, transparent); }
.r3-qo-term-label { font: 600 13px/1.3 var(--font-sans); color: var(--ink); }
.r3-qo-term-detail { font: 400 11.5px/1.45 var(--font-sans); color: var(--ink-3); margin-top: 2px; }
.r3-qo-confirm { background: var(--surface-2); border: 0.5px solid var(--line); border-radius: 10px; padding: 16px; }
.r3-qo-confirm-title { font: 500 16px/1.3 var(--font-serif); color: var(--ink); margin-bottom: 10px; letter-spacing: -0.005em; }
.r3-qo-confirm-row { display: flex; justify-content: space-between; padding: 6px 0; font: 400 12.5px/1 var(--font-sans); color: var(--ink); border-bottom: 0.5px solid var(--line-soft); }
.r3-qo-confirm-row:last-child { border-bottom: 0; }
.r3-qo-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 14px; }

/* AUTONOMY SLIDER */
.r3-auto-card { padding: 20px 22px; }
.r3-auto-hd { display: flex; justify-content: space-between; align-items: flex-start; gap: 20px; margin-bottom: 24px; }
.r3-auto-title { font: 500 22px/1.2 var(--font-serif); letter-spacing: -0.015em; color: var(--ink); margin-top: 4px; }
.r3-auto-desc { font: 400 13px/1.5 var(--font-sans); color: var(--ink-2); margin-top: 4px; max-width: 360px; }
.r3-auto-stat { font: 500 11px/1.4 var(--font-mono); color: var(--ink-3); text-align: right; }
.r3-auto-track { position: relative; height: 4px; background: var(--surface-2); border-radius: 2px; margin: 36px 18px 50px; }
.r3-auto-fill { position: absolute; top: 0; left: 0; height: 100%; background: var(--brand); border-radius: 2px; transition: width 320ms cubic-bezier(.22,1,.36,1); }
.r3-auto-stop { position: absolute; top: 50%; transform: translate(-50%, -50%); width: 16px; height: 16px; border-radius: 50%; background: var(--surface); border: 1.5px solid var(--line); cursor: default; padding: 0; transition: border-color 120ms, transform 120ms, background 120ms; }
.r3-auto-stop:hover { transform: translate(-50%, -50%) scale(1.15); }
.r3-auto-stop-passed { background: var(--brand); border-color: var(--brand); }
.r3-auto-stop-on { background: var(--brand); border-color: var(--brand); transform: translate(-50%, -50%) scale(1.3); }
.r3-auto-stop-label { position: absolute; top: 22px; left: 50%; transform: translateX(-50%); font: 500 11px/1 var(--font-sans); color: var(--ink-3); white-space: nowrap; }
.r3-auto-stop-on .r3-auto-stop-label, .r3-auto-stop-passed .r3-auto-stop-label { color: var(--ink); font-weight: 600; }
.r3-auto-impact { padding-top: 16px; border-top: 0.5px solid var(--line-soft); }
.r3-auto-impact-row { margin-bottom: 12px; font: 500 11.5px/1 var(--font-sans); }
.r3-auto-impact-bars { display: flex; flex-direction: column; gap: 8px; }
.r3-auto-bar-wrap { display: grid; grid-template-columns: 180px 1fr 36px; align-items: center; gap: 12px; }
.r3-auto-bar-label { font: 400 12px/1 var(--font-sans); color: var(--ink-2); }
.r3-auto-bar { height: 6px; background: var(--surface-2); border-radius: 3px; overflow: hidden; }
.r3-auto-bar-fill { height: 100%; background: var(--brand); border-radius: 3px; transition: width 420ms cubic-bezier(.22,1,.36,1); }
.r3-auto-bar-n { font: 500 12px/1 var(--font-mono); color: var(--ink); text-align: right; }

/* LIVE FEED */
.r3-feed { padding: 0; overflow: hidden; }
.r3-feed-hd { display: flex; justify-content: space-between; align-items: center; padding: 16px 18px; border-bottom: 0.5px solid var(--line); }
.r3-feed-title { font: 500 15px/1.3 var(--font-display); color: var(--ink); margin: 4px 0 0; letter-spacing: -0.005em; }
.r3-feed-pulse { display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: var(--ink-3); margin-right: 6px; vertical-align: middle; }
.r3-feed-pulse-on { background: oklch(74% 0.16 145); animation: r3-pulse 1400ms ease-in-out infinite; }
@keyframes r3-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
.r3-feed-list { max-height: 480px; overflow-y: auto; font-family: var(--font-mono); }
.r3-feed-row { display: grid; grid-template-columns: 60px 60px 160px 1fr 50px; gap: 12px; align-items: center; padding: 8px 18px; border-bottom: 0.5px solid var(--line-soft); font-size: 11.5px; line-height: 1.3; transition: background 200ms; }
.r3-feed-row:last-child { border-bottom: 0; }
.r3-feed-row-new { background: color-mix(in oklch, var(--brand) 10%, transparent); animation: r3-feed-flash 1400ms ease-out; }
@keyframes r3-feed-flash { from { background: color-mix(in oklch, var(--brand) 22%, transparent); } to { background: transparent; } }
.r3-feed-time { color: var(--ink-3); }
.r3-feed-agent { font-weight: 600; }
.r3-feed-agent-atlas { color: oklch(60% 0.18 30); }
.r3-feed-agent-pax { color: oklch(58% 0.16 240); }
.r3-feed-agent-sophie { color: oklch(60% 0.14 145); }
.r3-feed-tenant { color: var(--ink-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.r3-feed-action { color: var(--ink); font-family: var(--font-sans); font-size: 12px; }
.r3-feed-ms { color: var(--ink-3); text-align: right; }
@media (max-width: 800px) {
  .r3-feed-row { grid-template-columns: 50px 50px 1fr 40px; }
  .r3-feed-tenant { display: none; }
}

/* BEFORE/AFTER TOGGLE */
.r3-ba-toggle { display: inline-flex; align-items: center; gap: 8px; background: var(--surface); border: 0.5px solid var(--line); border-radius: 999px; padding: 6px 12px 6px 8px; cursor: default; font: 500 12px/1 var(--font-sans); color: var(--ink-2); transition: border-color 120ms, background 120ms; }
.r3-ba-toggle:hover { border-color: var(--ink-3); }
.r3-ba-toggle-on { background: var(--ink); color: var(--bg); border-color: var(--ink); }
.r3-ba-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--ink-3); }
.r3-ba-toggle-on .r3-ba-dot { background: var(--bg); }
.r3-without-fade { opacity: 0.35; filter: grayscale(0.7); transition: opacity 280ms, filter 280ms; pointer-events: none; }

/* TABLE KEY-NAV row highlight */
.tbl-row-kbd { background: color-mix(in oklch, var(--brand) 8%, transparent) !important; box-shadow: inset 2px 0 0 var(--brand); }
`;
window.R3_FEATURES_CSS = R3_FEATURES_CSS;
