import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  Shield, Users, AlertTriangle, CheckCircle, Clock,
  MessageSquare, Gavel, ChevronDown, ChevronUp,
  ThumbsUp, ThumbsDown, XCircle,
} from "lucide-react";
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

  const resolveMutation = useMutation({
    mutationFn: async (resolution: string) => {
      const res = await fetch(`/api/founder/v11/negotiation/${negotiation.id}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resolution }),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to resolve negotiation");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/founder/v11/negotiation/active"] });
    },
  });

  return (
    <Card>
      <CardContent className="pt-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <MessageSquare className="w-4 h-4 text-primary" />
            <div>
              <p className="font-medium text-sm">{negotiation.topic ?? negotiation.subject ?? "Agent Negotiation"}</p>
              <p className="text-xs text-muted-foreground">
                {negotiation.participants?.join(", ") ?? "Multiple agents"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={
              negotiation.status === "resolved" ? "default" :
              negotiation.status === "escalated" ? "destructive" :
              "secondary"
            }>
              {negotiation.status}
            </Badge>
            <Button variant="ghost" size="sm" onClick={() => setExpanded(!expanded)}>
              {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </Button>
          </div>
        </div>

        {expanded && (
          <div className="mt-4 space-y-3 pl-7">
            {negotiation.summary && (
              <p className="text-sm text-muted-foreground">{negotiation.summary}</p>
            )}

            {negotiation.messages && Array.isArray(negotiation.messages) && (
              <div className="space-y-2 border-l-2 pl-3">
                {negotiation.messages.slice(-5).map((msg: any, i: number) => (
                  <div key={i} className="text-xs">
                    <span className="font-medium">{msg.agent ?? msg.from}:</span>{" "}
                    <span className="text-muted-foreground">{msg.content ?? msg.message}</span>
                  </div>
                ))}
              </div>
            )}

            {negotiation.status === "escalated" && (
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={() => setPendingResolution("approved")}
                  disabled={resolveMutation.isPending}
                >
                  <ThumbsUp className="w-3 h-3 mr-1" /> Approve
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => setPendingResolution("rejected")}
                  disabled={resolveMutation.isPending}
                >
                  <ThumbsDown className="w-3 h-3 mr-1" /> Reject
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
                      ? `You're approving this decision regarding "${negotiation.topic ?? negotiation.subject ?? "this negotiation"}". The system will proceed with the proposed action.`
                      : `You're rejecting this decision regarding "${negotiation.topic ?? negotiation.subject ?? "this negotiation"}". The system will not proceed and may escalate to you again later.`}
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
              <p className="text-xs text-muted-foreground">
                Started {relative(negotiation.createdAt)}
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function BoardOfDirectors() {
  const { data: negotiations = [], isLoading: negLoading } = useAgentNegotiations();
  const { data: tokens = [], isLoading: tokensLoading } = useDelegationTokens();
  const { data: trustLog = [], isLoading: trustLoading } = useTrustEnforcement();
  const { data: overrides = [], isLoading: overridesLoading } = useFounderOverrides();
  const { data: cascade = [], isLoading: cascadeLoading } = useConfidenceCascade();

  const isLoading = negLoading || tokensLoading;

  const escalated = Array.isArray(negotiations) ? negotiations.filter((n: any) => n.status === "escalated") : [];
  const activeTokens = Array.isArray(tokens) ? tokens.filter((t: any) => t.status === "active") : [];

  return (
    <PageShell isLoading={isLoading}>
      <div className="space-y-6 md:space-y-8">
        {/* Header */}
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Shield className="w-6 h-6 text-primary" />
            Board of Directors
          </h1>
          <p className="text-sm text-muted-foreground">
            Agent negotiations, delegation authority, trust enforcement, and founder overrides
          </p>
        </div>

        {/* Escalation Alert */}
        {escalated.length > 0 && (
          <Card className="border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950">
            <CardContent className="pt-4">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-red-500" />
                <p className="font-medium text-sm text-red-700 dark:text-red-400">
                  {escalated.length} negotiation{escalated.length > 1 ? "s" : ""} require{escalated.length === 1 ? "s" : ""} your attention
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        <Tabs defaultValue="negotiations">
          <TabsList>
            <TabsTrigger value="negotiations">
              Negotiations {Array.isArray(negotiations) && negotiations.length > 0 && (
                <Badge variant="secondary" className="ml-1">{negotiations.length}</Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="delegation">Delegation</TabsTrigger>
            <TabsTrigger value="trust">Trust Log</TabsTrigger>
            <TabsTrigger value="overrides">Overrides</TabsTrigger>
            <TabsTrigger value="cascade">Confidence</TabsTrigger>
          </TabsList>

          {/* Negotiations */}
          <TabsContent value="negotiations" className="space-y-4">
            {Array.isArray(negotiations) && negotiations.length > 0 ? (
              negotiations.map((neg: any) => (
                <NegotiationCard key={neg.id} negotiation={neg} />
              ))
            ) : (
              <Card>
                <CardContent className="pt-6 text-center text-sm text-muted-foreground">
                  No active negotiations. Agents are operating harmoniously.
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* Delegation Tokens */}
          <TabsContent value="delegation" className="space-y-4">
            {Array.isArray(tokens) && tokens.length > 0 ? (
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Active Delegation Tokens</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {tokens.map((token: any) => (
                      <div key={token.id} className="flex items-center justify-between text-sm border-b last:border-0 pb-2">
                        <div>
                          <p className="font-medium">{token.agentCodename ?? token.grantedTo}</p>
                          <p className="text-xs text-muted-foreground">
                            Scope: {token.scope ?? "general"} · Max: ${token.maxAmountCents ? (token.maxAmountCents / 100).toLocaleString() : "N/A"}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant={token.status === "active" ? "default" : "secondary"}>
                            {token.status}
                          </Badge>
                          {token.usageCount != null && (
                            <span className="text-xs text-muted-foreground">Used {token.usageCount}x</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardContent className="pt-6 text-center text-sm text-muted-foreground">
                  No delegation tokens active. Grant tokens to allow agents autonomous spending authority.
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* Trust Enforcement Log */}
          <TabsContent value="trust" className="space-y-4">
            {Array.isArray(trustLog) && trustLog.length > 0 ? (
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Trust Enforcement Events</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2 max-h-96 overflow-y-auto">
                    {trustLog.slice(0, 30).map((entry: any, i: number) => (
                      <div key={entry.id ?? i} className="flex items-center justify-between text-sm border-b last:border-0 pb-2">
                        <div className="flex items-center gap-2">
                          {entry.action === "allowed" || entry.action === "approved" ? (
                            <CheckCircle className="w-3.5 h-3.5 text-green-500" />
                          ) : entry.action === "blocked" || entry.action === "denied" ? (
                            <XCircle className="w-3.5 h-3.5 text-red-500" />
                          ) : (
                            <Clock className="w-3.5 h-3.5 text-yellow-500" />
                          )}
                          <div>
                            <span className="font-medium">{entry.agent ?? entry.subject}</span>
                            <span className="text-muted-foreground"> · {entry.description ?? entry.reason ?? entry.action}</span>
                          </div>
                        </div>
                        {entry.createdAt && (
                          <span className="text-xs text-muted-foreground">
                            {relative(entry.createdAt)}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardContent className="pt-6 text-center text-sm text-muted-foreground">
                  No trust enforcement events recorded yet.
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* Founder Overrides */}
          <TabsContent value="overrides" className="space-y-4">
            {Array.isArray(overrides) && overrides.length > 0 ? (
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Override History</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3 max-h-96 overflow-y-auto">
                    {overrides.map((override: any, i: number) => (
                      <div key={override.id ?? i} className="border-b last:border-0 pb-3">
                        <div className="flex items-center justify-between">
                          <p className="font-medium text-sm">{override.reason ?? override.description ?? "Manual Override"}</p>
                          <Badge>{override.type ?? "override"}</Badge>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">
                          Agent: {override.agent ?? override.targetAgent ?? "System"} ·{" "}
                          {override.createdAt && relative(override.createdAt)}
                        </p>
                        {override.learningApplied && (
                          <p className="text-xs text-green-600 mt-1">Learning applied to future decisions</p>
                        )}
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardContent className="pt-6 text-center text-sm text-muted-foreground">
                  No founder overrides recorded. Use the agent conversation view to override decisions.
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* Confidence Cascade */}
          <TabsContent value="cascade" className="space-y-4">
            {Array.isArray(cascade) && cascade.length > 0 ? (
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Confidence Cascade — Multi-Layer Resolution</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3 max-h-96 overflow-y-auto">
                    {cascade.map((item: any, i: number) => (
                      <div key={item.id ?? i} className="border-b last:border-0 pb-3">
                        <div className="flex items-center justify-between">
                          <p className="font-medium text-sm">{item.question ?? item.decision ?? "Decision Point"}</p>
                          <Badge variant={item.resolvedAt ? "default" : "secondary"}>
                            {item.resolvedBy ?? (item.resolvedAt ? "Resolved" : "Pending")}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">
                          Confidence: {item.confidence != null ? `${Math.round(item.confidence * 100)}%` : "N/A"} ·{" "}
                          Layer: {item.layer ?? "unknown"}
                        </p>
                        {item.layers && Array.isArray(item.layers) && (
                          <div className="mt-2 flex gap-1">
                            {item.layers.map((layer: any, j: number) => (
                              <Badge key={j} variant={layer.resolved ? "default" : "outline"} className="text-xs">
                                {layer.name}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardContent className="pt-6 text-center text-sm text-muted-foreground">
                  No confidence cascade events. Decisions resolved at first layer.
                </CardContent>
              </Card>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </PageShell>
  );
}
