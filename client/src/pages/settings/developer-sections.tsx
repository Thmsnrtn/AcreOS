/**
 * Settings → Integrations → Developer tools sections — extracted from the
 * settings.tsx monolith (T3 census W1-2). Behavior and test ids preserved;
 * spinner loading states upgraded to table-row-shaped Skeletons, empty
 * states upgraded to the EmptyState primitive with purposeful CTAs, and
 * query failures now render QueryErrorState with retry.
 *
 * The "API keys" card that lived here was retired 2026-11-08 (W3.6-B): the
 * keys it created were accepted by no AcreOS endpoint, and the expansion
 * ladder defers customer-issued API keys to ~50 customers.
 */
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { QueryErrorState } from "@/components/query-error-state";
import { EmptyState } from "@/components/empty-state";
import { Shield } from "lucide-react";

/** Table-row-shaped skeleton for the list panel below. */
function TableRowsSkeleton({ announceText, rows = 3 }: { announceText: string; rows?: number }) {
  return (
    <div className="space-y-3 p-4" aria-busy="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="h-4 w-28" announce={i === 0} announceText={announceText} />
          <Skeleton className="h-4 w-20 hidden sm:block" announce={false} />
          <Skeleton className="h-5 w-14 rounded-full" announce={false} />
          <Skeleton className="h-4 flex-1" announce={false} />
        </div>
      ))}
    </div>
  );
}

// ── Activity Audit Log Panel ───────────────────────────────────────────────────

interface AuditLogEntry {
  id: number;
  userId: string | null;
  action: string;
  entityType: string;
  entityId: number | null;
  changes: Record<string, any> | null;
  ipAddress: string | null;
  metadata: Record<string, any> | null;
  createdAt: string;
}

export function ActivityLogPanel() {
  const { data: entries = [], isLoading, isError, error, refetch, isRefetching } = useQuery<AuditLogEntry[]>({
    queryKey: ["/api/org/activity-log"],
    queryFn: async () => {
      const res = await fetch("/api/org/activity-log", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load activity log");
      return res.json();
    },
  });

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-section-h2 flex items-center gap-2">
          <Shield className="w-5 h-5" aria-hidden="true" />
          Activity log
        </h2>
        <p className="text-muted-foreground text-sm">
          Last 50 actions performed in your organization.
        </p>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <TableRowsSkeleton announceText="Loading activity log" rows={4} />
          ) : isError ? (
            <div className="p-4">
              <QueryErrorState
                error={error as Error}
                onRetry={() => refetch()}
                isRetrying={isRefetching}
                compact
                title="Couldn't load the activity log"
                description="The log itself is intact — this is just a display issue."
                testId="error-activity-log"
              />
            </div>
          ) : entries.length === 0 ? (
            <EmptyState
              icon={Shield}
              headline="No activity yet"
              subtitle="Actions performed in your organization — edits, invites, key changes — will appear here."
              cta={{
                label: "Refresh",
                onClick: () => refetch(),
                "data-testid": "empty-refresh-activity-log",
              }}
              actionIcon={null}
              className="py-8"
              testId="empty-activity-log"
            />
          ) : (
            <div
              tabIndex={0}
              role="region"
              aria-label="Organization activity log"
              className="overflow-x-auto"
            >
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Time</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Entity</TableHead>
                    <TableHead>User</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entries.map(e => (
                    <TableRow key={e.id}>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap tabular-nums">
                        {new Date(e.createdAt).toLocaleString()}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs capitalize">{e.action}</Badge>
                      </TableCell>
                      <TableCell className="text-sm">
                        <span className="capitalize">{e.entityType}</span>
                        {e.entityId && <span className="text-muted-foreground ml-1 tabular-nums">#{e.entityId}</span>}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground tabular-nums">
                        {e.userId ? e.userId.slice(0, 8) + "…" : "System"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
