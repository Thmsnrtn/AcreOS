/**
 * SecurityActivityLog — customer-visible security activity view.
 *
 * Tahoe / Beatrice. Reads GET /api/audit/log (org-scoped, paginated) and
 * renders the customer's own security/data-significant events: logins, data
 * exports, member invite/remove, role changes, billing changes, subscription
 * cancellation, tax-identity changes. Lives behind Settings → Security (NOT a
 * new top-level door).
 *
 * Event metadata is class-labelled SERVER-SIDE (PII/financial values are
 * already reduced to labels like "[Personal]" / "[Financial]" by the
 * classification registry), so anything rendered here is safe to show.
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { ShieldCheck, ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { EmptyState } from "@/components/empty-state";
import { QueryErrorState } from "@/components/query-error-state";
import { staggerContainer, staggerItem } from "@/lib/animations";

interface AuditEntry {
  id: number;
  action: string;
  category: string;
  actorEmail: string | null;
  targetLabel: string | null;
  metadata: Record<string, unknown> | null;
  ipAddress: string | null;
  createdAt: string;
}

interface AuditResponse {
  entries: AuditEntry[];
  total: number;
  limit: number;
  offset: number;
}

const PAGE_SIZE = 25;

const CATEGORY_LABELS: Record<string, string> = {
  auth: "Sign-in",
  members: "Team",
  billing: "Billing",
  data: "Data",
  security: "Security",
};

const CATEGORY_TONE: Record<string, string> = {
  auth: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  members: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
  billing: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  data: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  security: "bg-rose-500/10 text-rose-600 dark:text-rose-400",
};

function humanizeAction(action: string): string {
  const tail = action.split(".").slice(1).join(" ") || action;
  return tail.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

function formatWhen(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

export function SecurityActivityLog() {
  const [category, setCategory] = useState<string>("all");
  const [offset, setOffset] = useState(0);

  const { data, isLoading, isFetching, isError, error, refetch } =
    useQuery<AuditResponse>({
      queryKey: ["/api/audit/log", category, offset],
      queryFn: async () => {
        const params = new URLSearchParams();
        params.set("limit", String(PAGE_SIZE));
        params.set("offset", String(offset));
        if (category !== "all") params.set("category", category);
        const res = await fetch(`/api/audit/log?${params.toString()}`);
        if (!res.ok) throw new Error("Failed to load security activity");
        return res.json();
      },
    });

  const total = data?.total ?? 0;
  const entries = data?.entries ?? [];
  const page = Math.floor(offset / PAGE_SIZE) + 1;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <Card data-testid="card-security-activity">
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="w-5 h-5" aria-hidden="true" />
              Security activity
            </CardTitle>
            <CardDescription>
              A record of sign-ins, team changes, billing changes, and other
              security-significant events on your account. Sensitive values are
              labelled, never shown in full.
            </CardDescription>
          </div>
          <Button
            variant="outline"
            size="icon"
            onClick={() => refetch()}
            disabled={isFetching}
            aria-label="Refresh security activity"
            data-testid="button-refresh-security-activity"
          >
            <RefreshCw
              className={`w-4 h-4 ${isFetching ? "animate-spin" : ""}`}
              aria-hidden="true"
            />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-end gap-3">
          <div className="space-y-1">
            <Label htmlFor="security-activity-category">Category</Label>
            <Select
              value={category}
              onValueChange={(v) => {
                setCategory(v);
                setOffset(0);
              }}
            >
              <SelectTrigger
                id="security-activity-category"
                className="w-[180px]"
                data-testid="select-security-activity-category"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All categories</SelectItem>
                <SelectItem value="auth">Sign-in</SelectItem>
                <SelectItem value="members">Team</SelectItem>
                <SelectItem value="billing">Billing</SelectItem>
                <SelectItem value="data">Data</SelectItem>
                <SelectItem value="security">Security</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {isLoading ? (
          <div className="space-y-2" role="status" aria-label="Loading security activity">
            {Array.from({ length: 5 }).map((_, i) => (
              <div
                key={i}
                className="flex items-center gap-3 rounded-lg border p-3"
              >
                <Skeleton className="h-6 w-16 rounded-full" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-64" />
                </div>
                <Skeleton className="h-3 w-28" />
              </div>
            ))}
          </div>
        ) : isError ? (
          <QueryErrorState
            error={error as Error}
            onRetry={() => refetch()}
            title="Couldn't load security activity"
          />
        ) : entries.length === 0 ? (
          <EmptyState
            icon={ShieldCheck}
            headline="No security activity yet"
            subtitle="Sign-ins, team changes, and billing changes will appear here as they happen."
            tone="default"
            // TODO(cta): read-only system-generated log — no user action drives it.
            cta={{ label: "", _noOp: true }}
          />
        ) : (
          <motion.ul
            className="space-y-2"
            variants={staggerContainer}
            initial="hidden"
            animate="show"
            data-testid="list-security-activity"
          >
            {entries.map((entry) => {
              const metaPairs = Object.entries(entry.metadata ?? {});
              return (
                <motion.li
                  key={entry.id}
                  variants={staggerItem}
                  className="flex items-start gap-3 rounded-lg border p-3"
                  data-testid={`row-security-activity-${entry.id}`}
                >
                  <Badge
                    variant="secondary"
                    className={`shrink-0 ${CATEGORY_TONE[entry.category] ?? ""}`}
                  >
                    {CATEGORY_LABELS[entry.category] ?? entry.category}
                  </Badge>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">
                      {humanizeAction(entry.action)}
                      {entry.targetLabel ? (
                        <span className="text-muted-foreground font-normal">
                          {" "}
                          · {entry.targetLabel}
                        </span>
                      ) : null}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      {entry.actorEmail ? `${entry.actorEmail} · ` : ""}
                      {entry.ipAddress ? `IP ${entry.ipAddress}` : "System"}
                    </p>
                    {metaPairs.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {metaPairs.map(([k, v]) => (
                          <span
                            key={k}
                            className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground"
                          >
                            {k}: {String(v)}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <time
                    className="shrink-0 text-xs text-muted-foreground"
                    dateTime={entry.createdAt}
                  >
                    {formatWhen(entry.createdAt)}
                  </time>
                </motion.li>
              );
            })}
          </motion.ul>
        )}

        {total > PAGE_SIZE && (
          <div className="flex items-center justify-between pt-2">
            <p className="text-xs text-muted-foreground">
              Page {page} of {totalPages} · {total} events
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={offset === 0}
                onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
                aria-label="Previous page"
                data-testid="button-security-activity-prev"
              >
                <ChevronLeft className="w-4 h-4" aria-hidden="true" />
                Prev
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={offset + PAGE_SIZE >= total}
                onClick={() => setOffset((o) => o + PAGE_SIZE)}
                aria-label="Next page"
                data-testid="button-security-activity-next"
              >
                Next
                <ChevronRight className="w-4 h-4" aria-hidden="true" />
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
