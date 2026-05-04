/**
 * /founder/prompt-versions — Phase 4 Week 21-22 (Nadia-AI §2.A).
 *
 * Founder dashboard for the prompt-versioning A/B harness.
 *
 * Layout (top → bottom):
 *   1. Per-prompt summary cards: prod version, candidate version, score
 *      delta, weight split.
 *   2. Per-prompt version table — full history (active + retired) with
 *      eval scores, weights, hash, createdAt.
 *   3. Inline "Promote candidate" button + "Run auto-promotion" button.
 *
 * Founder-only — gated by FounderProtectedRoute in App.tsx and again at
 * the API layer.
 */

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Beaker, CheckCircle2, TrendingUp, TrendingDown, Sparkles } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

interface PromptVersion {
  id?: string;
  promptName: string;
  version: string;
  system: string;
  tier: "critical" | "standard" | "background";
  hash: string;
  createdAt: string;
  evalScore?: number;
  evalRunAt?: string;
  weight: number;
  active: boolean;
  isCandidate: boolean;
}

interface PromptSummary {
  promptName: string;
  versions: PromptVersion[];
  prod?: PromptVersion;
  candidate?: PromptVersion;
  scoreDelta: number | null;
}

interface ListResponse {
  prompts: PromptSummary[];
}

function fmtScore(v?: number | null): string {
  if (v == null || isNaN(Number(v))) return "—";
  return Number(v).toFixed(3);
}

function fmtDate(s?: string | null): string {
  if (!s) return "—";
  try {
    return new Date(s).toLocaleString();
  } catch {
    return s;
  }
}

function deltaBadge(delta: number | null): JSX.Element {
  if (delta == null) return <Badge variant="outline">—</Badge>;
  if (delta > 0.0001) {
    return (
      <Badge variant="default" className="bg-green-600 hover:bg-green-700">
        <TrendingUp className="mr-1 h-3 w-3" />+{delta.toFixed(3)}
      </Badge>
    );
  }
  if (delta < -0.0001) {
    return (
      <Badge variant="destructive">
        <TrendingDown className="mr-1 h-3 w-3" />
        {delta.toFixed(3)}
      </Badge>
    );
  }
  return <Badge variant="secondary">±0.000</Badge>;
}

export default function FounderPromptVersionsPage() {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery<ListResponse>({
    queryKey: ["/api/founder/prompt-versions"],
  });

  const [busyKey, setBusyKey] = useState<string | null>(null);

  const promote = useMutation({
    mutationFn: async (vars: { promptName: string; candidateVersion: string; prodVersion: string }) => {
      return apiRequest("POST", "/api/founder/prompt-versions/promote", vars);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/founder/prompt-versions"] }),
  });

  const autoPromote = useMutation({
    mutationFn: async () => apiRequest("POST", "/api/founder/prompt-versions/auto-promote", {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/founder/prompt-versions"] }),
  });

  const summaries = data?.prompts ?? [];

  const total = useMemo(
    () => ({
      prompts: summaries.length,
      candidates: summaries.filter((s) => !!s.candidate).length,
      improving: summaries.filter((s) => (s.scoreDelta ?? 0) > 0.05).length,
    }),
    [summaries],
  );

  return (
    <PageShell
      title="Prompt versions — A/B harness"
      description="Inspect prompt versions, A/B traffic splits, and eval-score deltas. Promote a candidate when its 7-day score is ≥ 5% better than production."
    >
      <div className="space-y-6">
        {/* Aggregate strip */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Sparkles className="h-4 w-4" /> Registered prompts
              </CardTitle>
            </CardHeader>
            <CardContent className="text-3xl font-semibold">{total.prompts}</CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Beaker className="h-4 w-4" /> Active candidates
              </CardTitle>
            </CardHeader>
            <CardContent className="text-3xl font-semibold">{total.candidates}</CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <TrendingUp className="h-4 w-4" /> Improving (≥+5%)
              </CardTitle>
            </CardHeader>
            <CardContent className="text-3xl font-semibold">{total.improving}</CardContent>
          </Card>
        </div>

        {/* Auto-promote */}
        <div className="flex items-center justify-end">
          <Button
            variant="outline"
            disabled={autoPromote.isPending}
            onClick={() => autoPromote.mutate()}
            aria-label="Run auto-promotion"
            data-testid="button-auto-promote"
          >
            {autoPromote.isPending ? "Running…" : "Run auto-promotion"}
          </Button>
        </div>

        {/* Loading */}
        {isLoading && (
          <div className="space-y-4">
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        )}

        {/* Error */}
        {error && (
          <Card>
            <CardHeader>
              <CardTitle>Failed to load prompt versions</CardTitle>
              <CardDescription>{(error as Error).message}</CardDescription>
            </CardHeader>
          </Card>
        )}

        {/* Empty */}
        {!isLoading && !error && summaries.length === 0 && (
          <EmptyState
            icon={Beaker}
            title="No prompts registered yet"
            description="Once a callsite uses routeWithRegisteredPrompt(), versions will appear here."
          />
        )}

        {/* Per-prompt cards */}
        {!isLoading &&
          !error &&
          summaries.map((s) => {
            const candidateKey = s.candidate ? `${s.promptName}:${s.candidate.version}` : null;
            return (
              <Card key={s.promptName} data-testid={`prompt-card-${s.promptName}`}>
                <CardHeader>
                  <CardTitle className="flex items-center justify-between text-lg">
                    <span>{s.promptName}</span>
                    {deltaBadge(s.scoreDelta)}
                  </CardTitle>
                  <CardDescription className="flex items-center gap-3 text-sm">
                    <span>
                      Production: <strong>{s.prod?.version ?? "—"}</strong>
                      {s.prod?.evalScore != null && (
                        <span className="ml-1 text-muted-foreground">
                          ({fmtScore(s.prod.evalScore)})
                        </span>
                      )}
                    </span>
                    <span>•</span>
                    <span>
                      Candidate: <strong>{s.candidate?.version ?? "none"}</strong>
                      {s.candidate?.evalScore != null && (
                        <span className="ml-1 text-muted-foreground">
                          ({fmtScore(s.candidate.evalScore)})
                        </span>
                      )}
                    </span>
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Version</TableHead>
                        <TableHead>Tier</TableHead>
                        <TableHead>Weight</TableHead>
                        <TableHead>Eval score</TableHead>
                        <TableHead>Hash</TableHead>
                        <TableHead>Created</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {s.versions
                        .slice()
                        .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))
                        .map((v) => (
                          <TableRow key={`${v.promptName}-${v.version}`}>
                            <TableCell className="font-mono">{v.version}</TableCell>
                            <TableCell>{v.tier}</TableCell>
                            <TableCell>{v.weight}%</TableCell>
                            <TableCell>{fmtScore(v.evalScore)}</TableCell>
                            <TableCell className="font-mono text-xs">
                              {v.hash.slice(0, 10)}…
                            </TableCell>
                            <TableCell>{fmtDate(v.createdAt)}</TableCell>
                            <TableCell>
                              {!v.active ? (
                                <Badge variant="outline">retired</Badge>
                              ) : v.isCandidate ? (
                                <Badge variant="secondary">
                                  <Beaker className="mr-1 h-3 w-3" /> candidate
                                </Badge>
                              ) : v.weight > 0 ? (
                                <Badge variant="default">
                                  <CheckCircle2 className="mr-1 h-3 w-3" /> production
                                </Badge>
                              ) : (
                                <Badge variant="outline">inactive</Badge>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                    </TableBody>
                  </Table>

                  {s.candidate && s.prod && (
                    <div className="mt-4 flex items-center justify-end gap-2">
                      <Button
                        disabled={busyKey === candidateKey || promote.isPending}
                        onClick={() => {
                          setBusyKey(candidateKey);
                          promote.mutate(
                            {
                              promptName: s.promptName,
                              candidateVersion: s.candidate!.version,
                              prodVersion: s.prod!.version,
                            },
                            { onSettled: () => setBusyKey(null) },
                          );
                        }}
                        data-testid={`button-promote-${s.promptName}`}
                        aria-label={`Promote candidate ${s.candidate.version}`}
                      >
                        {busyKey === candidateKey ? "Promoting…" : "Promote candidate"}
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
      </div>
    </PageShell>
  );
}
