/**
 * FounderTracesPage — agent action-replay.
 *
 * Every LLM call an agent makes writes a row to agent_llm_traces. This
 * page lists recent traces and lets the founder expand any row to see
 * the exact prompt + response — the canonical answer to "why did the
 * system do that?"
 *
 * Roadmap top-20 #8 (action-replay) + #10 (reasoning-trace viewer).
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FileCode, ChevronDown, ChevronRight, Clock } from "lucide-react";
import { relative, dollars } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { useDocumentTitle } from "@/hooks/use-document-title";

interface TraceSummary {
  id: number;
  agentCodename: string;
  purpose: string;
  decisionId: number | null;
  model: string;
  latencyMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  costCents: number | null;
  error: string | null;
  createdAt: string;
}

interface TraceDetail extends TraceSummary {
  organizationId: number | null;
  systemPrompt: string | null;
  userPrompt: string;
  response: string;
  metadata: Record<string, unknown>;
}

const AGENT_CHOICES = ["pax", "sophie_csm", "forge_revenue", "atlas_cto", "beacon_marketing", "ledger_finance"];

export default function FounderTracesPage() {
  useDocumentTitle("Agent traces");
  const [agentFilter, setAgentFilter] = useState<string>("all");

  const { data, isLoading, isError } = useQuery<{ traces: TraceSummary[] }>({
    queryKey: [
      `/api/founder/intelligence/traces${agentFilter === "all" ? "" : `?agent=${agentFilter}`}`,
    ],
    staleTime: 30_000,
  });

  const traces = data?.traces ?? [];

  return (
    <PageShell label="Agent Traces">
      <div className="space-y-6 max-w-5xl mx-auto">
        <PageHeader
          title="Agent traces"
          icon={<FileCode className="h-5 w-5 text-muted-foreground" />}
          description="Every LLM call an agent makes lands here — the exact prompt sent, the exact response received, model, latency, token usage. Expand a row to see the full trace. This is the canonical answer to 'why did the system do that?'"
          actions={
            <Select value={agentFilter} onValueChange={setAgentFilter}>
              <SelectTrigger className="w-[180px]" data-testid="select-trace-agent">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All agents</SelectItem>
                {AGENT_CHOICES.map((a) => (
                  <SelectItem key={a} value={a}>
                    {a}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          }
        />

        {isLoading ? (
          <Card>
            <CardContent className="p-6 space-y-3">
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
            </CardContent>
          </Card>
        ) : isError ? (
          <Card>
            <CardContent className="p-6 text-sm text-red-600">
              Could not load traces.
            </CardContent>
          </Card>
        ) : traces.length === 0 ? (
          <EmptyState
            icon={FileCode}
            title="No traces yet"
            description={
              agentFilter === "all"
                ? "Agent LLM calls will start appearing here as they happen."
                : `No traces logged for ${agentFilter}. Try a different agent.`
            }
          />
        ) : (
          <div className="space-y-2">
            {traces.map((t) => (
              <TraceRow key={t.id} trace={t} />
            ))}
          </div>
        )}
      </div>
    </PageShell>
  );
}

function TraceRow({ trace }: { trace: TraceSummary }) {
  const [expanded, setExpanded] = useState(false);
  const { data: detailData, isLoading } = useQuery<{ trace: TraceDetail }>({
    queryKey: [`/api/founder/intelligence/traces/${trace.id}`],
    enabled: expanded,
    staleTime: 60 * 60_000, // traces are immutable
  });
  const detail = detailData?.trace;

  return (
    <Card>
      <CardContent className="p-3 space-y-2">
        <button
          className="w-full flex items-center gap-3 text-left"
          onClick={() => setExpanded((v) => !v)}
          data-testid={`trace-toggle-${trace.id}`}
        >
          {expanded ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
          )}
          <Badge variant="secondary" className="text-[10px] font-mono">
            {trace.agentCodename}
          </Badge>
          <span className="text-sm font-medium text-foreground">{trace.purpose}</span>
          <Badge variant="outline" className="text-[10px]">{trace.model}</Badge>
          {trace.error ? (
            <Badge variant="outline" className="text-[10px] border-rose-500/30 text-rose-600">
              Error
            </Badge>
          ) : null}
          <span className="ml-auto flex items-center gap-2 text-xs text-muted-foreground shrink-0">
            {trace.latencyMs != null && (
              <>
                <Clock className="h-3 w-3" />
                {trace.latencyMs}ms
              </>
            )}
            {trace.costCents != null && <span>{dollars(trace.costCents)}</span>}
            {relative(trace.createdAt)}
          </span>
        </button>

        {expanded && (
          <div className="pt-2 border-t space-y-3">
            {isLoading ? (
              <Skeleton className="h-24 w-full" />
            ) : detail ? (
              <>
                {detail.error && (
                  <div className="rounded-md bg-rose-500/5 border border-rose-500/30 p-2 text-xs text-rose-700 dark:text-rose-300 font-mono whitespace-pre-wrap">
                    {detail.error}
                  </div>
                )}
                {detail.systemPrompt && (
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">System prompt</p>
                    <pre className="rounded-md border bg-muted/30 text-[11px] font-mono leading-5 px-3 py-2 max-h-[240px] overflow-auto whitespace-pre-wrap">
                      {detail.systemPrompt}
                    </pre>
                  </div>
                )}
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">User prompt</p>
                  <pre className="rounded-md border bg-muted/30 text-[11px] font-mono leading-5 px-3 py-2 max-h-[240px] overflow-auto whitespace-pre-wrap">
                    {detail.userPrompt}
                  </pre>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Response</p>
                  <pre className="rounded-md border bg-muted/30 text-[11px] font-mono leading-5 px-3 py-2 max-h-[360px] overflow-auto whitespace-pre-wrap">
                    {detail.response}
                  </pre>
                </div>
                {(detail.inputTokens != null || detail.outputTokens != null) && (
                  <p className="text-[11px] text-muted-foreground">
                    {detail.inputTokens != null && <>in: {detail.inputTokens} </>}
                    {detail.outputTokens != null && <>out: {detail.outputTokens}</>}
                  </p>
                )}
              </>
            ) : null}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
