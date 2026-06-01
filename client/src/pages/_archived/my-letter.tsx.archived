/**
 * MyLetterPage — the customer-facing monthly letter from Pax.
 *
 * Customer-side surface mirroring /founder/letter. Each Land Investor
 * gets a personalized monthly brief on their own business — portfolio
 * delta, what worked, what didn't, and Pax's recommended next step.
 *
 * This is a primary engagement lever, so the page is minimal and
 * focused — one letter, one clear recommended action, an archive.
 *
 * Persona note: customers see ONE AI brand — Pax. The founder-side
 * board (sophie_csm, forge_revenue, etc.) is internal and never
 * surfaces here.
 */

import { useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { getErrorMessage, getErrorTitle } from "@/lib/error-utils";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { FileText, RefreshCw, Archive } from "lucide-react";
import { format } from "date-fns";

interface CustomerLetterRow {
  id: number;
  organizationId: number;
  monthKey: string;
  letterMarkdown: string;
  recommendedAction: string | null;
  generatedAt: string;
  openedAt: string | null;
  status: string;
}

interface ArchiveEntry {
  monthKey: string;
  generatedAt: string;
  openedAt: string | null;
  status: string;
  recommendedAction: string | null;
}

function renderMarkdown(md: string): React.ReactNode {
  const blocks = md.trim().split(/\n{2,}/);
  return blocks.map((block, i) => {
    const trimmed = block.trim();
    if (trimmed.startsWith("# ")) {
      return (
        <h1 key={i} className="text-2xl sm:text-3xl font-bold text-foreground mt-4 mb-4">
          {inline(trimmed.slice(2))}
        </h1>
      );
    }
    if (trimmed.startsWith("## ")) {
      return (
        <h2 key={i} className="text-lg font-semibold text-foreground mt-6 mb-2">
          {inline(trimmed.slice(3))}
        </h2>
      );
    }
    if (/^[-*] /.test(trimmed)) {
      const items = trimmed.split(/\n/).filter((l) => /^[-*] /.test(l));
      return (
        <ul key={i} className="list-disc pl-6 my-2 space-y-1 text-foreground/90">
          {items.map((it, j) => (
            <li key={j}>{inline(it.replace(/^[-*] /, ""))}</li>
          ))}
        </ul>
      );
    }
    if (trimmed === "---") return <hr key={i} className="my-4 border-border" />;
    return (
      <p key={i} className="my-2 text-foreground/90 leading-relaxed">
        {inline(trimmed)}
      </p>
    );
  });
}

function inline(text: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  let remaining = text;
  let key = 0;
  const boldRe = /\*\*([^*]+)\*\*/;
  while (remaining.length > 0) {
    const m = boldRe.exec(remaining);
    if (!m || m.index === undefined) {
      parts.push(remaining);
      break;
    }
    if (m.index > 0) parts.push(remaining.slice(0, m.index));
    parts.push(<strong key={key++} className="font-semibold text-foreground">{m[1]}</strong>);
    remaining = remaining.slice(m.index + m[0].length);
  }
  return <>{parts}</>;
}

export default function MyLetterPage() {
  useDocumentTitle("My monthly letter");
  const { data, isLoading, isError, refetch } = useQuery<{ letter: CustomerLetterRow | null }>({
    queryKey: ["/api/my-letter/current"],
    staleTime: 60_000,
  });
  const archive = useQuery<{ letters: ArchiveEntry[] }>({
    queryKey: ["/api/my-letter/archive"],
    staleTime: 5 * 60_000,
  });
  const qc = useQueryClient();
  const { toast } = useToast();

  const generate = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/my-letter/generate", {});
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/my-letter/current"] });
      qc.invalidateQueries({ queryKey: ["/api/my-letter/archive"] });
      toast({ title: "Letter generated", description: "Your latest brief is ready." });
    },
    onError: (e: Error) =>
      toast({
        title: "Couldn't generate letter",
        description: `${e.message}. Your previous letter (if any) is unchanged — try again in a moment.`,
        variant: "destructive",
      }),
  });

  const markOpened = useMutation({
    mutationFn: async (monthKey: string) => {
      const res = await apiRequest("POST", `/api/my-letter/${monthKey}/opened`, {});
      return res.json();
    },
    onError: (error) => {
      const title = getErrorTitle(error);
      const description = getErrorMessage(error);
      toast({ title, description, variant: "destructive" });
    },
  });

  const letter = data?.letter ?? null;
  useEffect(() => {
    if (letter && letter.status !== "opened") {
      markOpened.mutate(letter.monthKey);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [letter?.monthKey]);

  return (
    <PageShell label="My monthly letter">
      <div className="grid gap-6 lg:grid-cols-[1fr_260px] max-w-5xl mx-auto">
        <div className="space-y-4">
          {isLoading ? (
            <Card>
              <CardContent className="p-8 space-y-3" role="status" aria-live="polite">
                <span className="sr-only">Loading your monthly letter…</span>
                <Skeleton className="h-8 w-64" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-11/12" />
              </CardContent>
            </Card>
          ) : isError ? (
            <Card>
              <CardContent className="p-6 text-sm text-acr-neg" role="alert">
                Couldn't load your letter. Your previous letter is still saved —{" "}
                <button
                  type="button"
                  className="underline hover:no-underline"
                  onClick={() => refetch()}
                >
                  try again
                </button>.
              </CardContent>
            </Card>
          ) : !letter ? (
            <EmptyState
              icon={FileText}
              title="No letter yet"
              description="Your first monthly letter will be generated on the 1st of next month. You can also generate one now from your current business state."
              actionLabel={generate.isPending ? "Generating…" : "Generate now"}
              onAction={() => generate.mutate()}
              testId="generate-customer-letter"
            />
          ) : (
            <>
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="capitalize">{letter.status}</Badge>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {format(new Date(letter.generatedAt), "MMMM yyyy")}
                  </span>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => generate.mutate()}
                  disabled={generate.isPending}
                  aria-label={`Regenerate letter for ${format(new Date(letter.generatedAt), "MMMM yyyy")}`}
                >
                  <RefreshCw className={`h-4 w-4 mr-2 ${generate.isPending ? "animate-spin" : ""}`} aria-hidden="true" />
                  {generate.isPending ? "Regenerating…" : "Regenerate"}
                </Button>
              </div>

              <Card>
                <CardContent className="p-6 sm:p-8 prose prose-neutral dark:prose-invert max-w-none">
                  {renderMarkdown(letter.letterMarkdown)}
                </CardContent>
              </Card>

              {letter.recommendedAction && (
                <Card className="bg-acr-pos-soft/50 dark:bg-acr-pos-soft/20 border-acr-pos-soft dark:border-acr-pos-soft/40">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm text-acr-pos dark:text-acr-pos">
                      Pax's recommendation
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-acr-pos dark:text-acr-pos">
                      {letter.recommendedAction}
                    </p>
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </div>

        <aside aria-label="Letter archive">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Archive className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                Archive
              </CardTitle>
            </CardHeader>
            <CardContent className="p-3 pt-0">
              {archive.isLoading ? (
                <div role="status" aria-live="polite">
                  <span className="sr-only">Loading archive…</span>
                  <Skeleton className="h-4 w-full" />
                </div>
              ) : archive.data?.letters.length === 0 ? (
                <p className="text-xs text-muted-foreground">No previous letters yet.</p>
              ) : (
                <ol className="space-y-1" aria-label="Previous monthly letters, newest first">
                  {archive.data?.letters.map((row) => (
                    <li key={row.monthKey} className="p-2 rounded text-xs">
                      <div className="font-medium text-foreground tabular-nums">{row.monthKey}</div>
                      <div className="text-caption text-muted-foreground">
                        <span className="capitalize">{row.status}</span>
                        {row.openedAt ? <> · opened <span className="tabular-nums">{format(new Date(row.openedAt), "MMM d")}</span></> : ""}
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>
        </aside>
      </div>
    </PageShell>
  );
}
