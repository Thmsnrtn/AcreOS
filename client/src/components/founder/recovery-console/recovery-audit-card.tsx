/**
 * "Recent recovery actions" card for /founder/recovery-console — last 25
 * audit_events rows filtered to recovery.*.
 *
 * Extracted from client/src/pages/founder/recovery-console.tsx (W3-5
 * decomposition); the card now owns its own query (same key the page
 * invalidates after every recovery action, so refresh behavior is
 * unchanged). State-consistency upgrade in the same pass: shaped skeleton
 * (role="status" wrapper), QueryErrorState with retry, EmptyState for the
 * no-actions-yet case, and formatDateTime for event timestamps.
 */

import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { formatDateTime } from "@/lib/format";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { QueryErrorState } from "@/components/query-error-state";
import { ScrollText } from "lucide-react";
import type { AuditRow } from "./recovery-shared";

export function RecoveryAuditCard() {
  const auditQuery = useQuery<{ events: AuditRow[] }>({
    queryKey: ["/api/admin/recovery/audit"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/admin/recovery/audit?limit=25");
      if (!res.ok) throw new Error("Audit fetch failed");
      return res.json();
    },
  });

  const events = auditQuery.data?.events ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ScrollText className="w-5 h-5" aria-hidden="true" />
          Recent recovery actions
        </CardTitle>
        <CardDescription>
          Last 25 rows from audit_events filtered to recovery.*. Visible
          to founders only.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {auditQuery.isLoading ? (
          <div className="space-y-2" role="status" aria-live="polite">
            <span className="sr-only">Loading recovery audit log…</span>
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="border rounded-md px-3 py-2 space-y-2"
              >
                <div className="flex items-center gap-2">
                  <Skeleton announce={false} className="h-5 w-32" />
                  <Skeleton announce={false} className="h-3 w-28" />
                </div>
                <Skeleton announce={false} className="h-3 w-64 max-w-full" />
              </div>
            ))}
          </div>
        ) : auditQuery.error ? (
          <QueryErrorState
            compact
            error={auditQuery.error as Error}
            onRetry={() => auditQuery.refetch()}
            isRetrying={auditQuery.isFetching}
            title="Couldn't load the audit log"
          />
        ) : events.length === 0 ? (
          /* TODO(cta): read-only audit log — it fills as recovery actions are
             taken in the tabs above; no direct user action available here. */
          <EmptyState
            icon={ScrollText}
            headline="No recovery actions yet"
            subtitle="Every recovery action taken above writes an immutable row here."
            cta={{ label: "", _noOp: true }}
            testId="empty-recovery-audit"
          />
        ) : (
          <div className="space-y-2">
            {events.map((e) => (
              <div
                key={e.id}
                className="text-sm border rounded-md px-3 py-2 flex flex-col gap-1"
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant="secondary" className="font-mono text-xs">
                    {e.action}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {formatDateTime(e.createdAt)}
                  </span>
                  <span className="text-xs">
                    {e.targetType} <code>{e.targetId}</code>
                  </span>
                  {e.actorEmail && (
                    <span className="text-xs text-muted-foreground">
                      by {e.actorEmail}
                    </span>
                  )}
                </div>
                {e.justification && (
                  <p className="text-xs text-muted-foreground">
                    {e.justification}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
