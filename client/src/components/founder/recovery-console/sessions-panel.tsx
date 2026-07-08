/**
 * Sessions panel for /founder/recovery-console — list, single-revoke, and
 * revoke-all-but-admin-session flows, each behind an AlertDialog.
 *
 * Extracted from client/src/pages/founder/recovery-console.tsx (W3-5
 * decomposition). State-consistency upgrade in the same pass: shaped
 * skeleton (role="status" wrapper), QueryErrorState with retry, EmptyState
 * for the no-sessions case, and formatDateTime for last-active timestamps.
 */

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatDateTime } from "@/lib/format";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
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
import { EmptyState } from "@/components/empty-state";
import { QueryErrorState } from "@/components/query-error-state";
import { useToast } from "@/hooks/use-toast";
import { Trash2, LogOut, MonitorSmartphone } from "lucide-react";
import type { SessionRow, UserHit } from "./recovery-shared";

export function SessionsPanel({
  user,
  onAction,
}: {
  user: UserHit;
  onAction: () => void;
}) {
  const { toast } = useToast();
  const [adminSessionId, setAdminSessionId] = useState("");
  const [confirmRevokeAll, setConfirmRevokeAll] = useState(false);
  const [pendingRevoke, setPendingRevoke] = useState<string | null>(null);

  const sessionsQuery = useQuery<SessionRow[]>({
    queryKey: ["/api/admin/users", user.id, "sessions"],
    queryFn: async () => {
      const res = await apiRequest(
        "GET",
        `/api/admin/users/${encodeURIComponent(user.id)}/sessions`,
      );
      if (!res.ok) throw new Error("Failed to load sessions");
      return res.json();
    },
  });

  const refresh = () =>
    queryClient.invalidateQueries({
      queryKey: ["/api/admin/users", user.id, "sessions"],
    });

  // allow-no-invalidation: onSuccess calls the local refresh() helper (invalidateQueries wrapper above)
  const revokeOne = useMutation({
    mutationFn: async (sid: string) => {
      const res = await apiRequest(
        "POST",
        `/api/admin/users/${encodeURIComponent(user.id)}/sessions/${encodeURIComponent(sid)}/revoke`,
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message ?? "Revoke failed");
      return json;
    },
    onSuccess: () => {
      toast({ title: "Session revoked" });
      refresh();
      onAction();
    },
    onError: (e: Error) => {
      toast({
        title: "Revoke failed",
        description: e.message,
        variant: "destructive",
      });
    },
  });

  // allow-no-invalidation: onSuccess calls the local refresh() helper (invalidateQueries wrapper above)
  const revokeAllOthers = useMutation({
    mutationFn: async () => {
      const res = await apiRequest(
        "POST",
        `/api/admin/users/${encodeURIComponent(user.id)}/sessions/revoke-all-others`,
        { exceptCurrentAdminSessionId: adminSessionId.trim() },
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message ?? "Bulk revoke failed");
      return json;
    },
    onSuccess: (data) => {
      toast({
        title: "Bulk revoke complete",
        description: `Revoked ${data?.revokedCount ?? 0} session(s).`,
      });
      refresh();
      onAction();
    },
    onError: (e: Error) => {
      toast({
        title: "Bulk revoke failed",
        description: e.message,
        variant: "destructive",
      });
    },
  });

  const sessions = sessionsQuery.data ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Active sessions for {user.email ?? user.id}</CardTitle>
        <CardDescription>
          Revoke a single session, or revoke all sessions except a known
          admin session id (paste your own session id to keep yourself
          signed in).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {sessionsQuery.isLoading ? (
          <div className="space-y-2" role="status" aria-live="polite">
            <span className="sr-only">Loading sessions…</span>
            {[0, 1].map((i) => (
              <div
                key={i}
                className="border rounded-md px-3 py-2 flex items-center gap-3"
              >
                <Skeleton announce={false} className="h-4 w-40" />
                <Skeleton announce={false} className="h-4 w-16" />
                <Skeleton announce={false} className="h-4 w-32" />
                <Skeleton announce={false} className="ml-auto h-8 w-24" />
              </div>
            ))}
          </div>
        ) : sessionsQuery.error ? (
          <QueryErrorState
            compact
            error={sessionsQuery.error as Error}
            onRetry={() => sessionsQuery.refetch()}
            isRetrying={sessionsQuery.isFetching}
            title="Couldn't load sessions"
          />
        ) : sessions.length === 0 ? (
          /* TODO(cta): read-only state — the user has no active sessions, so
             there is nothing to revoke; no user action available. */
          <EmptyState
            icon={MonitorSmartphone}
            headline="No active sessions for this user"
            subtitle="There is nothing to revoke right now."
            cta={{ label: "", _noOp: true }}
            testId="empty-sessions"
          />
        ) : (
          <div className="space-y-2">
            {sessions.map((s) => (
              <div
                key={s.sessionId}
                className="border rounded-md px-3 py-2 flex items-center gap-3 flex-wrap"
              >
                <code className="text-xs">{s.sessionId}</code>
                {s.status && (
                  <Badge variant="outline" className="text-xs">
                    {s.status}
                  </Badge>
                )}
                {s.lastActiveAt && (
                  <span className="text-xs text-muted-foreground">
                    last {formatDateTime(s.lastActiveAt)}
                  </span>
                )}
                {s.ip && (
                  <span className="text-xs text-muted-foreground">
                    {s.ip}
                  </span>
                )}
                <div className="ml-auto">
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => setPendingRevoke(s.sessionId)}
                    aria-label={`Revoke session ${s.sessionId}`}
                  >
                    <Trash2 className="w-4 h-4 mr-1" aria-hidden="true" />
                    Revoke
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="border-t pt-4 space-y-2">
          <Label htmlFor="admin-sid">
            Your current admin session id (preserved during bulk revoke)
          </Label>
          <Input
            id="admin-sid"
            placeholder="sess_abc123…"
            value={adminSessionId}
            onChange={(e) => setAdminSessionId(e.target.value)}
            aria-label="Admin session id to preserve"
          />
          <Button
            variant="destructive"
            disabled={adminSessionId.trim().length === 0}
            onClick={() => setConfirmRevokeAll(true)}
            aria-label="Revoke all other sessions"
          >
            <LogOut className="w-4 h-4 mr-1" aria-hidden="true" />
            Revoke all other sessions
          </Button>
        </div>
      </CardContent>

      <AlertDialog
        open={!!pendingRevoke}
        onOpenChange={(o) => !o && setPendingRevoke(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke this session?</AlertDialogTitle>
            <AlertDialogDescription>
              The user will be signed out of this session immediately.
              This action is logged.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel aria-label="Cancel revoke">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingRevoke) revokeOne.mutate(pendingRevoke);
                setPendingRevoke(null);
              }}
              aria-label="Confirm revoke session"
            >
              Revoke
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={confirmRevokeAll}
        onOpenChange={setConfirmRevokeAll}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke all other sessions?</AlertDialogTitle>
            <AlertDialogDescription>
              All sessions for this user will be revoked except{" "}
              <code>{adminSessionId}</code>. This is irreversible and is
              logged.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel aria-label="Cancel bulk revoke">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                revokeAllOthers.mutate();
                setConfirmRevokeAll(false);
              }}
              aria-label="Confirm bulk revoke"
            >
              Revoke all others
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
