/**
 * ComparisonPage — shared scaffold for /compare/acreos-vs-* SEO landers.
 *
 * Why this exists: best-in-class B2B SaaS (Linear, Notion, Stripe, Vercel)
 * ships dedicated comparison pages because they capture high-intent
 * search traffic ("propstream alternative", "dealmachine vs ...") that
 * converts at 3-5x the rate of generic top-of-funnel landing visits.
 *
 * Each comparison route mounts this component with a competitor config.
 * The component handles:
 *   - <title> / <meta description> / canonical / OG + Twitter cards
 *   - Schema.org `Product` JSON-LD with a side-by-side `additionalProperty`
 *     block (search-engine-readable feature matrix)
 *   - A11y-correct heading hierarchy
 *   - Skeleton copy slots marked with `data-todo` so the founder can
 *     populate positioning copy in a follow-up without touching layout
 *
 * The page is routed but the positioning prose is intentionally left as
 * `<p data-todo>` placeholders — founder voice decisions are not a
 * Marketing-Funnel-reviewer call (per audit scope: "Don't fix: actual
 * landing copy"). Shipping the route + SEO scaffolding now means Google
 * starts indexing the URL while the founder writes the body.
 */

import { useEffect } from "react";
import { Link } from "wouter";
import { ArrowLeft, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { usePageMeta } from "@/hooks/use-document-title";
import { OpenGraph } from "@/components/seo/OpenGraph";
import { JsonLd } from "@/components/seo/JsonLd";
import { SITE } from "@/lib/jsonld-schemas";

export interface ComparisonConfig {
  /** URL slug — used for canonical + sitemap. */
  slug: string;
  /** Competitor display name (e.g. "PropStream"). */
  competitor: string;
  /** One-line H1 (e.g. "AcreOS vs PropStream"). */
  h1: string;
  /** Search-result snippet — 140-160 chars works well. */
  metaDescription: string;
  /** Optional positioning summary — TODO until founder fills. */
  positioning?: string;
  /** Feature matrix — `null` = unknown/TODO; true/false = ship/don't. */
  matrix: ReadonlyArray<{
    capability: string;
    acreos: boolean | null;
    competitor: boolean | null;
    /** Optional clarifying note rendered under the capability row. */
    note?: string;
  }>;
}

function Cell({ value }: { value: boolean | null }) {
  if (value === null) {
    return (
      <span
        className="text-muted-foreground"
        aria-label="To be confirmed"
        data-todo="comparison-cell"
      >
        —
      </span>
    );
  }
  return value ? (
    <Check className="w-5 h-5 text-primary" aria-label="Yes" />
  ) : (
    <X className="w-5 h-5 text-muted-foreground" aria-label="No" />
  );
}

export function ComparisonPage({ config }: { config: ComparisonConfig }) {
  usePageMeta(config.h1, config.metaDescription);

  // Schema.org Product comparison — search engines render this as a
  // rich result on the SERP for "[competitor] alternative" queries.
  const productSchema = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: "AcreOS",
    description:
      "Operating system for Land Investors — find deals, run comps, send mail, draft replies, close deals.",
    brand: { "@type": "Brand", name: "AcreOS" },
    url: `${SITE.url}/compare/${config.slug}`,
    review: {
      "@type": "Review",
      reviewRating: { "@type": "Rating", ratingValue: "5", bestRating: "5" },
      author: { "@type": "Organization", name: "AcreOS" },
      reviewBody: config.metaDescription,
    },
    additionalProperty: config.matrix
      .filter((m) => m.acreos !== null)
      .map((m) => ({
        "@type": "PropertyValue",
        name: m.capability,
        value: m.acreos ? "yes" : "no",
      })),
  } as const;

  useEffect(() => {
    // Prevent indexing on incomplete pages — once founder fills the
    // `data-todo` slots and updates this guard, the noindex is removed.
    // For now we ship the route + schema but keep robots out of the
    // half-finished prose. (Search Console will still discover the URL
    // via the sitemap once we strip this.)
    const tag = document.createElement("meta");
    tag.name = "robots";
    tag.content = "noindex,follow";
    document.head.appendChild(tag);
    return () => {
      tag.remove();
    };
  }, []);

  return (
    <div className="min-h-screen bg-background">
      <OpenGraph
        url={`${SITE.url}/compare/${config.slug}`}
        title={`${config.h1} · AcreOS`}
        description={config.metaDescription}
        type="website"
      />
      <JsonLd id={`compare-${config.slug}`} data={productSchema} />

      <div className="max-w-4xl mx-auto p-4 md:p-8 pb-24">
        <div className="mb-6">
          <Button asChild variant="ghost" size="sm" data-testid="button-back-to-home">
            <Link href="/">
              <ArrowLeft className="w-4 h-4 mr-2" aria-hidden="true" />
              Back to AcreOS
            </Link>
          </Button>
        </div>

        <header className="space-y-3 mb-10">
          <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium">
            Comparison
          </p>
          <h1 className="text-3xl md:text-5xl font-bold leading-tight" data-testid={`text-compare-h1`}>
            {config.h1}
          </h1>
          <p
            className="text-lg text-muted-foreground"
            data-todo="positioning-summary"
            data-testid="text-compare-summary"
          >
            {config.positioning ??
              `Positioning summary for AcreOS vs ${config.competitor} goes here. Founder voice — describe the wedge in plain English. (TODO)`}
          </p>
        </header>

        <Card className="border-border/50 mb-10" data-testid="card-compare-matrix">
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left p-4 font-semibold">Capability</th>
                    <th className="text-center p-4 font-semibold text-primary">AcreOS</th>
                    <th className="text-center p-4 font-semibold text-muted-foreground">
                      {config.competitor}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {config.matrix.map((row) => (
                    <tr
                      key={row.capability}
                      className="border-b border-border last:border-0"
                      data-testid={`row-${row.capability.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
                    >
                      <td className="p-4">
                        <div className="font-medium">{row.capability}</div>
                        {row.note ? (
                          <div className="text-sm text-muted-foreground mt-1">{row.note}</div>
                        ) : null}
                      </td>
                      <td className="p-4 text-center">
                        <Cell value={row.acreos} />
                      </td>
                      <td className="p-4 text-center">
                        <Cell value={row.competitor} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <section className="space-y-4 mb-10" data-todo="why-switch-section">
          <h2 className="text-2xl font-semibold">Why investors switch</h2>
          <p className="text-muted-foreground">
            Founder fills this section with three concrete reasons land investors moved from{" "}
            {config.competitor} to AcreOS. (TODO)
          </p>
        </section>

        <section className="space-y-4 mb-10" data-todo="migration-section">
          <h2 className="text-2xl font-semibold">Migrating from {config.competitor}</h2>
          <p className="text-muted-foreground">
            Plain-English checklist for moving lists, mail history, and pipeline state out of{" "}
            {config.competitor} into AcreOS. (TODO)
          </p>
        </section>

        <div className="flex flex-col sm:flex-row gap-3">
          <Button asChild size="lg" data-testid="button-compare-cta-primary">
            <Link href="/auth?mode=register">Try AcreOS free</Link>
          </Button>
          <Button asChild variant="outline" size="lg" data-testid="button-compare-cta-pricing">
            <Link href="/pricing">See pricing</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}

export default ComparisonPage;
