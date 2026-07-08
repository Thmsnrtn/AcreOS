/**
 * /team/dashboard — Manager dashboard.
 *
 * Phase 5 §5 Part C (team readiness). Per-rep performance rollup with
 * sortable columns and a 7d / 30d / 90d range selector. Clicking a rep
 * row drills into their lead pipeline (filtered list page).
 */

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryErrorState } from "@/components/query-error-state";
import { EmptyState } from "@/components/empty-state";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { ArrowDownAZ, ArrowUpAZ, Users } from "lucide-react";

interface RepRow {
  teamMemberId: number;
  displayName: string | null;
  email: string | null;
  role: string;
  leadsAssigned: number;
  leadsContacted: number;
  dealsOpened: number;
  dealsClosed: number;
  mrrContribCents: number;
}

type SortKey = keyof Pick<
  RepRow,
  "displayName" | "leadsAssigned" | "leadsContacted" | "dealsOpened" | "dealsClosed" | "mrrContribCents"
>;

export default function ManagerDashboardPage() {
  useDocumentTitle("Manager dashboard");
  const [range, setRange] = useState<"7d" | "30d" | "90d">("30d");
  const [sortKey, setSortKey] = useState<SortKey>("mrrContribCents");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const { data: response, isLoading, error, refetch } = useQuery<{
    range: string;
    since: string;
    performance: RepRow[];
  }>({
    queryKey: ["/api/team-readiness/rep-performance", range],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/team-readiness/rep-performance?range=${range}`);
      return await res.json();
    },
  });

  const sorted = useMemo(() => {
    const rows = [...(response?.performance ?? [])];
    rows.sort((a, b) => {
      const av = a[sortKey] ?? 0;
      const bv = b[sortKey] ?? 0;
      if (typeof av === "string" || typeof bv === "string") {
        return (sortDir === "asc" ? 1 : -1) * String(av).localeCompare(String(bv));
      }
      return (sortDir === "asc" ? 1 : -1) * ((av as number) - (bv as number));
    });
    return rows;
  }, [response, sortKey, sortDir]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const SortHeader = ({ k, children }: { k: SortKey; children: React.ReactNode }) => (
    <TableHead>
      <button
        type="button"
        className="flex items-center gap-1 font-medium"
        onClick={() => handleSort(k)}
        aria-label={`Sort by ${String(k)}`}
      >
        {children}
        {sortKey === k && (sortDir === "asc" ? <ArrowUpAZ className="h-3 w-3" /> : <ArrowDownAZ className="h-3 w-3" />)}
      </button>
    </TableHead>
  );

  return (
    <PageShell label="Manager dashboard">
      <div className="space-y-6">
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Manager dashboard</h1>
            <p className="text-sm text-muted-foreground">Per-rep performance for your team.</p>
          </div>
          <div>
            <label htmlFor="range-select" className="sr-only">Time range</label>
            <Select value={range} onValueChange={(v) => setRange(v as any)}>
              <SelectTrigger id="range-select" className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7d">Last 7 days</SelectItem>
                <SelectItem value="30d">Last 30 days</SelectItem>
                <SelectItem value="90d">Last 90 days</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Leaderboard</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div role="status" aria-busy="true">
                <span className="sr-only">Loading rep performance…</span>
                <div className="space-y-3">
                  {[0, 1, 2, 3, 4].map((i) => (
                    <div key={i} className="flex items-center gap-4">
                      <Skeleton className="h-4 w-32 flex-1" announce={false} />
                      <Skeleton className="h-5 w-16 rounded-full" announce={false} />
                      <Skeleton className="h-4 w-12" announce={false} />
                      <Skeleton className="h-4 w-12" announce={false} />
                      <Skeleton className="h-4 w-12" announce={false} />
                      <Skeleton className="h-4 w-12" announce={false} />
                      <Skeleton className="h-4 w-16" announce={false} />
                      <Skeleton className="h-8 w-24 rounded-md" announce={false} />
                    </div>
                  ))}
                </div>
              </div>
            ) : error ? (
              <QueryErrorState
                error={error as Error}
                onRetry={() => refetch()}
                title="Couldn't load rep performance"
                testId="manager-dashboard-error"
              />
            ) : sorted.length === 0 ? (
              <EmptyState
                icon={Users}
                headline="No performance data in this range"
                subtitle="No active team members logged activity in the selected window. Try a longer range, or assign leads to your team to start tracking performance."
                // TODO(cta): the range selector that changes the window is in the page header above — no separate action needed
                cta={{ label: "", _noOp: true }}
                testId="manager-dashboard-empty"
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <SortHeader k="displayName">Rep</SortHeader>
                    <TableHead>Role</TableHead>
                    <SortHeader k="leadsAssigned">Leads assigned</SortHeader>
                    <SortHeader k="leadsContacted">Leads contacted</SortHeader>
                    <SortHeader k="dealsOpened">Deals opened</SortHeader>
                    <SortHeader k="dealsClosed">Deals closed</SortHeader>
                    <SortHeader k="mrrContribCents">Revenue</SortHeader>
                    <TableHead className="text-right">Drill-down</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sorted.map((r) => (
                    <TableRow key={r.teamMemberId}>
                      <TableCell className="font-medium">{r.displayName || r.email || `#${r.teamMemberId}`}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{r.role}</Badge>
                      </TableCell>
                      <TableCell>{r.leadsAssigned}</TableCell>
                      <TableCell>{r.leadsContacted}</TableCell>
                      <TableCell>{r.dealsOpened}</TableCell>
                      <TableCell>{r.dealsClosed}</TableCell>
                      <TableCell>${(r.mrrContribCents / 100).toLocaleString()}</TableCell>
                      <TableCell className="text-right">
                        <Link href={`/leads?assignedTo=${r.teamMemberId}`}>
                          <Button size="sm" variant="ghost">View pipeline</Button>
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </PageShell>
  );
}
