// acreos-onboarding/screens-2.jsx
// Buy-box · Experience & goals

const { useState: useState2 } = React;

// ─────────────────────────────────── 2 · BUY-BOX
function ScreenBuyBox({ data, set, tweaks = {} }) {
  const { OBCallout, OBStepTime, OBPreviewStrip } = window.OBClarity || {};
  const dealTypes = [
    { id: 'flip', t: 'Wholesale / flip', d: 'Buy under market, resell to retail buyers' },
    { id: 'finance', t: 'Seller-finance', d: 'Hold notes, collect monthly payments' },
    { id: 'subdivide', t: 'Subdivide', d: 'Buy larger, split into smaller parcels' },
    { id: 'hold', t: 'Long-term hold', d: 'Buy and hold for appreciation' },
  ];

  const access = [
    { id: 'paved', label: 'Paved road' },
    { id: 'gravel', label: 'Gravel / dirt' },
    { id: 'no-access', label: 'Landlocked OK' },
  ];

  const utils = [
    { id: 'power', label: 'Power available' },
    { id: 'water', label: 'Water (well/city)' },
    { id: 'septic', label: 'Septic OK' },
    { id: 'no-utils', label: 'Raw land OK' },
  ];

  const dealType = data.dealType || [];
  const accessVals = data.access || ['paved', 'gravel'];
  const utilsVals = data.utils || ['no-utils'];

  const togglePill = (key, currVal, id) => {
    set(key, currVal.includes(id) ? currVal.filter(x => x !== id) : [...currVal, id]);
  };

  return (
    <div className="ob-screen ob-screen-wide">
      <div className="ob-eyebrow">
        <span className="ob-eyebrow-dot"></span>
        Step 2 of 8
        {tweaks.showStepTimes && OBStepTime && <OBStepTime time="~60 seconds" />}
      </div>
      <h1 className="ob-title">What kind of parcels?</h1>
      <p className="ob-sub">
        Sketch your buy-box. Atlas will use this to pull and rank parcels every night. You can refine or add more shapes after we're up and running.
      </p>

      {tweaks.showCallouts && OBCallout && (
        <OBCallout agent="atlas" title="How your buy-box becomes a daily list">
          Atlas turns these answers into a filter that runs against every parcel record overnight. <b>Deal type</b> changes how Atlas prices each parcel (a flip target ≠ a hold target). <b>Acreage + price</b> drop anything outside the band. <b>Access + utilities</b> are <i>preferences, not rules</i> — Atlas surfaces matches but doesn't hide near-misses.
        </OBCallout>
      )}

      <div className="ob-bb-grid">
        <div className="ob-bb-field ob-bb-field-full">
          <div className="ob-bb-label">Deal type — pick one or more</div>
          <div className="ob-bb-hint">Atlas adjusts pricing logic for each strategy</div>
          <div className="ob-cards">
            {dealTypes.map(dt => (
              <button
                key={dt.id}
                className={`ob-card ${dealType.includes(dt.id) ? 'is-on' : ''}`}
                onClick={() => set('dealType', dealType.includes(dt.id) ? dealType.filter(x => x !== dt.id) : [...dealType, dt.id])}
              >
                <span className="ob-card-glyph">
                  <DealGlyph kind={dt.id} />
                </span>
                <span className="ob-card-title">{dt.t}</span>
                <span className="ob-card-desc">{dt.d}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="ob-bb-field">
          <div className="ob-bb-label">Acreage range</div>
          <div className="ob-bb-hint">Min and max acres per parcel</div>
          <div className="ob-bb-range">
            <input
              className="ob-bb-range-input"
              type="number"
              value={data.acresMin ?? 1}
              onChange={e => set('acresMin', parseFloat(e.target.value) || 0)}
              placeholder="Min"
            />
            <span className="ob-bb-range-sep">to</span>
            <input
              className="ob-bb-range-input"
              type="number"
              value={data.acresMax ?? 40}
              onChange={e => set('acresMax', parseFloat(e.target.value) || 0)}
              placeholder="Max"
            />
          </div>
          <div className="ob-bb-hint" style={{ marginTop: 8 }}>
            Currently: {data.acresMin ?? 1} – {data.acresMax ?? 40} acres
          </div>
        </div>

        <div className="ob-bb-field">
          <div className="ob-bb-label">Price range (purchase)</div>
          <div className="ob-bb-hint">What you'd pay per parcel</div>
          <div className="ob-bb-range">
            <input
              className="ob-bb-range-input"
              type="text"
              value={data.priceMin ?? '$3,000'}
              onChange={e => set('priceMin', e.target.value)}
              placeholder="Min"
            />
            <span className="ob-bb-range-sep">to</span>
            <input
              className="ob-bb-range-input"
              type="text"
              value={data.priceMax ?? '$45,000'}
              onChange={e => set('priceMax', e.target.value)}
              placeholder="Max"
            />
          </div>
        </div>

        <div className="ob-bb-field">
          <div className="ob-bb-label">Access</div>
          <div className="ob-bb-hint">Filter parcels by road access</div>
          <div className="ob-pills">
            {access.map(a => (
              <button
                key={a.id}
                className={`ob-pill ${accessVals.includes(a.id) ? 'is-on' : ''}`}
                onClick={() => togglePill('access', accessVals, a.id)}
              >
                {a.label}
              </button>
            ))}
          </div>
        </div>

        <div className="ob-bb-field">
          <div className="ob-bb-label">Utilities</div>
          <div className="ob-bb-hint">Anything you'd accept counts</div>
          <div className="ob-pills">
            {utils.map(u => (
              <button
                key={u.id}
                className={`ob-pill ${utilsVals.includes(u.id) ? 'is-on' : ''}`}
                onClick={() => togglePill('utils', utilsVals, u.id)}
              >
                {u.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {tweaks.showLivePreviews && OBPreviewStrip && (data.dealType || []).length > 0 && (
        <div style={{ marginTop: 20 }}>
          <OBPreviewStrip label="Example match">
            "<b>{(data.acresMin ?? 1)}–{(data.acresMax ?? 40)} acre {(data.dealType || [])[0] === 'flip' ? 'wholesale flip' : (data.dealType || [])[0]} target</b>, {data.priceMin || '$3,000'}–{data.priceMax || '$45,000'}, {(data.access || []).includes('paved') ? 'paved or gravel access' : 'any access'} — Atlas would rank this <b>A-tier</b>."
          </OBPreviewStrip>
        </div>
      )}
    </div>
  );
}

function DealGlyph({ kind }) {
  const props = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' };
  if (kind === 'flip') return <svg {...props}><path d="M3 9l4-4 4 4M7 5v14M21 15l-4 4-4-4M17 19V5"/></svg>;
  if (kind === 'finance') return <svg {...props}><circle cx="12" cy="12" r="9"/><path d="M12 7v10M9 9c0-1.1.9-2 2-2h2a2 2 0 010 4h-2a2 2 0 000 4h3"/></svg>;
  if (kind === 'subdivide') return <svg {...props}><rect x="3" y="3" width="18" height="18" rx="1"/><path d="M3 12h18M12 3v18"/></svg>;
  if (kind === 'hold') return <svg {...props}><path d="M3 21l3-9 5-3 4 4 6-7M3 21h18"/></svg>;
  return null;
}

// ─────────────────────────────────── 3 · GOALS
function ScreenGoals({ data, set, tweaks = {} }) {
  const { OBCallout, OBStepTime, OBPreviewStrip } = window.OBClarity || {};
  const experience = [
    { id: 'new', t: 'Just getting started', d: '0–5 deals closed', emoji: '🌱' },
    { id: 'growing', t: 'Growing', d: '6–30 deals · serious about scale', emoji: '🌿' },
    { id: 'established', t: 'Established', d: '30+ deals · running an operation', emoji: '🌳' },
  ];

  const exp = data.experience || '';
  const target = data.dealsTarget ?? 4;

  return (
    <div className="ob-screen">
      <div className="ob-eyebrow">
        <span className="ob-eyebrow-dot"></span>
        Step 3 of 8
        {tweaks.showStepTimes && OBStepTime && <OBStepTime time="~45 seconds" />}
      </div>
      <h1 className="ob-title">Where are you in your journey?</h1>
      <p className="ob-sub">
        This shapes the kind of suggestions Atlas and Pax give you. We'll calibrate to your scale, not push you past it.
      </p>

      {tweaks.showCallouts && OBCallout && (
        <OBCallout agent="pax" title="Why we ask for a deal target">
          Your monthly target sets <b>Pax's mail volume</b> — roughly 12 mailers per deal you want to close. Set it honestly. We'd rather start small and ramp up than burn through your postage budget guessing. <b>You'll always approve a batch before it ships.</b>
        </OBCallout>
      )}

      <div className="ob-field">
        <div className="ob-label">Where you are today</div>
        <div className="ob-cards">
          {experience.map(e => (
            <button
              key={e.id}
              className={`ob-card ${exp === e.id ? 'is-on' : ''}`}
              onClick={() => set('experience', e.id)}
            >
              <div style={{ fontSize: 20, marginBottom: 4 }}>{e.emoji}</div>
              <span className="ob-card-title">{e.t}</span>
              <span className="ob-card-desc">{e.d}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="ob-field">
        <div className="ob-label">Deals you'd like to close per month</div>
        <p className="ob-hint" style={{ marginTop: 0, marginBottom: 12 }}>
          Honest target — not a stretch goal. We use this to size your mail volume.
        </p>
        <div className="ob-money">
          <div className="ob-stat">
            <div className="ob-stat-num">{target}</div>
            <div className="ob-stat-label">Deals / month</div>
          </div>
          <div className="ob-stat">
            <div className="ob-stat-num">{(target * 12).toLocaleString()}</div>
            <div className="ob-stat-label">Mailers / mo (est.)</div>
          </div>
        </div>
        <input
          type="range"
          min="1" max="20" step="1"
          value={target}
          onChange={e => set('dealsTarget', parseInt(e.target.value))}
          className="ob-slider"
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', font: '500 11px/1 var(--font-mono)', color: 'var(--ink-3)' }}>
          <span>1</span>
          <span>5</span>
          <span>10</span>
          <span>15</span>
          <span>20</span>
        </div>
      </div>

      <div className="ob-field">
        <div className="ob-label">North-star deal</div>
        <p className="ob-hint" style={{ marginTop: 0, marginBottom: 12 }}>
          One sentence — what does the ideal deal look like? Atlas reads this to break ties.
        </p>
        <textarea
          className="ob-textarea"
          rows="3"
          placeholder="e.g. 5–20 acre parcel within 30 min of paved road, owned 8+ years, out-of-state owner."
          value={data.northStar || ''}
          onChange={e => set('northStar', e.target.value)}
        />
      </div>

      {tweaks.showLivePreviews && OBPreviewStrip && (
        <OBPreviewStrip label="Pax mail plan">
          ~<b>{(data.dealsTarget ?? 4) * 12} mailers/month</b> in {(data.dealsTarget ?? 4) * 3}-batch waves. Pax pauses between waves to learn from replies before sending more.
        </OBPreviewStrip>
      )}
    </div>
  );
}

window.OBScreens2 = { ScreenBuyBox, ScreenGoals };
