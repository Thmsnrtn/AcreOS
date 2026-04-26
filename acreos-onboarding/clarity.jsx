// acreos-onboarding/clarity.jsx — explanation/clarity layer + tweaks defaults

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "showRoadmap": true,
  "showCallouts": true,
  "showPaxExplainer": true,
  "showStepTimes": true,
  "showLivePreviews": true,
  "explanationDensity": "helpful",
  "tone": "founder"
} /*EDITMODE-END*/;

window.OB_TWEAK_DEFAULTS = TWEAK_DEFAULTS;

// ───────────────────────── Roadmap (Welcome screen)
function OBRoadmap({ density }) {
  const steps = [
  { n: '01', name: 'Markets', desc: 'Counties Atlas should watch tonight', time: '~30s' },
  { n: '02', name: 'Buy-box', desc: 'Acreage, price, road, utilities Atlas filters by', time: '~60s' },
  { n: '03', name: 'Goals', desc: "Sets Pax's mail volume to your real pace", time: '~45s' },
  { n: '04', name: 'Phone', desc: "Provisions Pax's outbound number + verifies you", time: '~45s' },
  { n: '05', name: 'Billing', desc: "14-day trial. Card on file or skip for now", time: '~30s' },
  { n: '06', name: 'Done', desc: "Preview tomorrow morning's command center", time: '~10s' }];


  return (
    <div className="ob-roadmap">
      <div className="ob-roadmap-head">
        <span className="ob-roadmap-eyebrow">How this works</span>
        <span className="ob-roadmap-time">~4 min total</span>
      </div>
      <p className="ob-roadmap-title">
        Six short steps. Each one tells the agents how to behave on day one.
      </p>
      <ul className="ob-roadmap-list">
        {steps.map((s) =>
        <li key={s.n} className="ob-roadmap-row">
            <span className="ob-roadmap-num">{s.n}</span>
            <span className="ob-roadmap-step-name">
              {s.name}
              {density !== 'minimal' && <span>{s.desc}</span>}
            </span>
            <span className="ob-roadmap-step-time">{s.time}</span>
          </li>
        )}
      </ul>
    </div>);

}

// ───────────────────────── Generic callout
function OBCallout({ agent, title, children, icon }) {
  const cls = agent ? `ob-callout ob-callout-${agent}` : 'ob-callout';
  const agentLabel = agent === 'atlas' ? 'Atlas · finds parcels' :
  agent === 'pax' ? 'Pax · runs outreach' :
  agent === 'sophie' ? 'Sophie · books deals' :
  null;
  return (
    <div className={cls}>
      <span className="ob-callout-icon">
        {icon ||
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 8v4" />
            <circle cx="12" cy="16" r="0.5" fill="currentColor" />
          </svg>
        }
      </span>
      <div className="ob-callout-body">
        {agentLabel &&
        <div className="ob-callout-agent">
            <span className="ob-callout-agent-dot"></span>
            {agentLabel}
          </div>
        }
        {title && <div style={{ font: '600 13px/1.4 var(--font-sans)', color: 'var(--ink)', marginBottom: 3 }}>{title}</div>}
        {children}
      </div>
    </div>);

}

// ───────────────────────── Step time chip (rendered next to eyebrow)
function OBStepTime({ time }) {
  return <span className="ob-step-meta">{time}</span>;
}

// ───────────────────────── Pax explainer (phone screen)
function OBPaxExplainer() {
  return (
    <div className="ob-pax-explainer">
      <div className="ob-pax-explainer-head">
        <div className="ob-pax-explainer-mark">P</div>
        <div>
          <div className="ob-pax-explainer-title">What does Pax actually do with phone numbers?</div>
          <div className="ob-pax-explainer-sub">
</div>
        </div>
      </div>
      <div className="ob-pax-explainer-body">
        <div className="ob-pax-explainer-row">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 5h4l2 5-2.5 1.5a11 11 0 0 0 5 5L13 14l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 7a2 2 0 0 1 2-2" />
          </svg>
          <div>
            <b>Outbound: only when sellers reply first.</b>
            <span>Pax never cold-calls. After your mailers go out, Pax dials sellers who text or call back — using the local number you pick below so caller-ID looks familiar.</span>
          </div>
        </div>
        <div className="ob-pax-explainer-row">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="9" />
            <polyline points="12 7 12 12 15 14" />
          </svg>
          <div>
            <b>Calling hours: 9am–7pm seller-local.</b>
            <span>Default windows in each county's timezone. Outside that, Pax replies by SMS only and queues the call for the next opening.</span>
          </div>
        </div>
        <div className="ob-pax-explainer-row">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
          <div>
            <b>Voicemails get transcribed.</b>
            <span>Pax drafts a reply you can approve in one tap. Recordings, transcripts, and SMS threads all live in your Pax inbox.</span>
          </div>
        </div>
        <div className="ob-pax-explainer-row">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
          <div>
            <b>Your mobile is for you, not sellers.</b>
            <span>The number in the field below is for 2FA + emergency alerts. Sellers only ever see the local outbound number.</span>
          </div>
        </div>
      </div>
    </div>);
}

// ───────────────────────── Live preview strip (computed effect)
function OBPreviewStrip({ children, label = 'Day one' }) {
  return (
    <div className="ob-preview-strip">
      <span className="ob-preview-strip-tag">{label}</span>
      <span>{children}</span>
    </div>);

}

window.OBClarity = {
  OBRoadmap,
  OBCallout,
  OBStepTime,
  OBPaxExplainer,
  OBPreviewStrip
};