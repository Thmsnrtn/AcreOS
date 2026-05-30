/**
 * /founder/customers — distribution truth surface (Wave 3 / E).
 *
 * Auto-computed view that answers "is the business actually working?":
 *   - Paid / trial / churned-30d counts
 *   - Top UTM sources (last 90 days)
 *   - Recent signups (last 20) with names, persona, city/state, UTM
 *
 * Companion to the hand-maintained customers.md at the repo root. The
 * markdown file is the qualitative narrative; this page is the
 * quantitative summary. The two complement each other.
 */

import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Users, TrendingUp, AlertTriangle, Compass, type LucideIcon } from "lucide-react";

import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/empty-state";
import { QueryErrorState } from "@/components/query-error-state";
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import { useDocumentTitle } from "@/hooks/use-document-title";

interface UtmSourceRow {
  source: string;
  count: number;
}

interface RecentSignupRow {
  orgName: string;
  persona: string;
  createdAt: string;
  utmSource: string | null;
  city: string | null;
  state: string | null;
}

interface CustomersResponse {
  asOf: string;
  paidOrgCount: number;
  trialOrgCount: number;
  churnedLast30d: number;
  topUtmSources: UtmSourceRow[];
  recentSignups: RecentSignupRow[];
}

function fmtTimestamp(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

function fmtRegion(city: string | null, state: string | null): string {
  const parts = [city, state].filter((v): v is string => !!v && v.length > 0);
  return parts.length > 0 ? parts.join(", ") : "—";
}

function CountCard({
  label,
  value,
  icon: Icon,
  tone,
  testId,
}: {
  label: string;
  value: number;
  icon: LucideIcon;
  tone: "brand" | "warn" | "ok";
  testId: string;
}) {
  const toneClass =
    tone === "warn"
      ? "text-acr-warn"
      : tone === "ok"
        ? "text-acr-ok"
        : "text-acr-brand";
  return (
    <Card className="rounded-card" data-testid={testId}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs uppercase tracking-wide text-muted-foreground">
            {label}
          </span>
          <Icon className={`w-4 h-4 ${toneClass}`} aria-hidden={true} />
        </div>
        <div className="text-3xl font-semibold tabular-nums" data-testid={`${testId}-value`}>
          {value.toLocaleString()}
        </div>
      </CardContent>
    </Card>
  );
}

function CardSkeleton() {
  return (
    <Card className="rounded-card">
      <CardContent className="p-4 space-y-3">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-8 w-16" />
      </CardContent>
    </Card>
  );
}

export default function FounderCustomersPage() {
  useDocumentTitle("Customers — AcreOS");

  const { data, isLoading, error, refetch } = useQuery<CustomersResponse>({
    queryKey: ["/api/founder/customers"],
    queryFn: async () => {
      const r = await fetch("/api/founder/customers", { credentials: "include" });
      if (!r.ok) throw new Error(`Failed to load customers (${r.status})`);
      return r.json();
    },
  });

  return (
    <PageShell label="Customers">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <Users className="w-6 h-6 text-acr-brand" aria-hidden={true} />
          Customers
        </h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
          Distribution truth surface. Paid / trial / churned counts come
          straight from <code>organizations.subscription_status</code>. UTM
          sources come from <code>users.acquisition_utm</code>, captured at
          signup. Pair this with the qualitative tracker in{" "}
          <code>customers.md</code> at the repo root.
        </p>
        {data && (
          <p className="text-xs text-muted-foreground mt-2 tabular-nums">
            As of {new Date(data.asOf).toLocaleString()}
          </p>
        )}
      </div>

      {error && (
        <QueryErrorState
          error={error as Error}
          onRetry={() => refetch()}
          title="Couldn't load customers"
          description="We hit a snag computing the customer snapshot. Try again."
          testId="founder-customers-error"
        />
      )}

      {isLoading && (
        <div data-testid="founder-customers-loading" className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <CardSkeleton />
            <CardSkeleton />
            <CardSkeleton />
          </div>
          <Card className="rounded-card">
            <CardContent className="p-4 space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-6 w-full" />
              ))}
            </CardContent>
          </Card>
        </div>
      )}

      {!isLoading && !error && data && (
        <div className="space-y-6">
          {/* ── Top-level counts ─────────────────────────────────────── */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <CountCard
              label="Paying orgs"
              value={data.paidOrgCount}
              icon={Users}
              tone="ok"
              testId="founder-customers-paid"
            />
            <CountCard
              label="Trial (last 14 days)"
              value={data.trialOrgCount}
              icon={Compass}
              tone="brand"
              testId="founder-customers-trial"
            />
            <CountCard
              label="Churned (last 30 days)"
              value={data.churnedLast30d}
              icon={AlertTriangle}
              tone="warn"
              testId="founder-customers-churn"
            />
          </div>

          {/* ── UTM sources ──────────────────────────────────────────── */}
          <Card className="rounded-card" data-testid="founder-customers-utm-card">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-acr-brand" aria-hidden={true} />
                Where they came from
                <span className="text-xs font-normal text-muted-foreground">
                  (last 90 days)
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {data.topUtmSources.length === 0 ? (
                <div className="px-4 pb-4">
                  <EmptyState
                    icon={TrendingUp}
                    title="No UTM data yet"
                    description="No signups in the last 90 days have a captured UTM source. Tag your campaign URLs with utm_source / utm_medium / utm_campaign so this page can tell you what's working."
                    actionIcon={null}
                    testId="founder-customers-utm-empty"
                  />
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Source</TableHead>
                      <TableHead className="text-right">Signups</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.topUtmSources.map((row) => (
                      <TableRow
                        key={row.source}
                        data-testid={`founder-customers-utm-row-${row.source}`}
                      >
                        <TableCell className="font-medium">
                          {row.source}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          <Badge
                            variant="secondary"
                            className="bg-acr-brand-soft text-acr-brand border-transparent tabular-nums"
                          >
                            {row.count.toLocaleString()}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {/* ── Recent signups ───────────────────────────────────────── */}
          <Card className="rounded-card" data-testid="founder-customers-recent-card">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Users className="w-4 h-4 text-acr-brand" aria-hidden={true} />
                Recent signups
                <span className="text-xs font-normal text-muted-foreground">
                  (last {data.recentSignups.length})
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {data.recentSignups.length === 0 ? (
                <div className="px-4 pb-4">
                  <EmptyState
                    icon={Users}
                    title="No signups yet"
                    description="Nobody has signed up. The first one will land here."
                    actionIcon={null}
                    testId="founder-customers-recent-empty"
                  />
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Org</TableHead>
                      <TableHead>Persona</TableHead>
                      <TableHead>Where</TableHead>
                      <TableHead>Signed up</TableHead>
                      <TableHead>UTM source</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.recentSignups.map((row, idx) => (
                      <TableRow
                        key={`${row.orgName}-${row.createdAt}-${idx}`}
                        data-testid={`founder-customers-recent-row-${idx}`}
                      >
                        <TableCell className="font-medium">{row.orgName}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {row.persona}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {fmtRegion(row.city, row.state)}
                        </TableCell>
                        <TableCell className="tabular-nums text-muted-foreground">
                          {fmtTimestamp(row.createdAt)}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {row.utmSource ?? (
                            <span className="italic">direct</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </PageShell>
  );
}
