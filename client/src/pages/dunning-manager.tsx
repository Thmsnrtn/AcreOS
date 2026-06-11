import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { usd } from "@/lib/format";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { AlertTriangle, CreditCard, Mail, RefreshCw, CheckCircle2, XCircle, Clock } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";

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
  pending: { label: "Pending", color: "text-acr-warn", icon: Clock },
  retrying: { label: "Retrying", color: "text-acr-accent", icon: RefreshCw },
  failed: { label: "Failed", color: "text-acr-neg", icon: XCircle },
  resolved: { label: "Resolved", color: "text-acr-pos", icon: CheckCircle2 },
  cancelled: { label: "Cancelled", color: "text-muted-foreground", icon: XCircle },
};

export default function DunningManagerPage() {
  useDocumentTitle("Dunning manager");
  const { toast } = useToast();
  const qc = useQueryClient();
  const [pendingCancel, setPendingCancel] = useState<DunningCase | null>(null);

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
      setPendingCancel(null);
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
          Dunning manager
        </h1>
        <p className="text-muted-foreground text-sm md:text-base">
          Manage failed payments and retry logic for delinquent subscriptions.
        </p>
      </div>

      {summary && (
        <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Card>
            <CardContent className="p-4">
              <dt className="flex items-center gap-2 text-acr-warn mb-1">
                <Clock className="w-4 h-4" aria-hidden="true" />
                <span className="text-xs">Pending</span>
              </dt>
              <dd className="text-2xl font-bold tabular-nums">{summary.pending}</dd>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <dt className="flex items-center gap-2 text-acr-accent mb-1">
                <RefreshCw className="w-4 h-4" aria-hidden="true" />
                <span className="text-xs">Retrying</span>
              </dt>
              <dd className="text-2xl font-bold tabular-nums">{summary.retrying}</dd>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <dt className="flex items-center gap-2 text-acr-neg mb-1">
                <XCircle className="w-4 h-4" aria-hidden="true" />
                <span className="text-xs">Failed</span>
              </dt>
              <dd className="text-2xl font-bold tabular-nums">{summary.failed}</dd>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <dt className="flex items-center gap-2 text-muted-foreground mb-1">
                <CreditCard className="w-4 h-4" aria-hidden="true" />
                <span className="text-xs">Total due</span>
              </dt>
              <dd className="text-2xl font-bold tabular-nums">
                {usd((summary.totalAmountDueCents ?? 0) / 100)}
              </dd>
            </CardContent>
          </Card>
        </dl>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Active cases</CardTitle>
          <CardDescription>Subscriptions with payment failures requiring action.</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2" role="status" aria-busy="true" aria-live="polite">
              <span className="sr-only">Loading cases</span>
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex items-center justify-between p-3 border rounded-card gap-3">
                  <div className="space-y-1.5 min-w-0 flex-1">
                    <Skeleton announce={false} className="h-4 w-1/3 max-w-48" />
                    <Skeleton announce={false} className="h-3 w-1/2 max-w-64" />
                  </div>
                  <Skeleton announce={false} className="h-9 w-20 shrink-0" />
                </div>
              ))}
            </div>
          ) : cases.length === 0 ? (
            <EmptyState
              icon={CheckCircle2}
              tone="celebratory"
              headline="No active dunning cases."
              // TODO(cta): cleared queue — cases are created by payment failures, not users
              cta={{ label: "", _noOp: true }}
              testId="empty-state-dunning-cases"
            />
          ) : (
            <ul className="space-y-2" aria-label="Active dunning cases">
              {cases.map(c => {
                const config = STATUS_CONFIG[c.status] ?? STATUS_CONFIG.pending;
                const Icon = config.icon;
                return (
                  <li key={c.id} className="flex items-center justify-between p-3 border rounded-card gap-3 flex-wrap">
                    <div className="space-y-0.5 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium">{c.orgName}</span>
                        <Badge variant="outline" className="text-xs">{c.planName}</Badge>
                        <span
                          className={`flex items-center gap-1 text-xs ${config.color}`}
                          aria-label={`Status: ${config.label}`}
                        >
                          <Icon className="w-3 h-3" aria-hidden="true" /> {config.label}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                        <span className="flex items-center gap-1 min-w-0">
                          <Mail className="w-3 h-3 shrink-0" aria-hidden="true" />
                          <a href={`mailto:${c.email}`} className="underline-offset-2 hover:underline truncate">{c.email}</a>
                        </span>
                        <span className="flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3 text-acr-warn" aria-hidden="true" />
                          <span className="tabular-nums">{c.daysOverdue}</span> days overdue
                        </span>
                        <span className="tabular-nums">{usd(c.amountDueCents / 100)}</span>
                        <span>Attempt <span className="tabular-nums">{c.attemptCount}</span></span>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      {(c.status === "pending" || c.status === "failed") && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="min-h-9"
                          onClick={() => retryMutation.mutate(c.id)}
                          disabled={retryMutation.isPending}
                          aria-label={`Retry payment for ${c.orgName}`}
                        >
                          <RefreshCw className="w-3 h-3 mr-1" aria-hidden="true" /> Retry
                        </Button>
                      )}
                      {c.status !== "resolved" && c.status !== "cancelled" && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="min-h-9"
                          onClick={() => setPendingCancel(c)}
                          aria-label={`Cancel dunning case for ${c.orgName}`}
                        >
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

      <ConfirmDialog
        open={!!pendingCancel}
        onOpenChange={(open) => { if (!open) setPendingCancel(null); }}
        title={`Cancel dunning case for ${pendingCancel?.orgName ?? ""}?`}
        description={
          pendingCancel
            ? `Stops automatic retry attempts for ${pendingCancel.orgName} (${usd(pendingCancel.amountDueCents / 100)} on ${pendingCancel.planName}). The customer's subscription stays in its current state — you'll need to collect payment manually or close their account separately.`
            : ""
        }
        confirmLabel="Yes, cancel case"
        variant="destructive"
        isLoading={cancelMutation.isPending}
        onConfirm={() => pendingCancel && cancelMutation.mutate(pendingCancel.id)}
      />
    </PageShell>
  );
}
