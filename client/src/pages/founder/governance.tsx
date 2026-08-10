import { useState, useId } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
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
import {
  useAgentNegotiations,
  useDelegationTokens,
  useTrustEnforcement,
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

/** Shell-less body — rendered as the "Governance" tab of the agents hub
 *  (/founder/admin/agents?tab=governance, F1 slice 4). */
export function GovernanceContent() {
  const { data: negotiations = [], isLoading: negLoading, error: negError, refetch: refetchNeg } = useAgentNegotiations();
  const { data: tokens = [], isLoading: tokensLoading, error: tokensError, refetch: refetchTokens } = useDelegationTokens();
  const { data: trustLog = [], isLoading: trustLoading, error: trustError, refetch: refetchTrust } = useTrustEnforcement();
  const { data: overrides = [], isLoading: overridesLoading, error: overridesError, refetch: refetchOverrides } = useFounderOverrides();
  const { data: cascade = [], isLoading: cascadeLoading, error: cascadeError, refetch: refetchCascade } = useConfidenceCascade();

  const escalated = Array.isArray(negotiations) ? negotiations.filter((n: any) => n.status === "escalated") : [];

  return (
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
            <TabsTrigger value="delegation">Delegation</TabsTrigger>
            <TabsTrigger value="trust">Trust log</TabsTrigger>
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

          <TabsContent value="delegation" className="space-y-4">
            {tokensLoading ? (
              <ListSkeleton label="Loading delegation tokens…" />
            ) : tokensError ? (
              <QueryErrorState
                error={tokensError as Error}
                onRetry={() => refetchTokens()}
                testId="governance-delegation-error"
              />
            ) : Array.isArray(tokens) && tokens.length > 0 ? (
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Active delegation tokens</CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-3" aria-label="Active delegation tokens">
                    {tokens.map((token: any) => (
                      <li key={token.id} className="flex items-center justify-between text-sm border-b last:border-0 pb-2 gap-3 flex-wrap">
                        <div className="min-w-0">
                          <p className="font-medium">{token.agentCodename ?? token.grantedTo}</p>
                          <p className="text-xs text-muted-foreground tabular-nums">
                            Scope: {token.scope ?? "general"} · Max: {token.maxAmountCents ? usd(token.maxAmountCents / 100) : "N/A"}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant={token.status === "active" ? "default" : "secondary"} className="capitalize">
                            {token.status}
                          </Badge>
                          {token.usageCount != null && (
                            <span className="text-xs text-muted-foreground tabular-nums">Used {token.usageCount}x</span>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            ) : (
              <EmptyState
                framed
                icon={Shield}
                headline="No delegation tokens active"
                subtitle="Grant tokens to give agents bounded autonomous spending authority. Tokens are issued from agent conversations when an agent asks for budget."
                // TODO(cta): read-only governance ledger — tokens are granted
                // from agent conversations, not from this surface.
                cta={{ label: "", _noOp: true }}
                testId="governance-delegation-empty"
              />
            )}
          </TabsContent>

          <TabsContent value="trust" className="space-y-4">
            {trustLoading ? (
              <ListSkeleton label="Loading trust enforcement log…" />
            ) : trustError ? (
              <QueryErrorState
                error={trustError as Error}
                onRetry={() => refetchTrust()}
                testId="governance-trust-error"
              />
            ) : Array.isArray(trustLog) && trustLog.length > 0 ? (
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Trust enforcement events</CardTitle>
                </CardHeader>
                <CardContent>
                  <ol className="space-y-2 max-h-96 overflow-y-auto" aria-label="Trust enforcement log, newest first">
                    {trustLog.slice(0, 30).map((entry: any, i: number) => {
                      const isAllowed = entry.action === "allowed" || entry.action === "approved";
                      const isBlocked = entry.action === "blocked" || entry.action === "denied";
                      const actionLabel = isAllowed ? "Allowed" : isBlocked ? "Blocked" : "Pending";
                      return (
                        <li key={entry.id ?? i} className="flex items-center justify-between text-sm border-b last:border-0 pb-2 gap-3 flex-wrap">
                          <div className="flex items-center gap-2 min-w-0">
                            {isAllowed ? (
                              <CheckCircle className="w-3.5 h-3.5 text-acr-pos" aria-label={actionLabel} />
                            ) : isBlocked ? (
                              <XCircle className="w-3.5 h-3.5 text-acr-neg" aria-label={actionLabel} />
                            ) : (
                              <Clock className="w-3.5 h-3.5 text-acr-warn" aria-label={actionLabel} />
                            )}
                            <div className="min-w-0">
                              <span className="font-medium">{entry.agent ?? entry.subject}</span>
                              <span className="text-muted-foreground"> · {entry.description ?? entry.reason ?? entry.action}</span>
                            </div>
                          </div>
                          {entry.createdAt && (
                            <span className="text-xs text-muted-foreground tabular-nums">
                              {relative(entry.createdAt)}
                            </span>
                          )}
                        </li>
                      );
                    })}
                  </ol>
                </CardContent>
              </Card>
            ) : (
              <EmptyState
                framed
                icon={CheckCircle}
                headline="No trust enforcement events yet"
                subtitle="Every allowed or blocked agent action is recorded here as agents operate against their trust tiers."
                // TODO(cta): read-only audit log — populated by the trust
                // enforcement layer, no user action available.
                cta={{ label: "", _noOp: true }}
                testId="governance-trust-empty"
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
                        <p className="text-xs text-muted-foreground mt-1 tabular-nums">
                          Confidence: {item.confidence != null ? `${Math.round(item.confidence * 100)}%` : "N/A"} ·{" "}
                          Layer: {item.layer ?? "unknown"}
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
  );
}
