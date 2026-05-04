/**
 * ChangelogPage — public, curated, customer-facing.
 *
 * Reads from `client/src/data/customer-changelog.ts` (manually edited
 * before each release) instead of the dev CHANGELOG.md, which is too
 * noisy: it includes ticket IDs, file paths, regex counts, and
 * occasionally CVE-like detail we don't want on a public surface.
 *
 * Linked from the public-page footer (P1-5).
 */
import { Link } from "wouter";
import { ArrowLeft, Plus, Sparkles, Wrench } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AcreosLogo } from "@/components/acreos-logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { SkipToContent } from "@/components/skip-to-content";
import { PublicFooter } from "@/components/public-footer";
import { usePageMeta } from "@/hooks/use-document-title";
import { JsonLd } from "@/components/seo/JsonLd";
import { OpenGraph } from "@/components/seo/OpenGraph";
import { blogPostingSchema, SITE } from "@/lib/jsonld-schemas";
import {
  CUSTOMER_CHANGELOG,
  type ChangelogEntryType,
} from "@/data/customer-changelog";

const TYPE_META: Record<
  ChangelogEntryType,
  { label: string; className: string; Icon: typeof Plus }
> = {
  added: {
    label: "Added",
    className: "bg-primary/10 text-primary border-primary/20",
    Icon: Plus,
  },
  improved: {
    label: "Improved",
    className: "bg-secondary text-secondary-foreground border-border",
    Icon: Sparkles,
  },
  fixed: {
    label: "Fixed",
    className: "bg-muted text-muted-foreground border-border",
    Icon: Wrench,
  },
};

/** Format an ISO date as "May 1, 2026" without locale surprises. */
function formatDate(iso: string): string {
  // Parse explicitly as UTC midnight to avoid off-by-one in negative timezones.
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toLocaleDateString("en-US", {
    timeZone: "UTC",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export default function ChangelogPage() {
  usePageMeta(
    "Changelog",
    "Recent updates, new features, and improvements to AcreOS — written for Land Investors using the platform.",
  );

  // Defensive: ensure reverse-chronological even if an editor inserts
  // an out-of-order entry by hand.
  const entries = [...CUSTOMER_CHANGELOG].sort((a, b) =>
    a.date < b.date ? 1 : -1,
  );

  return (
    <div className="min-h-screen bg-background">
      <SkipToContent />
      <OpenGraph
        url={`${SITE.url}/changelog`}
        title="Changelog · AcreOS"
        description="Recent updates, new features, and improvements to AcreOS — written for Land Investors using the platform."
        type="website"
      />
      {/* Each release gets its own BlogPosting structured-data record so
          search engines can surface release notes individually. */}
      {entries.map((entry) => (
        <JsonLd
          key={entry.date}
          id={`changelog-${entry.date}`}
          data={blogPostingSchema({
            title: entry.version
              ? `AcreOS ${entry.version} (${entry.date})`
              : `AcreOS update — ${entry.date}`,
            description: entry.changes
              .map((c) => `${c.title}: ${c.body}`)
              .join(" · ")
              .slice(0, 280),
            datePublished: entry.date,
            url: `${SITE.url}/changelog#${entry.date}`,
          })}
        />
      ))}

      {/* Top nav — same pattern as /pricing, /security, /privacy */}
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
        <header className="mb-12 space-y-3">
          <h1 className="text-4xl font-bold">What's new in AcreOS</h1>
          <p className="text-muted-foreground max-w-2xl leading-relaxed">
            A running log of features, improvements, and fixes shipped to
            Land Investors. Newest first.
          </p>
        </header>

        {entries.length === 0 ? (
          <p className="text-center text-muted-foreground py-12">
            No changelog entries yet — check back soon.
          </p>
        ) : (
          <ol className="space-y-10" aria-label="Changelog entries">
            {entries.map((entry) => (
              <li key={entry.date} id={entry.date} className="scroll-mt-20">
                {/* Date header */}
                <div className="flex items-baseline gap-3 mb-4 flex-wrap">
                  <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground tabular-nums">
                    {formatDate(entry.date)}
                  </h2>
                  {entry.version && (
                    <Badge
                      variant="outline"
                      className="text-xs font-mono tabular-nums"
                    >
                      {entry.version}
                    </Badge>
                  )}
                </div>

                <Card>
                  <CardContent className="pt-6 space-y-5">
                    {entry.changes.map((change, i) => {
                      const meta = TYPE_META[change.type];
                      const Icon = meta.Icon;
                      return (
                        <div key={i} className="space-y-2">
                          <div className="flex items-center gap-2 flex-wrap">
                            <Badge
                              variant="outline"
                              className={`${meta.className} flex items-center gap-1`}
                            >
                              <Icon
                                className="h-3 w-3"
                                aria-hidden="true"
                              />
                              {meta.label}
                            </Badge>
                            <h3 className="font-semibold">{change.title}</h3>
                          </div>
                          <p className="text-sm text-muted-foreground leading-relaxed">
                            {change.body}
                          </p>
                        </div>
                      );
                    })}
                  </CardContent>
                </Card>
              </li>
            ))}
          </ol>
        )}
      </main>

      <PublicFooter />
    </div>
  );
}
