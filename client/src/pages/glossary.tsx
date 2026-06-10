/**
 * GlossaryPage — public, MDN-tier definitions for the dense vocabulary
 * Land Investors run into (yellow letter, skip trace, AVM, §5.069, etc.).
 *
 * Doubles as a long-tail SEO target: each definition is anchor-linked
 * (`#yellow_letter`, `#skip_trace`, …) and surfaced via JSON-LD
 * `DefinedTermSet` so search engines can show definition rich-results.
 *
 * Source of truth is `client/src/lib/glossary.ts` — the same registry
 * powering inline `<GlossaryTerm>` tooltips throughout the app. Editing
 * a definition there updates this page automatically.
 */
import { Link } from "wouter";
import { ArrowLeft, BookOpen } from "lucide-react";
import { AcreosLogo } from "@/components/acreos-logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { SkipToContent } from "@/components/skip-to-content";
import { PublicFooter } from "@/components/public-footer";
import { usePageMeta } from "@/hooks/use-document-title";
import { GLOSSARY } from "@/lib/glossary";
import { JsonLd } from "@/components/seo/JsonLd";
import { OpenGraph } from "@/components/seo/OpenGraph";
import { glossarySchema, SITE } from "@/lib/jsonld-schemas";

interface CrossReference {
  slug: string;
  term: string;
}

/**
 * For each glossary term, surface other terms whose definition mentions
 * the same term — gives the reader a why-this-matters cross-link path
 * and is a meaningful internal-linking SEO signal.
 */
function computeCrossReferences(): Record<string, CrossReference[]> {
  const refs: Record<string, CrossReference[]> = {};
  const slugs = Object.keys(GLOSSARY);
  for (const slug of slugs) {
    const entry = GLOSSARY[slug];
    refs[slug] = [];
    for (const otherSlug of slugs) {
      if (otherSlug === slug) continue;
      const other = GLOSSARY[otherSlug];
      // Match whole-word, case-insensitive.
      const escaped = other.term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const pattern = new RegExp(`\\b${escaped}\\b`, "i");
      if (pattern.test(entry.definition)) {
        refs[slug].push({ slug: otherSlug, term: other.term });
      }
    }
  }
  return refs;
}

export default function GlossaryPage() {
  // Title/description must mirror META_BY_PATH["/glossary"] in
  // script/prerender.ts — crawlers get the prerendered head, then
  // hydration re-asserts the same values (useDocumentTitle appends
  // " · AcreOS", yielding "Land investor glossary · AcreOS").
  usePageMeta(
    "Land investor glossary",
    "Plain-English definitions of the vocabulary every Land Investor needs — yellow letter, skip trace, AVM, BPO, executory contract, balloon, escrow shortfall, and more.",
  );

  const entries = Object.entries(GLOSSARY)
    .map(([slug, e]) => ({ slug, ...e }))
    .sort((a, b) => a.term.localeCompare(b.term));

  const crossRefs = computeCrossReferences();

  // Group by first letter for the index — A/B/C section headers help
  // both human scanability and search-engine outline detection.
  const byLetter = entries.reduce<Record<string, typeof entries>>((acc, e) => {
    const letter = e.term.charAt(0).toUpperCase();
    (acc[letter] ||= []).push(e);
    return acc;
  }, {});

  const letters = Object.keys(byLetter).sort();

  return (
    <div className="min-h-screen bg-background">
      <SkipToContent />

      <OpenGraph
        url={`${SITE.url}/glossary`}
        title="Land investor glossary · AcreOS"
        description="Plain-English definitions of the vocabulary every Land Investor needs — yellow letter, skip trace, AVM, BPO, executory contract, balloon, escrow shortfall, and more."
        type="website"
      />
      <JsonLd
        id="glossary-defined-term-set"
        data={glossarySchema(
          entries.map((e) => ({
            slug: e.slug,
            term: e.term,
            definition: e.definition,
          })),
        )}
      />

      <nav className="border-b bg-background/95 backdrop-blur sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link
            href="/"
            className="flex items-center gap-2 hover:opacity-80 transition-opacity min-h-11 py-1"
            aria-label="Back to AcreOS home"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            <AcreosLogo size={30} />
          </Link>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Button asChild>
              <Link href="/auth?mode=register" className="min-h-11">
                Get started
              </Link>
            </Button>
          </div>
        </div>
      </nav>

      <main id="main-content" className="max-w-3xl mx-auto px-6 py-16">
        <header className="mb-10 space-y-3">
          <div className="flex items-center gap-2 text-muted-foreground text-sm">
            <BookOpen className="h-4 w-4" aria-hidden="true" />
            <span>Glossary</span>
          </div>
          <h1 className="text-4xl font-bold">Land Investor glossary</h1>
          <p className="text-muted-foreground max-w-2xl leading-relaxed">
            Land investing has dense vocabulary. Plain-English
            definitions for the {entries.length} terms you'll see across
            AcreOS — and a handful you'll see on a closing statement, in
            a title commitment, or in your county appraisal portal.
          </p>
        </header>

        {/* A-Z jump nav */}
        <nav
          aria-label="Jump to letter"
          className="mb-10 flex flex-wrap gap-1 text-sm"
        >
          {letters.map((letter) => (
            <a
              key={letter}
              href={`#letter-${letter}`}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border bg-card hover:bg-accent hover:text-accent-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {letter}
            </a>
          ))}
        </nav>

        <div className="space-y-12">
          {letters.map((letter) => (
            <section
              key={letter}
              id={`letter-${letter}`}
              aria-labelledby={`letter-heading-${letter}`}
            >
              <h2
                id={`letter-heading-${letter}`}
                className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-4"
              >
                {letter}
              </h2>
              <ul
                className="space-y-4"
                aria-label={`Terms starting with ${letter}`}
              >
                {byLetter[letter].map((entry) => (
                  <li
                    key={entry.slug}
                    id={entry.slug}
                    className="scroll-mt-20"
                  >
                    <Card>
                      <CardContent className="pt-6 space-y-3">
                        <div className="flex items-baseline gap-3 flex-wrap">
                          <h3 className="text-xl font-semibold">
                            {entry.term}
                          </h3>
                          <a
                            href={`#${entry.slug}`}
                            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                            aria-label={`Anchor link for ${entry.term}`}
                          >
                            #{entry.slug}
                          </a>
                        </div>
                        <p className="text-sm leading-relaxed">
                          {entry.definition}
                        </p>
                        {crossRefs[entry.slug]?.length > 0 && (
                          <div className="pt-2 border-t border-border/60 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                            <span>See also:</span>
                            {crossRefs[entry.slug].map((ref, i) => (
                              <span key={ref.slug}>
                                <a
                                  href={`#${ref.slug}`}
                                  className="text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
                                >
                                  {ref.term}
                                </a>
                                {i < crossRefs[entry.slug].length - 1 && ", "}
                              </span>
                            ))}
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        <aside className="mt-16 rounded-card border bg-card p-6 space-y-3">
          <h2 className="text-lg font-semibold">
            Want to see these in context?
          </h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            AcreOS surfaces a definition tooltip for every prominent term
            inside the product — hover any underlined word in a deal record,
            buy-box editor, or compliance checklist.
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            <Button asChild>
              <Link href="/auth?mode=register">Start free trial</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/pricing">See pricing</Link>
            </Button>
          </div>
        </aside>
      </main>

      <PublicFooter />
    </div>
  );
}
