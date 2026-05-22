/**
 * /founder/inspector/:scope/:id — provenance lens.
 *
 * The microscope: per-agent, per-decision, per-audit deep dive. Every
 * "click here to see why" link in the founder UI routes through this
 * surface. Responsive parity: single-column scrolling on phone, side-by-
 * side data + actions on desktop.
 *
 * Routes handled:
 *   /founder/inspector/agent/:codename
 *   /founder/inspector/decision/:id
 *   /founder/inspector/audit               (no id — recent founder mutations feed)
 *   /founder/inspector/org/:id             (handed off to ./inspector/org.tsx)
 *   /founder/inspector/cost-event/:id      (handed off to ./inspector/cost-event.tsx)
 *   /founder/inspector/provider/:name      (handed off to ./inspector/provider.tsx)
 */

import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useRoute } from "wouter";

const OrgInspector = React.lazy(() => import("./inspector/org"));
const CostEventInspector = React.lazy(() => import("./inspector/cost-event"));
const ProviderInspector = React.lazy(() => import("./inspector/provider"));
import {
  Activity,
  ArrowLeft,
  ClipboardList,
  Cpu,
  Gauge,
  History,
  Tag as TagIcon,
  Zap,
} from "lucide-react";

import { PageShell } from "@/components/page-shell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useDocumentTitle } from "@/hooks/use-document-title";

interface AgentInspectorResponse {
  agent: {
    codename: string;
    title: string;
    trustScore: number;
    status: string;
    personalityPromptHash: string;
    metrics: unknown;
  };
  windowDays: number;
  trustCurve: Array<{
    id: number;
    previousScore: number;
    newScore: number;
    delta: number;
    reason: string;
    createdAt: string;
  }>;
  actionStats: {
    total: number;
    succeeded: number;
    failed: number;
    escalated: number;
  };
  recentDecisions: Array<{
    id: number;
    itemType: string;
    status: string;
    sophieAnalysis: string;
    recommendedActionLabel: string;
    createdAt: string;
  }>;
  rejectionSummary: {
    totalCount: number;
    windowDays: number;
    topTags: Array<{ tag: string; count: number }>;
    mostRecentNote: string | null;
    mostRecentAt: string | null;
  };
  promptHistory: Array<{
    id: number;
    proposalReason: string;
    status: string;
    createdAt?: string;
  }>;
  recentTraces: Array<{
    id: number;
    purpose: string;
    model: string;
    latencyMs: number | null;
    inputTokens: number | null;
    outputTokens: number | null;
    costCents: number | null;
    error: string | null;
    decisionId: number | null;
    createdAt: string;
  }>;
}

export default function FounderInspectorRouter() {
  const [agentMatch, agentParams] = useRoute<{ codename: string }>("/founder/inspector/agent/:codename");
  const [decisionMatch, decisionParams] = useRoute<{ id: string }>("/founder/inspector/decision/:id");
  const [auditMatch] = useRoute("/founder/inspector/audit");
  const [orgMatch] = useRoute("/founder/inspector/org/:id");
  const [costEventMatch] = useRoute("/founder/inspector/cost-event/:id");
  const [providerMatch] = useRoute("/founder/inspector/provider/:name");

  if (agentMatch && agentParams) {
    return <AgentInspector codename={agentParams.codename} />;
  }
  if (decisionMatch && decisionParams) {
    return <DecisionInspector id={decisionParams.id} />;
  }
  if (auditMatch) {
    return <AuditInspector />;
  }
  if (orgMatch) {
    return (
      <React.Suspense fallback={<PageShell label="Org inspector"><div className="text-sm text-muted-foreground">Loading…</div></PageShell>}>
        <OrgInspector />
      </React.Suspense>
    );
  }
  if (costEventMatch) {
    return (
      <React.Suspense fallback={<PageShell label="Cost event"><div className="text-sm text-muted-foreground">Loading…</div></PageShell>}>
        <CostEventInspector />
      </React.Suspense>
    );
  }
  if (providerMatch) {
    return (
      <React.Suspense fallback={<PageShell label="Provider audit"><div className="text-sm text-muted-foreground">Loading…</div></PageShell>}>
        <ProviderInspector />
      </React.Suspense>
    );
  }

  return (
    <PageShell label="Inspector">
      <p className="text-sm text-muted-foreground">
        Choose a scope:{" "}
        <Link href="/founder/inspector/audit" className="underline">audit</Link>, or open from an
        agent/decision/org/cost-event/provider link.
      </p>
    </PageShell>
  );
}

function AgentInspector({ codename }: { codename: string }) {
  useDocumentTitle(`${codename} — Inspector`);
  const { data, isLoading } = useQuery<AgentInspectorResponse>({
    queryKey: [`/api/founder/inspector/agent/${codename}`],
  });

  if (isLoading || !data) {
    return (
      <PageShell label="Agent inspector">
        <Skeleton className="h-32 w-full" />
      </PageShell>
    );
  }

  const { agent, actionStats, recentDecisions, rejectionSummary, promptHistory, recentTraces, trustCurve } = data;

  const successPct = actionStats.total > 0 ? Math.round((actionStats.succeeded / actionStats.total) * 100) : null;

  return (
    <PageShell label={`${agent.title} — Inspector`}>
      <div className="space-y-6">
        <header className="space-y-2">
          <Link href="/founder" className="text-xs text-muted-foreground inline-flex items-center gap-1 hover:underline">
            <ArrowLeft className="w-3 h-3" aria-hidden="true" /> Back to Now
          </Link>
          <div className="flex flex-wrap items-end gap-3 justify-between">
            <div>
              <h1 className="text-2xl md:text-3xl font-bold tracking-tight">
                {agent.title}{" "}
                <span className="font-mono text-sm text-muted-foreground">{agent.codename}</span>
              </h1>
              <p className="text-xs text-muted-foreground">
                Window: last {data.windowDays} days · prompt fingerprint{" "}
                <code className="font-mono">{agent.personalityPromptHash}</code>
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline" className="gap-1">
                <Gauge className="w-3 h-3" aria-hidden="true" /> trust {agent.trustScore}
              </Badge>
              <Badge variant={agent.status === "active" ? "default" : "secondary"}>{agent.status}</Badge>
            </div>
          </div>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          <Stat label="Actions" value={String(actionStats.total)} icon={Activity} />
          <Stat label="Success rate" value={successPct === null ? "—" : `${successPct}%`} icon={Zap} />
          <Stat label="Failed" value={String(actionStats.failed)} icon={History} />
          <Stat label="Rejections" value={String(rejectionSummary.totalCount)} icon={ClipboardList} />
        </div>

        <Section title="Trust curve" subtitle="Recent evolution log entries; +/− deltas tied to outcome verification + decision accuracy">
          {trustCurve.length === 0 ? (
            <Empty msg="No trust events yet" />
          ) : (
            <div className="space-y-1.5">
              {trustCurve.map((entry) => (
                <div
                  key={entry.id}
                  className="flex flex-wrap gap-3 items-center text-sm border-b border-border/40 pb-1.5"
                >
                  <span className="font-mono text-xs text-muted-foreground w-32">
                    {new Date(entry.createdAt).toLocaleString()}
                  </span>
                  <span className="font-mono">
                    {entry.previousScore} → {entry.newScore}
                  </span>
                  <Badge variant={entry.delta >= 0 ? "default" : "destructive"} className="font-mono">
                    {entry.delta > 0 ? "+" : ""}
                    {entry.delta}
                  </Badge>
                  <span className="text-xs text-muted-foreground flex-1 min-w-[200px]">{entry.reason}</span>
                </div>
              ))}
            </div>
          )}
        </Section>

        <Section title="Rejection signal" subtitle="Founder rejections in this window — top tags and most recent note">
          {rejectionSummary.totalCount === 0 ? (
            <Empty msg="No rejections in this window" />
          ) : (
            <div className="space-y-2">
              <div className="flex flex-wrap gap-2">
                {rejectionSummary.topTags.map((t) => (
                  <Badge key={t.tag} variant="outline" className="gap-1 font-mono text-xs">
                    <TagIcon className="w-3 h-3" aria-hidden="true" /> {t.tag} × {t.count}
                  </Badge>
                ))}
              </div>
              {rejectionSummary.mostRecentNote && (
                <p className="text-sm italic text-muted-foreground border-l-2 border-primary/30 pl-3">
                  "{rejectionSummary.mostRecentNote}"
                </p>
              )}
            </div>
          )}
        </Section>

        <Section title="Recent decisions" subtitle="Items that landed in the decisions inbox owned by this agent">
          {recentDecisions.length === 0 ? (
            <Empty msg="No decisions in this window" />
          ) : (
            <div className="space-y-2">
              {recentDecisions.slice(0, 20).map((d) => (
                <Link key={d.id} href={`/founder/inspector/decision/${d.id}`}>
                  <a className="block hover:bg-muted/30 rounded p-2 -mx-2 transition-colors">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <Badge variant="outline" className="text-xs">{d.itemType}</Badge>
                      <Badge variant={d.status === "approved" ? "default" : d.status === "rejected" ? "destructive" : "secondary"} className="text-xs">
                        {d.status}
                      </Badge>
                      <span>{new Date(d.createdAt).toLocaleString()}</span>
                    </div>
                    <p className="text-sm font-medium mt-0.5 line-clamp-1">{d.recommendedActionLabel}</p>
                    <p className="text-xs text-muted-foreground line-clamp-1">{d.sophieAnalysis}</p>
                  </a>
                </Link>
              ))}
            </div>
          )}
        </Section>

        <Section title="Prompt evolution history" subtitle="Founder-reviewable revisions; ties into /founder/prompt-evolutions">
          {promptHistory.length === 0 ? (
            <Empty msg="No proposed prompt changes" />
          ) : (
            <div className="space-y-1.5">
              {promptHistory.map((h) => (
                <div key={h.id} className="text-sm border-b border-border/40 pb-1.5">
                  <div className="flex items-center gap-2">
                    <Badge variant={h.status === "applied" ? "default" : h.status === "rejected" ? "destructive" : "secondary"} className="text-xs">
                      {h.status}
                    </Badge>
                    <code className="font-mono text-xs">#{h.id}</code>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{h.proposalReason}</p>
                </div>
              ))}
            </div>
          )}
        </Section>

        <Section title="Recent LLM traces" subtitle="Per-call telemetry; click a decision id to see its full trace lineage">
          {recentTraces.length === 0 ? (
            <Empty msg="No traces in this window" />
          ) : (
            <div className="space-y-1 font-mono text-xs">
              {recentTraces.map((t) => (
                <div key={t.id} className="flex flex-wrap items-center gap-2 border-b border-border/40 pb-1">
                  <span className="text-muted-foreground w-32 shrink-0">
                    {new Date(t.createdAt).toLocaleTimeString()}
                  </span>
                  <Badge variant="outline" className="text-xs">{t.model}</Badge>
                  <span className="flex-1 min-w-[120px]">{t.purpose}</span>
                  <span className="text-muted-foreground">
                    {t.inputTokens ?? "?"}→{t.outputTokens ?? "?"} tok
                  </span>
                  {t.latencyMs !== null && <span className="text-muted-foreground">{t.latencyMs}ms</span>}
                  {t.costCents !== null && (
                    <span className="text-muted-foreground">${(t.costCents / 100).toFixed(3)}</span>
                  )}
                  {t.decisionId && (
                    <Link href={`/founder/inspector/decision/${t.decisionId}`} className="underline">
                      → decision {t.decisionId}
                    </Link>
                  )}
                  {t.error && <Badge variant="destructive" className="text-xs">err</Badge>}
                </div>
              ))}
            </div>
          )}
        </Section>
      </div>
    </PageShell>
  );
}

function DecisionInspector({ id }: { id: string }) {
  useDocumentTitle(`Decision ${id} — Inspector`);
  const { data, isLoading } = useQuery<{
    decision: Record<string, unknown>;
    traces: Array<Record<string, unknown>>;
    audit: Array<Record<string, unknown>>;
  }>({
    queryKey: [`/api/founder/inspector/decision/${id}`],
  });

  if (isLoading || !data) {
    return (
      <PageShell label="Decision inspector">
        <Skeleton className="h-32 w-full" />
      </PageShell>
    );
  }

  return (
    <PageShell label={`Decision ${id}`}>
      <div className="space-y-6">
        <header>
          <Link href="/founder" className="text-xs text-muted-foreground inline-flex items-center gap-1 hover:underline">
            <ArrowLeft className="w-3 h-3" aria-hidden="true" /> Back to Now
          </Link>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Decision #{id}</h1>
        </header>

        <Section title="Decision record">
          <pre className="bg-muted/30 rounded p-3 text-xs overflow-x-auto">
            {JSON.stringify(data.decision, null, 2)}
          </pre>
        </Section>

        <Section title={`Traces (${data.traces.length})`} subtitle="LLM call lineage tied to this decision">
          {data.traces.length === 0 ? (
            <Empty msg="No traces recorded for this decision" />
          ) : (
            <pre className="bg-muted/30 rounded p-3 text-xs overflow-x-auto max-h-[60vh]">
              {JSON.stringify(data.traces, null, 2)}
            </pre>
          )}
        </Section>

        <Section title={`Audit entries (${data.audit.length})`} subtitle="Founder actions targeting this decision">
          {data.audit.length === 0 ? (
            <Empty msg="No audit entries for this decision" />
          ) : (
            <pre className="bg-muted/30 rounded p-3 text-xs overflow-x-auto">
              {JSON.stringify(data.audit, null, 2)}
            </pre>
          )}
        </Section>
      </div>
    </PageShell>
  );
}

function AuditInspector() {
  useDocumentTitle("Audit — Inspector");
  const { data, isLoading } = useQuery<{
    entries: Array<{
      id: number;
      founderId: string | null;
      area: string;
      action: string;
      targetType: string | null;
      targetId: string | null;
      note: string | null;
      createdAt: string;
    }>;
  }>({
    queryKey: ["/api/founder/inspector/audit"],
    refetchInterval: 60_000,
  });

  return (
    <PageShell label="Audit">
      <div className="space-y-4">
        <header>
          <Link href="/founder" className="text-xs text-muted-foreground inline-flex items-center gap-1 hover:underline">
            <ArrowLeft className="w-3 h-3" aria-hidden="true" /> Back to Now
          </Link>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Founder audit log</h1>
          <p className="text-sm text-muted-foreground">Every founder-visible mutation — settings edits, decision overrides, agent toggles.</p>
        </header>

        {isLoading || !data ? (
          <Skeleton className="h-64 w-full" />
        ) : data.entries.length === 0 ? (
          <Empty msg="No audit entries yet" />
        ) : (
          <div className="space-y-1.5">
            {data.entries.map((e) => (
              <div key={e.id} className="text-sm border-b border-border/40 pb-1.5">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <Badge variant="outline">{e.area}</Badge>
                  <Badge variant="secondary" className="font-mono">{e.action}</Badge>
                  {e.targetType && (
                    <span className="text-muted-foreground font-mono">
                      {e.targetType}:{e.targetId ?? "—"}
                    </span>
                  )}
                  <span className="text-muted-foreground ml-auto">{new Date(e.createdAt).toLocaleString()}</span>
                </div>
                {e.note && <p className="text-xs text-muted-foreground italic mt-0.5">"{e.note}"</p>}
              </div>
            ))}
          </div>
        )}
      </div>
    </PageShell>
  );
}

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{title}</h2>
        {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
      </div>
      {children}
    </section>
  );
}

function Stat({ label, value, icon: Icon }: { label: string; value: string; icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }> }) {
  return (
    <Card>
      <CardContent className="p-3 flex items-center gap-3">
        <Icon className="w-4 h-4 text-muted-foreground" aria-hidden />
        <div>
          <div className="text-xs text-muted-foreground">{label}</div>
          <div className="text-lg font-bold tabular-nums">{value}</div>
        </div>
      </CardContent>
    </Card>
  );
}

function Empty({ msg }: { msg: string }) {
  return <p className="text-xs text-muted-foreground italic">{msg}</p>;
}
