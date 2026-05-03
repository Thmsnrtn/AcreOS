/**
 * Three tiers (Solo / Operator / Empire) with monthly/annual toggle.
 * Operator is "Most popular" — gets 1px ink-color border + shadow + flag.
 *
 * Prices come from shared/billing/tier-pricing.ts so this landing surface
 * can never drift from the pricing page, MRR math, or Stripe checkout
 * amounts. Earlier prototype copy used $199 / $499 / $1290 as illustrative
 * marketing; that drifted from the canonical $20 / $49 / $79 and is the
 * reason MRR math was fiction across the founder dashboard.
 */

import { useState } from "react";
import { Link } from "wouter";
import { LANDING_COPY } from "./copy";
import { TIER_PRICES_CENTS } from "@shared/billing/tier-pricing";

const TIERS = [
  {
    name: "Solo",
    desc: "For investors closing 1–4 deals a month.",
    m: TIER_PRICES_CENTS.solo.priceMonthlyCents / 100,
    a: TIER_PRICES_CENTS.solo.priceYearlyCents / 100,
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
    m: TIER_PRICES_CENTS.operator.priceMonthlyCents / 100,
    a: TIER_PRICES_CENTS.operator.priceYearlyCents / 100,
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
    name: "Empire",
    desc: "For full-time operations & multi-state.",
    m: TIER_PRICES_CENTS.empire.priceMonthlyCents / 100,
    a: TIER_PRICES_CENTS.empire.priceYearlyCents / 100,
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
