/**
 * Decisions door → Owner requests (W5a).
 *
 * A property owner's opt-out / deletion request. Suppression already applied
 * the moment they confirmed; what waits here is the founder-only part:
 * mailing a verification code, and ruling on each org's records (deleting
 * customer data is a hard stop). Renders only when something is open.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { QueryErrorState } from "@/components/query-error-state";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface OrgMatch {
  organizationId: number;
  leadIds: number[];
  notifiedAt: string | null;
  deletion: { status: "awaiting_founder" | "executed" | "declined" | "not_requested"; rowsErased: number | null };
}

interface OwnerRequest {
  id: number;
  ref: string;
  status: string;
  verificationMethod: string;
  receivedAt: string;
  dueAt: string;
  daysLeft: number;
  wantsDeletion: boolean;
  identifierKinds: string[];
  mailCode: { line1: string; city: string; state: string; zip: string; code: string } | null;
  orgMatches: OrgMatch[];
}

const KEY = ["/api/founder/trust/owner-optouts"];

export function OwnerRequestsSection() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data, isError, refetch, isRefetching } = useQuery<{ requests: OwnerRequest[] }>({ queryKey: KEY, staleTime: 30_000 });

  const mailed = useMutation({
    mutationFn: async (id: number) => (await apiRequest("POST", `/api/founder/trust/owner-optouts/${id}/mail-code-sent`)).json(),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: KEY });
      toast({ title: "Marked as mailed", description: "The address is now erased from AcreOS." });
    },
    onError: (err) => toast({ title: "Couldn't update", description: err instanceof Error ? err.message : String(err), variant: "destructive" }),
  });
  const decide = useMutation({
    mutationFn: async (v: { id: number; orgId: number; approve: boolean }) =>
      (await apiRequest("POST", `/api/founder/trust/owner-optouts/${v.id}/orgs/${v.orgId}/deletion`, { approve: v.approve })).json(),
    onSuccess: (_r, v) => {
      void qc.invalidateQueries({ queryKey: KEY });
      toast({ title: v.approve ? "Records erased" : "Deletion declined — the records stay suppressed" });
    },
    onError: (err) => toast({ title: "Couldn't record the decision", description: err instanceof Error ? err.message : String(err), variant: "destructive" }),
  });

  if (isError) {
    return <QueryErrorState error={new Error("Owner requests could not be loaded")} title="Owner requests" onRetry={() => void refetch()} isRetrying={isRefetching} />;
  }
  const open = (data?.requests ?? []).filter((r) => r.status !== "completed" && r.status !== "expired");
  if (open.length === 0) return null;

  return (
    <Card className="border-l-4 border-l-primary" data-testid="decisions-owner-requests">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Owner requests ({open.length})</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {open.map((r) => (
          <div key={r.id} className="space-y-2 border-b border-border pb-3 last:border-b-0 last:pb-0">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-medium text-foreground">Request {r.ref.slice(0, 6)}</span>
              <Badge variant={r.daysLeft <= 0 ? "destructive" : r.daysLeft <= 10 ? "secondary" : "outline"}>
                {r.daysLeft <= 0 ? `Past due by ${-r.daysLeft} day(s)` : `${r.daysLeft} day(s) left`}
              </Badge>
              <span className="text-muted-foreground">
                {r.status === "pending_verification" ? "awaiting the owner's confirmation" : "confirmed — suppressed everywhere"} · matches on{" "}
                {r.identifierKinds.join(", ")}
              </span>
            </div>
            {r.mailCode ? (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-muted p-3 text-sm">
                <p className="text-foreground">
                  Mail code <span className="font-mono font-semibold">{r.mailCode.code}</span> to {r.mailCode.line1}, {r.mailCode.city} {r.mailCode.state}{" "}
                  {r.mailCode.zip}
                </p>
                <Button size="sm" variant="outline" onClick={() => mailed.mutate(r.id)} disabled={mailed.isPending} aria-label={`Mark code for request ${r.ref.slice(0, 6)} as mailed`}>
                  Mailed
                </Button>
              </div>
            ) : null}
            {r.orgMatches.map((m) => (
              <div key={m.organizationId} className="flex flex-wrap items-center justify-between gap-3 text-sm">
                <p className="text-foreground">
                  Org #{m.organizationId} · {m.leadIds.length} record(s){m.notifiedAt ? " · org told" : ""}
                  {m.deletion.status === "executed" ? ` · erased ${m.deletion.rowsErased ?? 0}` : m.deletion.status === "declined" ? " · deletion declined" : ""}
                </p>
                {m.deletion.status === "awaiting_founder" ? (
                  <div className="flex gap-2">
                    <Button size="sm" variant="destructive" onClick={() => decide.mutate({ id: r.id, orgId: m.organizationId, approve: true })} disabled={decide.isPending}>
                      Erase records
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => decide.mutate({ id: r.id, orgId: m.organizationId, approve: false })} disabled={decide.isPending}>
                      Keep, suppressed
                    </Button>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        ))}
        <p className="text-xs text-muted-foreground">
          Contact stopped the moment each owner confirmed. Erasing an org's records is yours alone to approve; nothing here runs on its own.
        </p>
      </CardContent>
    </Card>
  );
}
