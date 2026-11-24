/**
 * AcreOS public landing page.
 *
 * Composes the homestead-palette, serif-display landing per the
 * /acreos-landing/ prototype (sections-1.jsx, sections-2.jsx,
 * sections-3.jsx, sections.css, copy.jsx).
 *
 * Section order:
 *   Hero → Positioning → HowItWorks → Agents → DayInLife → Features →
 *   LandCreditScore → DataProvenance → Quotes → Pricing → FAQ →
 *   FinalCTA → Footer
 *
 * Voice is mechanics-first, third-person — see
 * client/src/pages/landing/copy.ts. The former founder-letter tone
 * (and its FounderNote section) was removed per founder direction:
 * the landing should describe what the system does, not why it was
 * built. Top nav lives in client/src/pages/landing/LandingNav.tsx
 * (homestead-styled, sticky, anchor links to in-page sections + Sign
 * in + Start free trial).
 *
 * Legacy WaitlistSection / SOCIAL_PROOF / inline FEATURES that previously
 * lived in this file have been removed — the prototype's Features /
 * Quotes sections cover the same intent at higher fidelity, and the
 * waitlist for adjacent verticals will live on /verticals/waitlist
 * (Phase 8 Coverage Pass) rather than the public landing.
 */
import { useEffect } from "react";
import { usePageDescription } from "@/hooks/use-document-title";
import { emitMarketingTouch } from "@/lib/marketing-touch";
import { SkipToContent } from "@/components/skip-to-content";
import { JsonLd } from "@/components/seo/JsonLd";
import { OpenGraph } from "@/components/seo/OpenGraph";
import {
  organizationSchema,
  websiteSchema,
  productLandingSchema,
  SITE,
} from "@/lib/jsonld-schemas";
import { useLandingCopy } from "@/lib/landing-copy";
import { LandingNav } from "./landing/LandingNav";
import { Hero } from "./landing/Hero";
import { ProductShots } from "./landing/ProductShots";
import { Positioning } from "./landing/Positioning";
import { HowItWorks } from "./landing/HowItWorks";
import { Agents } from "./landing/Agents";
import { DayInLife } from "./landing/DayInLife";
import { Features } from "./landing/Features";
import { LandCreditScoreBand } from "./landing/LandCreditScore";
import { DataProvenance } from "./landing/DataProvenance";
import { Quotes } from "./landing/Quotes";
import { Pricing } from "./landing/Pricing";
import { FAQ } from "./landing/FAQ";
import { FinalCTA } from "./landing/FinalCTA";
import { Footer } from "./landing/Footer";
import "./landing/landing.css";

/**
 * The one public positioning sentence — rendered as the meta description AND
 * the Open Graph description, so it is typed once. It says what the product
 * does and what it will not do without you: Pax drafts and keeps records
 * current, and nothing reaches another person until you tap Approve
 * (shared/pax-glossary.ts is the customer-facing wording of the same rule).
 */
const PAGE_DESCRIPTION =
  "AcreOS is the operating system for property investors — deepest in land: land flippers, note investors, fix-and-flippers, wholesalers, subdividers, tax-delinquent buyers, and buy-and-hold landlords. Run comps, send mail, draft replies, and track every deal through closing — Pax does the work and every message waits for your tap.";

export default function LandingPage() {
  // The page's copy is served as data (/landing-copy.json), loaded
  // once here and threaded to the sections as props — copy.ts stays
  // the source of truth and the claims audit reads it from disk.
  // A failed or wrong-shape load renders the shell plus a visible
  // error, never a silently-empty public page.
  const { data: copy, error: copyError } = useLandingCopy();
  // Title is intentionally NOT set here — index.html ships the canonical
  // "AcreOS — The Operating System for Property Investors" title and we don't
  // want a flicker between that and a React-set variant on first paint.
  // Other routes still use useDocumentTitle() for their per-page titles.
  usePageDescription(PAGE_DESCRIPTION);
  // Marketing-touch substrate — record the landing page view (the top of the
  // acquisition funnel) once per mount. Carries the session's captured UTM.
  useEffect(() => {
    emitMarketingTouch({ surface: "landing", eventType: "page_view" });
  }, []);
  return (
    <div className="min-h-screen bg-background">
      <SkipToContent />
      <OpenGraph
        url={`${SITE.url}/`}
        title="AcreOS — The Operating System for Property Investors"
        description={PAGE_DESCRIPTION}
        type="website"
      />
      <JsonLd id="ld-organization" data={organizationSchema()} />
      <JsonLd id="ld-website" data={websiteSchema()} />
      <JsonLd id="ld-product" data={productLandingSchema()} />
      <LandingNav />
      {/* Full landing per /acreos-landing/. Section order matches the
          prototype's app.jsx switch statement. */}
      <main id="main-content">
        {copyError && (
          <p role="alert" className="lp-section text-sm" data-testid="landing-load-error">
            We couldn't load this page's content. Please refresh and try again.
          </p>
        )}
        {!copy && !copyError && (
          <p className="lp-section text-sm" role="status" data-testid="landing-loading">
            Loading…
          </p>
        )}
        {copy && (
          <>
            <Hero copy={copy.hero} />
            {/* Simulated product screens (rendered UI, example-labeled) — the
                benchmark pattern of showing the actual product, done honestly. */}
            <ProductShots copy={copy.productShots} />
            <Positioning copy={copy.positioning} />
            <HowItWorks copy={copy.how} />
            <Agents copy={copy.agents} />
            <DayInLife copy={copy.day} />
            <Features copy={copy.features} />
            <LandCreditScoreBand copy={copy.landCreditScore} />
            <DataProvenance copy={copy.data} />
            <Quotes copy={copy.quotes} />
            <Pricing copy={copy.pricing} />
            <FAQ copy={copy.faq} />
            <FinalCTA copy={copy.cta} />
          </>
        )}
      </main>
      <Footer />
    </div>
  );
}
