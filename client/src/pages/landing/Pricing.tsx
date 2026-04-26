/**
 * Prototype reference: /acreos-landing/sections-3.jsx → Pricing (lines 43-115)
 *
 * Three tiers (Solo / Operator / Operation) with monthly/annual toggle.
 * Operator is "Most popular" — gets 1px ink-color border + shadow + flag.
 *
 * Per founder pricing memory: prototype prices are illustrative landing
 * marketing. Actual production pricing should pull from /api/config/pricing
 * which the founder controls via the founder dashboard. For now this
 * landing displays the prototype's marketing pricing as static copy —
 * Phase 9 coherence pass can wire it to the real API if desired.
 */

import { useState } from "react";
import { Link } from "wouter";
import { LANDING_COPY } from "./copy";

const TIERS = [
  {
    name: "Solo",
    desc: "For investors closing 1–4 deals a month.",
    m: 199,
    a: 1990,
    features: [
      "1 user",
      "3 counties in buy-box",
      "All 3 agents",
      "500 mailers / mo",
      "Pax inbox",
      "Audit log",
    ],
    cta: "Start free trial",
    featured: false,
  },
  {
    name: "Operator",
    desc: "For partnerships and small teams.",
    m: 499,
    a: 4990,
    features: [
      "5 users",
      "Unlimited counties",
      "All 3 agents + automation builder",
      "2,500 mailers / mo",
      "Sophie note servicing",
      "Roles + permissions",
      "Priority support",
    ],
    cta: "Start free trial",
    featured: true,
  },
  {
    name: "Operation",
    desc: "For full-time operations & multi-state.",
    m: 1290,
    a: 12900,
    features: [
      "Unlimited users",
      "Custom integrations",
      "Dedicated success partner",
      "10K mailers / mo",
      "White-glove migration",
      "Quarterly portfolio review",
    ],
    cta: "Talk to us",
    featured: false,
  },
];

export function Pricing() {
  const c = LANDING_COPY.pricing;
  const [annual, setAnnual] = useState(true);

  return (
    <section className="lp-section" id="pricing">
      <div className="lp-eyebrow">{c.eyebrow}</div>
      <h2 className="lp-section-title">{c.title}</h2>
      <p className="lp-section-sub">{c.sub}</p>

      <div className="lp-pricing-toggle" role="tablist" aria-label="Billing cadence">
        <button
          role="tab"
          aria-selected={!annual}
          className={!annual ? "lp-toggle-active" : ""}
          onClick={() => setAnnual(false)}
        >
          Monthly
        </button>
        <button
          role="tab"
          aria-selected={annual}
          className={annual ? "lp-toggle-active" : ""}
          onClick={() => setAnnual(true)}
        >
          Annual <span className="lp-pricing-save">Save 17%</span>
        </button>
      </div>

      <div className="lp-pricing-grid">
        {TIERS.map((t) => {
          const price = annual ? Math.round(t.a / 12) : t.m;
          return (
            <div key={t.name} className={`lp-tier ${t.featured ? "lp-tier-featured" : ""}`}>
              {t.featured && <div className="lp-tier-flag">Most popular</div>}
              <div className="lp-tier-name">{t.name}</div>
              <div className="lp-tier-desc">{t.desc}</div>
              <div className="lp-tier-price">
                <span className="lp-tier-amt">${price.toLocaleString()}</span>
                <span className="lp-tier-per">/mo</span>
              </div>
              <div className="lp-tier-billed">
                {annual ? `Billed $${t.a.toLocaleString()} annually` : "Billed monthly"}
              </div>
              <Link
                href={t.cta === "Talk to us" ? "/contact" : "/auth?mode=register"}
                className={`lp-btn ${t.featured ? "lp-btn-primary" : "lp-btn-secondary"} lp-btn-lg lp-tier-cta`}
              >
                {t.cta}
              </Link>
              <ul className="lp-tier-features">
                {t.features.map((f, j) => (
                  <li key={j}>
                    <span className="lp-tier-check">✓</span>
                    {f}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>

      <div className="lp-pricing-foot">
        Every plan includes 14 days free, no setup fees, and migration help from a real human.
      </div>
    </section>
  );
}
