// acreos-onboarding/screens-1.jsx
// Welcome · Markets

const { useState, useEffect, useRef, useMemo } = React;

const TONE_WELCOME = {
  founder: {
    eyebrow: 'Welcome to AcreOS',
    h1a: "Glad you're here.",
    h1b: "Let's get you set up.",
    p1: "Setup takes about 4 minutes. We'll ask where you're investing, what kind of parcels you're after, and how you'd like the agents to behave.",
    p2: "Nothing is locked in. You can change any of this later, and your buy-box can hold as many shapes as you want — no plan to define a single perfect one upfront.",
    p3: "When we're done, your first list will be pulling overnight. Tomorrow morning you'll have something real to look at.",
  },
  plain: {
    eyebrow: 'Setup',
    h1a: 'Six steps.',
    h1b: 'About four minutes.',
    p1: "We'll ask: which counties to watch, what kind of parcels you want, your monthly deal target, your phone number, and your billing.",
    p2: "Every answer is editable later. Skip what you don't know — defaults are sensible.",
    p3: "When you finish, AcreOS pulls your first parcel list overnight. You'll review it tomorrow morning.",
  },
  coach: {
    eyebrow: 'You made it',
    h1a: "Welcome aboard.",
    h1b: "We'll do this together.",
    p1: "Take it slow — about four minutes. We'll walk through six short questions about where and how you invest. No quiz, no wrong answers.",
    p2: "Anything you set now, you can change later. Even your buy-box can shape-shift as you learn what's working.",
    p3: "By the time you log in tomorrow, you'll have a real list of parcels and a few drafted mailers waiting for your read.",
  },
};

// ─────────────────────────────────── 0 · WELCOME
function ScreenWelcome({ data, set, next, tweaks = {} }) {
  const tone = TONE_WELCOME[tweaks.tone] || TONE_WELCOME.founder;
  const { OBRoadmap } = window.OBClarity || {};
  const density = tweaks.explanationDensity || 'helpful';

  return (
    <div className="ob-screen ob-welcome">
      <div className="ob-eyebrow">
        <span className="ob-eyebrow-dot"></span>
        {tone.eyebrow}
      </div>
      <h1 className="ob-welcome-title">
        <span className="ob-welcome-line">{tone.h1a}</span>
        <span className="ob-welcome-line ob-welcome-line-2">{tone.h1b}</span>
      </h1>
      <p className="ob-letter">{tone.p1}</p>
      {density !== 'minimal' && <p className="ob-letter">{tone.p2}</p>}
      <p className="ob-letter">{tone.p3}</p>

      {tweaks.showRoadmap && OBRoadmap && <OBRoadmap density={density} />}

      <div className="ob-letter-meta">
        <div>
          <div className="ob-letter-sig-name"></div>
          <div className="ob-letter-sig-sub"></div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────── 1 · MARKETS
const ALL_COUNTIES = [
  { id: 'apache-az', name: 'Apache County', state: 'AZ', parcels: '142K', x: 850, y: 360 },
  { id: 'coconino-az', name: 'Coconino County', state: 'AZ', parcels: '98K', x: 780, y: 340 },
  { id: 'mohave-az', name: 'Mohave County', state: 'AZ', parcels: '87K', x: 720, y: 360 },
  { id: 'navajo-az', name: 'Navajo County', state: 'AZ', parcels: '76K', x: 820, y: 360 },
  { id: 'yavapai-az', name: 'Yavapai County', state: 'AZ', parcels: '64K', x: 760, y: 380 },
  { id: 'catron-nm', name: 'Catron County', state: 'NM', parcels: '54K', x: 880, y: 400 },
  { id: 'sierra-nm', name: 'Sierra County', state: 'NM', parcels: '38K', x: 900, y: 420 },
  { id: 'otero-nm', name: 'Otero County', state: 'NM', parcels: '46K', x: 905, y: 410 },
  { id: 'luna-nm', name: 'Luna County', state: 'NM', parcels: '32K', x: 895, y: 430 },
  { id: 'culberson-tx', name: 'Culberson County', state: 'TX', parcels: '24K', x: 940, y: 430 },
  { id: 'hudspeth-tx', name: 'Hudspeth County', state: 'TX', parcels: '28K', x: 945, y: 420 },
  { id: 'jeff-davis-tx', name: 'Jeff Davis County', state: 'TX', parcels: '18K', x: 960, y: 440 },
  { id: 'presidio-tx', name: 'Presidio County', state: 'TX', parcels: '22K', x: 970, y: 460 },
  { id: 'park-co', name: 'Park County', state: 'CO', parcels: '52K', x: 830, y: 280 },
  { id: 'fremont-co', name: 'Fremont County', state: 'CO', parcels: '47K', x: 840, y: 290 },
  { id: 'costilla-co', name: 'Costilla County', state: 'CO', parcels: '34K', x: 850, y: 320 },
  { id: 'huerfano-co', name: 'Huerfano County', state: 'CO', parcels: '28K', x: 860, y: 310 },
  { id: 'iron-ut', name: 'Iron County', state: 'UT', parcels: '42K', x: 740, y: 290 },
  { id: 'kane-ut', name: 'Kane County', state: 'UT', parcels: '38K', x: 750, y: 300 },
  { id: 'wayne-ut', name: 'Wayne County', state: 'UT', parcels: '32K', x: 760, y: 280 },
  { id: 'lyon-nv', name: 'Lyon County', state: 'NV', parcels: '46K', x: 660, y: 250 },
  { id: 'nye-nv', name: 'Nye County', state: 'NV', parcels: '78K', x: 680, y: 280 },
];

function ScreenMarkets({ data, set, tweaks = {} }) {
  const [search, setSearch] = useState('');
  const selected = data.counties || [];
  const { OBCallout, OBStepTime, OBPreviewStrip } = window.OBClarity || {};

  const filtered = useMemo(() => {
    if (!search) return ALL_COUNTIES;
    const q = search.toLowerCase();
    return ALL_COUNTIES.filter((c) =>
      c.name.toLowerCase().includes(q) || c.state.toLowerCase().includes(q)
    );
  }, [search]);

  const toggle = (id) => {
    set('counties', selected.includes(id) ? selected.filter((c) => c !== id) : [...selected, id]);
  };

  const totalParcels = selected.reduce((sum, id) => {
    const c = ALL_COUNTIES.find((x) => x.id === id);
    return sum + (c ? parseInt(c.parcels) : 0);
  }, 0);

  return (
    <div className="ob-screen ob-screen-wide">
      <div className="ob-eyebrow">
        <span className="ob-eyebrow-dot"></span>
        Step 1 of 8
        {tweaks.showStepTimes && OBStepTime && <OBStepTime time="~30 seconds" />}
      </div>
      <h1 className="ob-title">Where are you investing?</h1>
      <p className="ob-sub">
        Pick the counties you want AcreOS to watch. You can pick a few or many — we'll start tracking parcels in all of them tonight.
      </p>

      {tweaks.showCallouts && OBCallout && (
        <OBCallout agent="atlas" title="What Atlas will do with this">
          Tonight, <b>Atlas</b> downloads the parcel records for every county you check below — owner, acres, last sale, tax status, road access. It re-syncs daily at 2am and flags anything new that fits your buy-box. <b>You can edit this list anytime in Settings → Markets.</b>
        </OBCallout>
      )}

      <div className="ob-map-grid">
        <div className="ob-map">
          <USMapSVG selected={selected} onToggle={toggle} />
        </div>
        <div>
          <div className="ob-counties-search">
            <svg className="ob-counties-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.3-4.3" />
            </svg>
            <input
              type="text"
              placeholder="Search counties or states…"
              className="ob-input"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="ob-counties-list">
            {filtered.map((c) =>
              <button
                key={c.id}
                className={`ob-county-row ${selected.includes(c.id) ? 'is-on' : ''}`}
                onClick={() => toggle(c.id)}
              >
                <span className="ob-county-check">
                  {selected.includes(c.id) &&
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  }
                </span>
                <span className="ob-county-name">{c.name}, {c.state}</span>
                <span className="ob-county-meta">{c.parcels}</span>
              </button>
            )}
            {filtered.length === 0 &&
              <div style={{ padding: '24px 12px', color: 'var(--ink-3)', fontSize: 14, textAlign: 'center' }}>
                No counties match "{search}".
              </div>
            }
          </div>
          {selected.length > 0 &&
            <div className="ob-counties-summary">
              <b>{selected.length}</b> {selected.length === 1 ? 'county' : 'counties'} selected · <b>~{(totalParcels / 1000).toFixed(0)}K parcels</b> watched
            </div>
          }
          {tweaks.showLivePreviews && OBPreviewStrip && selected.length > 0 && (
            <OBPreviewStrip label="Tonight">
              Atlas pulls <b>~{(totalParcels / 1000).toFixed(0)}K parcels</b> across <b>{selected.length} {selected.length === 1 ? 'county' : 'counties'}</b>. By 6am, ~{Math.round(totalParcels * 0.0008)} will match your buy-box.
            </OBPreviewStrip>
          )}
        </div>
      </div>
    </div>
  );
}

function USMapSVG({ selected, onToggle }) {
  return (
    <svg viewBox="500 200 500 320" preserveAspectRatio="xMidYMid meet">
      <defs>
        <pattern id="map-grid" width="20" height="20" patternUnits="userSpaceOnUse">
          <path d="M 20 0 L 0 0 0 20" fill="none" stroke="rgba(80,40,15,0.06)" strokeWidth="0.5" />
        </pattern>
      </defs>
      <rect x="500" y="200" width="500" height="320" fill="url(#map-grid)" />
      <g fill="#FAF4E8" stroke="rgba(80,40,15,0.18)" strokeWidth="0.8">
        <path d="M 580 230 L 640 220 L 660 280 L 680 360 L 660 460 L 600 470 L 570 400 Z" />
        <path d="M 640 220 L 720 230 L 720 320 L 700 380 L 680 360 L 660 280 Z" />
        <path d="M 580 200 L 720 200 L 720 230 L 580 230 Z" />
        <path d="M 720 230 L 800 230 L 800 320 L 720 320 Z" />
        <path d="M 700 320 L 720 320 L 800 320 L 800 410 L 700 420 L 680 380 Z" />
        <path d="M 800 320 L 880 320 L 880 460 L 800 460 L 800 410 Z" />
        <path d="M 800 230 L 880 230 L 880 320 L 800 320 Z" />
        <path d="M 880 410 L 1000 420 L 1010 480 L 940 470 L 880 460 Z" />
        <path d="M 800 200 L 900 200 L 900 230 L 800 230 Z" />
        <path d="M 720 200 L 800 200 L 900 200 L 900 220 L 720 220 Z" />
      </g>
      <g fill="rgba(80,40,15,0.4)" fontFamily="Inter, sans-serif" fontSize="9" fontWeight="500" letterSpacing="0.04em" textAnchor="middle">
        <text x="620" y="350">CA</text>
        <text x="680" y="290">NV</text>
        <text x="760" y="280">UT</text>
        <text x="750" y="380">AZ</text>
        <text x="840" y="400">NM</text>
        <text x="840" y="280">CO</text>
        <text x="940" y="445">TX</text>
      </g>
      {ALL_COUNTIES.map((c) => {
        const isOn = selected.includes(c.id);
        return (
          <g key={c.id} onClick={() => onToggle(c.id)} style={{ cursor: 'default' }}>
            <circle
              cx={c.x} cy={c.y} r={isOn ? 6 : 3}
              fill={isOn ? '#C2531C' : 'rgba(80,40,15,0.3)'}
              stroke={isOn ? '#FFFBF1' : 'transparent'}
              strokeWidth="1.5"
              style={{ transition: 'all 0.2s' }}
            />
            {isOn &&
              <circle cx={c.x} cy={c.y} r="11" fill="none" stroke="#C2531C" strokeWidth="0.8" opacity="0.5">
                <animate attributeName="r" from="6" to="14" dur="1.6s" repeatCount="indefinite" />
                <animate attributeName="opacity" from="0.5" to="0" dur="1.6s" repeatCount="indefinite" />
              </circle>
            }
          </g>
        );
      })}
    </svg>
  );
}

window.OBScreens1 = { ScreenWelcome, ScreenMarkets };
