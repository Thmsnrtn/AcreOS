/**
 * /founder/pax-traces — read-only Pax LLM trace viewer (Workstream A).
 *
 * Founder-only. Lists every Pax LLM call captured in `agent_llm_traces`
 * with the full prompt/response, tool-call timeline (read out of the
 * trace's `metadata` blob when present), token counts, latency, and the
 * eventual decision-inbox disposition.
 *
 * Companion to the "honest preview" copy fix on the Today autonomy card —
 * the slider may still be in preview, but every Pax call is already
 * captured here, so the founder can verify the underlying numbers against
 * the actual prompts at any time.
 */

import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity, FileCode, AlertTriangle, CheckCircle2, Clock, Coins } from "lucide-react";

import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/empty-state";
import { QueryErrorState } from "@/components/query-error-state";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useDocumentTitle } from "@/hooks/use-document-title";

interface PaxTraceRow {
  id: number;
  organizationId: number | null;
  agentCodename: string;
  purpose: string;
  model: string;
  systemPrompt: string | null;
  userPrompt: string;
  response: string;
  latencyMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  costCents: number | null;
  error: string | null;
  metadata: Record<string, unknown> | null;
  decisionId: number | null;
  createdAt: string;
  decisionStatus: string | null;
  decisionItemType: string | null;
  decisionRecommendedAction: string | null;
  decisionResolvedAt: string | null;
  decisionResolvedBy: string | null;
  decisionFounderOverrideAction: string | null;
  decisionOutcomeScore: number | null;
}

interface PaxTracesResponse {
  traces: PaxTraceRow[];
  nextCursor: number | null;
  totals: { total: number; errors: number };
}

function fmtTimestamp(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function fmtCents(cents: number | null): string {
  if (cents === null || cents === undefined) return "—";
  if (cents === 0) return "$0.00";
  return `$${(cents / 100).toFixed(4)}`;
}

function fmtMs(ms: number | null): string {
  if (ms === null || ms === undefined) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function dispositionLabel(row: PaxTraceRow): { label: string; tone: "neutral" | "ok" | "warn" } {
  if (!row.decisionId) return { label: "no decision", tone: "neutral" };
  const status = row.decisionStatus;
  if (status === "approved") return { label: "accepted", tone: "ok" };
  if (status === "rejected") return { label: "rejected", tone: "warn" };
  if (status === "auto_resolved") return { label: "auto-resolved", tone: "ok" };
  if (row.decisionFounderOverrideAction) {
    return { label: `edited (${row.decisionFounderOverrideAction})`, tone: "warn" };
  }
  return { label: status ?? "pending", tone: "neutral" };
}

interface ToolCall {
  name: string;
  args?: unknown;
  result?: unknown;
}

interface GuardrailDecision {
  rule: string;
  outcome: string;
  detail?: string;
}

interface TraceMetadataShape {
  toolCalls?: ToolCall[];
  tool_calls?: ToolCall[];
  guardrails?: GuardrailDecision[];
  guardrailDecisions?: GuardrailDecision[];
}

function readToolCalls(meta: Record<string, unknown> | null): ToolCall[] {
  if (!meta) return [];
  const m = meta as TraceMetadataShape;
  const calls = m.toolCalls ?? m.tool_calls;
  if (!Array.isArray(calls)) return [];
  return calls as ToolCall[];
}

function readGuardrails(meta: Record<string, unknown> | null): GuardrailDecision[] {
  if (!meta) return [];
  const m = meta as TraceMetadataShape;
  const gs = m.guardrails ?? m.guardrailDecisions;
  if (!Array.isArray(gs)) return [];
  return gs as GuardrailDecision[];
}

function TraceRowSkeleton() {
  return (
    <Card className="rounded-card">
      <CardContent className="p-3.5">
        <div className="flex items-start gap-3">
          <Skeleton className="w-8 h-8 rounded-full shrink-0" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-3 w-3/4" />
            <Skeleton className="h-3 w-2/3" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ToneBadge({ label, tone }: { label: string; tone: "neutral" | "ok" | "warn" }) {
  const cls =
    tone === "ok"
      ? "bg-acr-pos-soft text-acr-pos"
      : tone === "warn"
      ? "bg-acr-warn-soft text-acr-warn"
      : "bg-muted text-muted-foreground";
  return (
    <Badge variant="secondary" className={`text-[10px] border-transparent ${cls}`}>
      {label}
    </Badge>
  );
}

export default function FounderPaxTracesPage() {
  useDocumentTitle("Pax traces — AcreOS");
  const [selected, setSelected] = React.useState<PaxTraceRow | null>(null);
  const [open, setOpen] = React.useState(false);

  const { data, isLoading, error, refetch } = useQuery<PaxTracesResponse>({
    queryKey: ["/api/founder/pax-traces"],
    refetchInterval: 60_000,
  });

  const openTrace = (row: PaxTraceRow) => {
    setSelected(row);
    setOpen(true);
  };

  return (
    <PageShell label="Pax traces">
      <div className="flex items-start justify-between mb-6 gap-4 flex-wrap">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <FileCode className="w-6 h-6 text-acr-brand" aria-hidden="true" />
            Pax traces
          </h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Every Pax LLM call — system prompt, user message, tool calls, guardrail
            decisions, token counts, latency, and how the resulting decision was
            dispositioned. Read-only. Refreshes every minute.
          </p>
        </div>
        {data && (
          <div className="flex items-center gap-2 shrink-0">
            <Badge variant="secondary" className="bg-acr-brand-soft text-acr-brand border-transparent tabular-nums">
              <Activity className="w-3 h-3 mr-1" aria-hidden="true" />
              {data.totals.total} total
            </Badge>
            {data.totals.errors > 0 && (
              <Badge variant="secondary" className="bg-acr-neg-soft text-acr-neg border-transparent tabular-nums">
                <AlertTriangle className="w-3 h-3 mr-1" aria-hidden="true" />
                {data.totals.errors} errors
              </Badge>
            )}
          </div>
        )}
      </div>

      {error && (
        <QueryErrorState
          error={error as Error}
          onRetry={() => refetch()}
          title="Couldn't load Pax traces"
          description="We hit a snag loading the trace list. Try again."
          testId="pax-traces-error"
        />
      )}

      {isLoading && (
        <div className="space-y-2" data-testid="pax-traces-loading">
          {Array.from({ length: 5 }).map((_, i) => (
            <TraceRowSkeleton key={i} />
          ))}
        </div>
      )}

      {!isLoading && !error && data && data.traces.length === 0 && (
        <EmptyState
          icon={FileCode}
          headline="No Pax traces yet"
          subtitle="Pax hasn't made any captured LLM calls in this environment yet. As soon as Pax runs an observation, negotiation, or support exchange, the trace will appear here."
          // TODO(cta): Pax traces are system-generated from LLM calls; no direct founder action
          cta={{ label: "", _noOp: true }}
          actionIcon={null}
          testId="pax-traces-empty"
        />
      )}

      {!isLoading && !error && data && data.traces.length > 0 && (
        <ul className="space-y-2" data-testid="pax-traces-list">
          {data.traces.map((row) => {
            const disp = dispositionLabel(row);
            const toolCount = readToolCalls(row.metadata).length;
            return (
              <li key={row.id}>
                <Card className="rounded-card hover:bg-muted/30 transition-colors">
                  <CardContent className="p-3.5">
                    <button
                      type="button"
                      onClick={() => openTrace(row)}
                      className="w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-card"
                      aria-label={`Open trace ${row.id} — ${row.purpose}`}
                      data-testid={`pax-trace-row-${row.id}`}
                    >
                      <div className="flex items-start gap-3">
                        <div
                          className={`w-8 h-8 rounded-full shrink-0 flex items-center justify-center ${
                            row.error
                              ? "bg-acr-neg-soft text-acr-neg"
                              : "bg-acr-brand-soft text-acr-brand"
                          }`}
                          aria-hidden="true"
                        >
                          {row.error ? (
                            <AlertTriangle className="w-4 h-4" />
                          ) : (
                            <CheckCircle2 className="w-4 h-4" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap mb-1">
                            <span className="font-medium text-sm truncate">{row.purpose}</span>
                            <Badge variant="secondary" className="text-[10px] border-transparent bg-muted text-muted-foreground">
                              {row.model}
                            </Badge>
                            <ToneBadge label={disp.label} tone={disp.tone} />
                            {toolCount > 0 && (
                              <Badge variant="secondary" className="text-[10px] border-transparent bg-muted text-muted-foreground">
                                {toolCount} tool {toolCount === 1 ? "call" : "calls"}
                              </Badge>
                            )}
                          </div>
                          <div className="flex items-center gap-3 text-[11px] text-muted-foreground tabular-nums flex-wrap">
                            <span className="inline-flex items-center gap-1">
                              <Clock className="w-3 h-3" aria-hidden="true" />
                              {fmtTimestamp(row.createdAt)}
                            </span>
                            <span>{fmtMs(row.latencyMs)}</span>
                            <span>
                              {(row.inputTokens ?? 0).toLocaleString()} in /{" "}
                              {(row.outputTokens ?? 0).toLocaleString()} out
                            </span>
                            <span className="inline-flex items-center gap-1">
                              <Coins className="w-3 h-3" aria-hidden="true" />
                              {fmtCents(row.costCents)}
                            </span>
                          </div>
                          <p className="text-xs text-muted-foreground line-clamp-1 mt-1">
                            {row.userPrompt}
                          </p>
                        </div>
                      </div>
                    </button>
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
          {selected && (
            <>
              <SheetHeader>
                <SheetTitle className="flex items-center gap-2">
                  <FileCode className="w-5 h-5 text-acr-brand" aria-hidden="true" />
                  Trace #{selected.id}
                </SheetTitle>
                <SheetDescription>
                  {selected.purpose} · {selected.model} · {fmtTimestamp(selected.createdAt)}
                </SheetDescription>
              </SheetHeader>

              <div className="mt-6 space-y-6">
                <Card className="rounded-card">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Disposition</CardTitle>
                  </CardHeader>
                  <CardContent className="text-sm space-y-1">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-muted-foreground">Decision status</span>
                      <ToneBadge {...dispositionLabel(selected)} />
                    </div>
                    {selected.decisionRecommendedAction && (
                      <div className="flex items-start justify-between gap-3">
                        <span className="text-muted-foreground">Recommended action</span>
                        <span className="text-right max-w-[60%] break-words">
                          {selected.decisionRecommendedAction}
                        </span>
                      </div>
                    )}
                    {selected.decisionResolvedBy && (
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-muted-foreground">Resolved by</span>
                        <span>{selected.decisionResolvedBy}</span>
                      </div>
                    )}
                    {selected.decisionFounderOverrideAction && (
                      <div className="flex items-start justify-between gap-3">
                        <span className="text-muted-foreground">Founder override</span>
                        <span className="text-right max-w-[60%] break-words">
                          {selected.decisionFounderOverrideAction}
                        </span>
                      </div>
                    )}
                  </CardContent>
                </Card>

                {readGuardrails(selected.metadata).length > 0 && (
                  <Card className="rounded-card">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm">Guardrail decisions</CardTitle>
                    </CardHeader>
                    <CardContent className="text-xs space-y-1.5">
                      {readGuardrails(selected.metadata).map((g, i) => (
                        <div key={i} className="flex items-start gap-2">
                          <Badge variant="secondary" className="text-[10px] border-transparent bg-muted text-muted-foreground shrink-0">
                            {g.rule}
                          </Badge>
                          <span className="text-muted-foreground">→</span>
                          <span>{g.outcome}</span>
                          {g.detail && (
                            <span className="text-muted-foreground">— {g.detail}</span>
                          )}
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                )}

                {readToolCalls(selected.metadata).length > 0 && (
                  <Card className="rounded-card">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm">Tool call timeline</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {readToolCalls(selected.metadata).map((tc, i) => (
                        <div key={i} className="border-l-2 border-acr-brand pl-3 space-y-1">
                          <div className="text-sm font-medium">{tc.name}</div>
                          {tc.args !== undefined && (
                            <pre className="text-[11px] bg-muted/60 rounded p-2 overflow-x-auto">
                              {JSON.stringify(tc.args, null, 2)}
                            </pre>
                          )}
                          {tc.result !== undefined && (
                            <pre className="text-[11px] bg-muted/60 rounded p-2 overflow-x-auto">
                              {JSON.stringify(tc.result, null, 2)}
                            </pre>
                          )}
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                )}

                {selected.systemPrompt && (
                  <Card className="rounded-card">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm">System prompt</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <pre className="text-[11px] whitespace-pre-wrap break-words bg-muted/60 rounded p-3 max-h-72 overflow-y-auto">
                        {selected.systemPrompt}
                      </pre>
                    </CardContent>
                  </Card>
                )}

                <Card className="rounded-card">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">User message</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <pre className="text-[11px] whitespace-pre-wrap break-words bg-muted/60 rounded p-3 max-h-72 overflow-y-auto">
                      {selected.userPrompt}
                    </pre>
                  </CardContent>
                </Card>

                <Card className="rounded-card">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Response</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <pre className="text-[11px] whitespace-pre-wrap break-words bg-muted/60 rounded p-3 max-h-96 overflow-y-auto">
                      {selected.response}
                    </pre>
                  </CardContent>
                </Card>

                {selected.error && (
                  <Card className="rounded-card border-acr-neg/30">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm text-acr-neg">Error</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <pre className="text-[11px] whitespace-pre-wrap break-words bg-acr-neg-soft rounded p-3 overflow-x-auto">
                        {selected.error}
                      </pre>
                    </CardContent>
                  </Card>
                )}

                {selected.metadata && Object.keys(selected.metadata).length > 0 && (
                  <Card className="rounded-card">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm">Raw metadata</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <pre className="text-[10px] bg-muted/60 rounded p-3 max-h-72 overflow-auto">
                        {JSON.stringify(selected.metadata, null, 2)}
                      </pre>
                    </CardContent>
                  </Card>
                )}

                <div className="flex justify-end pt-2">
                  <Button variant="outline" onClick={() => setOpen(false)}>
                    Close
                  </Button>
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </PageShell>
  );
}
