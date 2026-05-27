/**
 * Single KB article — `/help/article/:slug`.
 *
 * Lens 25 #3 — this is the destination for the "Learn why" deep link
 * surfaced by `Errors.*` helpers (server/utils/errors.ts) when a route
 * handler attaches a `docsSlug`. It also powers organic search traffic
 * (SEO: canonical link + og:title + schema.org Article JSON-LD).
 *
 * Markdown body is rendered with the in-house `TextArtifact` parser
 * (client/src/components/founder-chat/artifacts/text.tsx) — same one used
 * by the property-analysis chat. We deliberately don't pull in
 * react-markdown / remark just for this surface.
 */
import { useEffect } from "react";
import { Link, useRoute } from "wouter";
import { useQuery } from "@tanstack/react-query";

import { PageShell } from "@/components/page-shell";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { BookOpen, ArrowLeft } from "lucide-react";
import { TextArtifact } from "@/components/founder-chat/artifacts/text";

interface KbArticle {
  id: number;
  title: string;
  slug: string;
  content: string;
  summary: string | null;
  category: string;
  tags: string[] | null;
  viewCount: number | null;
  helpfulCount: number | null;
  updatedAt: string | null;
  createdAt: string | null;
}

/**
 * Set or replace a `<meta>` / `<link>` tag in `<head>`. Tags are tagged
 * with `data-kb="1"` so we can clean them up on unmount and not leak
 * KB-specific metadata into other routes.
 */
function setHeadTag(
  selector: string,
  tagName: "meta" | "link" | "script",
  attrs: Record<string, string>,
) {
  if (typeof document === "undefined") return;
  let el = document.head.querySelector<HTMLElement>(selector);
  if (!el) {
    el = document.createElement(tagName);
    el.setAttribute("data-kb", "1");
    document.head.appendChild(el);
  }
  for (const [k, v] of Object.entries(attrs)) {
    el.setAttribute(k, v);
  }
  return el;
}

function cleanKbHeadTags() {
  if (typeof document === "undefined") return;
  document.head.querySelectorAll('[data-kb="1"]').forEach((n) => n.remove());
}

export default function KnowledgeBaseArticlePage() {
  const [, params] = useRoute<{ slug: string }>("/help/article/:slug");
  const slug = params?.slug ?? "";

  const { data, isLoading, isError } = useQuery<KbArticle>({
    queryKey: ["/api/kb/articles", slug],
    queryFn: async () => {
      const res = await fetch(`/api/kb/articles/${encodeURIComponent(slug)}`, {
        credentials: "include",
      });
      if (!res.ok) {
        if (res.status === 404) throw new Error("404: Article not found");
        throw new Error("Failed to load article");
      }
      return res.json();
    },
    enabled: !!slug,
  });

  // Browser document.title fallback — useDocumentTitle handles the visible
  // tab. We compose it from the article title once it loads.
  useDocumentTitle(data?.title ? `${data.title} · Help` : "Help article");

  // SEO metadata: canonical URL, og:title, JSON-LD schema.org Article.
  // Cleaned up on unmount so we don't pollute other routes.
  useEffect(() => {
    if (!data) return;
    const origin =
      typeof window !== "undefined" && window.location?.origin
        ? window.location.origin
        : "";
    const url = `${origin}/help/article/${data.slug}`;
    const desc =
      data.summary ??
      data.content
        .replace(/^#+\s.*$/gm, "")
        .trim()
        .slice(0, 160);

    setHeadTag('link[rel="canonical"][data-kb="1"]', "link", {
      rel: "canonical",
      href: url,
    });
    setHeadTag('meta[property="og:title"][data-kb="1"]', "meta", {
      property: "og:title",
      content: data.title,
    });
    setHeadTag('meta[property="og:type"][data-kb="1"]', "meta", {
      property: "og:type",
      content: "article",
    });
    setHeadTag('meta[property="og:url"][data-kb="1"]', "meta", {
      property: "og:url",
      content: url,
    });
    setHeadTag('meta[property="og:description"][data-kb="1"]', "meta", {
      property: "og:description",
      content: desc,
    });
    setHeadTag('meta[name="description"][data-kb="1"]', "meta", {
      name: "description",
      content: desc,
    });

    // schema.org Article JSON-LD
    const ld = {
      "@context": "https://schema.org",
      "@type": "Article",
      headline: data.title,
      description: desc,
      datePublished: data.createdAt ?? undefined,
      dateModified: data.updatedAt ?? data.createdAt ?? undefined,
      mainEntityOfPage: url,
      articleSection: data.category,
      keywords: data.tags?.join(", "),
    };
    let script = document.head.querySelector<HTMLScriptElement>(
      'script[type="application/ld+json"][data-kb="1"]',
    );
    if (!script) {
      script = document.createElement("script");
      script.type = "application/ld+json";
      script.setAttribute("data-kb", "1");
      document.head.appendChild(script);
    }
    script.text = JSON.stringify(ld);

    return cleanKbHeadTags;
  }, [data]);

  return (
    <PageShell label="Help article" maxWidth="4xl">
      <Link
        href="/help#kb"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
        data-testid="kb-back"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to knowledge base
      </Link>

      {isLoading ? (
        <div className="space-y-3" data-testid="kb-article-loading">
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-4 w-full mt-4" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
        </div>
      ) : isError || !data ? (
        <EmptyState
          icon={BookOpen}
          title="Article not found"
          description="This article may have been moved or unpublished. Search the knowledge base for related topics."
          actionLabel="Browse all articles"
          actionIcon={null}
          onAction={() => {
            window.location.href = "/help#kb";
          }}
          testId="kb-article-error"
        />
      ) : (
        <article
          className="space-y-4"
          itemScope
          itemType="https://schema.org/Article"
          data-testid={`kb-article-${data.slug}`}
        >
          <header className="space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="outline" className="capitalize">
                {data.category.replace(/_/g, " ")}
              </Badge>
              {data.tags?.slice(0, 6).map((t) => (
                <Badge key={t} variant="secondary" className="text-xs">
                  {t}
                </Badge>
              ))}
            </div>
            <h1
              className="text-3xl font-bold leading-tight"
              itemProp="headline"
              data-testid="kb-article-title"
            >
              {data.title}
            </h1>
            {data.summary ? (
              <p className="text-muted-foreground" itemProp="description">
                {data.summary}
              </p>
            ) : null}
          </header>

          <div className="prose prose-sm max-w-none" itemProp="articleBody">
            <TextArtifact markdown={data.content} />
          </div>
        </article>
      )}
    </PageShell>
  );
}
