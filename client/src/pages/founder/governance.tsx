import { useState, useId } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ClearedEmpty } from "@/components/empty-state";
import { QueryErrorState } from "@/components/query-error-state";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Shield, AlertTriangle, CheckCircle, Clock,
  MessageSquare, ChevronDown, ChevronUp,
  ThumbsUp, ThumbsDown, XCircle,
} from "lucide-react";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useToast } from "@/hooks/use-toast";
import { usd } from "@/lib/format";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { relative } from "@/lib/format";
import { DataProvenanceChip } from "@/components/data-provenance-chip";
import {
  useAgentNegotiations,
  useFounderOverrides,
  useConfidenceCascade,
} from "@/hooks/use-sovereign-dashboard";

function NegotiationCard({ negotiation }: { negotiation: any }) {
  const [expanded, setExpanded] = useState(false);
  const [pendingResolution, setPendingResolution] = useState<"approved" | "rejected" | null>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const detailsId = useId();
  const topicLabel = negotiation.topic ?? negotiation.subject ?? "Agent negotiation";

  const resolveMutation = useMutation({
    mutationFn: async (resolution: string) => {
      // Real server route (routes-founder-anticipatory-enterprise.ts): CEO
      // override — the old /negotiation/:id/resolve path never existed.
      const res = await fetch(`/api/founder/v11/negotiations/${negotiation.id}/override`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ override: resolution }),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to resolve negotiation");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/founder/v11/negotiations/active"] });
    },
    onError: () =>
      toast({
        title: "Couldn't resolve negotiation",
        description: "The negotiation is unchanged. Try again, or refresh to check current state.",
        variant: "destructive",
      }),
  });

  return (
    <Card>
      <CardContent className="pt-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3 min-w-0">
            <MessageSquare className="w-4 h-4 text-primary shrink-0" aria-hidden="true" />
            <div className="min-w-0">
              <p className="font-medium text-sm">{topicLabel}</p>
              <p className="text-xs text-muted-foreground">
                {negotiation.participants?.join(", ") ?? "Multiple agents"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge
              variant={
                negotiation.status === "resolved" ? "default" :
                negotiation.status === "escalated" ? "destructive" :
                "secondary"
              }
              className="capitalize"
            >
              {negotiation.status}
            </Badge>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="min-h-9 min-w-9"
              onClick={() => setExpanded(!expanded)}
              aria-expanded={expanded}
              aria-controls={detailsId}
              aria-label={`${expanded ? "Collapse" : "Expand"} ${topicLabel}`}
            >
              {expanded ? <ChevronUp className="w-4 h-4" aria-hidden="true" /> : <ChevronDown className="w-4 h-4" aria-hidden="true" />}
            </Button>
          </div>
        </div>

        {expanded && (
          <div id={detailsId} className="mt-4 space-y-3 pl-7">
            {negotiation.summary && (
              <p className="text-sm text-muted-foreground">{negotiation.summary}</p>
            )}

            {negotiation.messages && Array.isArray(negotiation.messages) && (
              <ol className="space-y-2 border-l-2 pl-3" aria-label={`Recent messages in ${topicLabel}`}>
                {negotiation.messages.slice(-5).map((msg: any, i: number) => (
                  <li key={i} className="text-xs">
                    <span className="font-medium">{msg.agent ?? msg.from}:</span>{" "}
                    <span className="text-muted-foreground">{msg.content ?? msg.message}</span>
                  </li>
                ))}
              </ol>
            )}

            {negotiation.status === "escalated" && (
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={() => setPendingResolution("approved")}
                  disabled={resolveMutation.isPending}
                  aria-label={`Approve "${topicLabel}"`}
                >
                  <ThumbsUp className="w-3 h-3 mr-1" aria-hidden="true" /> Approve
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => setPendingResolution("rejected")}
                  disabled={resolveMutation.isPending}
                  aria-label={`Reject "${topicLabel}"`}
                >
                  <ThumbsDown className="w-3 h-3 mr-1" aria-hidden="true" /> Reject
                </Button>
              </div>
            )}

            <AlertDialog open={!!pendingResolution} onOpenChange={(open) => { if (!open) setPendingResolution(null); }}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    {pendingResolution === "approved" ? "Approve this decision?" : "Reject this decision?"}
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    {pendingResolution === "approved"
                      ? `You're approving this decision regarding "${topicLabel}". The system will proceed with the proposed action.`
                      : `You're rejecting this decision regarding "${topicLabel}". The system will not proceed and may escalate to you again later.`}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={() => {
                    if (pendingResolution) {
                      resolveMutation.mutate(pendingResolution);
                      setPendingResolution(null);
                    }
                  }}>
                    Yes, {pendingResolution === "approved" ? "approve" : "reject"} it
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>

            {negotiation.createdAt && (
              <p className="text-xs text-muted-foreground tabular-nums">
                Started {relative(negotiation.createdAt)}
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** Shaped loading placeholder for a list of governance cards. */
function ListSkeleton({ label, rows = 3 }: { label: string; rows?: number }) {
  return (
    <div role="status" aria-busy="true" className="space-y-4">
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} announce={false} className="h-24 w-full rounded-card" />
      ))}
    </div>
  );
}

export default function FounderGovernancePage() {
  useDocumentTitle("Governance");
  const { data: negotiations = [], isLoading: negLoading, error: negError, refetch: refetchNeg } = useAgentNegotiations();
  const { data: overrides = [], isLoading: overridesLoading, error: overridesError, refetch: refetchOverrides } = useFounderOverrides();
  const { data: cascade = [], isLoading: cascadeLoading, error: cascadeError, refetch: refetchCascade } = useConfidenceCascade();

  const escalated = Array.isArray(negotiations) ? negotiations.filter((n: any) => n.status === "escalated") : [];

  return (
    <PageShell>
      <div className="space-y-6 md:space-y-8">
        {/* Header */}
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Shield className="w-6 h-6 text-primary" aria-hidden="true" />
            Governance
          </h1>
          <p className="text-sm text-muted-foreground">
            The AI board — agent negotiations, delegation authority, trust enforcement, and founder overrides.
          </p>
        </div>

        {escalated.length > 0 && (
          <Card className="border-acr-neg-soft bg-acr-neg-soft dark:border-acr-neg-soft dark:bg-acr-neg-soft" role="alert">
            <CardContent className="pt-4">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-acr-neg" aria-hidden="true" />
                <p className="font-medium text-sm text-acr-neg dark:text-acr-neg">
                  <span className="tabular-nums">{escalated.length}</span> negotiation{escalated.length > 1 ? "s" : ""} require{escalated.length === 1 ? "s" : ""} your attention.
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        <Tabs defaultValue="negotiations">
          <TabsList>
            <TabsTrigger value="negotiations">
              Negotiations {Array.isArray(negotiations) && negotiations.length > 0 && (
                <Badge variant="secondary" className="ml-1 tabular-nums">{negotiations.length}</Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="overrides">Overrides</TabsTrigger>
            <TabsTrigger value="cascade">Confidence</TabsTrigger>
          </TabsList>

          <TabsContent value="negotiations" className="space-y-4">
            {negLoading ? (
              <ListSkeleton label="Loading negotiations…" />
            ) : negError ? (
              <QueryErrorState
                error={negError as Error}
                onRetry={() => refetchNeg()}
                testId="governance-negotiations-error"
              />
            ) : Array.isArray(negotiations) && negotiations.length > 0 ? (
              <ul className="space-y-4" aria-label="Active agent negotiations">
                {negotiations.map((neg: any) => (
                  <li key={neg.id}><NegotiationCard negotiation={neg} /></li>
                ))}
              </ul>
            ) : (
              <ClearedEmpty
                headline="No active negotiations"
                subtitle="Agents are operating harmoniously. Disagreements that need your call land here."
              />
            )}
          </TabsContent>



          <TabsContent value="overrides" className="space-y-4">
            {overridesLoading ? (
              <ListSkeleton label="Loading override history…" />
            ) : overridesError ? (
              <QueryErrorState
                error={overridesError as Error}
                onRetry={() => refetchOverrides()}
                testId="governance-overrides-error"
              />
            ) : Array.isArray(overrides) && overrides.length > 0 ? (
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Override history</CardTitle>
                </CardHeader>
                <CardContent>
                  <ol className="space-y-3 max-h-96 overflow-y-auto" aria-label="Founder override history, newest first">
                    {overrides.map((override: any, i: number) => (
                      <li key={override.id ?? i} className="border-b last:border-0 pb-3">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <p className="font-medium text-sm">{override.reason ?? override.description ?? "Manual override"}</p>
                          <Badge className="capitalize">{override.type ?? "override"}</Badge>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1 tabular-nums">
                          Agent: {override.agent ?? override.targetAgent ?? "System"} ·{" "}
                          {override.createdAt && relative(override.createdAt)}
                        </p>
                        {override.learningApplied && (
                          <p className="text-xs text-acr-pos mt-1">Learning applied to future decisions.</p>
                        )}
                      </li>
                    ))}
                  </ol>
                </CardContent>
              </Card>
            ) : (
              <ClearedEmpty
                headline="No founder overrides recorded"
                subtitle="When you override an agent decision from a conversation, it's logged here and the learning is applied forward."
              />
            )}
          </TabsContent>

          <TabsContent value="cascade" className="space-y-4">
            {cascadeLoading ? (
              <ListSkeleton label="Loading confidence cascade…" />
            ) : cascadeError ? (
              <QueryErrorState
                error={cascadeError as Error}
                onRetry={() => refetchCascade()}
                testId="governance-cascade-error"
              />
            ) : Array.isArray(cascade) && cascade.length > 0 ? (
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Confidence cascade — multi-layer resolution</CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-3 max-h-96 overflow-y-auto" aria-label="Confidence cascade decisions">
                    {cascade.map((item: any, i: number) => (
                      <li key={item.id ?? i} className="border-b last:border-0 pb-3">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <p className="font-medium text-sm">{item.question ?? item.decision ?? "Decision point"}</p>
                          <Badge variant={item.resolvedAt ? "default" : "secondary"}>
                            {item.resolvedBy ?? (item.resolvedAt ? "Resolved" : "Pending")}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1 tabular-nums flex items-center gap-2 flex-wrap">
                          <DataProvenanceChip
                            source="Confidence cascade"
                            classification="modeled"
                            confidence={item.confidence != null ? item.confidence * 100 : null}
                          />
                          <span>Layer: {item.layer ?? "unknown"}</span>
                        </p>
                        {item.layers && Array.isArray(item.layers) && (
                          <ul className="mt-2 flex gap-1 flex-wrap" aria-label="Resolution layers">
                            {item.layers.map((layer: any, j: number) => (
                              <li key={j}>
                                <Badge variant={layer.resolved ? "default" : "outline"} className="text-xs">
                                  {layer.name}
                                </Badge>
                              </li>
                            ))}
                          </ul>
                        )}
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            ) : (
              <ClearedEmpty
                headline="No confidence cascade events"
                subtitle="Decisions are resolving at the first layer — nothing has needed multi-layer escalation."
              />
            )}
          </TabsContent>
        </Tabs>
      </div>
    </PageShell>
  );
}
