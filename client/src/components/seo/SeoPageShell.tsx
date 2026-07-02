/**
 * SeoPageShell — ONE shared shell for the public SEO-page families
 * (/compare/*, /learn/*, /glossary). Before this existed, each family
 * carried its own drifting copy of the same idiom: top nav (or none),
 * hero/title block, footer (or none), and head/meta wiring.
 *
 * The shell converges on the best of the three:
 *   - Sticky public top nav (logo home link + theme toggle + signup CTA)
 *     — previously only the glossary had it.
 *   - SkipToContent + <main id="main-content"> landmark — WCAG 2.4.1.
 *   - One <h1> per page: the shell's `title` slot.
 *   - PublicFooter on every page — previously only the glossary.
 *   - Centralized SEO head handling: document.title + meta description
 *     (usePageMeta), OpenGraph/Twitter/canonical (OpenGraph), optional
 *     robots noindex guard for not-yet-finished pages.
 *
 * Page-specific structured data (JSON-LD Article/FAQ/Product/etc.)
 * stays with the page and is passed via `structuredData` (the nodes
 * render null and inject into <head>).
 *
 * Purely presentational — no data fetching, no auth awareness.
 */
import { useEffect, type ReactNode } from "react";
import { Link } from "wouter";
import { ArrowLeft } from "lucide-react";

import { AcreosLogo } from "@/components/acreos-logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { SkipToContent } from "@/components/skip-to-content";
import { PublicFooter } from "@/components/public-footer";
import { OpenGraph } from "@/components/seo/OpenGraph";
import { usePageMeta } from "@/hooks/use-document-title";

export interface SeoPageShellProps {
  /** The single h1 on the page. */
  title: string;
  /** data-testid for the h1. */
  titleTestId?: string;
  /**
   * Base for document.title and og:title (shell appends " · AcreOS").
   * Defaults to `title` — override when the SERP title differs from the
   * on-page h1 (e.g. /glossary mirrors META_BY_PATH in script/prerender.ts).
   */
  metaTitle?: string;
  /** Meta description + og:description — 140-160 chars works well. */
  description: string;
  /** Absolute canonical URL (og:url + <link rel="canonical">). */
  canonicalUrl: string;
  /** og:type — defaults to "website". */
  ogType?: "website" | "article";
  /**
   * Ship robots noindex,follow for the lifetime of the page. Used by
   * pages whose prose is still `data-todo` so crawlers discover the URL
   * (via sitemap) without indexing half-finished copy.
   */
  noindex?: boolean;
  /** Small label rendered above the h1 (pass a complete element). */
  eyebrow?: ReactNode;
  /** Lede paragraph(s) rendered under the h1 (pass complete elements). */
  intro?: ReactNode;
  /** Rendered inside <nav aria-label="Breadcrumb"> above the header. */
  breadcrumb?: ReactNode;
  /** JSON-LD nodes (render null; inject into <head>). */
  structuredData?: ReactNode;
  /** Content column width. narrow = max-w-3xl (default), wide = max-w-4xl. */
  width?: "narrow" | "wide";
  children: ReactNode;
}

export function SeoPageShell({
  title,
  titleTestId,
  metaTitle,
  description,
  canonicalUrl,
  ogType = "website",
  noindex = false,
  eyebrow,
  intro,
  breadcrumb,
  structuredData,
  width = "narrow",
  children,
}: SeoPageShellProps) {
  const headTitle = metaTitle ?? title;
  usePageMeta(headTitle, description);

  useEffect(() => {
    if (!noindex) return;
    const tag = document.createElement("meta");
    tag.name = "robots";
    tag.content = "noindex,follow";
    document.head.appendChild(tag);
    return () => {
      tag.remove();
    };
  }, [noindex]);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <SkipToContent />

      <OpenGraph
        url={canonicalUrl}
        title={`${headTitle} · AcreOS`}
        description={description}
        type={ogType}
      />
      {structuredData}

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

      <main
        id="main-content"
        className={`w-full ${
          width === "wide" ? "max-w-4xl" : "max-w-3xl"
        } mx-auto px-4 md:px-6 py-8 md:py-12 pb-24 flex-1`}
      >
        {breadcrumb ? (
          <nav aria-label="Breadcrumb" className="mb-6">
            {breadcrumb}
          </nav>
        ) : null}

        <header className="space-y-3 mb-10">
          {eyebrow}
          <h1
            className="text-3xl md:text-4xl font-bold leading-tight tracking-tight"
            data-testid={titleTestId}
          >
            {title}
          </h1>
          {intro}
        </header>

        {children}
      </main>

      <PublicFooter />
    </div>
  );
}

export default SeoPageShell;
