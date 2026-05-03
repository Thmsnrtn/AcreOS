import { useState, useId } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
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
import { useDocumentTitle } from "@/hooks/use-document-title";
import { usd } from "@/lib/format";
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
  { label: "This month", value: "mtd", since: () => startOfMonth(new Date()) },
  { label: "This quarter", value: "qtd", since: () => startOfQuarter(new Date()) },
  { label: "This year", value: "ytd", since: () => startOfYear(new Date()) },
  { label: "Last 30 days", value: "30d", since: () => subDays(new Date(), 30) },
  { label: "Last 90 days", value: "90d", since: () => subDays(new Date(), 90) },
];

function RankBadge({ rank }: { rank: number }) {
  const ranks: Record<number, { emoji: string; bg: string; label: string }> = {
    1: { emoji: "🥇", bg: "bg-acr-warn-soft text-acr-warn", label: "1st place" },
    2: { emoji: "🥈", bg: "bg-muted text-muted-foreground", label: "2nd place" },
    3: { emoji: "🥉", bg: "bg-acr-warn-soft text-acr-warn", label: "3rd place" },
  };
  const meta = ranks[rank];
  if (meta) {
    return (
      <span
        className={`flex items-center justify-center w-8 h-8 rounded-full ${meta.bg} font-bold text-sm`}
        aria-label={meta.label}
      >
        <span aria-hidden="true">{meta.emoji}</span>
      </span>
    );
  }
  return (
    <span
      className="flex items-center justify-center w-8 h-8 rounded-full bg-muted text-muted-foreground font-bold text-sm tabular-nums"
      aria-label={`Rank ${rank}`}
    >
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
          <Icon className={`w-8 h-8 ${color}`} aria-hidden="true" />
          <div>
            <dd className="text-2xl font-bold tabular-nums">{value}</dd>
            <dt className="text-sm text-muted-foreground">{label}</dt>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function TeamLeaderboardPage() {
  useDocumentTitle("Team leaderboard");
  const periodSelectId = useId();
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
    <PageShell label="Team leaderboard">
      <div className="space-y-6">
        <div className="flex items-center gap-4 flex-wrap">
          <div>
            <Label htmlFor={periodSelectId} className="sr-only">Reporting period</Label>
            <Select value={period} onValueChange={setPeriod}>
              <SelectTrigger id={periodSelectId} className="w-44" aria-label="Reporting period">
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
          </div>
          {data?.since && (
            <p className="text-sm text-muted-foreground tabular-nums">
              Since {format(new Date(data.since), "MMMM d, yyyy")}
            </p>
          )}
        </div>

        <dl className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard label="Team members" value={entries.length} icon={Users} color="text-acr-accent" />
          <StatCard label="Leads assigned" value={totalLeads} icon={TrendingUp} color="text-acr-brand" />
          <StatCard label="Deals closed" value={totalClosed} icon={Trophy} color="text-acr-warn" />
          <StatCard label="Revenue generated" value={usd(totalRevenue, { noCents: true })} icon={DollarSign} color="text-acr-pos" />
        </dl>

        {topAgent && topAgent.dealsClosed > 0 && (
          <Card className="border-acr-warn-soft bg-acr-warn-soft">
            <CardContent className="pt-6">
              <div className="flex items-center gap-4 flex-wrap">
                <span className="text-4xl" aria-hidden="true">🏆</span>
                <div className="min-w-0">
                  <p className="font-bold text-lg">{topAgent.displayName}</p>
                  <p className="text-sm text-muted-foreground">
                    Top performer this period — <span className="tabular-nums">{topAgent.dealsClosed}</span> deals
                    closed, <span className="tabular-nums">{usd(topAgent.revenueGenerated, { noCents: true })}</span> revenue.
                  </p>
                </div>
                <Badge className="ml-auto bg-acr-warn-soft text-acr-warn hover:bg-acr-warn-soft">
                  <Medal className="w-3 h-3 mr-1" aria-hidden="true" />
                  MVP
                </Badge>
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Rankings</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="flex justify-center py-12" role="status" aria-live="polite">
                <span className="sr-only">Loading leaderboard…</span>
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" aria-hidden="true" />
              </div>
            ) : entries.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                No team members found.
              </div>
            ) : (
              <div role="region" aria-label="Team leaderboard rankings" tabIndex={0}>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead scope="col" className="w-12">Rank</TableHead>
                      <TableHead scope="col">Agent</TableHead>
                      <TableHead scope="col">Role</TableHead>
                      <TableHead scope="col" className="text-center">Leads</TableHead>
                      <TableHead scope="col" className="text-center">Offers out</TableHead>
                      <TableHead scope="col" className="text-center">Under contract</TableHead>
                      <TableHead scope="col" className="text-center">Closed</TableHead>
                      <TableHead scope="col" className="text-right">Revenue</TableHead>
                      <TableHead scope="col" className="text-right">Score</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {entries.map((entry, idx) => (
                      <TableRow
                        key={entry.teamMemberId}
                        className={idx === 0 ? "bg-acr-warn-soft/50" : ""}
                      >
                        <TableCell>
                          <RankBadge rank={idx + 1} />
                        </TableCell>
                        <TableCell>
                          <div>
                            <p className="font-medium">{entry.displayName}</p>
                            <p className="text-xs text-muted-foreground">{entry.email}</p>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="capitalize text-xs">
                            {entry.role}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-center tabular-nums">{entry.leadsAssigned}</TableCell>
                        <TableCell className="text-center tabular-nums">{entry.offersOut}</TableCell>
                        <TableCell className="text-center tabular-nums">{entry.dealsUnderContract}</TableCell>
                        <TableCell className="text-center font-semibold tabular-nums">{entry.dealsClosed}</TableCell>
                        <TableCell className="text-right font-semibold text-acr-pos tabular-nums">
                          {usd(entry.revenueGenerated, { noCents: true })}
                        </TableCell>
                        <TableCell className="text-right">
                          <span className="font-bold text-acr-accent tabular-nums">
                            {entry.score}
                          </span>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        <p className="text-xs text-muted-foreground text-center">
          Score formula: closed × <span className="tabular-nums">10</span> + active × <span className="tabular-nums">3</span> + offers × <span className="tabular-nums">2</span> + leads × <span className="tabular-nums">1</span>.
        </p>
      </div>
    </PageShell>
  );
}
