/**
 * StateVerticalLandingPage — programmatic SEO surface for
 * /learn/<vertical>/<state>.
 *
 * Each page is a state×vertical primer for a land or note investor
 * who arrived from a long-tail search query ("texas land flipping
 * disclosure rule", "ohio note investing servicing license"). The
 * page is content-led, mechanics-first, and ships Schema.org markup
 * for Article, FAQPage, and BreadcrumbList so Google can render
 * rich-result cards for the FAQ items and the breadcrumb trail.
 *
 * Content lives in content/learn/<vertical>/<state>.json. Adding a
 * new state×vertical combination is a content-only PR — no code
 * change required, as long as the audit-learn-pages script passes.
 *
 * Voice rules (per feedback_landing_voice + team_soren):
 *   - Third-person, mechanics-first. No "I", no founder voice.
 *   - No fabricated testimonials, no investment-return promises.
 *   - Every numeric / statutory claim has a named source.
 *   - No competitor name-drops (Land Geek, GeekPay, etc.).
 *
 * Routing: mounted in App.tsx at /learn/:vertical/:state. The route is
 * public (no auth required) so search-engine crawlers can index it.
 */

import { useEffect, useMemo } from "react";
import { Link, useRoute } from "wouter";
import { ArrowLeft, ExternalLink } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { JsonLd } from "@/components/seo/JsonLd";
import { OpenGraph } from "@/components/seo/OpenGraph";
import { usePageMeta } from "@/hooks/use-document-title";
import { emitMarketingTouch } from "@/lib/marketing-touch";

import { getLearnContent, listLearnRoutes } from "./registry";
import type { LearnContent } from "./types";

const SITE_URL = "https://acreos.io";

function NotFoundForLearn() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <div className="max-w-md text-center space-y-4">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">
          Page not found
        </p>
        <h1 className="text-2xl font-semibold">No primer for that state yet</h1>
        <p className="text-muted-foreground">
          The state × vertical combination doesn’t have a primer published.
          The library is small on purpose — each page is hand-checked
          against named legal and market sources before it ships.
        </p>
        <div className="flex gap-2 justify-center">
          <Button asChild variant="default" data-testid="button-learn-back-home">
            <Link href="/">Back to AcreOS</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}

function buildSchema(content: LearnContent, canonicalUrl: string) {
  const article = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: content.headline,
    description: content.metaDescription,
    url: canonicalUrl,
    inLanguage: "en-US",
    isAccessibleForFree: true,
    publisher: {
      "@type": "Organization",
      name: "AcreOS",
      url: SITE_URL,
      logo: { "@type": "ImageObject", url: `${SITE_URL}/favicon.png` },
    },
    author: { "@type": "Organization", name: "AcreOS", url: SITE_URL },
    mainEntityOfPage: { "@type": "WebPage", "@id": canonicalUrl },
    about: [
      { "@type": "Thing", name: content.stateName },
      {
        "@type": "Thing",
        name:
          content.vertical === "land-flipping"
            ? "Land flipping"
            : "Note investing",
      },
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
      {
        "@type": "ListItem",
        position: 2,
        name: "Learn",
        item: `${SITE_URL}/learn`,
      },
      {
        "@type": "ListItem",
        position: 3,
        name:
          content.vertical === "land-flipping"
            ? "Land flipping"
            : "Note investing",
        item: `${SITE_URL}/learn/${content.vertical}`,
      },
      {
        "@type": "ListItem",
        position: 4,
        name: content.stateName,
        item: canonicalUrl,
      },
    ],
  } as const;

  return { article, faqPage, breadcrumbs };
}

// Wouter's useRoute generic requires `DefaultParams` shape (`{ [k: string]: string | undefined }`).
// The named fields below give us typed access; the index signature satisfies the constraint.
interface StateVerticalParams {
  vertical: string;
  state: string;
  [key: string]: string | undefined;
}

export default function StateVerticalLandingPage() {
  const [, params] = useRoute<StateVerticalParams>("/learn/:vertical/:state");
  const vertical = params?.vertical ?? "";
  const state = params?.state ?? "";

  const content = useMemo(() => getLearnContent(vertical, state), [vertical, state]);

  // Always call hooks unconditionally — render fallback after.
  usePageMeta(
    content?.headline ?? "Learn · AcreOS",
    content?.metaDescription ??
      "State-by-vertical primers for land and note investors.",
  );

  const allRoutes = useMemo(() => listLearnRoutes(), []);

  // Marketing-touch substrate — record a /learn page view keyed to the
  // artifact id (learn:<vertical>:<state>) so the per-artifact ROI rollup
  // (03-analytics.md §5) can attribute downstream signups to this primer.
  // Guarded by content so a 404 primer doesn't emit a phantom touch.
  useEffect(() => {
    if (!content) return;
    const artifactId = `learn:${content.vertical}:${content.stateSlug}`;
    emitMarketingTouch({
      surface: artifactId,
      eventType: "page_view",
      sourceArtifactId: artifactId,
    });
  }, [content]);

  if (!content) {
    return <NotFoundForLearn />;
  }

  const canonicalUrl = `${SITE_URL}/learn/${content.vertical}/${content.stateSlug}`;
  const schemas = buildSchema(content, canonicalUrl);

  const sameVerticalElsewhere = allRoutes.filter(
    (r) => r.vertical === content.vertical && r.state !== content.stateSlug,
  );
  const sameStateOtherVertical = allRoutes.filter(
    (r) => r.state === content.stateSlug && r.vertical !== content.vertical,
  );

  const verticalLabel =
    content.vertical === "land-flipping" ? "Land flipping" : "Note investing";

  return (
    <div className="min-h-screen bg-background">
      <OpenGraph
        url={canonicalUrl}
        title={`${content.headline} · AcreOS`}
        description={content.metaDescription}
        type="article"
      />
      <JsonLd id={`learn-article-${content.vertical}-${content.stateSlug}`} data={schemas.article} />
      <JsonLd id={`learn-faq-${content.vertical}-${content.stateSlug}`} data={schemas.faqPage} />
      <JsonLd id={`learn-breadcrumb-${content.vertical}-${content.stateSlug}`} data={schemas.breadcrumbs} />

      <div className="max-w-3xl mx-auto px-4 md:px-6 py-8 md:py-12 pb-24">
        <nav aria-label="Breadcrumb" className="mb-6">
          <Button asChild variant="ghost" size="sm" data-testid="button-learn-back">
            <Link href="/">
              <ArrowLeft className="w-4 h-4 mr-2" aria-hidden="true" />
              Back to AcreOS
            </Link>
          </Button>
        </nav>

        <header className="space-y-3 mb-8">
          <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium" data-testid="text-learn-eyebrow">
            {verticalLabel} · {content.stateName}
          </p>
          <h1
            className="text-3xl md:text-4xl font-semibold leading-tight tracking-tight"
            data-testid="text-learn-headline"
          >
            {content.headline}
          </h1>
          <p className="text-lg text-muted-foreground" data-testid="text-learn-intro">
            {content.intro}
          </p>
        </header>

        <section className="prose prose-neutral dark:prose-invert max-w-none mb-10" data-testid="section-learn-mechanics">
          <h2 className="text-2xl font-semibold mb-3">How it works in {content.stateName}</h2>
          <p className="text-base leading-relaxed whitespace-pre-wrap">
            {content.mechanics}
          </p>
        </section>

        <section className="mb-10" data-testid="section-learn-statutes">
          <h2 className="text-2xl font-semibold mb-4">Statutes that change the playbook</h2>
          <div className="space-y-4">
            {content.statutes.map((s, idx) => (
              <Card key={`statute-${idx}`} className="border-border/50">
                <CardContent className="p-5">
                  <h3 className="font-semibold mb-2">{s.headline}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {s.body}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        <section className="mb-10" data-testid="section-learn-gotchas">
          <h2 className="text-2xl font-semibold mb-4">State-specific gotchas</h2>
          <div className="space-y-4">
            {content.gotchas.map((g, idx) => (
              <Card key={`gotcha-${idx}`} className="border-border/50">
                <CardContent className="p-5">
                  <h3 className="font-semibold mb-2">{g.headline}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {g.body}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        <section className="mb-10" data-testid="section-learn-value">
          <h2 className="text-2xl font-semibold mb-3">What AcreOS does for {content.stateName} operators</h2>
          <p className="text-base leading-relaxed text-muted-foreground">
            {content.valueProp}
          </p>
          <div className="flex flex-col sm:flex-row gap-3 mt-5">
            <Button asChild size="lg" data-testid="button-learn-cta-primary">
              <Link href="/auth?mode=register">Try AcreOS free</Link>
            </Button>
            <Button asChild variant="outline" size="lg" data-testid="button-learn-cta-pricing">
              <Link href="/pricing">See pricing</Link>
            </Button>
          </div>
        </section>

        <section className="mb-10" data-testid="section-learn-faq">
          <h2 className="text-2xl font-semibold mb-4">Frequently asked</h2>
          <div className="space-y-5">
            {content.faq.map((f, idx) => (
              <div key={`faq-${idx}`}>
                <h3 className="font-semibold mb-1">{f.q}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{f.a}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mb-10" data-testid="section-learn-sources">
          <h2 className="text-xl font-semibold mb-3">Sources</h2>
          <ul className="space-y-2 text-sm text-muted-foreground">
            {content.sources.map((s, idx) => (
              <li key={`src-${idx}`} className="flex items-start gap-2">
                <span className="font-medium text-foreground">{s.name}</span>
                <span>·</span>
                {s.url ? (
                  <a
                    href={s.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="underline hover:text-foreground inline-flex items-center gap-1"
                  >
                    {s.citation}
                    <ExternalLink className="w-3 h-3" aria-hidden="true" />
                  </a>
                ) : (
                  <span>{s.citation}</span>
                )}
              </li>
            ))}
          </ul>
        </section>

        {(sameVerticalElsewhere.length > 0 || sameStateOtherVertical.length > 0) && (
          <section className="mb-10" data-testid="section-learn-related">
            <h2 className="text-xl font-semibold mb-3">Related primers</h2>
            {sameVerticalElsewhere.length > 0 && (
              <div className="mb-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground mb-2">
                  {verticalLabel} in other states
                </p>
                <ul className="space-y-1 text-sm">
                  {sameVerticalElsewhere.map((r) => (
                    <li key={`${r.vertical}-${r.state}`}>
                      <Link
                        href={`/learn/${r.vertical}/${r.state}`}
                        className="underline hover:no-underline"
                      >
                        {verticalLabel} in {r.stateName}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {sameStateOtherVertical.length > 0 && (
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground mb-2">
                  Other verticals in {content.stateName}
                </p>
                <ul className="space-y-1 text-sm">
                  {sameStateOtherVertical.map((r) => (
                    <li key={`${r.vertical}-${r.state}`}>
                      <Link
                        href={`/learn/${r.vertical}/${r.state}`}
                        className="underline hover:no-underline"
                      >
                        {r.vertical === "land-flipping"
                          ? "Land flipping"
                          : "Note investing"}{" "}
                        in {r.stateName}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <p className="text-xs text-muted-foreground mt-4">
              Field notes and longer writeups live on the{" "}
              <a
                href="https://acreos.substack.com"
                target="_blank"
                rel="noreferrer noopener"
                className="underline"
              >
                AcreOS Substack
              </a>
              .
            </p>
          </section>
        )}
      </div>
    </div>
  );
}
