/**
 * FounderLetterPage — the monthly narrative that replaces the
 * dashboard as the primary surface for the "1 hour/month" operation.
 *
 * Instead of five cards, read one page. The letter is written by the
 * AcreOS Chief of Staff (an AI synthesizing across all 12 agents) and
 * always ends with a single bolded decision the founder has to weigh
 * in on. The archive sidebar shows previous months.
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { FileText, Check, RefreshCw, Archive } from "lucide-react";
import { format } from "date-fns";

interface FounderLetter {
  id: number;
  monthKey: string;
  letterMarkdown: string;
  pendingFounderDecision: string | null;
  generatedAt: string;
  deliveredAt: string | null;
  status: "draft" | "delivered" | "archived";
}

interface ArchiveRow {
  monthKey: string;
  generatedAt: string;
  deliveredAt: string | null;
  status: string;
  pendingFounderDecision: string | null;
}

function useCurrentLetter(monthKey?: string) {
  return useQuery<{ letter: FounderLetter | null }>({
    queryKey: monthKey
      ? [`/api/founder/intelligence/letter/${monthKey}`]
      : ["/api/founder/intelligence/letter/current"],
    staleTime: 60_000,
  });
}

function useArchive() {
  return useQuery<{ letters: ArchiveRow[] }>({
    queryKey: ["/api/founder/intelligence/letter/archive"],
    staleTime: 5 * 60_000,
  });
}

/**
 * Minimal inline markdown renderer — headings, bold, bullet lists,
 * paragraphs. Keeps dep surface small and gives us full control of
 * styling. Not a general-purpose renderer; tuned for the narrative
 * structure the AI produces.
 */
function renderMarkdown(md: string): React.ReactNode {
  const blocks = md.trim().split(/\n{2,}/);
  return blocks.map((block, i) => {
    const trimmed = block.trim();
    if (trimmed.startsWith("# ")) {
      return (
        <h1 key={i} className="text-3xl font-bold text-foreground mt-6 mb-4">
          {inline(trimmed.slice(2))}
        </h1>
      );
    }
    if (trimmed.startsWith("## ")) {
      return (
        <h2 key={i} className="text-xl font-semibold text-foreground mt-8 mb-3">
          {inline(trimmed.slice(3))}
        </h2>
      );
    }
    if (trimmed.startsWith("### ")) {
      return (
        <h3 key={i} className="text-lg font-semibold text-foreground mt-6 mb-2">
          {inline(trimmed.slice(4))}
        </h3>
      );
    }
    if (/^[-*] /.test(trimmed)) {
      const items = trimmed.split(/\n/).filter((l) => /^[-*] /.test(l));
      return (
        <ul key={i} className="list-disc pl-6 my-3 space-y-1.5 text-foreground/90">
          {items.map((it, j) => (
            <li key={j}>{inline(it.replace(/^[-*] /, ""))}</li>
          ))}
        </ul>
      );
    }
    return (
      <p key={i} className="my-3 text-foreground/90 leading-relaxed">
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
    parts.push(
      <strong key={key++} className="font-semibold text-foreground">
        {m[1]}
      </strong>,
    );
    remaining = remaining.slice(m.index + m[0].length);
  }
  return <>{parts}</>;
}

export default function FounderLetterPage() {
  const [selectedMonth, setSelectedMonth] = useState<string | undefined>(undefined);
  const { data, isLoading, isError, refetch } = useCurrentLetter(selectedMonth);
  const archive = useArchive();
  const qc = useQueryClient();
  const { toast } = useToast();

  const generate = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/founder/intelligence/letter/generate", {});
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/founder/intelligence/letter/current"] });
      qc.invalidateQueries({ queryKey: ["/api/founder/intelligence/letter/archive"] });
      toast({ title: "Letter generated", description: "Fresh content loaded." });
    },
    onError: (e: Error) => toast({ title: "Generate failed", description: e.message, variant: "destructive" }),
  });

  const markDelivered = useMutation({
    mutationFn: async (monthKey: string) => {
      const res = await apiRequest("POST", `/api/founder/intelligence/letter/${monthKey}/mark-delivered`, {});
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/founder/intelligence/letter/current"] });
      qc.invalidateQueries({ queryKey: ["/api/founder/intelligence/letter/archive"] });
    },
  });

  const letter = data?.letter ?? null;

  return (
    <PageShell label="Founder Letter">
      <div className="grid gap-6 lg:grid-cols-[1fr_280px] max-w-6xl mx-auto">
        {/* Main letter */}
        <div className="space-y-4">
          {isLoading ? (
            <Card>
              <CardContent className="p-8 space-y-3">
                <Skeleton className="h-8 w-64" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-11/12" />
                <Skeleton className="h-4 w-10/12" />
              </CardContent>
            </Card>
          ) : isError ? (
            <EmptyState
              icon={FileText}
              title="Couldn't load the letter"
              description="Try generating it or come back in a moment."
              actionLabel="Retry"
              onAction={() => refetch()}
            />
          ) : !letter ? (
            <EmptyState
              icon={FileText}
              title="No letter yet"
              description="The first letter will be generated on the 1st of next month. You can also generate one on demand from the current data."
              actionLabel={generate.isPending ? "Generating…" : "Generate now"}
              onAction={() => generate.mutate()}
              testId="button-generate-letter"
            />
          ) : (
            <>
              {/* Status row */}
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-2">
                  <Badge variant={letter.status === "delivered" ? "secondary" : "default"}>
                    {letter.status}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    generated {format(new Date(letter.generatedAt), "MMM d, yyyy h:mm a")}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    onClick={() => generate.mutate()}
                    disabled={generate.isPending}
                    variant="ghost"
                    size="sm"
                    data-testid="button-regenerate-letter"
                  >
                    <RefreshCw className="h-4 w-4 mr-2" />
                    {generate.isPending ? "Regenerating…" : "Regenerate"}
                  </Button>
                  {letter.status !== "delivered" && (
                    <Button
                      onClick={() => markDelivered.mutate(letter.monthKey)}
                      disabled={markDelivered.isPending}
                      variant="outline"
                      size="sm"
                      data-testid="button-mark-delivered"
                    >
                      <Check className="h-4 w-4 mr-2" />
                      Read
                    </Button>
                  )}
                </div>
              </div>

              {/* The letter */}
              <Card>
                <CardContent className="p-8 prose prose-neutral dark:prose-invert max-w-none">
                  {renderMarkdown(letter.letterMarkdown)}
                </CardContent>
              </Card>

              {/* Pending founder decision — call-out card */}
              {letter.pendingFounderDecision && (
                <Card className="bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base text-amber-900 dark:text-amber-200">
                      The one thing I need from you
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-amber-900 dark:text-amber-200">
                      {letter.pendingFounderDecision}
                    </p>
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </div>

        {/* Archive sidebar */}
        <aside className="space-y-3">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Archive className="h-4 w-4 text-muted-foreground" />
                Archive
              </CardTitle>
            </CardHeader>
            <CardContent className="p-3 pt-0 space-y-1">
              {archive.isLoading ? (
                <Skeleton className="h-4 w-full" />
              ) : archive.data?.letters.length === 0 ? (
                <p className="text-xs text-muted-foreground">No previous letters yet.</p>
              ) : (
                archive.data?.letters.map((row) => {
                  const isSelected = selectedMonth === row.monthKey;
                  return (
                    <button
                      key={row.monthKey}
                      onClick={() => setSelectedMonth(isSelected ? undefined : row.monthKey)}
                      className={`w-full text-left p-2 rounded text-xs hover:bg-muted/60 transition ${isSelected ? "bg-muted" : ""}`}
                      data-testid={`archive-${row.monthKey}`}
                    >
                      <div className="font-medium text-foreground">{row.monthKey}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {row.status}
                        {row.deliveredAt ? ` · read ${format(new Date(row.deliveredAt), "MMM d")}` : ""}
                      </div>
                    </button>
                  );
                })
              )}
            </CardContent>
          </Card>
        </aside>
      </div>
    </PageShell>
  );
}
