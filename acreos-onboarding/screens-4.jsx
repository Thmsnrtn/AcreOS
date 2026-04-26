// acreos-onboarding/screens-4.jsx
// Autonomy · Connections — pulled from the legacy modal flow into the main wizard.

const { useState: useState4 } = React;

// ─────────────────────────────────── AUTONOMY
function ScreenAutonomy({ data, set, tweaks = {} }) {
  const { OBCallout, OBStepTime, OBPreviewStrip } = window.OBClarity || {};
  const levels = [
    { n: 0, id: 'observe',    label: 'Observe',    desc: 'Suggest only. Atlas, Pax, and Sophie report — nothing acts without you.', who: 'Best for: people who want to read every recommendation first.' },
    { n: 1, id: 'draft',      label: 'Draft',      desc: 'Agents draft mailers, replies, and offers. You approve each batch before send.', who: 'Best for: most operators starting out.' },
    { n: 2, id: 'execute',    label: 'Execute',    desc: 'Agents act on routine work. They pause and ask for any decision over $5,000 or non-template offers.', rec: true, who: 'Recommended: balances speed and oversight.' },
    { n: 3, id: 'autonomous', label: 'Autonomous', desc: 'Full delegation. Agents run end-to-end. You read a daily briefing and step in only if you choose.', who: 'Best for: established operators with proven buy-boxes.' },
  ];
  const cur = data.autonomy ?? 'execute';

  return (
    <div className="ob-screen ob-screen-wide">
      <div className="ob-eyebrow">
        <span className="ob-eyebrow-dot"></span>
        Step 4 of 8
        {tweaks.showStepTimes && OBStepTime && <OBStepTime time="~30 seconds" />}
      </div>
      <h1 className="ob-title">How autonomously should AcreOS run?</h1>
      <p className="ob-sub">
        You can change this any time from Settings — and adjust per-agent if you want. Most people start at Execute and dial up.
      </p>

      {tweaks.showCallouts && OBCallout && (
        <OBCallout title="What 'autonomous' means in practice">
          When an agent <i>acts</i>, it can: send a mailer, reply to a seller text, send a docusign offer, log a deal, or schedule a call. <b>It never pulls money or signs binding contracts without you.</b> Higher levels expand the routine work agents handle without asking — but the dollar guardrail you set is honored at every level.
        </OBCallout>
      )}

      <div className="ob-cards" style={{ gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
        {levels.map(l => (
          <button
            key={l.id}
            className={`ob-card ${cur === l.id ? 'is-on' : ''}`}
            onClick={() => set('autonomy', l.id)}
            style={{ position: 'relative', textAlign: 'left', padding: 18 }}
          >
            {l.rec && (
              <span style={{
                position: 'absolute', top: 12, right: 12,
                font: '600 9.5px/1 var(--font-sans)', letterSpacing: '0.08em', textTransform: 'uppercase',
                color: 'var(--brand)', background: 'var(--brand-soft)',
                padding: '4px 8px', borderRadius: 99,
              }}>Recommended</span>
            )}
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
              <span style={{ font: '500 11px/1 var(--font-mono)', color: 'var(--ink-4)' }}>L{l.n}</span>
              <span className="ob-card-title" style={{ font: '600 16px/1.2 var(--font-display)' }}>{l.label}</span>
            </div>
            <span className="ob-card-desc" style={{ marginBottom: 6 }}>{l.desc}</span>
            <span style={{ font: '400 11.5px/1.4 var(--font-sans)', color: 'var(--ink-4)', fontStyle: 'italic' }}>{l.who}</span>
          </button>
        ))}
      </div>

      <div className="ob-field" style={{ marginTop: 28 }}>
        <div className="ob-label">Spending guardrail</div>
        <p className="ob-hint" style={{ marginTop: 0, marginBottom: 12 }}>
          Agents always pause and ask before any single decision above this amount.
        </p>
        <div className="ob-pills">
          {[1000, 2500, 5000, 10000, 25000].map(amt => (
            <button
              key={amt}
              className={`ob-pill ${(data.guardrail ?? 5000) === amt ? 'is-on' : ''}`}
              onClick={() => set('guardrail', amt)}
            >
              ${amt.toLocaleString()}
            </button>
          ))}
        </div>
      </div>

      {tweaks.showLivePreviews && OBPreviewStrip && (
        <OBPreviewStrip label="What this means">
          {cur === 'observe' && <>You'll see all <b>Atlas</b> finds and <b>Pax</b> drafts in your inbox. Nothing leaves AcreOS without your tap.</>}
          {cur === 'draft' && <>Pax drafts every mailer and reply. You'll get a "ready for approval" notification before each batch sends.</>}
          {cur === 'execute' && <>Pax sends mailers and replies on its own. Anything over <b>${(data.guardrail ?? 5000).toLocaleString()}</b> — like a discount offer — pauses for you.</>}
          {cur === 'autonomous' && <>Agents run end-to-end. You get a <b>6am daily briefing</b> with everything that happened overnight.</>}
        </OBPreviewStrip>
      )}
    </div>
  );
}

// ─────────────────────────────────── CONNECTIONS
function ScreenConnections({ data, set, tweaks = {} }) {
  const { OBCallout, OBStepTime } = window.OBClarity || {};
  const conns = data.connections || { regrid: true, batch: true, lob: false, stripe: false, twilio: false };
  const setConn = (id, val) => set('connections', { ...conns, [id]: val });

  const items = [
    { id: 'regrid', name: 'Regrid', desc: 'Parcel boundaries + ownership records', tag: 'Required', why: "Atlas can't pull parcels without it. We've connected our shared instance — yours starts free up to 10K parcels." },
    { id: 'batch', name: 'BatchData', desc: 'Skip-trace owner phone + email', tag: 'Required', why: 'Lets Pax actually reach the owners Atlas finds. Pre-connected on a shared key for trial.' },
    { id: 'lob', name: 'Lob', desc: 'Direct mail printing + delivery', tag: 'Required', why: "Pax uses Lob to print and ship physical mailers. You'll need to add your own account before mail goes out." },
    { id: 'stripe', name: 'Stripe', desc: 'Take buyer payments + recurring notes', tag: 'Optional', why: 'Connect when you start collecting earnest money or seller-finance payments. Sophie wires it into the ledger automatically.' },
    { id: 'twilio', name: 'Twilio', desc: 'Bring your own SMS / voice numbers', tag: 'Optional', why: "We provision a number for you on the next step. Connect Twilio only if you want to port an existing number." },
  ];

  return (
    <div className="ob-screen ob-screen-wide">
      <div className="ob-eyebrow">
        <span className="ob-eyebrow-dot"></span>
        Step 5 of 8
        {tweaks.showStepTimes && OBStepTime && <OBStepTime time="~45 seconds" />}
      </div>
      <h1 className="ob-title">Connect the tools that do the work.</h1>
      <p className="ob-sub">
        AcreOS orchestrates a few specialized services so the agents can act in the real world. Two are pre-connected for your trial. You can finish the rest later from Settings.
      </p>

      {tweaks.showCallouts && OBCallout && (
        <OBCallout title="Why these specific tools">
          <b>Regrid</b> is the parcel-data backbone — without it, no map. <b>BatchData</b> turns owner records into reachable phone/email. <b>Lob</b> physically prints and ships your mailers. <b>Stripe</b> moves money. <b>Twilio</b> is only if you want to bring your own numbers. Skip anything not blocking your first batch.
        </OBCallout>
      )}

      <div className="ob-conn-list">
        {items.map(c => {
          const on = !!conns[c.id];
          const required = c.tag === 'Required';
          return (
            <div key={c.id} className={`ob-conn-card ${on ? 'is-on' : ''}`}>
              <div className="ob-conn-card-l">
                <div className="ob-conn-card-head">
                  <span className="ob-conn-card-name">{c.name}</span>
                  <span className={`ob-conn-card-tag ${required ? 'is-req' : 'is-opt'}`}>{c.tag}</span>
                </div>
                <div className="ob-conn-card-desc">{c.desc}</div>
                <div className="ob-conn-card-why">{c.why}</div>
              </div>
              <div className="ob-conn-card-r">
                {on ? (
                  <button className="ob-conn-status is-connected" onClick={() => setConn(c.id, false)}>
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                    Connected
                  </button>
                ) : (
                  <button className="ob-conn-status" onClick={() => setConn(c.id, true)}>
                    Connect
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

window.OBScreens4 = { ScreenAutonomy, ScreenConnections };
