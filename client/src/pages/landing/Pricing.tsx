/**
 * Four tiers (Free / Starter / Pro / Scale) with monthly/annual toggle.
 * Pro is "Most popular" — gets 1px ink-color border + shadow + flag.
 *
 * Prices come from shared/billing/tier-pricing.ts so this landing surface
 * can never drift from the pricing page, MRR math, or Stripe checkout
 * amounts. Earlier prototype copy used $199 / $499 / $1290 as illustrative
 * marketing; that drifted from the canonical $20 / $49 / $79 and is the
 * reason MRR math was fiction across the founder dashboard.
 *
 * 2026-05-11 — renamed Solo/Operator/Empire → Starter/Pro/Scale to match
 * the in-app /pricing page and the canonical TIER_PRICES_CENTS keys. A
 * "Free" card was added so the landing matches the in-app's 4-tier shape.
 */

import { useState } from "react";
import { Link } from "wouter";
import { LANDING_COPY } from "./copy";
import { TIER_PRICES_CENTS } from "@shared/billing/tier-pricing";

const TIERS = [
  {
    // `id` keys the ?plan= tier context the signup CTA carries into the
    // acquisition-UTM chain (Tier 2C) — must match TIER_PRICES_CENTS keys.
    id: "free",
    name: "Free",
    desc: "Explore the platform — no card required.",
    m: 0,
    a: 0,
    features: [
      "1 user",
      "10 leads / 3 properties / 2 notes",
      "Pax assistant (limited monthly messages)",
      "Lead inbox with Pax drafts",
      "6 free data sources",
    ],
    cta: "Get started",
    featured: false,
  },
  {
    id: "starter",
    name: "Starter",
    desc: "For investors closing 1–4 deals a month.",
    m: TIER_PRICES_CENTS.starter.priceMonthlyCents / 100,
    a: TIER_PRICES_CENTS.starter.priceYearlyCents / 100,
    features: [
      "1 user",
      "3 counties in buy-box",
      "Full Pax assistant",
      "500 mailers / mo",
      "Lead inbox with Pax drafts",
      "Audit log",
    ],
    cta: "Start free trial",
    featured: false,
  },
  {
    id: "pro",
    name: "Pro",
    // Monthly-equivalent of the annual plan is DERIVED from the canonical
    // price (priceYearlyCents / 12) so this prose can never drift from the
    // live toggle below — the $199/$499 prototype drift that "made MRR math
    // fiction" started exactly here, with a hand-typed price in prose.
    desc:
      `$${Math.round(TIER_PRICES_CENTS.pro.priceYearlyCents / 12 / 100)}/mo billed annually. Full Pax assistant, unlimited counties, and BYOK for the data costs every operator already pays.`,
    m: TIER_PRICES_CENTS.pro.priceMonthlyCents / 100,
    a: TIER_PRICES_CENTS.pro.priceYearlyCents / 100,
    features: [
      "Unlimited seats ($20/seat after the first)",
      "Unlimited counties in buy-box",
      "Full Pax assistant + automation builder",
      "Unlimited campaigns (BYOK for postage)",
      "Bring-your-own-key for parcel + skip-trace data",
      "Note servicing automation",
      "Roles + permissions",
      "Priority support",
    ],
    cta: "Start free trial",
    featured: true,
  },
  {
    id: "scale",
    name: "Scale",
    desc: "For full-time operations & multi-state.",
    m: TIER_PRICES_CENTS.scale.priceMonthlyCents / 100,
    a: TIER_PRICES_CENTS.scale.priceYearlyCents / 100,
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
          const price = t.m === 0 ? 0 : annual ? Math.round(t.a / 12) : t.m;
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
                {t.m === 0
                  ? "Free forever"
                  : annual
                  ? `Billed $${t.a.toLocaleString()} annually`
                  : "Billed monthly"}
              </div>
              {t.cta === "Talk to us" ? (
                // Solo-founder sales path: mailto opens the user's email
                // client, eliminates the /contact route 404 that was
                // dropping the highest-intent leads pre-2026-06-05 audit.
                // A dedicated /contact page can replace this once there
                // are enough Scale-tier inquiries to justify it.
                <a
                  href="mailto:sales@acreos.io?subject=AcreOS%20Scale%20tier%20inquiry"
                  className={`lp-btn ${t.featured ? "lp-btn-primary" : "lp-btn-secondary"} lp-btn-lg lp-tier-cta`}
                  data-testid="cta-scale-mailto"
                >
                  {t.cta}
                </a>
              ) : (
                // Tier 2C — carry which tier + cadence the user clicked
                // into the signup URL. capturePendingUtm() picks plan/
                // billing up into the first-touch snapshot so trial_to_paid
                // cohorts can be segmented by stated intent.
                <Link
                  href={`/auth?mode=register&plan=${t.id}&billing=${annual ? "yearly" : "monthly"}`}
                  className={`lp-btn ${t.featured ? "lp-btn-primary" : "lp-btn-secondary"} lp-btn-lg lp-tier-cta`}
                >
                  {t.cta}
                </Link>
              )}
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
        Every paid plan includes 14 days free, a 30-day money-back guarantee, no setup fees, and migration help from a real human.
      </div>
    </section>
  );
}
