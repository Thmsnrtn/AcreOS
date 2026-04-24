import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { usd } from "@/lib/format";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { AlertTriangle, CreditCard, Mail, RefreshCw, CheckCircle2, XCircle, Loader2, Clock } from "lucide-react";

interface DunningCase {
  id: number;
  organizationId: number;
  orgName: string;
  email: string;
  planName: string;
  amountDueCents: number;
  daysOverdue: number;
  attemptCount: number;
  lastAttemptAt?: string;
  nextAttemptAt?: string;
  status: "pending" | "retrying" | "failed" | "resolved" | "cancelled";
  stripeCustomerId: string;
}

interface DunningSummary {
  total: number;
  pending: number;
  retrying: number;
  failed: number;
  resolved: number;
  totalAmountDueCents: number;
}

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  pending: { label: "Pending", color: "text-yellow-600", icon: Clock },
  retrying: { label: "Retrying", color: "text-blue-600", icon: RefreshCw },
  failed: { label: "Failed", color: "text-red-600", icon: XCircle },
  resolved: { label: "Resolved", color: "text-green-600", icon: CheckCircle2 },
  cancelled: { label: "Cancelled", color: "text-muted-foreground", icon: XCircle },
};

export default function DunningManagerPage() {
  useDocumentTitle("Dunning manager");
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: summary } = useQuery<DunningSummary>({
    queryKey: ["/api/dunning/summary"],
    queryFn: () => fetch("/api/dunning/summary").then(r => r.json()),
  });

  const { data: casesData, isLoading } = useQuery<{ cases: DunningCase[] }>({
    queryKey: ["/api/dunning/cases"],
    queryFn: () => fetch("/api/dunning/cases").then(r => r.json()),
  });

  const retryMutation = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/dunning/${id}/retry`),
    onSuccess: () => {
      toast({ title: "Payment retry initiated" });
      qc.invalidateQueries({ queryKey: ["/api/dunning"] });
    },
    onError: () =>
      toast({
        title: "Couldn't retry payment",
        description: "The customer's card wasn't charged. You can try again or cancel the case.",
        variant: "destructive",
      }),
  });

  const cancelMutation = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/dunning/${id}/cancel`),
    onSuccess: () => {
      toast({ title: "Dunning case cancelled" });
      qc.invalidateQueries({ queryKey: ["/api/dunning"] });
    },
    onError: () =>
      toast({
        title: "Couldn't cancel dunning case",
        description: "The case is still active and retries will continue as scheduled.",
        variant: "destructive",
      }),
  });

  const cases = casesData?.cases ?? [];

  return (
    <PageShell>
      <div>
        <h1 className="text-2xl md:text-3xl font-bold" data-testid="text-dunning-manager-title">
          Dunning Manager
        </h1>
        <p className="text-muted-foreground text-sm md:text-base">
          Manage failed payments and retry logic for delinquent subscriptions.
        </p>
      </div>

      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-yellow-600 mb-1">
                <Clock className="w-4 h-4" />
                <span className="text-xs">Pending</span>
              </div>
              <p className="text-2xl font-bold">{summary.pending}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-blue-600 mb-1">
                <RefreshCw className="w-4 h-4" />
                <span className="text-xs">Retrying</span>
              </div>
              <p className="text-2xl font-bold">{summary.retrying}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-red-600 mb-1">
                <XCircle className="w-4 h-4" />
                <span className="text-xs">Failed</span>
              </div>
              <p className="text-2xl font-bold">{summary.failed}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-muted-foreground mb-1">
                <CreditCard className="w-4 h-4" aria-hidden="true" />
                <span className="text-xs">Total due</span>
              </div>
              <p className="text-2xl font-bold tabular-nums">
                {usd((summary.totalAmountDueCents ?? 0) / 100)}
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Active cases</CardTitle>
          <CardDescription>Subscriptions with payment failures requiring action.</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground" role="status" aria-live="polite">
              <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> Loading cases…
            </div>
          ) : cases.length === 0 ? (
            <div className="text-center py-8">
              <CheckCircle2 className="w-8 h-8 text-green-600 mx-auto mb-2" aria-hidden="true" />
              <p className="text-muted-foreground text-sm">No active dunning cases.</p>
            </div>
          ) : (
            <ul className="space-y-2" aria-label="Active dunning cases">
              {cases.map(c => {
                const config = STATUS_CONFIG[c.status] ?? STATUS_CONFIG.pending;
                const Icon = config.icon;
                return (
                  <li key={c.id} className="flex items-center justify-between p-3 border rounded-lg">
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{c.orgName}</span>
                        <Badge variant="outline" className="text-xs">{c.planName}</Badge>
                        <div className={`flex items-center gap-1 text-xs ${config.color}`}>
                          <Icon className="w-3 h-3" aria-hidden="true" /> {config.label}
                        </div>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Mail className="w-3 h-3" aria-hidden="true" />
                          <a href={`mailto:${c.email}`} className="underline-offset-2 hover:underline truncate">{c.email}</a>
                        </span>
                        <span className="flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3 text-yellow-500" aria-hidden="true" />
                          <span className="tabular-nums">{c.daysOverdue}</span> days overdue
                        </span>
                        <span className="tabular-nums">{usd(c.amountDueCents / 100)}</span>
                        <span>Attempt <span className="tabular-nums">{c.attemptCount}</span></span>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      {(c.status === "pending" || c.status === "failed") && (
                        <Button size="sm" variant="outline" className="min-h-9" onClick={() => retryMutation.mutate(c.id)}>
                          <RefreshCw className="w-3 h-3 mr-1" aria-hidden="true" /> Retry
                        </Button>
                      )}
                      {c.status !== "resolved" && c.status !== "cancelled" && (
                        <Button size="sm" variant="ghost" className="min-h-9" onClick={() => cancelMutation.mutate(c.id)}>
                          Cancel
                        </Button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </PageShell>
  );
}
