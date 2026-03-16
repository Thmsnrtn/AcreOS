import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { apiRequest } from "@/lib/queryClient";
import {
  Trophy,
  TrendingUp,
  DollarSign,
  Users,
  Loader2,
  Medal,
} from "lucide-react";
import { format, subDays, startOfMonth, startOfQuarter, startOfYear } from "date-fns";

interface LeaderboardEntry {
  teamMemberId: number;
  displayName: string;
  email: string;
  role: string;
  leadsAssigned: number;
  offersOut: number;
  dealsUnderContract: number;
  dealsClosed: number;
  revenueGenerated: number;
  score: number;
}

interface LeaderboardResponse {
  since: string;
  leaderboard: LeaderboardEntry[];
}

const PERIODS = [
  { label: "This Month", value: "mtd", since: () => startOfMonth(new Date()) },
  { label: "This Quarter", value: "qtd", since: () => startOfQuarter(new Date()) },
  { label: "This Year", value: "ytd", since: () => startOfYear(new Date()) },
  { label: "Last 30 Days", value: "30d", since: () => subDays(new Date(), 30) },
  { label: "Last 90 Days", value: "90d", since: () => subDays(new Date(), 90) },
];

function RankBadge({ rank }: { rank: number }) {
  if (rank === 1)
    return (
      <span className="flex items-center justify-center w-8 h-8 rounded-full bg-yellow-100 text-yellow-700 font-bold text-sm">
        🥇
      </span>
    );
  if (rank === 2)
    return (
      <span className="flex items-center justify-center w-8 h-8 rounded-full bg-gray-100 text-gray-600 font-bold text-sm">
        🥈
      </span>
    );
  if (rank === 3)
    return (
      <span className="flex items-center justify-center w-8 h-8 rounded-full bg-orange-100 text-orange-700 font-bold text-sm">
        🥉
      </span>
    );
  return (
    <span className="flex items-center justify-center w-8 h-8 rounded-full bg-muted text-muted-foreground font-bold text-sm">
      {rank}
    </span>
  );
}

function StatCard({
  label,
  value,
  icon: Icon,
  color,
}: {
  label: string;
  value: string | number;
  icon: any;
  color: string;
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center gap-3">
          <Icon className={`w-8 h-8 ${color}`} />
          <div>
            <p className="text-2xl font-bold">{value}</p>
            <p className="text-sm text-muted-foreground">{label}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function TeamLeaderboardPage() {
  const [period, setPeriod] = useState("mtd");

  const sinceDate = PERIODS.find((p) => p.value === period)?.since() ?? startOfMonth(new Date());

  const { data, isLoading } = useQuery<LeaderboardResponse>({
    queryKey: ["/api/analytics/team-leaderboard", period],
    queryFn: () =>
      apiRequest(
        "GET",
        `/api/analytics/team-leaderboard?since=${sinceDate.toISOString()}`
      ).then((r) => r.json()),
  });

  const entries = data?.leaderboard ?? [];

  const totalClosed = entries.reduce((s, e) => s + e.dealsClosed, 0);
  const totalRevenue = entries.reduce((s, e) => s + e.revenueGenerated, 0);
  const totalLeads = entries.reduce((s, e) => s + e.leadsAssigned, 0);
  const topAgent = entries[0];

  return (
    <PageShell>
      <div className="space-y-6">
        {/* Period selector */}
        <div className="flex items-center gap-4">
          <Select value={period} onValueChange={setPeriod}>
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PERIODS.map((p) => (
                <SelectItem key={p.value} value={p.value}>
                  {p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {data?.since && (
            <p className="text-sm text-muted-foreground">
              Since {format(new Date(data.since), "MMMM d, yyyy")}
            </p>
          )}
        </div>

        {/* Summary stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard
            label="Team Members"
            value={entries.length}
            icon={Users}
            color="text-blue-500"
          />
          <StatCard
            label="Leads Assigned"
            value={totalLeads}
            icon={TrendingUp}
            color="text-purple-500"
          />
          <StatCard
            label="Deals Closed"
            value={totalClosed}
            icon={Trophy}
            color="text-yellow-500"
          />
          <StatCard
            label="Revenue Generated"
            value={`$${(totalRevenue / 1000).toFixed(0)}k`}
            icon={DollarSign}
            color="text-green-500"
          />
        </div>

        {/* Top performer highlight */}
        {topAgent && topAgent.dealsClosed > 0 && (
          <Card className="border-yellow-200 bg-yellow-50">
            <CardContent className="pt-6">
              <div className="flex items-center gap-4">
                <span className="text-4xl">🏆</span>
                <div>
                  <p className="font-bold text-lg">{topAgent.displayName}</p>
                  <p className="text-sm text-muted-foreground">
                    Top performer this period — {topAgent.dealsClosed} deals
                    closed, $
                    {(topAgent.revenueGenerated / 1000).toFixed(0)}k revenue
                  </p>
                </div>
                <Badge className="ml-auto bg-yellow-200 text-yellow-800 hover:bg-yellow-200">
                  <Medal className="w-3 h-3 mr-1" />
                  MVP
                </Badge>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Leaderboard table */}
        <Card>
          <CardHeader>
            <CardTitle>Rankings</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="flex justify-center py-12">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            ) : entries.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                No team members found.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">Rank</TableHead>
                    <TableHead>Agent</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead className="text-center">Leads</TableHead>
                    <TableHead className="text-center">Offers Out</TableHead>
                    <TableHead className="text-center">Under Contract</TableHead>
                    <TableHead className="text-center">Closed</TableHead>
                    <TableHead className="text-right">Revenue</TableHead>
                    <TableHead className="text-right">Score</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entries.map((entry, idx) => (
                    <TableRow
                      key={entry.teamMemberId}
                      className={idx === 0 ? "bg-yellow-50/50" : ""}
                    >
                      <TableCell>
                        <RankBadge rank={idx + 1} />
                      </TableCell>
                      <TableCell>
                        <div>
                          <p className="font-medium">{entry.displayName}</p>
                          <p className="text-xs text-muted-foreground">
                            {entry.email}
                          </p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="capitalize text-xs">
                          {entry.role}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-center">
                        {entry.leadsAssigned}
                      </TableCell>
                      <TableCell className="text-center">
                        {entry.offersOut}
                      </TableCell>
                      <TableCell className="text-center">
                        {entry.dealsUnderContract}
                      </TableCell>
                      <TableCell className="text-center font-semibold">
                        {entry.dealsClosed}
                      </TableCell>
                      <TableCell className="text-right font-semibold text-green-700">
                        $
                        {entry.revenueGenerated >= 1000
                          ? `${(entry.revenueGenerated / 1000).toFixed(0)}k`
                          : entry.revenueGenerated.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right">
                        <span className="font-bold text-blue-700">
                          {entry.score}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <p className="text-xs text-muted-foreground text-center">
          Score formula: Closed × 10 + Active × 3 + Offers × 2 + Leads × 1
        </p>
      </div>
    </PageShell>
  );
}
