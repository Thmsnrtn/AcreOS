/**
 * AcreOS public landing page.
 *
 * Composes the homestead-palette, serif-display landing per the
 * /acreos-landing/ prototype (sections-1.jsx, sections-2.jsx,
 * sections-3.jsx, sections.css, copy.jsx).
 *
 * Section order matches the prototype's app.jsx switch:
 *   Hero → HowItWorks → Agents → DayInLife → Features → Quotes →
 *   FounderNote → Pricing → FAQ → FinalCTA → Footer
 *
 * Voice is the prototype's "letter" tone — see
 * client/src/pages/landing/copy.ts. Top nav lives in
 * client/src/pages/landing/LandingNav.tsx (homestead-styled, sticky,
 * anchor links to in-page sections + Sign in + Start free trial).
 *
 * Legacy WaitlistSection / SOCIAL_PROOF / inline FEATURES that previously
 * lived in this file have been removed — the prototype's Features /
 * Quotes sections cover the same intent at higher fidelity, and the
 * waitlist for adjacent verticals will live on /verticals/waitlist
 * (Phase 8 Coverage Pass) rather than the public landing.
 */
import { useDocumentTitle } from "@/hooks/use-document-title";
import { SkipToContent } from "@/components/skip-to-content";
import { LandingNav } from "./landing/LandingNav";
import { Hero } from "./landing/Hero";
import { HowItWorks } from "./landing/HowItWorks";
import { Agents } from "./landing/Agents";
import { DayInLife } from "./landing/DayInLife";
import { Features } from "./landing/Features";
import { Quotes } from "./landing/Quotes";
import { FounderNote } from "./landing/FounderNote";
import { Pricing } from "./landing/Pricing";
import { FAQ } from "./landing/FAQ";
import { FinalCTA } from "./landing/FinalCTA";
import { Footer } from "./landing/Footer";
import "./landing/landing.css";

export default function LandingPage() {
  useDocumentTitle("AcreOS — the operating system for land investors");
  return (
    <div className="min-h-screen bg-background">
      <SkipToContent />
      <LandingNav />
      {/* Full landing per /acreos-landing/. Section order matches the
          prototype's app.jsx switch statement. */}
      <main id="main-content">
        <Hero />
        <HowItWorks />
        <Agents />
        <DayInLife />
        <Features />
        <Quotes />
        <FounderNote />
        <Pricing />
        <FAQ />
        <FinalCTA />
      </main>
      <Footer />
    </div>
  );
}
