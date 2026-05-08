/**
 * /account/security — customer-side security console (RS-4).
 *
 * Mirrors the founder-side recovery console but scoped to the requesting
 * user only. Asher-takeover §3: "no email-on-new-location, no exfil
 * alarm" — this page is the "I notice my account is acting weird" surface.
 */

import { useQuery, useMutation } from "@tanstack/react-query";
import { Shield, AlertTriangle, ShieldOff, LogOut, Check, KeyRound } from "lucide-react";

import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";

interface Session {
  sessionId: string;
  createdAt: string | null;
  lastActiveAt: string | null;
  ip: string | null;
  userAgent: string | null;
  status: string | null;
  isCurrent: boolean;
}

interface SecuritySummary {
  userId: string;
  email: string;
  twoFactorEnabled: boolean;
  lastSignInAt: string | null;
  fcraAttestationStale: boolean | null;
}

function csrf(): Record<string, string> {
  const m = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/);
  return { "Content-Type": "application/json", "x-csrf-token": decodeURIComponent(m?.[1] ?? "") };
}

function fmtTime(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export default function AccountSecurityPage() {
  useDocumentTitle("Security — AcreOS");
  const { toast } = useToast();

  const summary = useQuery<SecuritySummary>({
    queryKey: ["/api/account/security/summary"],
    queryFn: async () => {
      const res = await fetch("/api/account/security/summary", { credentials: "include" });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      return res.json();
    },
  });

  const sessions = useQuery<{ sessions: Session[] }>({
    queryKey: ["/api/account/sessions"],
    queryFn: async () => {
      const res = await fetch("/api/account/sessions", { credentials: "include" });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      return res.json();
    },
  });

  const revokeOne = useMutation({
    mutationFn: async (sessionId: string) => {
      const res = await fetch(`/api/account/sessions/${sessionId}/revoke`, {
        method: "POST", credentials: "include", headers: csrf(), body: "{}",
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        throw new Error(detail.message ?? `Failed (${res.status})`);
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Session revoked" });
      queryClient.invalidateQueries({ queryKey: ["/api/account/sessions"] });
    },
    onError: (err: any) => toast({ title: "Couldn't revoke", description: err.message, variant: "destructive" }),
  });

  const revokeOthers = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/account/sessions/revoke-others", {
        method: "POST", credentials: "include", headers: csrf(), body: "{}",
      });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      return res.json();
    },
    onSuccess: (r: any) => {
      toast({ title: "Other sessions revoked", description: `${r.revoked} ended, ${r.skipped} kept (current), ${r.failed} failed.` });
      queryClient.invalidateQueries({ queryKey: ["/api/account/sessions"] });
    },
  });

  const list = sessions.data?.sessions ?? [];
  const otherCount = list.filter((s) => !s.isCurrent && (s.status === null || s.status === "active")).length;

  return (
    <PageShell label="Security">
      <div className="mb-6 flex items-start gap-3">
        <Shield className="w-6 h-6 text-primary mt-1" aria-hidden="true" />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Account security</h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Active sessions, two-factor enrollment, and login-history at a glance. If
            anything looks off, sign out everywhere — the rest is best handled by
            email to support@acreos.io.
          </p>
        </div>
      </div>

      {/* Summary */}
      {summary.isLoading ? (
        <Skeleton className="h-32 mb-6" />
      ) : summary.data ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <Card className="p-3">
            <div className="text-xs text-muted-foreground flex items-center gap-1">
              <KeyRound className="w-3 h-3" aria-hidden="true" /> Two-factor
            </div>
            <div className="text-base font-semibold mt-1">
              {summary.data.twoFactorEnabled ? (
                <Badge variant="default" className="text-xs"><Check className="w-3 h-3 mr-1" /> enrolled</Badge>
              ) : (
                <Badge variant="destructive" className="text-xs"><AlertTriangle className="w-3 h-3 mr-1" /> not enrolled</Badge>
              )}
            </div>
          </Card>
          <Card className="p-3">
            <div className="text-xs text-muted-foreground">Last sign-in</div>
            <div className="text-base font-semibold mt-1">{fmtTime(summary.data.lastSignInAt)}</div>
          </Card>
          <Card className="p-3">
            <div className="text-xs text-muted-foreground">Active sessions</div>
            <div className="text-base font-semibold mt-1">{list.length}</div>
          </Card>
          <Card className="p-3">
            <div className="text-xs text-muted-foreground">FCRA attestation</div>
            <div className="text-base font-semibold mt-1">
              {summary.data.fcraAttestationStale === null ? (
                <Badge variant="outline" className="text-xs">N/A</Badge>
              ) : summary.data.fcraAttestationStale ? (
                <Badge variant="outline" className="text-xs">stale</Badge>
              ) : (
                <Badge variant="default" className="text-xs">current</Badge>
              )}
            </div>
          </Card>
        </div>
      ) : null}

      {/* Sessions */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="text-base">Active sessions</CardTitle>
            <CardDescription>
              Each row is a place you (or someone with your credentials) is currently signed in.
            </CardDescription>
          </div>
          {otherCount > 0 && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => revokeOthers.mutate()}
              disabled={revokeOthers.isPending}
            >
              <ShieldOff className="w-4 h-4 mr-1" aria-hidden="true" />
              Sign me out everywhere else
            </Button>
          )}
        </CardHeader>
        <CardContent className="p-0">
          {sessions.isLoading ? (
            <Skeleton className="h-32 m-4" />
          ) : list.length === 0 ? (
            <p className="px-4 py-3 text-sm text-muted-foreground">No active sessions.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-muted-foreground border-b border-border bg-muted/30">
                  <th className="px-3 py-2 text-left font-medium">Device</th>
                  <th className="px-3 py-2 text-left font-medium">IP</th>
                  <th className="px-3 py-2 text-left font-medium">Last active</th>
                  <th className="px-3 py-2 text-left font-medium">Started</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {list.map((s) => (
                  <tr key={s.sessionId} className="border-b border-border/40">
                    <td className="px-3 py-2 text-xs max-w-[20rem] truncate">
                      {s.userAgent ?? "—"}
                      {s.isCurrent && <Badge variant="default" className="ml-2 text-[10px]">this session</Badge>}
                    </td>
                    <td className="px-3 py-2 text-xs font-mono">{s.ip ?? "—"}</td>
                    <td className="px-3 py-2 text-xs">{fmtTime(s.lastActiveAt)}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{fmtTime(s.createdAt)}</td>
                    <td className="px-3 py-2 text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs"
                        onClick={() => revokeOne.mutate(s.sessionId)}
                        disabled={revokeOne.isPending}
                      >
                        <LogOut className="w-3 h-3 mr-1" aria-hidden="true" />
                        Revoke
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground mt-4">
        See an unfamiliar location, IP, or device? Revoke that session above, then change your password and email
        support@acreos.io with the timestamp. We can correlate against our audit log.
      </p>
    </PageShell>
  );
}
