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

export default function LandingPage() {
  // Title is intentionally NOT set here — index.html ships the canonical
  // "AcreOS — The Operating System for Property Investors" title and we don't
  // want a flicker between that and a React-set variant on first paint.
  // Other routes still use useDocumentTitle() for their per-page titles.
  usePageDescription(
    "AcreOS is the operating system for property investors — deepest in land: land flippers, note investors, fix-and-flippers, wholesalers, subdividers, tax-delinquent buyers, and buy-and-hold landlords. Pull lists, run comps, send mail, draft replies, and track every deal through closing with AI agents that act on your behalf.",
  );
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
        description="AcreOS is the operating system for property investors — deepest in land: land flippers, note investors, fix-and-flippers, wholesalers, subdividers, tax-delinquent buyers, and buy-and-hold landlords. Pull lists, run comps, send mail, draft replies, and track every deal through closing with AI agents that act on your behalf."
        type="website"
      />
      <JsonLd id="ld-organization" data={organizationSchema()} />
      <JsonLd id="ld-website" data={websiteSchema()} />
      <JsonLd id="ld-product" data={productLandingSchema()} />
      <LandingNav />
      {/* Full landing per /acreos-landing/. Section order matches the
          prototype's app.jsx switch statement. */}
      <main id="main-content">
        <Hero />
        {/* Simulated product screens (rendered UI, example-labeled) — the
            benchmark pattern of showing the actual product, done honestly. */}
        <ProductShots />
        <Positioning />
        <HowItWorks />
        <Agents />
        <DayInLife />
        <Features />
        <LandCreditScoreBand />
        <DataProvenance />
        <Quotes />
        <Pricing />
        <FAQ />
        <FinalCTA />
      </main>
      <Footer />
    </div>
  );
}
