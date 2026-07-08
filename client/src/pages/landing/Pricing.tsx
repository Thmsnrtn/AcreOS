/**
 * Four tiers (Free / Starter / Pro / Scale) with monthly/annual toggle.
 * Pro is "Most popular" — gets 1px ink-color border + shadow + flag.
 *
 * Tier copy (name / tagline / bullets / CTA) and prices come from the
 * shared pricing-copy module (client/src/lib/pricing-copy.ts) — the same
 * source the /pricing page renders — so this landing surface can never
 * drift from the pricing page, MRR math, or Stripe checkout amounts.
 * Earlier prototype copy used $199 / $499 / $1290 as illustrative
 * marketing; that drifted from the canonical $20 / $49 / $79 and is the
 * reason MRR math was fiction across the founder dashboard. A later
 * drift episode (T3 Census W4-5) had this card still advertising
 * "10 leads" on Free and "Unlimited seats" on Pro after the limits
 * changed — limits-derived bullets in pricing-copy.ts close that class
 * of bug.
 *
 * 2026-05-11 — renamed Solo/Operator/Empire → Starter/Pro/Scale to match
 * the in-app /pricing page and the canonical TIER_PRICES_CENTS keys. A
 * "Free" card was added so the landing matches the in-app's 4-tier shape.
 */

import { useState } from "react";
import { Link } from "wouter";
import { LANDING_COPY } from "./copy";
import {
  PRICING_TIER_COPY,
  SCALE_SALES_MAILTO,
  displayMonthlyPrice,
  tierSignupHref,
} from "@/lib/pricing-copy";

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
          type="button"
          role="tab"
          aria-selected={!annual}
          className={!annual ? "lp-toggle-active" : ""}
          onClick={() => setAnnual(false)}
        >
          Monthly
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={annual}
          className={annual ? "lp-toggle-active" : ""}
          onClick={() => setAnnual(true)}
        >
          Annual <span className="lp-pricing-save">Save 17%</span>
        </button>
      </div>

      <div className="lp-pricing-grid">
        {PRICING_TIER_COPY.map((t) => {
          const price = displayMonthlyPrice(t, annual);
          return (
            <div key={t.id} className={`lp-tier ${t.highlighted ? "lp-tier-featured" : ""}`}>
              {t.highlighted && <div className="lp-tier-flag">Most popular</div>}
              <div className="lp-tier-name">{t.name}</div>
              <div className="lp-tier-desc">{t.tagline}</div>
              <div className="lp-tier-price">
                <span className="lp-tier-amt">${price.toLocaleString()}</span>
                <span className="lp-tier-per">/mo</span>
              </div>
              <div className="lp-tier-billed">
                {t.priceMonthly === 0
                  ? "Free forever"
                  : annual
                  ? `Billed $${t.priceYearly.toLocaleString()} annually`
                  : "Billed monthly"}
              </div>
              {t.salesAssisted ? (
                // Solo-founder sales path: mailto opens the user's email
                // client, eliminates the /contact route 404 that was
                // dropping the highest-intent leads pre-2026-06-05 audit.
                // A dedicated /contact page can replace this once there
                // are enough Scale-tier inquiries to justify it.
                <a
                  href={SCALE_SALES_MAILTO}
                  className={`lp-btn ${t.highlighted ? "lp-btn-primary" : "lp-btn-secondary"} lp-btn-lg lp-tier-cta`}
                  data-testid="cta-scale-mailto"
                >
                  {t.ctaLabel}
                </a>
              ) : (
                // Tier 2C — carry which tier + cadence the user clicked
                // into the signup URL. capturePendingUtm() picks plan/
                // billing up into the first-touch snapshot so trial_to_paid
                // cohorts can be segmented by stated intent.
                <Link
                  href={tierSignupHref(t.id, annual ? "yearly" : "monthly")}
                  className={`lp-btn ${t.highlighted ? "lp-btn-primary" : "lp-btn-secondary"} lp-btn-lg lp-tier-cta`}
                >
                  {t.ctaLabel}
                </Link>
              )}
              <ul className="lp-tier-features">
                {t.features.map((f, j) => (
                  <li key={j}>
                    <span className="lp-tier-check" aria-hidden="true">✓</span>
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
