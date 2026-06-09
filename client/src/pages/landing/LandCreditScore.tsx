/**
 * LandCreditScore — public, ungated marketing surface for the Land Credit
 * Score, AcreOS's category-defining noun.
 *
 * The LCS has deep product surface (client/src/pages/land-credit.tsx,
 * shared/schema/marketplace.ts landCreditScores) but its in-app page is
 * auth + flag gated. This file gives the score a public face: a 300–850 /
 * A+–F explainer a stranger can read with no signup.
 *
 * Honest framing (truth-engine, voice-lint):
 *   - It scores PARCELS, not people. No personal/consumer credit is involved.
 *   - It is NOT a FICO score or a regulated consumer credit report.
 *   - The sample gauge is labeled "illustrative" — no example score is stated
 *     as a real measurement.
 *   - The six dimensions + weights mirror the product's feature-importance
 *     table exactly (Location 25 / Financial 20 / Physical 20 / Legal 15 /
 *     Environmental 10 / Market 10).
 *
 * Exposed two ways:
 *   1. <LandCreditScoreBand /> — a section mounted on the landing page
 *      (client/src/pages/landing.tsx), next to the DataProvenance proof band.
 *   2. default export LandCreditScorePage — a standalone /land-credit-score
 *      route (registered in App.tsx) with nav + footer for SEO/share.
 *
 * Voice: mechanics-first, third-person; copy lives in copy.ts (voice-linted).
 * Styling reuses landing.css --acr-* tokens; no hardcoded color.
 *
 * Soren, 2026-06-08 — conversion-proof stream.
 */

import { useEffect } from "react";
import { Link } from "wouter";
import { usePageDescription } from "@/hooks/use-document-title";
import { SkipToContent } from "@/components/skip-to-content";
import { OpenGraph } from "@/components/seo/OpenGraph";
import { SITE } from "@/lib/jsonld-schemas";
import { emitMarketingTouch } from "@/lib/marketing-touch";
import { LANDING_COPY } from "./copy";
import { LandingNav } from "./LandingNav";
import { Footer } from "./Footer";
import "./landing.css";

/**
 * The score band. Shared between the landing page and the standalone route.
 * `standalone` raises the heading level to h1 when it owns the page.
 */
export function LandCreditScoreBand({ standalone = false }: { standalone?: boolean }) {
  const c = LANDING_COPY.landCreditScore;
  const Title = standalone ? "h1" : "h2";
  return (
    <section className="lp-section" id="land-credit-score">
      <div className="lp-eyebrow">{c.eyebrow}</div>
      <Title className="lp-section-title">{c.title}</Title>
      <p className="lp-section-sub">{c.sub}</p>

      {/* Illustrative gauge — clearly labeled as an example, never a real score. */}
      <div className="lp-lcs-gauge" role="img" aria-label="Illustrative Land Credit Score gauge, 300 to 850 scale">
        <span className="lp-lcs-gauge-label">{c.sampleLabel}</span>
        <div className="lp-lcs-gauge-bar" aria-hidden="true">
          <div className="lp-lcs-gauge-fill" />
          <div className="lp-lcs-gauge-marker" />
        </div>
        <div className="lp-lcs-gauge-scale" aria-hidden="true">
          <span>300</span>
          <span>F</span>
          <span>C</span>
          <span>B</span>
          <span>A</span>
          <span>A+</span>
          <span>850</span>
        </div>
        <p className="lp-lcs-gauge-note">{c.scaleNote}</p>
      </div>

      <h3 className="lp-lcs-subhead">{c.dimensionsTitle}</h3>
      <p className="lp-lcs-subsub">{c.dimensionsSub}</p>
      <div className="lp-data-sources">
        {c.dimensions.map((d) => (
          <div key={d.name} className="lp-data-source">
            <p className="lp-data-source-agency">
              {d.name} <span className="lp-lcs-weight">{d.weight}%</span>
            </p>
            <p className="lp-data-source-what">{d.what}</p>
          </div>
        ))}
      </div>

      <div className="lp-lcs-honest">
        <h3 className="lp-lcs-subhead">{c.honestTitle}</h3>
        <ul className="lp-lcs-honest-list">
          {c.honest.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </div>

      <div className="lp-data-promise">
        <p className="lp-data-promise-text">
          <strong>See a Land Credit Score resolve on a parcel you pick — no signup.</strong>
        </p>
        <Link
          href="/tools/parcel-check?utm_source=landing&utm_medium=internal&utm_campaign=lcs_band"
          className="lp-btn lp-btn-secondary lp-btn-lg"
          onClick={() =>
            emitMarketingTouch({
              surface: "landing:lcs-band",
              eventType: "cta_click",
              payload: { ctaId: "lcs_parcel_check" },
            })
          }
        >
          {c.cta1}
        </Link>
        <Link
          href="/auth?mode=register"
          className="lp-btn lp-btn-primary lp-btn-lg"
          onClick={() =>
            emitMarketingTouch({
              surface: "landing:lcs-band",
              eventType: "cta_click",
              payload: { ctaId: "lcs_signup" },
            })
          }
        >
          {c.cta2}
        </Link>
      </div>
    </section>
  );
}

/** Standalone /land-credit-score marketing route. */
export default function LandCreditScorePage() {
  const c = LANDING_COPY.landCreditScore;
  usePageDescription(
    "The Land Credit Score is a 300–850 read on a parcel as an investment — graded A+ through F across six weighted dimensions. It scores land, not people, and is not a consumer credit report.",
  );
  useEffect(() => {
    emitMarketingTouch({ surface: "landing:land-credit-score", eventType: "page_view" });
  }, []);
  return (
    <div className="min-h-screen bg-background">
      <SkipToContent />
      <OpenGraph
        url={`${SITE.url}/land-credit-score`}
        title="The Land Credit Score — AcreOS"
        description={c.sub}
        type="website"
      />
      <LandingNav />
      <main id="main-content">
        <LandCreditScoreBand standalone />
      </main>
      <Footer />
    </div>
  );
}
