// acreos-landing/sections-3.jsx
// Founder · Pricing · FAQ · CTA · Footer

const { useState: useState3 } = React;

// ─────────────────────────────────────────────────────────── FOUNDER NOTE
function FounderNote({ copy }) {
  const c = copy.founder;
  return (
    <section className="lp-section lp-founder" id="founder">
      <div className="lp-founder-inner">
        <div className="lp-founder-portrait" aria-hidden="true">
          <svg viewBox="0 0 200 240" width="180" height="216">
            <defs>
              <linearGradient id="port-bg" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="#F1E9D6"/>
                <stop offset="100%" stopColor="#E5D7B5"/>
              </linearGradient>
            </defs>
            <rect width="200" height="240" rx="12" fill="url(#port-bg)"/>
            {/* abstract portrait silhouette */}
            <circle cx="100" cy="95" r="38" fill="#C2531C" opacity="0.85"/>
            <path d="M30 240 Q30 160 100 160 Q170 160 170 240 Z" fill="#C2531C" opacity="0.85"/>
            <rect x="10" y="200" width="180" height="40" fill="#FAF4E8" opacity="0.5"/>
            <text x="100" y="225" textAnchor="middle" fontFamily="Fraunces, serif" fontSize="11" fill="#5A4424" letterSpacing="0.1em">THOMAS NORTON</text>
          </svg>
        </div>
        <div className="lp-founder-text">
          <div className="lp-eyebrow">{c.eyebrow}</div>
          <h2 className="lp-founder-title">{c.title}</h2>
          {c.body.map((p, i) => <p key={i} className="lp-founder-p">{p}</p>)}
          <div className="lp-founder-sig">
            <div className="lp-founder-sig-name">{c.sig}</div>
            <div className="lp-founder-sig-sub">{c.sigSub}</div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────── PRICING
function Pricing({ copy }) {
  const c = copy.pricing;
  const [annual, setAnnual] = useState3(true);

  const tiers = [
    {
      name: 'Solo',
      desc: 'For investors closing 1–4 deals a month.',
      m: 199, a: 1990,
      features: ['1 user', '3 counties in buy-box', 'All 3 agents', '500 mailers / mo', 'Pax inbox', 'Audit log'],
      cta: 'Start free trial',
      featured: false,
    },
    {
      name: 'Operator',
      desc: 'For partnerships and small teams.',
      m: 499, a: 4990,
      features: ['5 users', 'Unlimited counties', 'All 3 agents + automation builder', '2,500 mailers / mo', 'Sophie note servicing', 'Roles + permissions', 'Priority support'],
      cta: 'Start free trial',
      featured: true,
    },
    {
      name: 'Operation',
      desc: 'For full-time operations & multi-state.',
      m: 1290, a: 12900,
      features: ['Unlimited users', 'Custom integrations', 'Dedicated success partner', '10K mailers / mo', 'White-glove migration', 'Quarterly portfolio review'],
      cta: 'Talk to us',
      featured: false,
    },
  ];

  return (
    <section className="lp-section" id="pricing">
      <div className="lp-eyebrow">{c.eyebrow}</div>
      <h2 className="lp-section-title">{c.title}</h2>
      <p className="lp-section-sub">{c.sub}</p>

      <div className="lp-pricing-toggle">
        <button className={!annual ? 'lp-toggle-active' : ''} onClick={() => setAnnual(false)}>Monthly</button>
        <button className={annual ? 'lp-toggle-active' : ''} onClick={() => setAnnual(true)}>
          Annual <span className="lp-pricing-save">Save 17%</span>
        </button>
      </div>

      <div className="lp-pricing-grid">
        {tiers.map((t, i) => (
          <div key={i} className={`lp-tier ${t.featured ? 'lp-tier-featured' : ''}`}>
            {t.featured && <div className="lp-tier-flag">Most popular</div>}
            <div className="lp-tier-name">{t.name}</div>
            <div className="lp-tier-desc">{t.desc}</div>
            <div className="lp-tier-price">
              <span className="lp-tier-amt">${(annual ? t.a / 12 : t.m).toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
              <span className="lp-tier-per">/mo</span>
            </div>
            <div className="lp-tier-billed">
              {annual ? `Billed $${t.a.toLocaleString()} annually` : 'Billed monthly'}
            </div>
            <a href="#cta" className={`btn ${t.featured ? 'btn-primary' : 'btn-secondary'} btn-lg lp-tier-cta`}>{t.cta}</a>
            <ul className="lp-tier-features">
              {t.features.map((f, j) => (
                <li key={j}><span className="lp-tier-check">✓</span>{f}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="lp-pricing-foot">
        Every plan includes 14 days free, no setup fees, and migration help from a real human.
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────── FAQ
function FAQ({ copy }) {
  const c = copy.faq;
  const [open, setOpen] = useState3(0);
  const items = [
    { q: 'Can I bring my existing list?', a: 'Yes — import CSVs from PropStream, REISift, Pebble, DataTree, or any source. AcreOS dedupes against owners you\'ve already mailed.' },
    { q: 'Where does the data come from?', a: 'County assessors, recorder offices, and licensed parcel datasets in all 50 states. We disclose the source on every Atlas analysis.' },
    { q: 'Can I turn off the AI agents?', a: 'Yes. Each agent has its own autonomy slider — Off, Suggest, Review-then-send, or Auto-send. Default is Suggest. You\'re always in control.' },
    { q: 'Does this replace my CRM?', a: 'Yes. AcreOS includes a CRM purpose-built for land — pipeline stages, contact records, callback queues, and Pax inbox in one place.' },
    { q: 'What about my existing notes / loans?', a: 'Sophie can import and service notes from Beanstalk, Note Servicing Center, or a CSV. We\'ll do the migration with you on a 30-min call.' },
    { q: 'Can I use this with a partner or VA?', a: 'Yes. Operator and Operation plans include multi-user with role-based permissions — your VA can\'t see financials unless you grant it.' },
    { q: 'How fast can I get started?', a: 'Same day. Define your buy-box in 4 minutes, and your first list pulls overnight. Mail can go out the next morning.' },
    { q: 'What if I cancel?', a: 'Export everything to CSV in one click. We don\'t hold your data hostage — and we\'ll send you a personal email asking what we missed.' },
  ];

  return (
    <section className="lp-section" id="faq">
      <div className="lp-eyebrow">{c.eyebrow}</div>
      <h2 className="lp-section-title">{c.title}</h2>
      <div className="lp-faq-list">
        {items.map((it, i) => (
          <div key={i} className={`lp-faq-item ${open === i ? 'lp-faq-open' : ''}`}>
            <button className="lp-faq-q" onClick={() => setOpen(open === i ? -1 : i)} aria-expanded={open === i}>
              <span>{it.q}</span>
              <span className="lp-faq-icon" aria-hidden="true">{open === i ? '–' : '+'}</span>
            </button>
            {open === i && <div className="lp-faq-a">{it.a}</div>}
          </div>
        ))}
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────── FINAL CTA
function FinalCTA({ copy }) {
  const c = copy.cta;
  return (
    <section className="lp-section lp-cta" id="cta">
      <div className="lp-cta-card">
        <div className="lp-eyebrow lp-eyebrow-brand">{c.eyebrow}</div>
        <h2 className="lp-cta-title">{c.title}</h2>
        <p className="lp-cta-sub">{c.sub}</p>
        <div className="lp-cta-form">
          <input type="email" placeholder="you@yourbusiness.com" className="lp-cta-input" />
          <button className="btn btn-primary btn-lg btn-arrow">{c.cta1}</button>
        </div>
        <div className="lp-cta-or">or</div>
        <a href="#" className="btn btn-ghost">{c.cta2} →</a>

        <div className="lp-cta-trust">
          <span>14 days free</span>
          <span className="lp-cta-sep" aria-hidden="true">·</span>
          <span>No credit card</span>
          <span className="lp-cta-sep" aria-hidden="true">·</span>
          <span>SOC2 Type II</span>
          <span className="lp-cta-sep" aria-hidden="true">·</span>
          <span>Cancel anytime</span>
        </div>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────── FOOTER
function Footer() {
  return (
    <footer className="lp-footer">
      <div className="lp-footer-inner">
        <div className="lp-footer-brand">
          <a href="#" className="lp-logo">
            <span className="lp-logo-mark">A</span>AcreOS
          </a>
          <p className="lp-footer-tag">The operating system for land investors. Built by an investor.</p>
        </div>
        <div className="lp-footer-cols">
          <div className="lp-footer-col">
            <div className="lp-footer-h">Product</div>
            <a href="#">Atlas</a><a href="#">Pax</a><a href="#">Sophie</a><a href="#">Automation</a><a href="#">Pricing</a>
          </div>
          <div className="lp-footer-col">
            <div className="lp-footer-h">Company</div>
            <a href="#">About</a><a href="#">Founder note</a><a href="#">Careers</a><a href="#">Press</a>
          </div>
          <div className="lp-footer-col">
            <div className="lp-footer-h">Resources</div>
            <a href="#">Academy</a><a href="#">Blog</a><a href="#">Land deal calculator</a><a href="#">API docs</a>
          </div>
          <div className="lp-footer-col">
            <div className="lp-footer-h">Contact</div>
            <a href="mailto:thomas@acreos.io">thomas@acreos.io</a>
            <a href="#">Support</a>
            <a href="#">Status</a>
          </div>
        </div>
      </div>
      <div className="lp-footer-bottom">
        <span>© 2025 AcreOS, Inc.</span>
        <span className="lp-footer-fine">
          <a href="#">Privacy</a> · <a href="#">Terms</a> · <a href="#">Security</a>
        </span>
      </div>
    </footer>
  );
}

window.Section3 = { FounderNote, Pricing, FAQ, FinalCTA, Footer };
