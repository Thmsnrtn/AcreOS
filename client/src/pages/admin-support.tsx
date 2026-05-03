import { useId, useState, type FormEvent } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Headphones, AlertTriangle, CheckCircle, Clock, Users, TrendingUp, MessageSquare, Send, ArrowLeft, User, Bot, Loader2, Timer, Building2, Activity, FileText, BookmarkPlus } from "lucide-react";
import { PageShell } from "@/components/page-shell";
import type { SupportCase, SupportMessage, SlaStatus } from "@shared/schema";

type SupportMetrics = {
  totalCases: number;
  openCases: number;
  escalatedCases: number;
  resolvedCases: number;
  avgSatisfaction: number;
  autoResolvedRate: number;
};

type SupportCaseWithSla = SupportCase & {
  slaDeadline?: string;
  slaStatus?: SlaStatus;
  hoursUntilBreached?: number;
};

type CaseWithMessages = {
  case: SupportCaseWithSla;
  messages: SupportMessage[];
  actions: any[];
};

function getSlaColor(status: SlaStatus | undefined): string {
  switch (status) {
    case "breached": return "bg-acr-neg/10 text-acr-neg dark:text-acr-neg border-acr-neg/20";
    case "at_risk": return "bg-acr-warn/10 text-acr-warn dark:text-acr-warn border-acr-warn/20";
    case "on_track": return "bg-acr-pos/10 text-acr-pos dark:text-acr-pos border-acr-pos/20";
    default: return "bg-muted text-muted-foreground border-border";
  }
}

function formatSlaTime(hoursUntilBreached: number | undefined): string {
  if (hoursUntilBreached === undefined) return "";
  const abs = Math.abs(hoursUntilBreached);
  if (abs < 1) {
    const mins = Math.round(abs * 60);
    return hoursUntilBreached < 0 ? `${mins}m overdue` : `${mins}m left`;
  }
  if (abs < 24) {
    const h = Math.round(abs);
    return hoursUntilBreached < 0 ? `${h}h overdue` : `${h}h left`;
  }
  const d = Math.round(abs / 24);
  return hoursUntilBreached < 0 ? `${d}d overdue` : `${d}d left`;
}

function getPriorityColor(priority: number): string {
  switch (priority) {
    case 5:
      return "bg-acr-neg/10 text-acr-neg dark:text-acr-neg border-acr-neg/20";
    case 4:
      return "bg-acr-warn/10 text-acr-warn dark:text-acr-warn border-acr-warn/20";
    case 3:
      return "bg-acr-warn/10 text-acr-warn dark:text-acr-warn border-acr-warn/20";
    case 2:
      return "bg-acr-accent/10 text-acr-accent dark:text-acr-accent border-acr-accent/20";
    default:
      return "bg-muted text-muted-foreground border-border";
  }
}

function getPriorityLabel(priority: number): string {
  switch (priority) {
    case 5:
      return "Critical";
    case 4:
      return "High";
    case 3:
      return "Medium";
    case 2:
      return "Normal";
    default:
      return "Low";
  }
}

function formatDate(date: string | Date | null | undefined): string {
  if (!date) return "";
  return new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatTimeAgo(date: string | Date | null | undefined): string {
  if (!date) return "";
  const now = new Date();
  const past = new Date(date);
  const diffMs = now.getTime() - past.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${diffDays}d ago`;
}

function MetricCard({
  title,
  value,
  subtitle,
  icon: Icon,
  testId
}: {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: any;
  testId: string;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2 space-y-0">
        <CardTitle className="text-sm font-medium" id={`${testId}-label`}>{title}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
      </CardHeader>
      <CardContent>
        <div
          className="text-2xl font-bold tabular-nums"
          data-testid={testId}
          aria-labelledby={`${testId}-label`}
        >{value}</div>
        {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
      </CardContent>
    </Card>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Customer-context sidebar (Olu §7 #5 — operator does not have to "go look up
// the org" before replying). Backed by GET /api/admin/support/customer-context.
// ────────────────────────────────────────────────────────────────────────────

interface CustomerContextResponse {
  organization: {
    id: number;
    name: string;
    slug: string;
    tier: string;
    billingInterval: string;
    subscriptionStatus: string;
    mrrCents: number;
    signupDate: string | null;
    dunningStage: string | null;
    isFounder: boolean;
  };
  openTickets: number;
  recentActivity: Array<{
    id: string;
    action: string;
    actorEmail: string | null;
    createdAt: string;
  }>;
  notes: Array<{ id: number; caseId: number; content: string; createdAt: string | null }>;
}

function CustomerContextSidebar({ organizationId, excludeCaseId }: { organizationId: number | null; excludeCaseId?: number | null }) {
  const { data, isLoading } = useQuery<CustomerContextResponse>({
    queryKey: ["/api/admin/support/customer-context", organizationId, excludeCaseId],
    queryFn: async () => {
      const url = excludeCaseId
        ? `/api/admin/support/customer-context/${organizationId}?excludeCaseId=${excludeCaseId}`
        : `/api/admin/support/customer-context/${organizationId}`;
      const r = await apiRequest("GET", url);
      return r.json();
    },
    enabled: !!organizationId,
    staleTime: 30_000,
  });

  if (!organizationId) {
    return (
      <Card>
        <CardContent className="p-4 text-sm text-muted-foreground" data-testid="customer-context-empty">
          Select a case to see customer context.
        </CardContent>
      </Card>
    );
  }
  if (isLoading || !data) {
    return (
      <Card>
        <CardContent className="p-4 space-y-2" role="status" aria-label="Loading customer context">
          <div className="animate-pulse h-4 bg-muted rounded w-32" />
          <div className="animate-pulse h-3 bg-muted rounded w-24" />
          <div className="animate-pulse h-3 bg-muted rounded w-40" />
        </CardContent>
      </Card>
    );
  }
  const o = data.organization;
  const mrrLabel = o.mrrCents > 0 ? `$${(o.mrrCents / 100).toFixed(0)}/mo` : "—";
  return (
    <Card data-testid="customer-context-sidebar">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Building2 className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
          Customer context
        </CardTitle>
        <CardDescription>Everything you need before you reply.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <dl className="space-y-1 text-sm">
          <div className="flex items-center justify-between gap-2">
            <dt className="text-muted-foreground">Org</dt>
            <dd className="font-medium truncate" data-testid="ctx-org-name">{o.name}</dd>
          </div>
          <div className="flex items-center justify-between gap-2">
            <dt className="text-muted-foreground">Tier</dt>
            <dd>
              <Badge variant="secondary" className="capitalize">{o.tier}</Badge>
            </dd>
          </div>
          <div className="flex items-center justify-between gap-2">
            <dt className="text-muted-foreground">MRR</dt>
            <dd className="tabular-nums" data-testid="ctx-mrr">{mrrLabel}</dd>
          </div>
          <div className="flex items-center justify-between gap-2">
            <dt className="text-muted-foreground">Signup</dt>
            <dd className="tabular-nums">{o.signupDate ? new Date(o.signupDate).toLocaleDateString() : "—"}</dd>
          </div>
          <div className="flex items-center justify-between gap-2">
            <dt className="text-muted-foreground">Status</dt>
            <dd className="capitalize">{o.subscriptionStatus}{o.dunningStage && o.dunningStage !== "none" ? ` · ${o.dunningStage.replace(/_/g, " ")}` : ""}</dd>
          </div>
          <div className="flex items-center justify-between gap-2">
            <dt className="text-muted-foreground">Open tickets</dt>
            <dd className="tabular-nums" data-testid="ctx-open-tickets">{data.openTickets}</dd>
          </div>
        </dl>

        <div>
          <h4 className="text-xs font-semibold text-foreground mb-2 flex items-center gap-1.5">
            <Activity className="w-3.5 h-3.5 text-muted-foreground" aria-hidden="true" />
            Recent activity
          </h4>
          {data.recentActivity.length === 0 ? (
            <p className="text-xs text-muted-foreground">No recent activity in audit log.</p>
          ) : (
            <ul className="space-y-1.5 list-none p-0 m-0" aria-label="Recent activity">
              {data.recentActivity.map((a) => (
                <li key={a.id} className="text-xs">
                  <span className="text-foreground">{a.action.replace(/_/g, " ")}</span>
                  <span className="text-muted-foreground">
                    {a.actorEmail ? ` · ${a.actorEmail}` : ""}
                    {" · "}
                    {formatTimeAgo(a.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <h4 className="text-xs font-semibold text-foreground mb-2 flex items-center gap-1.5">
            <FileText className="w-3.5 h-3.5 text-muted-foreground" aria-hidden="true" />
            Previous notes
          </h4>
          {data.notes.length === 0 ? (
            <p className="text-xs text-muted-foreground">No prior human-support notes.</p>
          ) : (
            <ul className="space-y-2 list-none p-0 m-0" aria-label="Previous interaction notes">
              {data.notes.map((n) => (
                <li key={n.id} className="text-xs p-2 rounded border border-border bg-muted/30">
                  <p className="line-clamp-3 text-foreground">{n.content}</p>
                  <p className="text-muted-foreground mt-1">Case #{n.caseId} · {formatTimeAgo(n.createdAt)}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Saved-replies panel (Olu §7 #6 — pre-canned operator responses).
// Backed by /api/admin/support/saved-replies.
// ────────────────────────────────────────────────────────────────────────────

interface SavedReply {
  id: number;
  organizationId: number | null;
  name: string;
  body: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

function SavedRepliesPanel({
  organizationId,
  onInsert,
}: {
  organizationId: number | null;
  onInsert: (body: string) => void;
}) {
  const { data, isLoading } = useQuery<{ replies: SavedReply[] }>({
    queryKey: ["/api/admin/support/saved-replies", organizationId],
    queryFn: async () => {
      const url = organizationId
        ? `/api/admin/support/saved-replies?organizationId=${organizationId}`
        : `/api/admin/support/saved-replies`;
      const r = await apiRequest("GET", url);
      return r.json();
    },
    staleTime: 60_000,
  });
  const replies = data?.replies ?? [];

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <BookmarkPlus className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
          Saved replies
        </CardTitle>
        <CardDescription>Click to insert into the composer.</CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="p-4 text-xs text-muted-foreground" role="status">Loading…</div>
        ) : replies.length === 0 ? (
          <div className="p-4 text-xs text-muted-foreground" data-testid="saved-replies-empty">
            No saved replies yet. Create one from any case to start a library.
          </div>
        ) : (
          <ul className="divide-y list-none p-0 m-0" aria-label="Saved replies">
            {replies.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  className="w-full text-left p-3 hover:bg-muted/40 transition"
                  onClick={() => onInsert(r.body)}
                  data-testid={`saved-reply-${r.id}`}
                  aria-label={`Insert saved reply: ${r.name}`}
                >
                  <p className="text-sm font-medium truncate">{r.name}</p>
                  <p className="text-xs text-muted-foreground line-clamp-2">{r.body}</p>
                  {r.organizationId && (
                    <span className="text-[10px] text-muted-foreground italic">org-scoped</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

const reassurance = "Your response is still in the input — try again.";

export default function AdminSupportPage() {
  useDocumentTitle("Admin support");
  const { toast } = useToast();
  const [selectedCaseId, setSelectedCaseId] = useState<number | null>(null);
  const [responseMessage, setResponseMessage] = useState("");
  const [shouldResolve, setShouldResolve] = useState(false);
  const responseId = useId();
  const resolveId = useId();

  const { data: metrics, isLoading: metricsLoading } = useQuery<SupportMetrics>({
    queryKey: ["/api/admin/support/metrics"],
  });

  const { data: escalatedCases, isLoading: casesLoading } = useQuery<SupportCaseWithSla[]>({
    queryKey: ["/api/admin/support/escalated"],
  });

  const { data: caseDetails, isLoading: detailsLoading } = useQuery<CaseWithMessages>({
    queryKey: ["/api/support/cases", selectedCaseId],
    enabled: !!selectedCaseId,
  });

  const respondMutation = useMutation({
    mutationFn: async ({ caseId, message, resolve }: { caseId: number; message: string; resolve: boolean }) => {
      const res = await apiRequest("POST", `/api/admin/support/cases/${caseId}/respond`, { message, resolve });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/support/escalated"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/support/metrics"] });
      queryClient.invalidateQueries({ queryKey: ["/api/support/cases", selectedCaseId] });
      setResponseMessage("");
      setShouldResolve(false);
      toast({
        title: shouldResolve ? "Case resolved" : "Response sent",
        description: shouldResolve 
          ? "The case has been marked as resolved." 
          : "Your response has been sent to the user.",
      });
      if (shouldResolve) {
        setSelectedCaseId(null);
      }
    },
    onError: (err: any) => {
      toast({
        title: "Couldn't send response",
        description: `${err.message || "Network error"}. ${reassurance}`,
        variant: "destructive",
      });
    },
  });

  const handleSendResponse = () => {
    if (!responseMessage.trim() || !selectedCaseId || respondMutation.isPending) return;
    respondMutation.mutate({
      caseId: selectedCaseId,
      message: responseMessage,
      resolve: shouldResolve,
    });
  };

  const handleResponseSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    handleSendResponse();
  };

  const selectedCase = escalatedCases?.find(c => c.id === selectedCaseId);
  const messages = caseDetails?.messages || [];

  return (
    <PageShell label="Admin support">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold" data-testid="text-page-title">Admin support dashboard</h1>
            <p className="text-muted-foreground">Manage escalated support cases and track resolution metrics.</p>
          </div>

          {metricsLoading ? (
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4" role="status" aria-label="Loading support metrics">
              {[...Array(5)].map((_, i) => (
                <Card key={i}>
                  <CardContent className="p-6">
                    <div className="animate-pulse space-y-2">
                      <div className="h-4 bg-muted rounded w-20" />
                      <div className="h-6 bg-muted rounded w-12" />
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <MetricCard
                title="Total cases"
                value={metrics?.totalCases || 0}
                icon={MessageSquare}
                testId="metric-total-cases"
              />
              <MetricCard
                title="Open cases"
                value={metrics?.openCases || 0}
                icon={Clock}
                testId="metric-open-cases"
              />
              <MetricCard
                title="Escalated"
                value={metrics?.escalatedCases || 0}
                icon={AlertTriangle}
                testId="metric-escalated-cases"
              />
              <MetricCard
                title="Auto-resolve rate"
                value={`${Math.round((metrics?.autoResolvedRate || 0) * 100)}%`}
                icon={TrendingUp}
                testId="metric-auto-resolve-rate"
              />
              <MetricCard
                title="Average satisfaction"
                value={metrics?.avgSatisfaction ? `${metrics.avgSatisfaction.toFixed(1)}/5` : "N/A"}
                icon={Users}
                testId="metric-avg-satisfaction"
              />
            </div>
          )}

          {escalatedCases && escalatedCases.some(c => c.slaStatus === "breached") && (
            <div
              className="flex items-center gap-3 p-4 rounded-lg border border-acr-neg/30 bg-acr-neg/10 text-acr-neg dark:text-acr-neg"
              data-testid="alert-sla-breach"
              role="alert"
            >
              <AlertTriangle className="w-5 h-5 flex-shrink-0" aria-hidden="true" />
              <div>
                <span className="font-semibold">SLA breach — </span>
                {(() => {
                  const n = escalatedCases.filter(c => c.slaStatus === "breached").length;
                  return `${n} ${n === 1 ? "ticket has" : "tickets have"} exceeded their response time target and require immediate attention.`;
                })()}
              </div>
            </div>
          )}

          <div className="grid lg:grid-cols-[360px_1fr_320px] gap-6">
            <Card className="lg:h-[calc(100vh-320px)]">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5 text-destructive" aria-hidden="true" />
                  Escalated cases
                </CardTitle>
                <CardDescription>Cases requiring human attention</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <ScrollArea className="h-[calc(100vh-480px)] lg:h-[calc(100vh-420px)]">
                  {casesLoading ? (
                    <div className="p-4 text-center text-muted-foreground" role="status" aria-label="Loading escalated cases">
                      <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2" aria-hidden="true" />
                      Loading cases…
                    </div>
                  ) : !escalatedCases?.length ? (
                    <div className="p-6 text-center" data-testid="empty-escalated-cases">
                      <CheckCircle className="w-10 h-10 mx-auto mb-3 text-acr-pos" aria-hidden="true" />
                      <p className="font-medium">No escalated cases</p>
                      <p className="text-muted-foreground text-sm mt-1">
                        All support cases are being handled by AI
                      </p>
                    </div>
                  ) : (
                    <ul className="divide-y list-none p-0 m-0" aria-label="Escalated support cases">
                      {escalatedCases.map((c) => {
                        const isActive = selectedCaseId === c.id;
                        const slaSummary = c.slaStatus
                          ? `, SLA ${c.slaStatus.replace(/_/g, " ")}: ${formatSlaTime(c.hoursUntilBreached)}`
                          : "";
                        return (
                          <li key={c.id}>
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedCaseId(c.id);
                                setResponseMessage("");
                                setShouldResolve(false);
                              }}
                              aria-current={isActive ? "true" : undefined}
                              aria-label={`${c.subject}, priority ${getPriorityLabel(c.priority)}, ${c.category}, escalated ${formatTimeAgo(c.escalatedAt)}${slaSummary}`}
                              className={`w-full p-4 text-left hover-elevate transition-colors ${
                                isActive ? "bg-accent" : ""
                              }`}
                              data-testid={`button-case-${c.id}`}
                            >
                              <div className="flex items-start justify-between gap-2 mb-2">
                                <span className="font-medium text-sm line-clamp-1" data-testid={`text-case-subject-${c.id}`}>
                                  {c.subject}
                                </span>
                                <Badge
                                  variant="outline"
                                  className={getPriorityColor(c.priority)}
                                  aria-label={`Priority: ${getPriorityLabel(c.priority)}`}
                                >
                                  {getPriorityLabel(c.priority)}
                                </Badge>
                              </div>
                              <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                                <span>User: {c.userId?.substring(0, 8) || "Unknown"}</span>
                                <span className="text-muted-foreground/50" aria-hidden="true">|</span>
                                <span className="capitalize">{c.category}</span>
                              </div>
                              <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                                <div className="flex items-center gap-1">
                                  <Clock className="w-3 h-3" aria-hidden="true" />
                                  <span>Escalated {formatTimeAgo(c.escalatedAt)}</span>
                                </div>
                                {c.slaStatus && (
                                  <Badge
                                    variant="outline"
                                    className={`text-xs tabular-nums ${getSlaColor(c.slaStatus)}`}
                                    data-testid={`badge-sla-${c.id}`}
                                    aria-label={`SLA status: ${c.slaStatus.replace(/_/g, " ")}, ${formatSlaTime(c.hoursUntilBreached)}`}
                                  >
                                    <Timer className="w-3 h-3 mr-1" aria-hidden="true" />
                                    {formatSlaTime(c.hoursUntilBreached)}
                                  </Badge>
                                )}
                              </div>
                              {c.escalationReason && (
                                <p className="text-xs text-muted-foreground mt-2 line-clamp-2 italic">
                                  {c.escalationReason}
                                </p>
                              )}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </ScrollArea>
              </CardContent>
            </Card>

            <Card className="lg:h-[calc(100vh-320px)] flex flex-col">
              {!selectedCaseId ? (
                <div className="flex-1 flex items-center justify-center p-6" data-testid="empty-case-detail">
                  <div className="text-center">
                    <Headphones className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
                    <h3 className="text-lg font-medium mb-2">Select a case</h3>
                    <p className="text-muted-foreground text-sm max-w-sm">
                      Choose an escalated case from the list to view details and respond.
                    </p>
                  </div>
                </div>
              ) : detailsLoading ? (
                <div className="flex-1 flex items-center justify-center" role="status" aria-label="Loading case details">
                  <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" aria-hidden="true" />
                </div>
              ) : (
                <>
                  <CardHeader className="pb-3 border-b flex-shrink-0">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="lg:hidden"
                            onClick={() => setSelectedCaseId(null)}
                            aria-label="Back to cases"
                            data-testid="button-back"
                          >
                            <ArrowLeft className="w-4 h-4" aria-hidden="true" />
                          </Button>
                          <CardTitle className="text-lg line-clamp-1" data-testid="text-active-case-subject">
                            {selectedCase?.subject}
                          </CardTitle>
                        </div>
                        <dl className="flex items-center gap-2 flex-wrap text-xs">
                          <dt className="sr-only">Priority</dt>
                          <dd>
                            <Badge
                              variant="outline"
                              className={getPriorityColor(selectedCase?.priority || 1)}
                              aria-label={`Priority: ${getPriorityLabel(selectedCase?.priority || 1)}`}
                            >
                              {getPriorityLabel(selectedCase?.priority || 1)}
                            </Badge>
                          </dd>
                          <dt className="sr-only">Category</dt>
                          <dd className="text-muted-foreground capitalize">
                            {selectedCase?.category}
                          </dd>
                          <dt className="sr-only">Created</dt>
                          <dd className="text-muted-foreground">
                            Created <time dateTime={typeof selectedCase?.createdAt === "string" ? selectedCase.createdAt : undefined}>{formatDate(selectedCase?.createdAt)}</time>
                          </dd>
                          {selectedCase?.slaStatus && (
                            <>
                              <dt className="sr-only">SLA</dt>
                              <dd>
                                <Badge
                                  variant="outline"
                                  className={`text-xs tabular-nums ${getSlaColor(selectedCase.slaStatus)}`}
                                  aria-label={`SLA status: ${selectedCase.slaStatus.replace(/_/g, " ")}, ${formatSlaTime(selectedCase.hoursUntilBreached)}`}
                                >
                                  <Timer className="w-3 h-3 mr-1" aria-hidden="true" />
                                  SLA: {formatSlaTime(selectedCase.hoursUntilBreached)}
                                </Badge>
                              </dd>
                            </>
                          )}
                        </dl>
                        {selectedCase?.escalationReason && (
                          <p className="text-sm text-muted-foreground mt-2">
                            <span className="font-medium">Escalation reason:</span> {selectedCase.escalationReason}
                          </p>
                        )}
                      </div>
                    </div>
                  </CardHeader>

                  <ScrollArea className="flex-1 p-4">
                    {messages.length === 0 ? (
                      <div className="text-center text-muted-foreground py-8">
                        No messages in this case yet.
                      </div>
                    ) : (
                      <ol
                        className="space-y-4 list-none p-0 m-0"
                        role="log"
                        aria-live="polite"
                        aria-label={`Conversation history${selectedCase?.subject ? ` for ${selectedCase.subject}` : ""}`}
                      >
                        {messages.map((msg) => {
                          const roleLabel = msg.role === "user" ? "User" : msg.role === "ai_support" ? "AI support" : "Human support";
                          return (
                            <li
                              key={msg.id}
                              className={`flex gap-3 ${
                                msg.role === "user" ? "flex-row-reverse" : ""
                              }`}
                              data-testid={`message-${msg.id}`}
                            >
                              <div
                                className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                                  msg.role === "user"
                                    ? "bg-primary text-primary-foreground"
                                    : msg.role === "ai_support"
                                    ? "bg-acr-brand/10 text-acr-brand dark:text-acr-brand"
                                    : "bg-accent"
                                }`}
                                role="img"
                                aria-label={`From: ${roleLabel}`}
                              >
                                {msg.role === "user" ? (
                                  <User className="w-4 h-4" aria-hidden="true" />
                                ) : msg.role === "ai_support" ? (
                                  <Bot className="w-4 h-4" aria-hidden="true" />
                                ) : (
                                  <Headphones className="w-4 h-4" aria-hidden="true" />
                                )}
                              </div>
                              <div
                                className={`flex-1 max-w-[85%] ${
                                  msg.role === "user" ? "text-right" : ""
                                }`}
                              >
                                <div
                                  className={`inline-block rounded-lg p-3 text-sm ${
                                    msg.role === "user"
                                      ? "bg-primary text-primary-foreground"
                                      : "bg-muted"
                                  }`}
                                >
                                  <p className="whitespace-pre-wrap" data-testid={`text-message-content-${msg.id}`}>
                                    {msg.content}
                                  </p>
                                </div>
                                <p className="text-xs text-muted-foreground mt-1">
                                  <time dateTime={typeof msg.createdAt === "string" ? msg.createdAt : undefined}>
                                    {formatDate(msg.createdAt)}
                                  </time>
                                </p>
                              </div>
                            </li>
                          );
                        })}
                      </ol>
                    )}
                  </ScrollArea>

                  <form onSubmit={handleResponseSubmit} className="p-4 border-t flex-shrink-0 space-y-4">
                    <Label htmlFor={responseId} className="sr-only">Response to user</Label>
                    <Textarea
                      id={responseId}
                      placeholder="Type your response to the user…"
                      value={responseMessage}
                      onChange={(e) => setResponseMessage(e.target.value)}
                      rows={3}
                      data-testid="input-response"
                    />
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex items-center gap-2">
                        <Switch
                          id={resolveId}
                          checked={shouldResolve}
                          onCheckedChange={setShouldResolve}
                          data-testid="switch-resolve"
                          aria-label={`Mark case as resolved on send${selectedCase?.subject ? `: ${selectedCase.subject}` : ""}`}
                        />
                        <Label htmlFor={resolveId} className="text-sm">
                          Mark as resolved
                        </Label>
                      </div>
                      <Button
                        type="submit"
                        disabled={!responseMessage.trim() || respondMutation.isPending}
                        data-testid="button-send-response"
                      >
                        {respondMutation.isPending ? (
                          <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                        ) : (
                          <>
                            <Send className="w-4 h-4 mr-2" aria-hidden="true" />
                            {shouldResolve ? "Send & resolve" : "Send response"}
                          </>
                        )}
                      </Button>
                    </div>
                  </form>
                </>
              )}
            </Card>

            {/* Right rail — customer context + saved replies (Olu §7 #5+#6, Kunle §2). */}
            <aside className="space-y-4 lg:max-h-[calc(100vh-320px)] lg:overflow-y-auto" aria-label="Customer context and saved replies">
              <CustomerContextSidebar
                organizationId={selectedCase?.organizationId ?? null}
                excludeCaseId={selectedCaseId}
              />
              <SavedRepliesPanel
                organizationId={selectedCase?.organizationId ?? null}
                onInsert={(body) => {
                  setResponseMessage((prev) => (prev.trim() ? `${prev}\n\n${body}` : body));
                }}
              />
            </aside>
          </div>
    </PageShell>
  );
}
