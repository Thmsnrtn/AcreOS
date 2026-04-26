// acreos/tier-c.jsx — C9 operator copy + C10 empty/loading/error states

// ──────────────────────────────────────────────────────────
// C9 · Copy helpers — operator voice
// Principles: present tense. Numbers before adjectives. No "I'll help you".
// Name the action. Earn the user's trust with specifics.
// ──────────────────────────────────────────────────────────

const copy = {
  // Greetings — one per time-of-day, no "Let me know how I can help"
  greeting: (name) => {
    const h = new Date().getHours();
    const stem = h < 5  ? 'Up late'
               : h < 12 ? 'Good morning'
               : h < 18 ? 'Good afternoon'
               :          'Good evening';
    return `${stem}, ${name}`;
  },

  // Action-led headlines — verbs first, context second
  needsAttention: (n) => n === 0
    ? 'Pipeline looks clean. Nothing needs you.'
    : n === 1
      ? '1 deal needs you today.'
      : `${n} deals need you today.`,

  // AI draft preamble
  drafted: (agent, what) => `${agent} drafted ${what}. Review before send.`,

  // Autonomy explainer
  autonomyLine: (level, what) =>
    level >= 3 ? `${what} will send without asking.`
    : level === 2 ? `${what} will wait for your approval.`
    : `${what} stays as a suggestion.`,
};

// ──────────────────────────────────────────────────────────
// C10 · Empty / loading / error states
// Every empty state names *why* it's empty and the *next action*.
// ──────────────────────────────────────────────────────────

/**
 * <EmptyState
 *   icon="inbox"
 *   eyebrow="No replies"
 *   title="Nobody's written back yet."
 *   body="That's normal. First replies usually land 4–7 days after a send."
 *   actions={[{label, variant, icon, onClick}]}
 * />
 */
const EmptyState = ({ icon = 'dot', eyebrow, title, body, actions = [] }) => {
  const Ic = I[icon] || I.dot;
  return (
    <div className="es">
      <div className="es-ic"><Ic size={22} /></div>
      {eyebrow && <div className="acr-eyebrow">{eyebrow}</div>}
      <div className="es-title">{title}</div>
      {body && <div className="es-body">{body}</div>}
      {actions.length > 0 && (
        <div className="es-actions">
          {actions.map((a, i) => (
            <Button key={i} variant={a.variant || (i === actions.length - 1 ? 'primary' : 'subtle')} size="sm" icon={a.icon} onClick={a.onClick}>
              {a.label}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
};

// Skeleton shimmer for loading states
const Skeleton = ({ w = '100%', h = 12, radius = 6, style }) => (
  <span className="sk" style={{ width: w, height: h, borderRadius: radius, ...style }} aria-hidden="true" />
);

const SkeletonRow = ({ cols = 5 }) => (
  <div className="sk-row">
    {Array.from({ length: cols }).map((_, i) => (
      <Skeleton key={i} w={i === 0 ? '40%' : i === cols - 1 ? '15%' : '70%'} h={14} />
    ))}
  </div>
);

// Inline error banner
const ErrorBanner = ({ title, detail, onRetry, onDismiss }) => (
  <div className="err-banner" role="alert">
    <div className="err-ic"><I.bell size={14} /></div>
    <div className="err-body">
      <b>{title}</b>
      {detail && <div className="err-detail">{detail}</div>}
    </div>
    <div className="err-actions">
      {onRetry && <Button size="sm" variant="subtle" onClick={onRetry}>Retry</Button>}
      {onDismiss && <button className="err-x" aria-label="Dismiss" onClick={onDismiss}><I.x size={12} /></button>}
    </div>
  </div>
);

const TIER_C_CSS = `
  /* ======== Empty state ======== */
  .es {
    padding: 40px 32px; text-align: center;
    background: var(--surface); border: 0.5px dashed var(--line);
    border-radius: 14px; color: var(--ink-2);
    display: flex; flex-direction: column; align-items: center; gap: 6px;
    max-width: 520px; margin: 0 auto;
  }
  .es-ic {
    width: 44px; height: 44px; border-radius: 12px;
    background: var(--surface-2); color: var(--ink-3);
    display: inline-flex; align-items: center; justify-content: center;
    margin-bottom: 4px;
  }
  .es-title {
    font: 600 15px/1.35 var(--font-display); letter-spacing: -0.01em;
    color: var(--ink); text-wrap: pretty;
  }
  .es-body {
    font-size: 13px; line-height: 1.55; color: var(--ink-3);
    max-width: 400px; text-wrap: pretty;
  }
  .es-actions { display: flex; gap: 6px; margin-top: 10px; }

  /* ======== Skeleton ======== */
  @keyframes sk-shim { 0% { background-position: -200px 0; } 100% { background-position: calc(200px + 100%) 0; } }
  .sk {
    display: inline-block;
    background: var(--surface-2);
    background-image: linear-gradient(90deg,
      var(--surface-2) 0px,
      color-mix(in srgb, var(--ink-3) 10%, var(--surface-2)) 80px,
      var(--surface-2) 200px);
    background-size: 200px 100%;
    background-repeat: no-repeat;
    animation: sk-shim 1.4s ease-in-out infinite;
  }
  .sk-row {
    display: grid; grid-template-columns: 2fr 1.3fr 1fr 1fr 0.6fr;
    gap: 20px; padding: 12px 14px;
    border-bottom: 0.5px solid var(--line-soft);
  }

  /* ======== Error banner ======== */
  .err-banner {
    display: flex; align-items: center; gap: 12px;
    padding: 10px 14px; background: var(--neg-soft);
    border: 0.5px solid color-mix(in srgb, var(--neg) 26%, transparent);
    border-radius: 10px;
  }
  .err-ic {
    width: 24px; height: 24px; border-radius: 6px;
    background: color-mix(in srgb, var(--neg) 18%, transparent);
    color: var(--neg);
    display: inline-flex; align-items: center; justify-content: center;
    flex-shrink: 0;
  }
  .err-body { flex: 1; font-size: 12.5px; color: var(--ink); }
  .err-body b { font: 600 13px/1.3 var(--font-sans); display: block; color: var(--ink); }
  .err-detail { color: var(--ink-2); margin-top: 2px; }
  .err-actions { display: flex; gap: 6px; align-items: center; }
  .err-x {
    width: 22px; height: 22px; border: 0; background: transparent;
    color: var(--ink-3); border-radius: 5px; cursor: pointer;
    display: inline-flex; align-items: center; justify-content: center;
  }
  .err-x:hover { background: color-mix(in srgb, var(--neg) 14%, transparent); color: var(--neg); }
`;

Object.assign(window, {
  copy,
  EmptyState, Skeleton, SkeletonRow, ErrorBanner,
  TIER_C_CSS,
});
