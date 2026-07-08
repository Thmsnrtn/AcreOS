/**
 * /learn — the Learn hub.
 *
 * The deep programmatic-SEO pages (/learn/:vertical/:state state primers and
 * /learn/county/:state/:county data primers) existed but were orphaned: no
 * index, no footer link, so neither crawlers nor humans had a path to them.
 * This hub is that path — a single crawlable surface that lists every authored
 * vertical primer and county primer from the build-time registries.
 *
 * Voice/house rules (same as the deep pages): third-person, mechanics-first,
 * "Land Investors" framing, customer AI brand is "Pax" only, no hex literals
 * (design tokens only), one h1 (the shell title slot).
 *
 * Purely presentational — both registries resolve at build time
 * (import.meta.glob eager), so there is no data fetch and no async state here.
 */

import { useEffect, useMemo } from "react";
import { Link } from "wouter";
import { ArrowLeft, MapPin } from "lucide-react";

import { Button } from "@/components/ui/button";
import { JsonLd } from "@/components/seo/JsonLd";
import { SeoPageShell } from "@/components/seo/SeoPageShell";
import { EmptyState } from "@/components/empty-state";
import { emitMarketingTouch } from "@/lib/marketing-touch";
import { SITE } from "@/lib/jsonld-schemas";

import { listLearnRoutes } from "./registry";
import { listCountyRoutes } from "./county-registry";
import type { LearnVertical } from "./types";

const SITE_URL = SITE.url;
const CANONICAL_URL = `${SITE_URL}/learn`;

const VERTICAL_LABELS: Record<LearnVertical, string> = {
  "land-flipping": "Land flipping",
  "note-investing": "Note investing",
};

function verticalLabel(vertical: string): string {
  return VERTICAL_LABELS[vertical as LearnVertical] ?? vertical;
}

export default function LearnHubPage() {
  // State×vertical primers grouped by vertical, then a flat county list grouped
  // by state — both already sorted alphabetically by their registries.
  const verticalGroups = useMemo(() => {
    const routes = listLearnRoutes();
    const groups = new Map<
      string,
      Array<{ state: string; stateName: string; headline: string }>
    >();
    for (const r of routes) {
      const list = groups.get(r.vertical) ?? [];
      list.push({ state: r.state, stateName: r.stateName, headline: r.headline });
      groups.set(r.vertical, list);
    }
    return Array.from(groups.entries()).sort((a, b) =>
      verticalLabel(a[0]).localeCompare(verticalLabel(b[0])),
    );
  }, []);

  const countyGroups = useMemo(() => {
    const routes = listCountyRoutes();
    const groups = new Map<
      string,
      { stateName: string; counties: Array<{ countySlug: string; countyName: string }> }
    >();
    for (const r of routes) {
      const g = groups.get(r.stateSlug) ?? { stateName: r.stateName, counties: [] };
      g.counties.push({ countySlug: r.countySlug, countyName: r.countyName });
      groups.set(r.stateSlug, g);
    }
    return Array.from(groups.entries())
      .map(([stateSlug, g]) => ({ stateSlug, ...g }))
      .sort((a, b) => a.stateName.localeCompare(b.stateName));
  }, []);

  const hasContent = verticalGroups.length > 0 || countyGroups.length > 0;

  useEffect(() => {
    emitMarketingTouch({
      surface: "learn-hub",
      eventType: "page_view",
      sourceArtifactId: "learn-hub",
    });
  }, []);

  const breadcrumbSchema = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "AcreOS", item: SITE_URL },
      { "@type": "ListItem", position: 2, name: "Learn", item: CANONICAL_URL },
    ],
  } as const;

  return (
    <SeoPageShell
      title="Learn — land due diligence by state and county"
      titleTestId="text-learn-hub-headline"
      metaTitle="Learn — land due diligence guides for Land Investors"
      description="Mechanics-first primers for Land Investors: state-by-state legal walkthroughs and county-level free-data reads on flood, soil, elevation, and wetlands."
      canonicalUrl={CANONICAL_URL}
      width="wide"
      structuredData={<JsonLd id="learn-hub-breadcrumb" data={breadcrumbSchema} />}
      breadcrumb={
        <Button asChild variant="ghost" size="sm" data-testid="button-learn-hub-back">
          <Link href="/">
            <ArrowLeft className="w-4 h-4 mr-2" aria-hidden="true" />
            Back to AcreOS
          </Link>
        </Button>
      }
      eyebrow={
        <p
          className="text-xs uppercase tracking-wide text-muted-foreground font-medium"
          data-testid="text-learn-hub-eyebrow"
        >
          Learn
        </p>
      }
      intro={
        <p className="text-lg text-muted-foreground" data-testid="text-learn-hub-intro">
          Plain-English reads on how land investing works where the rules and the
          ground actually differ — by state law and by county data. Every figure is
          public government data with a named source; every legal note cites the
          statute. No signup to read.
        </p>
      }
    >
      {!hasContent ? (
        <EmptyState
          icon={MapPin}
          headline="Guides are on the way"
          subtitle="State and county primers publish as their underlying free-data rollups clear the completeness bar. In the meantime, run a parcel on the free tools."
          cta={{
            label: "Try the free Parcel Check",
            href: "/tools/parcel-check",
            "data-testid": "learn-hub-empty-cta",
          }}
          actionIcon={null}
          testId="learn-hub-empty"
        />
      ) : (
        <div className="space-y-12">
          {verticalGroups.length > 0 && (
            <section aria-labelledby="learn-verticals-heading" data-testid="section-learn-verticals">
              <h2
                id="learn-verticals-heading"
                className="text-2xl font-semibold mb-2"
              >
                State primers
              </h2>
              <p className="text-sm text-muted-foreground mb-6">
                How a strategy operates under one state's statutes — redemption
                clocks, recording rules, and licensing, walked through for Land
                Investors.
              </p>
              <div className="space-y-8">
                {verticalGroups.map(([vertical, states]) => (
                  <div key={vertical} data-testid={`learn-vertical-${vertical}`}>
                    <h3 className="text-lg font-semibold mb-3">
                      {verticalLabel(vertical)}
                    </h3>
                    <ul className="grid gap-x-8 gap-y-2 sm:grid-cols-2">
                      {states.map((s) => (
                        <li key={`${vertical}-${s.state}`}>
                          <Link
                            href={`/learn/${vertical}/${s.state}`}
                            className="text-primary underline hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded inline-flex min-h-11 items-center"
                            data-testid={`link-learn-${vertical}-${s.state}`}
                          >
                            {verticalLabel(vertical)} in {s.stateName}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </section>
          )}

          {countyGroups.length > 0 && (
            <section aria-labelledby="learn-counties-heading" data-testid="section-learn-counties">
              <h2
                id="learn-counties-heading"
                className="text-2xl font-semibold mb-2"
              >
                County data primers
              </h2>
              <p className="text-sm text-muted-foreground mb-6">
                A county-by-county read of the free government data that screens a
                deal — flood prevalence, dominant soils, and elevation bands —
                pulled from FEMA, USDA, and USGS.
              </p>
              <div className="space-y-6">
                {countyGroups.map((g) => (
                  <div key={g.stateSlug} data-testid={`learn-county-state-${g.stateSlug}`}>
                    <h3 className="text-lg font-semibold mb-3">{g.stateName}</h3>
                    <ul className="grid gap-x-8 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
                      {g.counties.map((c) => (
                        <li key={`${g.stateSlug}-${c.countySlug}`}>
                          <Link
                            href={`/learn/county/${g.stateSlug}/${c.countySlug}`}
                            className="text-primary underline hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded inline-flex min-h-11 items-center"
                            data-testid={`link-learn-county-${g.stateSlug}-${c.countySlug}`}
                          >
                            {c.countyName} County
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section
            className="rounded-lg border border-border bg-muted/30 p-6"
            data-testid="section-learn-cta"
          >
            <h2 className="text-xl font-semibold">Run it on a real parcel</h2>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              The guides are the reference read. To see flood, soil, elevation, and
              wetlands on one parcel — from the same public government data, no
              signup — use the free Parcel Check, or open a saved public parcel
              report. Pax fills in the rest inside AcreOS.
            </p>
            <nav
              aria-label="Free tools"
              className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm"
            >
              <Link
                href="/tools/parcel-check"
                className="text-primary underline hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded inline-flex min-h-11 items-center"
                data-testid="link-learn-parcel-check"
              >
                Free Parcel Check
              </Link>
              <Link
                href="/land-credit-score"
                className="text-primary underline hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded inline-flex min-h-11 items-center"
                data-testid="link-learn-land-credit-score"
              >
                The Land Credit Score
              </Link>
            </nav>
          </section>
        </div>
      )}
    </SeoPageShell>
  );
}
