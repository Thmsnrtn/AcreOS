/**
 * TrustPage — the dated public trust surface at /trust (P2-6 S1, register A-5).
 *
 * DARK ROUTE: registered in the customer App so it is reachable by URL, and
 * linked from nowhere — no nav, footer, sitemap or landing link, and it sets
 * robots noindex. Publishing and linking it is the founder's act.
 *
 * CONTENT LAW: every sentence is a claim the shipped code makes true, and each
 * one is anchored in scripts/audit-public-claims.ts (TRUST_PAGE_FILES + its
 * CLAIMS / sources). The sentences live in client/src/data/trust-content-data.ts
 * (source of truth) and are served as /trust-content.json, not bundled JS (the
 * #680 pattern); the audit reads that module. Edit a sentence there, regenerate
 * the asset, and the audit fails until its anchor and source are updated to the
 * same truth. Keep each sentence on one line inside its string.
 *
 * Layout mirrors /security (top nav + cards + shared footer). The page is
 * data-driven to stay light: the customer bundle is at its ceiling, and this
 * page shipped with an in-PR offset (vite.config.ts __SENTRY_DEBUG__).
 */
import { useEffect } from "react";
import { Link } from "wouter";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AcreosLogo } from "@/components/acreos-logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { SkipToContent } from "@/components/skip-to-content";
import { PublicFooter } from "@/components/public-footer";
import { usePageMeta } from "@/hooks/use-document-title";
import { formatDate } from "@/lib/format";
import { TRUST_CONTENT_URL, useStaticData } from "@/lib/static-data";
import type { TrustSection } from "@/data/trust-content-data";

/** The page's own date and version. Change both when the copy changes. */
const UPDATED = new Date(2026, 10, 15);
const VERSION = "1";

export default function TrustPage() {
  const { data, error } = useStaticData<TrustSection[]>(TRUST_CONTENT_URL);
  usePageMeta("Trust", "What AcreOS promises about your money, your data and your records — in plain words.");
  // Dark route: never indexed until the founder publishes it.
  useEffect(() => {
    const tag = document.createElement("meta");
    tag.name = "robots";
    tag.content = "noindex";
    document.head.appendChild(tag);
    return () => tag.remove();
  }, []);

  return (
    <div className="min-h-screen bg-background">
      <SkipToContent />
      <nav className="border-b bg-surface-chrome backdrop-blur sticky top-0 z-floating">
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

      <main id="main-content" className="max-w-4xl mx-auto px-6 py-16 space-y-8">
        <header className="space-y-3">
          <div className="flex items-center gap-3">
            <ShieldCheck className="h-8 w-8 text-primary" aria-hidden="true" />
            <h1 className="text-4xl font-bold">Trust at AcreOS</h1>
          </div>
          <p className="text-muted-foreground max-w-2xl leading-relaxed">
            What AcreOS promises note investors and land investors, in plain words — and only what the product already does.
          </p>
          <p className="text-sm text-muted-foreground" data-testid="trust-updated">
            Last updated {formatDate(UPDATED)} · Version {VERSION}
          </p>
        </header>

        {error && (
          <p role="alert" className="text-sm text-destructive" data-testid="trust-load-error">
            We couldn't load this page's content. Please refresh and try again.
          </p>
        )}
        {!data && !error && (
          <p className="text-sm text-muted-foreground" role="status" data-testid="trust-loading">
            Loading…
          </p>
        )}
        {data?.map((s) => (
          <Card key={s.title}>
            <CardHeader>
              <CardTitle>{s.title}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm leading-relaxed text-muted-foreground">
              {s.lines.map((l) => (
                <p key={l}>{l}</p>
              ))}
            </CardContent>
          </Card>
        ))}
      </main>

      <PublicFooter />
    </div>
  );
}
