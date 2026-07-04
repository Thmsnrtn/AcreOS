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
 *   - <title> / <meta description> / canonical / OG + Twitter cards /
 *     noindex guard — all via the shared SeoPageShell
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

import { Link } from "wouter";
import { ArrowLeft, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { SeoPageShell } from "@/components/seo/SeoPageShell";
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

  return (
    <SeoPageShell
      title={config.h1}
      titleTestId="text-compare-h1"
      description={config.metaDescription}
      canonicalUrl={`${SITE.url}/compare/${config.slug}`}
      // Prose is real (2026-07 sweep) but the competitor matrix columns are
      // deliberately blank until the founder verifies each claim against the
      // competitor's CURRENT product — we don't publish guessed feature
      // claims. Remove this noindex (and the matching flag in
      // serverHead.headForCompare) once the matrices are filled.
      noindex
      width="wide"
      structuredData={<JsonLd id={`compare-${config.slug}`} data={productSchema} />}
      breadcrumb={
        <Button asChild variant="ghost" size="sm" data-testid="button-back-to-home">
          <Link href="/">
            <ArrowLeft className="w-4 h-4 mr-2" aria-hidden="true" />
            Back to AcreOS
          </Link>
        </Button>
      }
      eyebrow={
        <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium">
          Comparison
        </p>
      }
      intro={
        <p
          className="text-lg text-muted-foreground"
          data-testid="text-compare-summary"
        >
          {config.positioning ??
            `AcreOS is built for one loop: pull county data, mail the right owners, capture every seller response, and turn it into an offer — with an autopilot that runs the busywork. Below is how that stacks up against ${config.competitor}, capability by capability. Where we haven't verified ${config.competitor}'s current feature, the cell is left blank rather than guessed.`}
        </p>
      }
    >
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

      <section className="space-y-4 mb-10">
        <h2 className="text-2xl font-semibold">What you get with AcreOS</h2>
        <ul className="space-y-3 text-muted-foreground list-disc pl-5">
          <li>
            <span className="font-medium text-foreground">The whole loop in one place.</span>{" "}
            County data → targeted mail → seller responses captured automatically (SMS and
            email land on the lead, not in a separate inbox) → offer out the door. No
            stitching three tools together.
          </li>
          <li>
            <span className="font-medium text-foreground">Numbers that refuse to lie.</span>{" "}
            Valuations come from comparable sales or a trained model — and when there isn't
            enough data, AcreOS says "not enough data" instead of inventing a figure you might
            bid real money on.
          </li>
          <li>
            <span className="font-medium text-foreground">An autopilot, not just a database.</span>{" "}
            Pax drafts replies, watches your pipeline, and queues next actions — everything
            outbound waits for your explicit approval before it leaves the building.
          </li>
        </ul>
      </section>

      <section className="space-y-4 mb-10">
        <h2 className="text-2xl font-semibold">Migrating from {config.competitor}</h2>
        <ol className="space-y-3 text-muted-foreground list-decimal pl-5">
          <li>
            Export your owner/lead lists from {config.competitor} as CSV — AcreOS imports
            standard CSVs directly on the Leads page (names, addresses, phones, and any
            custom columns map on import).
          </li>
          <li>
            Bring notes on past mail touches as a column in the same CSV; they land on each
            lead's timeline so your response history isn't lost.
          </li>
          <li>
            Recreate in-flight deals on the pipeline — most investors move active deals in
            under an hour, and your first mail batch can go out the same day.
          </li>
        </ol>
      </section>

      <div className="flex flex-col sm:flex-row gap-3">
        <Button asChild size="lg" data-testid="button-compare-cta-primary">
          <Link href="/auth?mode=register">Try AcreOS free</Link>
        </Button>
        <Button asChild variant="outline" size="lg" data-testid="button-compare-cta-pricing">
          <Link href="/pricing">See pricing</Link>
        </Button>
      </div>
    </SeoPageShell>
  );
}

export default ComparisonPage;
