/**
 * /tools/calculator — public Land Deal Calculator. No auth.
 *
 * Top-of-funnel acquisition hook + backlink magnet for the land
 * investing market. Ships with full AcreOS chrome (lightweight nav
 * back to home + footer link). The bare iframe variant lives at
 * /tools/calculator/embed.
 */
import { Link } from "wouter";
import { ArrowLeft } from "lucide-react";
import { usePageMeta } from "@/hooks/use-document-title";
import { OpenGraph } from "@/components/seo/OpenGraph";
import { LandDealCalculator } from "@/components/tools/LandDealCalculator";

const TITLE = "Land Deal Calculator";
const DESCRIPTION =
  "Free land flip calculator. Real ROI, annualized return, IRR (Newton-Raphson), and breakeven — for land investors underwriting deals.";

// schema.org SoftwareApplication payload. Renders in <script type="application/ld+json">
// so Google / Bing / DuckDuckGo can pick it up. PriceSpecification is
// present (and zero) to flag the tool as free; that's a real SEO win
// for "free [thing] calculator" intent.
const JSON_LD = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "AcreOS Land Deal Calculator",
  description: DESCRIPTION,
  applicationCategory: "FinanceApplication",
  operatingSystem: "Any (web)",
  url: "https://acreos.io/tools/calculator",
  offers: {
    "@type": "Offer",
    price: "0",
    priceCurrency: "USD",
  },
  publisher: {
    "@type": "Organization",
    name: "AcreOS",
    url: "https://acreos.io",
  },
} as const;

export default function CalculatorPage() {
  usePageMeta(TITLE, DESCRIPTION);

  return (
    <main className="min-h-screen bg-background pb-24 lg:pb-0">
      <OpenGraph
        url="https://acreos.io/tools/calculator"
        title={`${TITLE} — AcreOS`}
        description={DESCRIPTION}
      />
      <script
        type="application/ld+json"
        // The JSON is a literal constant defined above — safe to stringify.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }}
      />

      <header className="border-b border-border">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 sm:px-6 py-4">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            AcreOS
          </Link>
          <Link
            href="/auth?mode=register&utm_source=calculator&utm_medium=internal&utm_campaign=calculator_header"
            className="text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded"
          >
            Sign up
          </Link>
        </div>
      </header>

      <section className="border-b border-border bg-muted/30">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 py-8 sm:py-12">
          <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium">
            Free tool
          </p>
          <h1 className="mt-2 text-3xl sm:text-4xl font-bold leading-tight">
            Land Deal Calculator
          </h1>
          <p className="mt-3 max-w-2xl text-base sm:text-lg text-muted-foreground">
            Underwrite a land flip in seconds. Real math — ROI, annualized
            return, IRR via Newton-Raphson, and breakeven sale price.
          </p>
        </div>
      </section>

      <LandDealCalculator />
    </main>
  );
}
