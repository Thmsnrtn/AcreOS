/**
 * Phase 3 Week 11 — Founder DSAR ops UI.
 *
 * Lists Data Subject Access Requests (GDPR/CCPA) and exposes operator
 * actions: verify identity, run fan-out (access/portability), run erasure,
 * deny w/ reason. Fan-out and erasure currently return 501 ("Implement:
 * data fan-out") — the surface ships now so the workflow is visible and
 * the audit trail accumulates.
 */

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { ShieldAlert, CheckCircle2, XCircle, Download, Trash2, ShieldCheck, Inbox } from "lucide-react";

type DsarStatus = "pending" | "verified" | "fulfilling" | "completed" | "denied";
type DsarType = "access" | "erasure" | "portability" | "rectification";

interface DsarRequest {
  id: string;
  requestType: DsarType;
  email: string;
  fullName: string;
  organization?: string | null;
  organizationId?: number | null;
  justification?: string | null;
  status: DsarStatus;
  verifiedAt?: string | null;
  completedAt?: string | null;
  deniedReason?: string | null;
  createdAt: string;
}

const STATUS_VARIANT: Record<DsarStatus, "default" | "secondary" | "destructive" | "outline"> = {
  pending: "outline",
  verified: "secondary",
  fulfilling: "default",
  completed: "default",
  denied: "destructive",
};

const TYPE_LABEL: Record<DsarType, string> = {
  access: "Access (Art. 15)",
  erasure: "Erasure (Art. 17)",
  portability: "Portability (Art. 20)",
  rectification: "Rectification (Art. 16)",
};

export default function FounderDsarPage() {
  const { toast } = useToast();
  const [denyReasonById, setDenyReasonById] = useState<Record<string, string>>({});

  const { data, isLoading, error } = useQuery<{ requests: DsarRequest[] }>({
    queryKey: ["/api/founder/dsar"],
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["/api/founder/dsar"] });

  const actionMutation = useMutation({
    mutationFn: async ({ id, action, body }: { id: string; action: string; body?: unknown }) => {
      const res = await apiRequest("POST", `/api/founder/dsar/${id}/${action}`, body);
      const json = await res.json();
      if (!res.ok) throw new Error(json?.message ?? "Action failed");
      return json;
    },
    onSuccess: () => {
      toast({ title: "Action recorded" });
      invalidate();
    },
    onError: (err: Error) => {
      toast({ title: "Action failed", description: err.message, variant: "destructive" });
    },
  });

  const handleVerify = (id: string) => actionMutation.mutate({ id, action: "verify" });
  const handleFanOut = (id: string) => actionMutation.mutate({ id, action: "fan-out" });
  const handleErasure = (id: string) => actionMutation.mutate({ id, action: "erasure" });
  const handleDeny = (id: string) => {
    const reason = denyReasonById[id]?.trim();
    if (!reason || reason.length < 5) {
      toast({ title: "Denial reason required", description: "Provide at least 5 characters.", variant: "destructive" });
      return;
    }
    actionMutation.mutate({ id, action: "deny", body: { reason } });
  };

  const requests = data?.requests ?? [];
  const pending = requests.filter((r) => r.status === "pending" || r.status === "verified" || r.status === "fulfilling");
  const recent = requests.filter((r) => r.status === "completed" || r.status === "denied").slice(0, 25);

  return (
    <PageShell>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <ShieldAlert className="w-7 h-7" aria-hidden="true" />
            Data Subject Access Requests
          </h1>
          <p className="text-muted-foreground mt-1">
            GDPR/CCPA — review, verify identity, fulfil or deny each request. All actions write to <code>audit_events</code>.
          </p>
        </div>

        {isLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : error ? (
          <Card className="border-destructive">
            <CardContent className="py-4">
              <p className="text-destructive text-sm">Failed to load DSAR queue.</p>
            </CardContent>
          </Card>
        ) : (
          <>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Inbox className="w-5 h-5" aria-hidden="true" />
                  Pending ({pending.length})
                </CardTitle>
                <CardDescription>
                  Verify identity before running fan-out or erasure. Stub handlers throw "Implement: data fan-out" today.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {pending.length === 0 && (
                  <p className="text-sm text-muted-foreground">No pending requests.</p>
                )}
                {pending.map((r) => (
                  <div key={r.id} className="rounded-lg border p-4 space-y-3">
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div className="space-y-1">
                        <div className="font-medium">{r.fullName} <span className="text-muted-foreground">&lt;{r.email}&gt;</span></div>
                        <div className="text-xs text-muted-foreground">
                          {TYPE_LABEL[r.requestType]} · received {new Date(r.createdAt).toLocaleString()}
                          {r.organization ? ` · org "${r.organization}"` : ""}
                        </div>
                        {r.justification && (
                          <p className="text-sm pt-1">{r.justification}</p>
                        )}
                      </div>
                      <Badge variant={STATUS_VARIANT[r.status]}>{r.status}</Badge>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {r.status === "pending" && (
                        <Button size="sm" onClick={() => handleVerify(r.id)} aria-label={`Verify identity for ${r.email}`}>
                          <ShieldCheck className="w-4 h-4 mr-1" aria-hidden="true" />
                          Verify identity
                        </Button>
                      )}
                      {(r.requestType === "access" || r.requestType === "portability") && r.status !== "pending" && (
                        <Button size="sm" variant="secondary" onClick={() => handleFanOut(r.id)} aria-label={`Run fan-out for ${r.email}`}>
                          <Download className="w-4 h-4 mr-1" aria-hidden="true" />
                          Run fan-out
                        </Button>
                      )}
                      {r.requestType === "erasure" && r.status !== "pending" && (
                        <Button size="sm" variant="destructive" onClick={() => handleErasure(r.id)} aria-label={`Run erasure for ${r.email}`}>
                          <Trash2 className="w-4 h-4 mr-1" aria-hidden="true" />
                          Run erasure
                        </Button>
                      )}
                    </div>
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <Textarea
                        rows={2}
                        placeholder="Reason for denial (min 5 chars)…"
                        value={denyReasonById[r.id] ?? ""}
                        onChange={(e) => setDenyReasonById((prev) => ({ ...prev, [r.id]: e.target.value }))}
                        aria-label={`Denial reason for ${r.email}`}
                      />
                      <Button size="sm" variant="outline" onClick={() => handleDeny(r.id)} aria-label={`Deny request from ${r.email}`}>
                        <XCircle className="w-4 h-4 mr-1" aria-hidden="true" />
                        Deny
                      </Button>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5" aria-hidden="true" />
                  Recently closed
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {recent.length === 0 && (
                  <p className="text-sm text-muted-foreground">No closed requests yet.</p>
                )}
                {recent.map((r) => (
                  <div key={r.id} className="text-sm flex items-center gap-2 flex-wrap">
                    <Badge variant={STATUS_VARIANT[r.status]}>{r.status}</Badge>
                    <span>{r.fullName} &lt;{r.email}&gt; — {TYPE_LABEL[r.requestType]}</span>
                    <span className="text-muted-foreground text-xs">
                      {new Date(r.completedAt ?? r.createdAt).toLocaleDateString()}
                    </span>
                    {r.deniedReason && <span className="text-xs text-muted-foreground">— {r.deniedReason}</span>}
                  </div>
                ))}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </PageShell>
  );
}
