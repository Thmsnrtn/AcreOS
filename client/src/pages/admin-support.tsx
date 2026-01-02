import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Headphones, AlertTriangle, CheckCircle, Clock, Users, TrendingUp, MessageSquare, Send, ArrowLeft, User, Bot, Loader2 } from "lucide-react";
import { Sidebar } from "@/components/layout-sidebar";
import type { SupportCase, SupportMessage } from "@shared/schema";

type SupportMetrics = {
  totalCases: number;
  openCases: number;
  escalatedCases: number;
  resolvedCases: number;
  avgSatisfaction: number;
  autoResolvedRate: number;
};

type CaseWithMessages = {
  case: SupportCase;
  messages: SupportMessage[];
  actions: any[];
};

function getPriorityColor(priority: number): string {
  switch (priority) {
    case 5:
      return "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20";
    case 4:
      return "bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20";
    case 3:
      return "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border-yellow-500/20";
    case 2:
      return "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20";
    default:
      return "bg-gray-500/10 text-gray-600 dark:text-gray-400 border-gray-500/20";
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
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold" data-testid={testId}>{value}</div>
        {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
      </CardContent>
    </Card>
  );
}

export default function AdminSupportPage() {
  const { toast } = useToast();
  const [selectedCaseId, setSelectedCaseId] = useState<number | null>(null);
  const [responseMessage, setResponseMessage] = useState("");
  const [shouldResolve, setShouldResolve] = useState(false);

  const { data: metrics, isLoading: metricsLoading } = useQuery<SupportMetrics>({
    queryKey: ["/api/admin/support/metrics"],
  });

  const { data: escalatedCases, isLoading: casesLoading } = useQuery<SupportCase[]>({
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
        title: "Error",
        description: err.message || "Failed to send response",
        variant: "destructive",
      });
    },
  });

  const handleSendResponse = () => {
    if (!responseMessage.trim() || !selectedCaseId) return;
    respondMutation.mutate({ 
      caseId: selectedCaseId, 
      message: responseMessage, 
      resolve: shouldResolve 
    });
  };

  const selectedCase = escalatedCases?.find(c => c.id === selectedCaseId);
  const messages = caseDetails?.messages || [];

  return (
    <div className="flex min-h-screen bg-background desert-gradient">
      <Sidebar />
      <main className="flex-1 md:ml-[17rem] p-4 pt-16 md:pt-8 md:p-8 pb-24 md:pb-8 overflow-x-hidden">
        <div className="max-w-7xl mx-auto space-y-6">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold" data-testid="text-page-title">Admin Support Dashboard</h1>
            <p className="text-muted-foreground">Manage escalated support cases and track resolution metrics.</p>
          </div>

          {metricsLoading ? (
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
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
                title="Total Cases"
                value={metrics?.totalCases || 0}
                icon={MessageSquare}
                testId="metric-total-cases"
              />
              <MetricCard
                title="Open Cases"
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
                title="Auto-Resolve Rate"
                value={`${Math.round((metrics?.autoResolvedRate || 0) * 100)}%`}
                icon={TrendingUp}
                testId="metric-auto-resolve-rate"
              />
              <MetricCard
                title="Avg. Satisfaction"
                value={metrics?.avgSatisfaction ? `${metrics.avgSatisfaction.toFixed(1)}/5` : "N/A"}
                icon={Users}
                testId="metric-avg-satisfaction"
              />
            </div>
          )}

          <div className="grid lg:grid-cols-[400px_1fr] gap-6">
            <Card className="lg:h-[calc(100vh-320px)]">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5 text-destructive" />
                  Escalated Cases
                </CardTitle>
                <CardDescription>Cases requiring human attention</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <ScrollArea className="h-[calc(100vh-480px)] lg:h-[calc(100vh-420px)]">
                  {casesLoading ? (
                    <div className="p-4 text-center text-muted-foreground">
                      <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2" />
                      Loading cases...
                    </div>
                  ) : !escalatedCases?.length ? (
                    <div className="p-6 text-center" data-testid="empty-escalated-cases">
                      <CheckCircle className="w-10 h-10 mx-auto mb-3 text-green-500" />
                      <p className="font-medium">No escalated cases</p>
                      <p className="text-muted-foreground text-sm mt-1">
                        All support cases are being handled by AI
                      </p>
                    </div>
                  ) : (
                    <div className="divide-y">
                      {escalatedCases.map((c) => (
                        <button
                          key={c.id}
                          onClick={() => {
                            setSelectedCaseId(c.id);
                            setResponseMessage("");
                            setShouldResolve(false);
                          }}
                          className={`w-full p-4 text-left hover-elevate transition-colors ${
                            selectedCaseId === c.id ? "bg-accent" : ""
                          }`}
                          data-testid={`button-case-${c.id}`}
                        >
                          <div className="flex items-start justify-between gap-2 mb-2">
                            <span className="font-medium text-sm line-clamp-1" data-testid={`text-case-subject-${c.id}`}>
                              {c.subject}
                            </span>
                            <Badge variant="outline" className={getPriorityColor(c.priority)}>
                              {getPriorityLabel(c.priority)}
                            </Badge>
                          </div>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                            <span>User: {c.userId?.substring(0, 8) || "Unknown"}</span>
                            <span className="text-muted-foreground/50">|</span>
                            <span className="capitalize">{c.category}</span>
                          </div>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <Clock className="w-3 h-3" />
                            <span>Escalated {formatTimeAgo(c.escalatedAt)}</span>
                          </div>
                          {c.escalationReason && (
                            <p className="text-xs text-muted-foreground mt-2 line-clamp-2 italic">
                              {c.escalationReason}
                            </p>
                          )}
                        </button>
                      ))}
                    </div>
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
                <div className="flex-1 flex items-center justify-center">
                  <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
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
                            data-testid="button-back"
                          >
                            <ArrowLeft className="w-4 h-4" />
                          </Button>
                          <CardTitle className="text-lg line-clamp-1" data-testid="text-active-case-subject">
                            {selectedCase?.subject}
                          </CardTitle>
                        </div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge variant="outline" className={getPriorityColor(selectedCase?.priority || 1)}>
                            {getPriorityLabel(selectedCase?.priority || 1)}
                          </Badge>
                          <span className="text-xs text-muted-foreground capitalize">
                            {selectedCase?.category}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            Created {formatDate(selectedCase?.createdAt)}
                          </span>
                        </div>
                        {selectedCase?.escalationReason && (
                          <p className="text-sm text-muted-foreground mt-2">
                            <span className="font-medium">Escalation reason:</span> {selectedCase.escalationReason}
                          </p>
                        )}
                      </div>
                    </div>
                  </CardHeader>

                  <ScrollArea className="flex-1 p-4">
                    <div className="space-y-4">
                      {messages.length === 0 ? (
                        <div className="text-center text-muted-foreground py-8">
                          No messages in this case yet.
                        </div>
                      ) : (
                        messages.map((msg) => (
                          <div
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
                                  ? "bg-purple-500/10 text-purple-600 dark:text-purple-400"
                                  : "bg-accent"
                              }`}
                            >
                              {msg.role === "user" ? (
                                <User className="w-4 h-4" />
                              ) : msg.role === "ai_support" ? (
                                <Bot className="w-4 h-4" />
                              ) : (
                                <Headphones className="w-4 h-4" />
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
                                {formatDate(msg.createdAt)}
                              </p>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </ScrollArea>

                  <div className="p-4 border-t flex-shrink-0 space-y-4">
                    <Textarea
                      placeholder="Type your response to the user..."
                      value={responseMessage}
                      onChange={(e) => setResponseMessage(e.target.value)}
                      rows={3}
                      data-testid="input-response"
                    />
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex items-center gap-2">
                        <Switch
                          id="resolve"
                          checked={shouldResolve}
                          onCheckedChange={setShouldResolve}
                          data-testid="switch-resolve"
                        />
                        <Label htmlFor="resolve" className="text-sm">
                          Mark as resolved
                        </Label>
                      </div>
                      <Button
                        onClick={handleSendResponse}
                        disabled={!responseMessage.trim() || respondMutation.isPending}
                        data-testid="button-send-response"
                      >
                        {respondMutation.isPending ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <>
                            <Send className="w-4 h-4 mr-2" />
                            {shouldResolve ? "Send & Resolve" : "Send Response"}
                          </>
                        )}
                      </Button>
                    </div>
                  </div>
                </>
              )}
            </Card>
          </div>
        </div>
      </main>
    </div>
  );
}
