/**
 * FounderPromptHistoryPage — per-agent prompt version timeline with
 * diffs between consecutive versions.
 *
 * Companion to /founder/prompt-evolutions (which shows *proposed*
 * changes). This page shows what actually landed — every version
 * that's ever been promoted, who promoted it, when it was rolled
 * back if ever, and a side-by-side diff against the prior version.
 *
 * Use when:
 *   - debugging a behavior regression ("what changed in Sophie since
 *     last month?")
 *   - auditing change history after an incident
 *   - reviewing prompt-evolution velocity per agent
 */

import { useState, useId } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { History, GitBranch } from "lucide-react";
import { relative, shortDateTime } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { PromptDiffViewer } from "@/components/prompt-diff-viewer";
import { useDocumentTitle } from "@/hooks/use-document-title";

interface Version {
  id: number;
  versionNumber: number;
  personalityPrompt: string;
  changeDescription: string;
  isActive: boolean;
  canaryWeight: number;
  deployedAt: string | null;
  rolledBackAt: string | null;
  createdBy: string;
  createdAt: string;
}

interface AgentSummary {
  agentCodename: string;
  versionCount: number;
  latestVersion: number;
}

export default function FounderPromptHistoryPage() {
  useDocumentTitle("Prompt history");
  const agentSelectId = useId();
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const { data: agentsData, isLoading: agentsLoading } = useQuery<{ agents: AgentSummary[] }>({
    queryKey: ["/api/founder/intelligence/prompt-history/agents"],
    staleTime: 5 * 60_000,
  });
  const agents = agentsData?.agents ?? [];

  if (!selectedAgent && agents.length > 0) {
    setSelectedAgent(agents[0].agentCodename);
  }

  const { data: historyData, isLoading: historyLoading } = useQuery<{
    agentCodename: string;
    versions: Version[];
  }>({
    queryKey: [`/api/founder/intelligence/prompt-history?agent=${selectedAgent ?? ""}`],
    enabled: !!selectedAgent,
    staleTime: 60_000,
  });
  const versions = historyData?.versions ?? [];

  function toggle(id: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <PageShell label="Prompt History">
      <div className="space-y-6 max-w-5xl mx-auto">
        <PageHeader
          title="Prompt history"
          icon={<History className="h-5 w-5 text-muted-foreground" aria-hidden="true" />}
          description="Every version that's ever been promoted for an agent, newest first. Expand a version to diff it against the one immediately before. Use this to track behavior drift, audit what changed when, and sanity-check prompt-evolution velocity per agent."
          actions={
            <div className="flex items-center gap-2">
              <Label htmlFor={agentSelectId} className="sr-only">Pick an agent</Label>
              <Select
                value={selectedAgent ?? ""}
                onValueChange={(v) => {
                  setSelectedAgent(v);
                  setExpanded(new Set());
                }}
                disabled={agentsLoading || agents.length === 0}
              >
                <SelectTrigger id={agentSelectId} className="w-[200px]" data-testid="select-agent" aria-label="Pick an agent">
                  <SelectValue placeholder="Pick an agent" />
                </SelectTrigger>
                <SelectContent>
                  {agents.map((a) => (
                    <SelectItem key={a.agentCodename} value={a.agentCodename}>
                      {a.agentCodename}{" "}
                      <span className="text-muted-foreground tabular-nums">
                        ({a.versionCount} version{a.versionCount === 1 ? "" : "s"})
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          }
        />

        {historyLoading ? (
          <Card>
            <CardContent className="p-6 space-y-3" role="status" aria-live="polite">
              <span className="sr-only">Loading prompt history…</span>
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
            </CardContent>
          </Card>
        ) : !selectedAgent ? (
          <EmptyState
            icon={GitBranch}
            title="No agents with history yet"
            description="Once the meta-agent ships its first prompt change, versions will start accumulating here."
          />
        ) : versions.length === 0 ? (
          <EmptyState
            icon={History}
            title={`No versions recorded for ${selectedAgent}`}
            description="Either this agent hasn't had a prompt change yet, or its history predates version control."
          />
        ) : (
          <ol className="space-y-3" aria-label={`${selectedAgent} version timeline`}>
            {versions.map((v, idx) => {
              const prev = versions[idx + 1];
              const isExpanded = expanded.has(v.id);
              return (
                <VersionRow
                  key={v.id}
                  version={v}
                  prev={prev}
                  isExpanded={isExpanded}
                  onToggle={() => toggle(v.id)}
                />
              );
            })}
          </ol>
        )}
      </div>
    </PageShell>
  );
}

function VersionRow({
  version: v,
  prev,
  isExpanded,
  onToggle,
}: {
  version: Version;
  prev: Version | undefined;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const detailsId = useId();
  const toggleLabel = isExpanded ? "Hide diff" : prev ? `Diff vs v${prev.versionNumber}` : "Show prompt";
  return (
    <li>
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="secondary" className="text-xs tabular-nums">
                  v{v.versionNumber}
                </Badge>
                {v.isActive && v.canaryWeight === 100 && (
                  <Badge className="text-xs bg-acr-pos/15 text-acr-pos dark:text-acr-pos border-acr-pos/30">
                    Live
                  </Badge>
                )}
                {v.isActive && v.canaryWeight < 100 && (
                  <Badge variant="outline" className="text-xs">
                    Canary <span className="tabular-nums ml-0.5">{v.canaryWeight}%</span>
                  </Badge>
                )}
                {v.rolledBackAt && (
                  <Badge variant="outline" className="text-xs text-acr-neg border-acr-neg/30">
                    Rolled back
                  </Badge>
                )}
                <span className="text-xs text-muted-foreground">
                  by {v.createdBy} · <span className="tabular-nums">{relative(v.createdAt)}</span>
                </span>
              </div>
              <p className="text-sm font-medium text-foreground mt-1.5">
                {v.changeDescription}
              </p>
              {(v.deployedAt || v.rolledBackAt) && (
                <p className="text-caption text-muted-foreground mt-0.5 tabular-nums">
                  {v.deployedAt && `Deployed ${shortDateTime(v.deployedAt)}`}
                  {v.deployedAt && v.rolledBackAt && " · "}
                  {v.rolledBackAt && `Rolled back ${shortDateTime(v.rolledBackAt)}`}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={onToggle}
              className="text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded border shrink-0 min-h-9"
              aria-expanded={isExpanded}
              aria-controls={detailsId}
              aria-label={`${toggleLabel} for v${v.versionNumber}`}
              data-testid={`toggle-version-${v.id}`}
            >
              {toggleLabel}
            </button>
          </div>

          {isExpanded && (
            <div id={detailsId} className="pt-2 border-t">
              {prev ? (
                <PromptDiffViewer
                  current={prev.personalityPrompt}
                  proposed={v.personalityPrompt}
                />
              ) : (
                <pre className="rounded-md border bg-muted/30 text-[11px] font-mono leading-5 px-3 py-2 max-h-[480px] overflow-auto whitespace-pre-wrap">
                  {v.personalityPrompt}
                </pre>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </li>
  );
}
