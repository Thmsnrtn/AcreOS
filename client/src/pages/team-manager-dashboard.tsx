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
import { useDocumentTitle } from "@/hooks/use-document-title";
import { ArrowDownAZ, ArrowUpAZ } from "lucide-react";

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

  const { data: response, isLoading } = useQuery<{
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
    <PageShell isLoading={isLoading} label="Loading manager dashboard">
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
                {sorted.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-sm text-muted-foreground py-8">
                      No active team members or no data in this range.
                    </TableCell>
                  </TableRow>
                ) : (
                  sorted.map((r) => (
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
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </PageShell>
  );
}
