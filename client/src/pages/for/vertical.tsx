/**
 * ForVerticalPage — /for/<vertical> marketing page, one per registered
 * business type (G1.3).
 *
 * Renders PURELY from the two live registries:
 *   - shared/business-types.ts   (label, shortDescription, spotlightModules,
 *                                 integrations — the product truth)
 *   - client/src/lib/onboarding-verticals.ts (VERTICAL_ONBOARDING — the
 *                                 vertical's own vocabulary + finish surface)
 *
 * NOTHING vertical-specific is written in this file: no copy per id, no
 * hardcoded lists, no maturity badges (D-4: all 15 registered verticals are
 * CORE; any future maturity treatment must derive from the registry, never
 * from strings here). A registry change flows to every page automatically —
 * the derivation is a pure exported function (deriveForPage) pinned against
 * the live registry by tests/unit/forVerticalRoutes.test.ts, mirroring
 * landingVerticalTiers.test.ts.
 *
 * Slugs come from FOR_VERTICAL_SLUGS (shared/seo/public-routes.ts) — the same
 * map that enumerates these routes into the sitemap/robots pipeline, so a
 * page can never exist that the sitemap doesn't know about, or vice versa.
 *
 * These are public marketing routes — NOT customer navigation. The five
 * customer doors are untouched (CLAUDE.md).
 *
 * CTA discipline: primary CTA → /demo (the read-only demo workspace, G1.2);
 * secondary → signup. Voice: mechanics-first, third-person, no fabricated
 * numbers — every capability named here is a registry entry backed by a
 * routed surface (business-types.ts truth pass, 2026-07-29).
 */

import { useEffect, useMemo } from "react";
import { Link, useRoute } from "wouter";
import { ArrowLeft, ArrowRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { JsonLd } from "@/components/seo/JsonLd";
import { SeoPageShell } from "@/components/seo/SeoPageShell";
import { usePageMeta } from "@/hooks/use-document-title";
import { emitMarketingTouch } from "@/lib/marketing-touch";
import { SITE } from "@/lib/jsonld-schemas";
import { BUSINESS_TYPE_IDS } from "@shared/business-types";

// Pure derivation lives in ./derive (no React) so the unit test can pin it
// against the live registry under vitest's node environment.
import { deriveForPage } from "./derive";

const SITE_URL = SITE.url;

// ───────────────────────────────────────────────────────────────────────────
// Page
// ───────────────────────────────────────────────────────────────────────────

function NotFoundForVertical() {
  usePageMeta(
    "Who AcreOS is for",
    "One operating system for every registered property-investor vertical.",
  );
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <div className="max-w-md text-center space-y-4">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">
          Page not found
        </p>
        <h1 className="text-2xl font-semibold">No page for that vertical</h1>
        <p className="text-muted-foreground">
          Every registered vertical has a page — this URL doesn&apos;t match
          one. The full list lives on the landing page.
        </p>
        <Button asChild variant="default" data-testid="button-for-back-home">
          <Link href="/">Back to AcreOS</Link>
        </Button>
      </div>
    </div>
  );
}

interface ForVerticalParams {
  vertical: string;
  [key: string]: string | undefined;
}

export default function ForVerticalPage() {
  const [, params] = useRoute<ForVerticalParams>("/for/:vertical");
  const slug = params?.vertical ?? "";
  const content = useMemo(() => deriveForPage(slug), [slug]);

  // Marketing-touch substrate — keyed per artifact (for:<slug>) so the
  // per-artifact ROI rollup can attribute downstream signups to this page.
  // Guarded by content so a 404 slug doesn't emit a phantom touch.
  useEffect(() => {
    if (!content) return;
    const artifactId = `for:${content.slug}`;
    emitMarketingTouch({
      surface: artifactId,
      eventType: "page_view",
      sourceArtifactId: artifactId,
    });
  }, [content]);

  if (!content) {
    return <NotFoundForVertical />;
  }

  const canonicalUrl = `${SITE_URL}${content.path}`;
  const breadcrumbLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "AcreOS", item: SITE_URL },
      { "@type": "ListItem", position: 2, name: content.label, item: canonicalUrl },
    ],
  } as const;

  return (
    <SeoPageShell
      title={`AcreOS for ${content.headlineAudience}`}
      titleTestId="text-for-headline"
      metaTitle={`AcreOS for ${content.headlineAudience}`}
      description={`${content.label}: ${content.shortDescription} One operating system — pipeline, outreach, documents, and money in one place.`}
      canonicalUrl={canonicalUrl}
      structuredData={
        <JsonLd id={`for-breadcrumb-${content.slug}`} data={breadcrumbLd} />
      }
      breadcrumb={
        <Button asChild variant="ghost" size="sm" data-testid="button-for-back">
          <Link href="/">
            <ArrowLeft className="w-4 h-4 mr-2" aria-hidden="true" />
            Back to AcreOS
          </Link>
        </Button>
      }
      eyebrow={
        <p
          className="text-xs uppercase tracking-wide text-muted-foreground font-medium"
          data-testid="text-for-eyebrow"
        >
          {content.label} · one of the {BUSINESS_TYPE_IDS.length} verticals AcreOS runs
        </p>
      }
      intro={
        <p className="text-lg text-muted-foreground" data-testid="text-for-intro">
          {content.shortDescription} AcreOS keeps your {content.noun} — and the
          mail, replies, documents, and money around them — in one workspace.
        </p>
      }
    >
      <section className="mb-10" data-testid="section-for-finish">
        <h2 className="text-2xl font-semibold mb-3">Where your workspace opens</h2>
        <p className="text-base leading-relaxed text-muted-foreground">
          {content.finishBlurb}
        </p>
      </section>

      <section className="mb-10" data-testid="section-for-surfaces">
        <h2 className="text-2xl font-semibold mb-4">
          The surfaces built for this work
        </h2>
        <ul className="flex flex-wrap gap-2" role="list">
          {content.spotlights.map((s) => (
            <li
              key={s.id}
              className="rounded-full border border-border/60 px-3 py-1 text-sm text-foreground"
              data-testid={`chip-for-module-${s.id}`}
            >
              {s.label}
            </li>
          ))}
        </ul>
      </section>

      {content.integrations.length > 0 && (
        <section className="mb-10" data-testid="section-for-integrations">
          <h2 className="text-xl font-semibold mb-3">Connected rails</h2>
          <p className="text-sm text-muted-foreground mb-3">
            The integrations this vertical ships with today — nothing listed
            that isn&apos;t wired.
          </p>
          <ul className="flex flex-wrap gap-2" role="list">
            {content.integrations.map((i) => (
              <li
                key={i.id}
                className="rounded-full border border-border/60 px-3 py-1 text-sm text-muted-foreground"
              >
                {i.label}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mb-10" data-testid="section-for-cta">
        <Card className="border-border/50">
          <CardContent className="p-6">
            <h2 className="text-xl font-semibold mb-2">See it before you sign up</h2>
            <p className="text-sm text-muted-foreground mb-4">
              The live demo is a read-only workspace on labeled sample data —
              no email, no card. Or start your own workspace free.
            </p>
            <div className="flex flex-col sm:flex-row gap-3">
              <Button asChild size="lg" data-testid="button-for-cta-demo">
                <Link href="/demo">
                  Browse the live demo
                  <ArrowRight className="w-4 h-4 ml-2" aria-hidden="true" />
                </Link>
              </Button>
              <Button
                asChild
                variant="outline"
                size="lg"
                data-testid="button-for-cta-signup"
              >
                <Link href="/auth?mode=register">Start free — 14 days, no card</Link>
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mt-3">
              {content.finishCta.replace(/\s*→\s*$/, "")} — that&apos;s the first
              job onboarding hands you.{" "}
              <Link href="/pricing" className="underline hover:no-underline">
                See pricing
              </Link>
              .
            </p>
          </CardContent>
        </Card>
      </section>

      <section className="mb-10" data-testid="section-for-others">
        <h2 className="text-xl font-semibold mb-3">Run a different book?</h2>
        <ul className="flex flex-wrap gap-x-5 gap-y-2 text-sm" role="list">
          {content.others.map((o) => (
            <li key={o.id}>
              <Link href={o.path} className="underline hover:no-underline">
                {o.label}
              </Link>
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted-foreground mt-4">
          Free due diligence, no signup:{" "}
          <Link href="/tools/parcel-check" className="underline hover:no-underline">
            parcel check
          </Link>{" "}
          ·{" "}
          <Link href="/tools/calculator" className="underline hover:no-underline">
            land deal calculator
          </Link>{" "}
          ·{" "}
          <Link href="/learn" className="underline hover:no-underline">
            state &amp; county guides
          </Link>
        </p>
      </section>
    </SeoPageShell>
  );
}
