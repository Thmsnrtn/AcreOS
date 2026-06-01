/**
 * Public Knowledge Base browse surface.
 *
 * Lens 25 #3 — the `knowledge_base_articles` table is fed by the AI
 * ticket-resolution agent and the admin KB editor, but until this file
 * landed there was nowhere on the customer-facing site to actually read
 * the articles. This page is reachable from /help (the dedicated tab)
 * and via the "Learn why" links surfaced by `Errors.*` docsSlug toasts.
 *
 * Endpoint contract: `GET /api/kb/articles` (server/routes-kb.ts).
 */
import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";

import { PageShell } from "@/components/page-shell";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { BookOpen, Search } from "lucide-react";

interface KbArticleSummary {
  id: number;
  title: string;
  slug: string;
  summary: string | null;
  category: string;
  tags: string[] | null;
  viewCount: number | null;
  updatedAt: string | null;
}

interface KbListResponse {
  data: KbArticleSummary[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  categories: string[];
}

const PAGE_SIZE = 20;

/**
 * Inner content (no PageShell). Used both:
 *   - as the embedded body of `/help#kb` (which already supplies the shell)
 *   - and inside the dedicated `/help/kb` route (which wraps it in PageShell).
 *
 * Keeping the data-fetching + UI in one place avoids divergence between the
 * embedded tab and the standalone route.
 */
export function KnowledgeBaseBrowseInner({ showHeader = true }: { showHeader?: boolean } = {}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const url = useMemo(() => {
    const p = new URLSearchParams();
    p.set("page", String(page));
    p.set("pageSize", String(PAGE_SIZE));
    if (query.trim()) p.set("q", query.trim());
    if (category) p.set("category", category);
    return `/api/kb/articles?${p.toString()}`;
  }, [page, query, category]);

  const { data, isLoading, isError, refetch } = useQuery<KbListResponse>({
    queryKey: ["/api/kb/articles", page, query.trim(), category],
    queryFn: async () => {
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load articles");
      return res.json();
    },
  });

  return (
    <div className="space-y-6">
      {showHeader ? (
        <div>
          <h1
            className="text-3xl font-bold flex items-center gap-2"
            data-testid="text-kb-title"
          >
            <BookOpen className="w-8 h-8" />
            Knowledge base
          </h1>
          <p className="text-muted-foreground mt-2">
            Search articles, troubleshooting steps, and explainers from the support team.
          </p>
        </div>
      ) : null}

      <div className="flex flex-col gap-3 md:flex-row md:items-center">
        <label htmlFor="kb-search" className="sr-only">
          Search articles
        </label>
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <Input
            id="kb-search"
            data-testid="input-kb-search"
            placeholder="Search articles…"
            value={query}
            onChange={(e) => {
              setPage(1);
              setQuery(e.target.value);
            }}
            className="pl-9"
          />
        </div>
      </div>

      {/* Category facets */}
      {data?.categories?.length ? (
        <div className="flex flex-wrap gap-2" data-testid="kb-category-facets">
          <button
            type="button"
            onClick={() => {
              setPage(1);
              setCategory(null);
            }}
            className="rounded-full border border-border bg-background px-3 py-1 text-xs font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-pressed={category === null}
            data-testid="kb-category-all"
          >
            <Badge
              variant={category === null ? "default" : "outline"}
              className="cursor-pointer"
            >
              All
            </Badge>
          </button>
          {data.categories.map((c) => (
            <button
              type="button"
              key={c}
              onClick={() => {
                setPage(1);
                setCategory(c === category ? null : c);
              }}
              className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-pressed={category === c}
              data-testid={`kb-category-${c}`}
            >
              <Badge
                variant={category === c ? "default" : "outline"}
                className="cursor-pointer capitalize"
              >
                {c.replace(/_/g, " ")}
              </Badge>
            </button>
          ))}
        </div>
      ) : null}

      {/* List */}
      {isLoading ? (
        <div className="space-y-3" data-testid="kb-loading">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}>
              <CardHeader>
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-3 w-full mt-2" />
              </CardHeader>
            </Card>
          ))}
        </div>
      ) : isError ? (
        <EmptyState
          icon={BookOpen}
          headline="Couldn't load articles"
          subtitle="We had trouble reaching the knowledge base. Try again in a moment."
          cta={{
            label: "Retry",
            onClick: () => refetch(),
            "data-testid": "kb-retry",
          }}
          actionIcon={null}
          testId="kb-error"
        />
      ) : !data || data.data.length === 0 ? (
        <EmptyState
          icon={BookOpen}
          headline={query ? "No articles match" : "No articles yet"}
          subtitle={
            query
              ? "Try different keywords or clear the category filter."
              : "Articles will appear here as the support team publishes them."
          }
          // TODO(cta): KB is author-published content; for search misses, the action is "clear search"
          cta={{ label: "", _noOp: true }}
          actionIcon={null}
          testId="kb-empty"
        />
      ) : (
        <ul className="space-y-3" data-testid="kb-article-list">
          {data.data.map((article) => (
            <li key={article.id}>
              <Link href={`/help/article/${article.slug}`}>
                <Card
                  className="hover:bg-muted/40 transition-colors cursor-pointer focus-within:ring-2 focus-within:ring-ring"
                  data-testid={`kb-article-${article.slug}`}
                >
                  <CardHeader>
                    <div className="flex items-center justify-between gap-3">
                      <CardTitle className="text-base">{article.title}</CardTitle>
                      <Badge variant="outline" className="capitalize shrink-0">
                        {article.category.replace(/_/g, " ")}
                      </Badge>
                    </div>
                    {article.summary ? (
                      <CardDescription>{article.summary}</CardDescription>
                    ) : null}
                  </CardHeader>
                  {article.tags && article.tags.length > 0 ? (
                    <CardContent className="flex flex-wrap gap-1 pt-0">
                      {article.tags.slice(0, 5).map((tag) => (
                        <Badge key={tag} variant="secondary" className="text-xs">
                          {tag}
                        </Badge>
                      ))}
                    </CardContent>
                  ) : null}
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {/* Pagination */}
      {data && data.totalPages > 1 ? (
        <div
          className="flex items-center justify-between text-sm text-muted-foreground"
          data-testid="kb-pagination"
        >
          <span>
            Page {data.page} of {data.totalPages} ({data.total} articles)
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={data.page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              data-testid="kb-prev"
            >
              Previous
            </button>
            <button
              type="button"
              disabled={data.page >= data.totalPages}
              onClick={() => setPage((p) => p + 1)}
              className="rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              data-testid="kb-next"
            >
              Next
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Standalone `/help/kb` route — wraps the inner content in a PageShell so
 * the URL is shareable / SEO-friendly without the parent /help tab.
 */
export default function KnowledgeBasePage() {
  useDocumentTitle("Knowledge base");
  return (
    <PageShell label="Knowledge base">
      <KnowledgeBaseBrowseInner />
    </PageShell>
  );
}
