/**
 * CountyLandingPage — programmatic SEO surface for
 * /learn/county/<state>/<county>.
 *
 * Each page is a DATA-FIRST county primer for a land investor who arrived
 * from a long-tail county query ("cochise county az flood zones", "navajo
 * county vacant land soil"). Unlike the state×vertical primers (hand-authored
 * legal walkthroughs), a county page exists to render the verified free-data
 * rollup — flood prevalence, dominant SSURGO soils, elevation bands — so it
 * survives Google's helpful-content/spam filters that kill thin programmatic
 * pages. The generator (scripts/generate-county-pages.mjs) only emits a page
 * when the rollup clears the completeness bar, so every page here is real.
 *
 * Voice rules mirror state-vertical.tsx: third-person, mechanics-first, every
 * numeric/data claim carries a named source rendered inline (DataSnapshotBand
 * enforces source + asOf structurally).
 *
 * Routing: mounted in App.tsx at /learn/county/:state/:county. Public.
 */

import { useEffect, useMemo } from "react";
import { Link, useRoute } from "wouter";
import { ArrowLeft } from "lucide-react";

import { Button } from "@/components/ui/button";
import { JsonLd } from "@/components/seo/JsonLd";
import { SeoPageShell } from "@/components/seo/SeoPageShell";
import { usePageMeta } from "@/hooks/use-document-title";
import { emitMarketingTouch } from "@/lib/marketing-touch";
import { SITE } from "@/lib/jsonld-schemas";

import { getCountyContent } from "./county-registry";
import { DataSnapshotBand } from "./DataSnapshotBand";
import type { CountyLearnContent } from "./types";

const SITE_URL = SITE.url;

function CountyNotFound() {
  usePageMeta(
    "County data",
    "County-level free-data primers for land investors.",
  );
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <div className="max-w-md text-center space-y-4">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">
          Page not found
        </p>
        <h1 className="text-2xl font-semibold">No county primer yet</h1>
        <p className="text-muted-foreground">
          That county doesn’t have a published data primer. County pages only
          go live once the free-data rollup clears a completeness bar — we don’t
          ship a page we can’t back with real flood, soil, and elevation data.
        </p>
        <div className="flex gap-2 justify-center">
          <Button asChild variant="default" data-testid="button-county-back-home">
            <Link href="/">Back to AcreOS</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}

function buildCountySchema(content: CountyLearnContent, canonicalUrl: string) {
  const article = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: content.headline,
    description: content.metaDescription,
    url: canonicalUrl,
    inLanguage: "en-US",
    isAccessibleForFree: true,
    dateModified: content.generatedAt,
    publisher: {
      "@type": "Organization",
      name: "AcreOS",
      url: SITE_URL,
      logo: { "@type": "ImageObject", url: `${SITE_URL}/favicon.png` },
    },
    author: { "@type": "Organization", name: "AcreOS", url: SITE_URL },
    mainEntityOfPage: { "@type": "WebPage", "@id": canonicalUrl },
    spatialCoverage: {
      "@type": "AdministrativeArea",
      name: `${content.countyName} County, ${content.stateName}`,
      geo: {
        "@type": "GeoCoordinates",
        latitude: content.centroid.latitude,
        longitude: content.centroid.longitude,
      },
    },
    about: [
      { "@type": "Thing", name: `${content.countyName} County` },
      { "@type": "Thing", name: content.stateName },
      { "@type": "Thing", name: "Vacant land due diligence" },
    ],
  } as const;

  const faqPage = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: content.faq.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  } as const;

  const breadcrumbs = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "AcreOS", item: SITE_URL },
      { "@type": "ListItem", position: 2, name: "Learn", item: `${SITE_URL}/learn` },
      {
        "@type": "ListItem",
        position: 3,
        name: content.stateName,
        item: `${SITE_URL}/learn/county/${content.stateSlug}`,
      },
      {
        "@type": "ListItem",
        position: 4,
        name: `${content.countyName} County`,
        item: canonicalUrl,
      },
    ],
  } as const;

  return { article, faqPage, breadcrumbs };
}

interface CountyParams {
  state: string;
  county: string;
  [key: string]: string | undefined;
}

export default function CountyLandingPage() {
  const [, params] = useRoute<CountyParams>("/learn/county/:state/:county");
  const state = params?.state ?? "";
  const county = params?.county ?? "";

  const content = useMemo(() => getCountyContent(state, county), [state, county]);

  // Title/description/OG/canonical are handled by SeoPageShell in the
  // found branch; CountyNotFound sets its own fallback meta.
  useEffect(() => {
    if (!content) return;
    const artifactId = `learn-county:${content.stateSlug}:${content.countySlug}`;
    emitMarketingTouch({
      surface: artifactId,
      eventType: "page_view",
      sourceArtifactId: artifactId,
    });
  }, [content]);

  if (!content) {
    return <CountyNotFound />;
  }

  const canonicalUrl = `${SITE_URL}/learn/county/${content.stateSlug}/${content.countySlug}`;
  const schemas = buildCountySchema(content, canonicalUrl);
  const placeName = `${content.countyName} County`;

  return (
    <SeoPageShell
      title={content.headline}
      titleTestId="text-county-headline"
      description={content.metaDescription}
      canonicalUrl={canonicalUrl}
      ogType="article"
      structuredData={
        <>
          <JsonLd id={`county-article-${content.stateSlug}-${content.countySlug}`} data={schemas.article} />
          <JsonLd id={`county-faq-${content.stateSlug}-${content.countySlug}`} data={schemas.faqPage} />
          <JsonLd id={`county-breadcrumb-${content.stateSlug}-${content.countySlug}`} data={schemas.breadcrumbs} />
        </>
      }
      breadcrumb={
        <Button asChild variant="ghost" size="sm" data-testid="button-county-back">
          <Link href="/">
            <ArrowLeft className="w-4 h-4 mr-2" aria-hidden="true" />
            Back to AcreOS
          </Link>
        </Button>
      }
      eyebrow={
        <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium" data-testid="text-county-eyebrow">
          {placeName} · {content.stateName}
        </p>
      }
      intro={
        <p className="text-lg text-muted-foreground" data-testid="text-county-intro">
          {content.intro}
        </p>
      }
    >
      <DataSnapshotBand snapshot={content.dataSnapshot} placeName={placeName} />

        <section className="mb-10" data-testid="section-county-tools">
          <h2 className="text-xl font-semibold mb-3">Run it on a specific parcel</h2>
          <p className="text-sm text-muted-foreground mb-3">
            The figures above are a {placeName} reference read. To see the same
            checks on one parcel — no signup — paste an address or APN into the
            free parcel tool. It pulls from the same public government data.
          </p>
          <nav aria-label="Free tools" className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
            <Link href="/tools/parcel-check" className="text-primary underline hover:text-foreground">
              Free Parcel Check — flood, soil, elevation, wetlands
            </Link>
            <Link href="/tools/calculator" className="text-primary underline hover:text-foreground">
              Land Deal Calculator
            </Link>
          </nav>
        </section>

        <section className="mb-10" data-testid="section-county-faq">
          <h2 className="text-2xl font-semibold mb-4">Frequently asked</h2>
          <div className="space-y-5">
            {content.faq.map((f, idx) => (
              <div key={`county-faq-${idx}`}>
                <h3 className="font-semibold mb-1">{f.q}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{f.a}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mb-10" data-testid="section-county-value">
          <h2 className="text-2xl font-semibold mb-3">
            Automate this across your {content.stateName} buy-box
          </h2>
          <p className="text-base leading-relaxed text-muted-foreground">
            AcreOS runs flood, soil, elevation, and wetlands checks on every
            parcel from free government data — so a {placeName} list pull arrives
            already screened on the diligence that kills resale. You only reach
            for paid data providers once your deal volume earns it.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 mt-5">
            <Button asChild size="lg" data-testid="button-county-cta-primary">
              <Link href="/auth?mode=register">Try AcreOS free</Link>
            </Button>
            <Button asChild variant="outline" size="lg" data-testid="button-county-cta-pricing">
              <Link href="/pricing">See pricing</Link>
            </Button>
          </div>
        </section>

        <section className="mb-10" data-testid="section-county-sources">
          <h2 className="text-xl font-semibold mb-3">Sources</h2>
          <ul className="space-y-2 text-sm text-muted-foreground">
            {content.sources.map((s, idx) => (
              <li key={`county-src-${idx}`} className="flex items-start gap-2">
                <span className="font-medium text-foreground">{s.name}</span>
                <span>·</span>
                {s.url ? (
                  <a
                    href={s.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="underline hover:text-foreground"
                  >
                    {s.citation}
                  </a>
                ) : (
                  <span>{s.citation}</span>
                )}
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground mt-4">
            Rollup generated {content.generatedAt.slice(0, 10)}. Figures are a
            county-level reference read and do not replace a parcel-level lookup.
          </p>
        </section>
    </SeoPageShell>
  );
}
