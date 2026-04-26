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
 * client/src/pages/landing/copy.ts. Production nav at top is preserved
 * from the pre-build landing (Clerk sign-in flow + analytics integration);
 * Phase 2A.3 will replace this with a homestead-styled nav as a follow-up.
 *
 * Legacy WaitlistSection / SOCIAL_PROOF / inline FEATURES that previously
 * lived in this file have been removed — the prototype's Features /
 * Quotes sections cover the same intent at higher fidelity, and the
 * waitlist for adjacent verticals will live on /verticals/waitlist
 * (Phase 8 Coverage Pass) rather than the public landing.
 */
import { Link } from "wouter";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { Button } from "@/components/ui/button";
import { AcreosLogo } from "@/components/acreos-logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { SkipToContent } from "@/components/skip-to-content";
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
      {/* Nav */}
      <nav className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <AcreosLogo size={30} />

          <div className="flex items-center gap-1 sm:gap-3">
            <Button variant="ghost" size="sm" asChild className="hidden sm:inline-flex">
              <Link href="/pricing">Pricing</Link>
            </Button>
            <ThemeToggle />
            <Button variant="ghost" size="sm" asChild>
              <Link href="/auth">Sign in</Link>
            </Button>
            <Button size="sm" asChild>
              {/* Short label on mobile so the button doesn't clip. Full
                  "Get Started Free" on sm+ screens. */}
              <Link href="/auth?mode=register">
                <span className="sm:hidden">Get started</span>
                <span className="hidden sm:inline">Get Started Free</span>
              </Link>
            </Button>
          </div>
        </div>
      </nav>

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
