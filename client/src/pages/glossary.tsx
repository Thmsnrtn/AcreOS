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
import { BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { SeoPageShell } from "@/components/seo/SeoPageShell";
import {
  getGlossaryEntry,
  useGlossaryData,
  type GlossaryData,
} from "@/lib/glossary-data";
import { JsonLd } from "@/components/seo/JsonLd";
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
function computeCrossReferences(
  glossary: GlossaryData,
): Record<string, CrossReference[]> {
  const refs: Record<string, CrossReference[]> = {};
  const slugs = Object.keys(glossary);
  for (const slug of slugs) {
    const entry = getGlossaryEntry(glossary, slug)!;
    refs[slug] = [];
    for (const otherSlug of slugs) {
      if (otherSlug === slug) continue;
      const other = getGlossaryEntry(glossary, otherSlug)!;
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

// metaTitle/description must mirror META_BY_PATH["/glossary"] in
// script/prerender.ts — crawlers get the prerendered head, then
// hydration re-asserts the same values (the shell appends " · AcreOS",
// yielding "Land investor glossary · AcreOS").
const META_TITLE = "Land investor glossary";
const META_DESCRIPTION =
  "Plain-English definitions of the vocabulary every Land Investor needs — yellow letter, skip trace, AVM, BPO, executory contract, balloon, escrow shortfall, and more.";

export default function GlossaryPage() {
  // Shell-first: the registry is served as /glossary.json (source of
  // truth client/src/lib/glossary.ts) instead of riding inside the
  // bundle. The shell renders immediately; the terms and the JSON-LD
  // land when the asset does, and a failed or wrong-shape load shows
  // a visible error, never a silently-empty page.
  const { data: glossary, error } = useGlossaryData();

  const entries = glossary
    ? Object.entries(glossary)
        .map(([slug, e]) => ({ slug, ...e }))
        .sort((a, b) => a.term.localeCompare(b.term))
    : [];

  const crossRefs = glossary ? computeCrossReferences(glossary) : {};

  // Group by first letter for the index — A/B/C section headers help
  // both human scanability and search-engine outline detection.
  const byLetter = entries.reduce<Record<string, typeof entries>>((acc, e) => {
    const letter = e.term.charAt(0).toUpperCase();
    (acc[letter] ||= []).push(e);
    return acc;
  }, {});

  const letters = Object.keys(byLetter).sort();

  return (
    <SeoPageShell
      title="Land Investor glossary"
      metaTitle={META_TITLE}
      description={META_DESCRIPTION}
      canonicalUrl={`${SITE.url}/glossary`}
      structuredData={
        glossary ? (
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
        ) : undefined
      }
      eyebrow={
        <p className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground font-medium">
          <BookOpen className="h-4 w-4" aria-hidden="true" />
          <span>Glossary</span>
        </p>
      }
      intro={
        <p className="text-lg text-muted-foreground max-w-2xl leading-relaxed">
          Land investing has dense vocabulary. Plain-English
          definitions for the {entries.length || ""} terms you'll see
          across AcreOS — and a handful you'll see on a closing
          statement, in a title commitment, or in your county appraisal
          portal.
        </p>
      }
    >
      <>
        {error && (
          <p role="alert" data-testid="glossary-load-error" className="mb-10 text-sm text-destructive">
            We couldn't load the glossary definitions. Check your
            connection and refresh to try again.
          </p>
        )}
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
      </>
    </SeoPageShell>
  );
}
