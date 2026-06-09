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

import { useEffect, useState } from "react";
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
 * The score band. Shared between the landing page, the standalone route, and
 * the iframe embed.
 *
 * `standalone` raises the heading level to h1 when it owns the page.
 * `embed` renders the band for a 3rd-party iframe: the in-app wouter CTAs
 * (which would navigate *inside* the iframe) are swapped for an external
 * "check your parcel" backlink that opens AcreOS in a new tab with
 * `?utm_source=embed`. The honest "scores land not people / not a FICO score"
 * disclaimer block ALWAYS renders, in every mode — it is part of the band, so
 * a host site can never strip it from the score it embeds (Beatrice guardrail).
 */
export function LandCreditScoreBand({
  standalone = false,
  embed = false,
}: {
  standalone?: boolean;
  embed?: boolean;
}) {
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

      {embed ? (
        // Embed mode: the band lives inside a 3rd-party iframe. A wouter <Link>
        // would route within the iframe's own SPA, so we use a real external
        // anchor that opens AcreOS in a new tab. This is the "Powered by AcreOS
        // · check your parcel" backlink the embed flywheel runs on.
        <div className="lp-data-promise">
          <p className="lp-data-promise-text">
            <strong>See a Land Credit Score resolve on a parcel you pick — no signup.</strong>
          </p>
          <a
            href="https://acreos.io/tools/parcel-check?utm_source=embed&utm_medium=iframe&utm_campaign=lcs_embed"
            target="_blank"
            rel="noopener noreferrer"
            className="lp-btn lp-btn-primary lp-btn-lg"
          >
            Powered by AcreOS · check your parcel
          </a>
        </div>
      ) : (
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
      )}
    </section>
  );
}

/** The iframe snippet shown on the public LCS page so any site can embed it. */
const LCS_EMBED_SNIPPET =
  '<iframe src="https://acreos.io/land-credit-score/embed" width="100%" height="900" frameborder="0" title="The Land Credit Score — AcreOS"></iframe>';

/**
 * One-click "Embed this" box. Reuses the landing.css lp-* tokens so it matches
 * the page; no shadcn Card here (this surface is intentionally token-styled).
 */
function EmbedThisBox() {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(LCS_EMBED_SNIPPET);
      setCopied(true);
      emitMarketingTouch({
        surface: "landing:land-credit-score",
        eventType: "cta_click",
        payload: { ctaId: "lcs_embed_copy" },
      });
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked — the snippet is still selectable in the <pre> */
    }
  }
  return (
    <div className="lp-lcs-honest" id="embed-this">
      <h3 className="lp-lcs-subhead">Embed the Land Credit Score</h3>
      <p className="lp-lcs-subsub">
        Drop this snippet into any page. Free to use — the score carries its own
        honesty disclaimer, so it stays accurate wherever it lands. A backlink to
        AcreOS travels inside the embed.
      </p>
      <pre className="lp-lcs-embed-code">
        <code data-testid="lcs-embed-snippet">{LCS_EMBED_SNIPPET}</code>
      </pre>
      <button
        type="button"
        onClick={copy}
        className="lp-btn lp-btn-secondary"
        data-testid="lcs-copy-embed"
        aria-label="Copy Land Credit Score embed code"
      >
        {copied ? "Copied" : "Copy embed code"}
      </button>
    </div>
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
        <section className="lp-section">
          <EmbedThisBox />
        </section>
      </main>
      <Footer />
    </div>
  );
}

/**
 * /land-credit-score/embed — iframe-friendly Land Credit Score.
 *
 * No nav, no footer, no in-app CTAs — just the score band (which carries the
 * honesty disclaimer INSIDE it, so a host can't strip it) plus a "Powered by
 * AcreOS · check your parcel" backlink. Renders on an explicit background with
 * a fixed max-width frame so it survives arbitrary 3rd-party page backgrounds
 * (Beatrice/Krieger guardrail: dark-host-safe, fixed frame).
 *
 * Iframe-ability is scoped to this exact path by server/middleware/security.ts.
 */
export function LandCreditScoreEmbedPage() {
  const c = LANDING_COPY.landCreditScore;
  usePageDescription(
    "The Land Credit Score is a 300–850 read on a parcel as an investment — graded A+ through F. It scores land, not people, and is not a consumer credit report.",
  );
  return (
    <main className="min-h-screen bg-background text-foreground">
      <OpenGraph
        url={`${SITE.url}/land-credit-score/embed`}
        title="The Land Credit Score — AcreOS"
        description={c.sub}
        type="website"
      />
      <div className="mx-auto max-w-4xl">
        <LandCreditScoreBand embed />
      </div>
    </main>
  );
}
