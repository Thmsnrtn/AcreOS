// acreos-landing/sections-1.jsx
// Hero · How it works · The agents

const { useState, useEffect, useRef } = React;

// ─────────────────────────────────────────────────────────── HERO
function Hero({ tone, copy }) {
  const c = copy.hero;
  return (
    <section className="lp-hero">
      <div className="lp-hero-bg" aria-hidden="true">
        <svg width="100%" height="100%" preserveAspectRatio="xMidYMid slice" viewBox="0 0 1200 700">
          <defs>
            <pattern id="parcel-grid" width="60" height="60" patternUnits="userSpaceOnUse">
              <path d="M 60 0 L 0 0 0 60" fill="none" stroke="rgba(80,40,15,0.06)" strokeWidth="0.5"/>
            </pattern>
            <radialGradient id="hero-glow" cx="50%" cy="20%" r="60%">
              <stop offset="0%" stopColor="rgba(194,83,28,0.08)"/>
              <stop offset="100%" stopColor="rgba(194,83,28,0)"/>
            </radialGradient>
          </defs>
          <rect width="1200" height="700" fill="url(#parcel-grid)"/>
          <rect width="1200" height="700" fill="url(#hero-glow)"/>
          {/* parcel polygons */}
          <g opacity="0.18" fill="none" stroke="#C2531C" strokeWidth="1">
            <path d="M 120 420 L 280 410 L 290 540 L 130 550 Z"/>
            <path d="M 280 410 L 460 405 L 475 545 L 290 540 Z"/>
            <path d="M 900 380 L 1080 390 L 1070 510 L 890 500 Z"/>
            <path d="M 720 200 L 880 195 L 890 320 L 730 325 Z"/>
          </g>
        </svg>
      </div>

      <div className="lp-hero-inner">
        <div className="lp-hero-eyebrow">
          <span className="lp-hero-pulse" aria-hidden="true"></span>
          {c.eyebrow}
        </div>
        <h1 className="lp-hero-title">
          {c.title.map((line, i) => (
            <span key={i} className="lp-hero-line" style={{ animationDelay: `${0.1 + i * 0.08}s` }}>
              {line}
            </span>
          ))}
        </h1>
        <p className="lp-hero-sub">{c.sub}</p>
        <div className="lp-hero-cta">
          <a href="#cta" className="btn btn-primary btn-lg btn-arrow">{c.cta1}</a>
          <a href="#how" className="btn btn-secondary btn-lg">{c.cta2}</a>
        </div>
        <div className="lp-hero-ctasub">{c.ctaSub}</div>
        <div className="lp-hero-proof">
          <span className="lp-hero-dot" aria-hidden="true"></span>
          {c.proof}
        </div>
      </div>

      <HeroVisual tone={tone} />
    </section>
  );
}

function HeroVisual({ tone }) {
  return (
    <div className="lp-hero-visual">
      <div className="lp-hero-card lp-hv-atlas">
        <div className="lp-hv-head">
          <div className="lp-hv-avatar lp-hv-atlas-av">A</div>
          <div className="lp-hv-meta">
            <div className="lp-hv-name">Atlas</div>
            <div className="lp-hv-role">Comping APN 304-12-456</div>
          </div>
          <span className="lp-hv-badge lp-hv-badge-running">
            <span className="lp-hv-spin"></span>Running
          </span>
        </div>
        <div className="lp-hv-row"><span>Comparable sales found</span><b>14</b></div>
        <div className="lp-hv-row"><span>Median $/acre</span><b>$2,840</b></div>
        <div className="lp-hv-row"><span>Confidence</span><b className="lp-hv-conf-high">High · 87%</b></div>
        <div className="lp-hv-bar"><div className="lp-hv-bar-fill" style={{ width: '87%' }}></div></div>
      </div>

      <div className="lp-hero-card lp-hv-pax">
        <div className="lp-hv-head">
          <div className="lp-hv-avatar lp-hv-pax-av">P</div>
          <div className="lp-hv-meta">
            <div className="lp-hv-name">Pax · Drafted reply</div>
            <div className="lp-hv-role">To: Janet Ruiz · Coconino County</div>
          </div>
        </div>
        <div className="lp-hv-msg">
          <span className="lp-hv-msg-from">Janet:</span> "What's your best offer? I have another buyer."
        </div>
        <div className="lp-hv-msg lp-hv-msg-out">
          <span className="lp-hv-msg-from">Pax draft:</span> "Hi Janet — I can do $14,200 cash, 14-day close. That's 12% above the median for parcels your size in Coconino. Happy to email a written offer."
        </div>
        <div className="lp-hv-actions">
          <span className="lp-hv-action">Send as-is</span>
          <span className="lp-hv-action lp-hv-action-soft">Edit</span>
          <span className="lp-hv-action lp-hv-action-soft">Why this price?</span>
        </div>
      </div>

      <div className="lp-hero-card lp-hv-sophie">
        <div className="lp-hv-head">
          <div className="lp-hv-avatar lp-hv-sophie-av">S</div>
          <div className="lp-hv-meta">
            <div className="lp-hv-name">Sophie</div>
            <div className="lp-hv-role">Note #2204-A · serviced</div>
          </div>
          <span className="lp-hv-badge lp-hv-badge-done">Done</span>
        </div>
        <div className="lp-hv-row"><span>Payment received</span><b>$487.50</b></div>
        <div className="lp-hv-row"><span>Receipt sent</span><b>2 min ago</b></div>
        <div className="lp-hv-row"><span>Next due</span><b>Jun 1</b></div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────── HOW
function HowItWorks({ copy }) {
  const c = copy.how;
  return (
    <section className="lp-section" id="how">
      <div className="lp-eyebrow">{c.eyebrow}</div>
      <h2 className="lp-section-title">{c.title}</h2>
      <div className="lp-how-grid">
        {c.steps.map((s, i) => (
          <div key={i} className="lp-how-card">
            <div className="lp-how-num">{String(s.n).padStart(2, '0')}</div>
            <h3 className="lp-how-title">{s.t}</h3>
            <p className="lp-how-body">{s.b}</p>
            {i < c.steps.length - 1 && <div className="lp-how-connector" aria-hidden="true">→</div>}
          </div>
        ))}
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────── AGENTS
function Agents({ copy }) {
  const c = copy.agents;
  const [active, setActive] = useState(0);

  const agents = [
    {
      id: 'atlas',
      name: 'Atlas',
      role: 'Analysis',
      tagline: 'Pulls comps. Spots flaws. Prices parcels.',
      color: '#C2531C',
      bullets: [
        'Pulls 10–20 comparables for any APN',
        'Calculates $/acre, road frontage, slope',
        'Flags wetlands, easements, access issues',
        'Suggests an offer band with confidence',
      ],
      sample: {
        title: 'Atlas just finished APN 304-12-456',
        rows: [
          ['Median comp', '$2,840 / acre'],
          ['Suggested offer', '$11,200 – $14,800'],
          ['Confidence', 'High · 87%'],
          ['Flagged', 'Easement on south boundary'],
        ],
      },
    },
    {
      id: 'pax',
      name: 'Pax',
      role: 'Communication',
      tagline: 'Drafts replies. Books calls. Handles objections.',
      color: '#4C7B80',
      bullets: [
        'Drafts SMS, email, and voicemail replies',
        'Tone-matches each seller',
        'Schedules follow-ups across time zones',
        'Hands off to you when judgment is needed',
      ],
      sample: {
        title: 'Pax has 4 drafts ready for review',
        rows: [
          ['Janet R. · price negotiation', 'Reviewed'],
          ['Marcus T. · objection (taxes)', 'Awaiting'],
          ['Diane K. · scheduling call', 'Awaiting'],
          ['Roy G. · sent contract', 'Awaiting'],
        ],
      },
    },
    {
      id: 'sophie',
      name: 'Sophie',
      role: 'Servicing',
      tagline: 'Watches title. Services notes. Keeps the books.',
      color: '#8B5A2B',
      bullets: [
        'Tracks loan payments + sends receipts',
        'Monitors title status across counties',
        'Files 1098s and year-end statements',
        'Catches missed payments before you do',
      ],
      sample: {
        title: 'Sophie\'s ledger · this week',
        rows: [
          ['Payments collected', '$14,820'],
          ['Notes serviced', '37 of 37'],
          ['Receipts sent', '37'],
          ['Late notices', '2 (auto-sent Mon)'],
        ],
      },
    },
  ];

  const a = agents[active];

  return (
    <section className="lp-section" id="agents">
      <div className="lp-eyebrow lp-eyebrow-brand">{c.eyebrow}</div>
      <h2 className="lp-section-title">{c.title}</h2>
      <p className="lp-section-sub">{c.sub}</p>

      <div className="lp-agents-tabs" role="tablist">
        {agents.map((ag, i) => (
          <button
            key={ag.id}
            role="tab"
            aria-selected={active === i}
            className={`lp-agent-tab ${active === i ? 'lp-agent-tab-active' : ''}`}
            onClick={() => setActive(i)}
            style={active === i ? { '--tab-color': ag.color } : {}}
          >
            <span className="lp-agent-tab-letter" style={{ background: ag.color }}>
              {ag.name[0]}
            </span>
            <span className="lp-agent-tab-name">{ag.name}</span>
            <span className="lp-agent-tab-role">{ag.role}</span>
          </button>
        ))}
      </div>

      <div className="lp-agent-panel" key={a.id}>
        <div className="lp-agent-panel-left">
          <h3 className="lp-agent-tagline">{a.tagline}</h3>
          <ul className="lp-agent-bullets">
            {a.bullets.map((b, i) => (
              <li key={i}><span className="lp-agent-check" style={{ color: a.color }}>✓</span>{b}</li>
            ))}
          </ul>
        </div>
        <div className="lp-agent-panel-right">
          <div className="lp-agent-sample" style={{ '--agent-color': a.color }}>
            <div className="lp-agent-sample-head">
              <span className="lp-agent-sample-avatar" style={{ background: a.color }}>{a.name[0]}</span>
              <div className="lp-agent-sample-title">{a.sample.title}</div>
            </div>
            <div className="lp-agent-sample-rows">
              {a.sample.rows.map((r, i) => (
                <div key={i} className="lp-agent-sample-row">
                  <span>{r[0]}</span><b>{r[1]}</b>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

window.Section1 = { Hero, HowItWorks, Agents };
