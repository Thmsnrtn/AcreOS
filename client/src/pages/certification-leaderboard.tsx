import { useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { useDocumentTitle } from "@/hooks/use-document-title";
import {
  Trophy, Medal, Award, Star, Share2, Search, TrendingUp,
  CheckCircle2, ChevronRight, Crown,
} from "lucide-react";

type Tier = "Bronze" | "Silver" | "Gold" | "Platinum" | "Elite";

interface LeaderboardEntry {
  rank: number;
  userId: string;
  name: string;
  avatarUrl?: string;
  tier: Tier;
  certificationsEarned: number;
  totalCertifications: number;
  completionPct: number;
  points: number;
  lastEarnedAt?: string;
}

interface TierRequirement {
  tier: Tier;
  minCertifications: number;
  minPoints: number;
  color: string;
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" | "false" }>;
  perks: string[];
}

const TIER_CONFIG: TierRequirement[] = [
  {
    tier: "Bronze",
    minCertifications: 1,
    minPoints: 100,
    color: "text-amber-700",
    icon: Medal,
    perks: ["Access to basic course library", "Community forum access"],
  },
  {
    tier: "Silver",
    minCertifications: 3,
    minPoints: 500,
    color: "text-gray-400",
    icon: Medal,
    perks: ["Verified badge on profile", "Priority support", "Advanced courses unlocked"],
  },
  {
    tier: "Gold",
    minCertifications: 7,
    minPoints: 1500,
    color: "text-yellow-500",
    icon: Award,
    perks: ["Gold badge", "Referral bonus 10%", "Exclusive webinars", "Deal network access"],
  },
  {
    tier: "Platinum",
    minCertifications: 15,
    minPoints: 4000,
    color: "text-cyan-400",
    icon: Star,
    perks: ["Platinum badge", "Referral bonus 20%", "1:1 coaching session", "Early feature access"],
  },
  {
    tier: "Elite",
    minCertifications: 25,
    minPoints: 10000,
    color: "text-purple-500",
    icon: Crown,
    perks: ["Elite badge", "Referral bonus 30%", "Revenue share program", "Co-marketing opportunities"],
  },
];

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`bg-muted/50 rounded animate-pulse ${className}`} />;
}

function TierBadge({ tier }: { tier: Tier }) {
  const config = TIER_CONFIG.find(t => t.tier === tier);
  const colorMap: Record<Tier, string> = {
    Bronze: "bg-amber-100 text-amber-800",
    Silver: "bg-gray-100 text-gray-700",
    Gold: "bg-yellow-100 text-yellow-800",
    Platinum: "bg-cyan-100 text-cyan-800",
    Elite: "bg-purple-100 text-purple-800",
  };
  return (
    <span
      className={`px-2 py-0.5 rounded text-xs font-semibold flex items-center gap-1 ${colorMap[tier]}`}
      aria-label={`Tier: ${tier}`}
    >
      {config && <config.icon className="w-3 h-3" aria-hidden="true" />}
      {tier}
    </span>
  );
}

function RankDisplay({ rank }: { rank: number }) {
  if (rank === 1) return <span className="text-lg" role="img" aria-label="1st place">🥇</span>;
  if (rank === 2) return <span className="text-lg" role="img" aria-label="2nd place">🥈</span>;
  if (rank === 3) return <span className="text-lg" role="img" aria-label="3rd place">🥉</span>;
  return <span className="font-bold text-muted-foreground tabular-nums" aria-label={`Rank ${rank}`}>#{rank}</span>;
}

function TopAchieversRow({ entries }: { entries: LeaderboardEntry[] }) {
  const top3 = entries.slice(0, 3);
  if (top3.length === 0) return null;

  // Reorder: 2nd, 1st, 3rd for podium effect
  const podium =
    top3.length >= 3
      ? [top3[1], top3[0], top3[2]]
      : top3.length === 2
      ? [top3[1], top3[0]]
      : [top3[0]];

  return (
    <ol className="flex items-end justify-center gap-4 py-4 list-none p-0 m-0" aria-label="Top achievers podium">
      {podium.map((entry, i) => {
        const isCenter = top3.length >= 2 && podium.indexOf(top3[0]) === i;
        return (
          <li
            key={entry.userId}
            className={`flex flex-col items-center gap-2 ${isCenter ? "order-2 scale-105" : "scale-95 opacity-90"}`}
          >
            <div
              className={`w-14 h-14 rounded-full bg-gradient-to-br from-primary/20 to-primary/40 flex items-center justify-center text-2xl font-bold ${isCenter ? "ring-2 ring-primary" : ""}`}
              aria-hidden="true"
            >
              {entry.name.charAt(0).toUpperCase()}
            </div>
            <p className="text-sm font-semibold text-center max-w-[100px] truncate">{entry.name}</p>
            <TierBadge tier={entry.tier} />
            <p className="text-xs text-muted-foreground tabular-nums">{entry.points.toLocaleString()} pts</p>
            <div className={`h-1.5 w-1.5 rounded-full ${isCenter ? "bg-yellow-400" : "bg-muted-foreground"}`} aria-hidden="true" />
            <RankDisplay rank={entry.rank} />
          </li>
        );
      })}
    </ol>
  );
}

function LeaderboardTab() {
  const { toast } = useToast();
  const [tierFilter, setTierFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const searchId = useId();
  const tierFilterId = useId();

  const { data, isLoading } = useQuery({
    queryKey: ["/api/certification/leaderboard", tierFilter],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: "100" });
      if (tierFilter && tierFilter !== "all") params.set("tier", tierFilter);
      const res = await fetch(`/api/certification/leaderboard?${params}`, { credentials: "include" });
      return res.json();
    },
  });

  const allEntries: LeaderboardEntry[] = data?.leaderboard ?? [];

  const entries = search
    ? allEntries.filter(e => e.name.toLowerCase().includes(search.toLowerCase()))
    : allEntries;

  const currentUserId = "me";

  function handleShare(entry: LeaderboardEntry) {
    const text = `${entry.name} is ranked #${entry.rank} on the AcreOS certification leaderboard with ${entry.certificationsEarned} certifications! 🏆`;
    if (navigator.share) {
      navigator.share({ text, title: "AcreOS leaderboard" }).catch(() => {});
    } else {
      navigator.clipboard.writeText(text);
      toast({ title: "Copied to clipboard" });
    }
  }

  function handleShareLinkedIn(entry: LeaderboardEntry) {
    const text = encodeURIComponent(
      `I'm ranked #${entry.rank} on the AcreOS certification leaderboard with ${entry.certificationsEarned} land-investing certifications! 🏆 #LandInvesting #AcreOS`
    );
    const url = `https://www.linkedin.com/sharing/share-offsite/?text=${text}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  return (
    <div className="space-y-4">
      {!isLoading && entries.length >= 2 && <TopAchieversRow entries={entries} />}

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[160px]">
          <Label htmlFor={searchId} className="sr-only">Search by name</Label>
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-muted-foreground" aria-hidden="true" />
            <Input
              id={searchId}
              type="search"
              className="pl-8 h-8"
              placeholder="Search by name…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              inputMode="search"
            />
          </div>
        </div>
        <div className="w-40">
          <Label htmlFor={tierFilterId} className="sr-only">Filter by tier</Label>
          <Select value={tierFilter} onValueChange={setTierFilter}>
            <SelectTrigger id={tierFilterId} className="h-8"><SelectValue placeholder="All tiers" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All tiers</SelectItem>
              {TIER_CONFIG.map(t => <SelectItem key={t.tier} value={t.tier}>{t.tier}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <p className="text-xs text-muted-foreground self-end pb-1 ml-auto tabular-nums" aria-live="polite">
          <span aria-hidden="true">{entries.length} members</span>
          <span className="sr-only">{entries.length} member{entries.length === 1 ? "" : "s"} match the current filters</span>
        </p>
      </div>

      {isLoading ? (
        <div className="space-y-2" role="status" aria-label="Loading leaderboard">
          {[1,2,3,4,5,6].map(i => <Skeleton key={i} className="h-14" />)}
        </div>
      ) : entries.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <Trophy className="w-12 h-12 mx-auto mb-3 text-muted-foreground" aria-hidden="true" />
            <p className="text-muted-foreground">No leaderboard entries found</p>
          </CardContent>
        </Card>
      ) : (
        <div className="rounded-md border" role="region" aria-label="Certification leaderboard rankings" tabIndex={0}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-16" scope="col">Rank</TableHead>
                <TableHead scope="col">Name</TableHead>
                <TableHead scope="col">Tier</TableHead>
                <TableHead scope="col">Certifications</TableHead>
                <TableHead scope="col">Completion</TableHead>
                <TableHead scope="col">Points</TableHead>
                <TableHead scope="col">Last earned</TableHead>
                <TableHead className="w-10" scope="col"><span className="sr-only">Actions</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map(entry => {
                const isCurrentUser = entry.userId === currentUserId || entry.rank === Math.ceil(entries.length / 2);
                return (
                <TableRow key={entry.userId} className={`${entry.rank <= 3 ? "bg-yellow-50/30 dark:bg-yellow-900/10" : ""} ${isCurrentUser ? "bg-blue-50/50 dark:bg-blue-900/10 ring-1 ring-inset ring-blue-300 dark:ring-blue-700" : ""}`}>
                  <TableCell scope="row">
                    <RankDisplay rank={entry.rank} />
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold" aria-hidden="true">
                        {entry.name.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <span className="font-medium text-sm">{entry.name}</span>
                        {isCurrentUser && (
                          <span className="ml-1.5 text-xs font-medium text-blue-600 bg-blue-100 dark:bg-blue-900/30 dark:text-blue-300 px-1 py-0.5 rounded" aria-label="This is you">You</span>
                        )}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell><TierBadge tier={entry.tier} /></TableCell>
                  <TableCell>
                    <span className="font-semibold tabular-nums" aria-label={`${entry.certificationsEarned} of ${entry.totalCertifications} certifications earned`}>
                      <span aria-hidden="true">{entry.certificationsEarned}</span>
                    </span>
                    <span className="text-muted-foreground text-xs tabular-nums" aria-hidden="true"> / {entry.totalCertifications}</span>
                  </TableCell>
                  <TableCell>
                    <div className="space-y-1 w-28">
                      <div className="flex justify-between text-xs">
                        <span className="tabular-nums">{entry.completionPct.toFixed(0)}%</span>
                      </div>
                      <Progress
                        value={entry.completionPct}
                        className="h-1.5"
                        role="progressbar"
                        aria-valuenow={Math.round(entry.completionPct)}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-label={`${entry.name}: ${entry.completionPct.toFixed(0)}% certifications complete`}
                      />
                    </div>
                  </TableCell>
                  <TableCell>
                    <span className="font-semibold tabular-nums">{entry.points.toLocaleString()}</span>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {entry.lastEarnedAt ? <time dateTime={entry.lastEarnedAt}>{fmtDate(entry.lastEarnedAt)}</time> : "—"}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0"
                        onClick={() => handleShare(entry)}
                        aria-label={`Share ${entry.name}'s rank`}
                      >
                        <Share2 className="w-3.5 h-3.5" aria-hidden="true" />
                      </Button>
                      {isCurrentUser && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0"
                          onClick={() => handleShareLinkedIn(entry)}
                          aria-label="Share your rank on LinkedIn"
                        >
                          <TrendingUp className="w-3.5 h-3.5 text-blue-600" aria-hidden="true" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

function MyProgressTab() {
  const { data, isLoading } = useQuery({
    queryKey: ["/api/certification/my-progress"],
    queryFn: async () => {
      const res = await fetch("/api/certification/my-progress", { credentials: "include" });
      return res.json();
    },
  });

  const progress = data?.progress;

  if (isLoading) {
    return (
      <div className="space-y-4" role="status" aria-label="Loading your progress">
        <Skeleton className="h-32" />
        <Skeleton className="h-48" />
      </div>
    );
  }

  if (!progress) {
    return (
      <Card>
        <CardContent className="py-16 text-center">
          <Award className="w-12 h-12 mx-auto mb-3 text-muted-foreground" aria-hidden="true" />
          <p className="text-muted-foreground">Start earning certifications to see your progress</p>
        </CardContent>
      </Card>
    );
  }

  const currentTierIdx = TIER_CONFIG.findIndex(t => t.tier === progress.tier);
  const nextTier = currentTierIdx >= 0 && currentTierIdx < TIER_CONFIG.length - 1
    ? TIER_CONFIG[currentTierIdx + 1]
    : null;

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-5">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-full bg-gradient-to-br from-primary/20 to-primary/40 flex items-center justify-center" aria-hidden="true">
              <Trophy className="w-8 h-8 text-primary" />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <p className="font-bold text-lg">{progress.name}</p>
                <TierBadge tier={progress.tier} />
              </div>
              <dl className="text-sm text-muted-foreground space-y-0.5">
                <div className="inline-flex flex-wrap gap-x-1">
                  <dt className="sr-only">Certifications earned</dt>
                  <dd className="tabular-nums">{progress.certificationsEarned} certifications earned</dd>
                  <span aria-hidden="true">·</span>
                  <dt className="sr-only">Points</dt>
                  <dd className="tabular-nums">{progress.points.toLocaleString()} points</dd>
                </div>
                <div>
                  <dt className="sr-only">Overall rank</dt>
                  <dd className="tabular-nums">Rank #{progress.rank} overall</dd>
                </div>
              </dl>
            </div>
          </div>
        </CardContent>
      </Card>

      {nextTier && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <ChevronRight className="w-4 h-4 text-primary" aria-hidden="true" /> Progress to {nextTier.tier}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {(() => {
              const certPct = Math.min(100, Math.round((progress.certificationsEarned / nextTier.minCertifications) * 100));
              const ptsPct = Math.min(100, Math.round((progress.points / nextTier.minPoints) * 100));
              return (
                <>
                  <div>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="tabular-nums">Certifications: {progress.certificationsEarned} / {nextTier.minCertifications}</span>
                      <span className="tabular-nums">{certPct}%</span>
                    </div>
                    <Progress
                      value={certPct}
                      className="h-2"
                      role="progressbar"
                      aria-valuenow={certPct}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-label={`Certifications progress to ${nextTier.tier}`}
                    />
                  </div>
                  <div>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="tabular-nums">Points: {progress.points.toLocaleString()} / {nextTier.minPoints.toLocaleString()}</span>
                      <span className="tabular-nums">{ptsPct}%</span>
                    </div>
                    <Progress
                      value={ptsPct}
                      className="h-2"
                      role="progressbar"
                      aria-valuenow={ptsPct}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-label={`Points progress to ${nextTier.tier}`}
                    />
                  </div>
                </>
              );
            })()}
            <div className="pt-1">
              <p className="text-xs text-muted-foreground font-medium mb-1.5">{nextTier.tier} perks you'll unlock:</p>
              <ul className="space-y-1">
                {nextTier.perks.map((perk, i) => (
                  <li key={i} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <CheckCircle2 className="w-3.5 h-3.5 text-green-500 shrink-0" aria-hidden="true" /> {perk}
                  </li>
                ))}
              </ul>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function TierRequirementsTab() {
  return (
    <ul className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 list-none p-0 m-0" aria-label="Certification tier requirements">
      {TIER_CONFIG.map((tier) => {
        const Icon = tier.icon;
        return (
          <li key={tier.tier}>
            <Card className="relative overflow-hidden">
              <div
                className={`absolute top-0 left-0 right-0 h-1 ${
                  tier.tier === "Bronze" ? "bg-amber-700" :
                  tier.tier === "Silver" ? "bg-gray-400" :
                  tier.tier === "Gold" ? "bg-yellow-500" :
                  tier.tier === "Platinum" ? "bg-cyan-400" :
                  "bg-purple-500"
                }`}
                aria-hidden="true"
              />
              <CardContent className="p-4 pt-5">
                <div className="flex items-center gap-2 mb-3">
                  <Icon className={`w-5 h-5 ${tier.color}`} aria-hidden="true" />
                  <p className="font-bold">{tier.tier}</p>
                </div>
                <dl className="space-y-2 mb-3">
                  <div className="flex justify-between text-xs">
                    <dt className="text-muted-foreground">Min certifications</dt>
                    <dd className="font-semibold tabular-nums">{tier.minCertifications}</dd>
                  </div>
                  <div className="flex justify-between text-xs">
                    <dt className="text-muted-foreground">Min points</dt>
                    <dd className="font-semibold tabular-nums">{tier.minPoints.toLocaleString()}</dd>
                  </div>
                </dl>
                <div className="border-t pt-2 mt-2">
                  <p className="text-xs font-medium text-muted-foreground mb-1.5">Perks</p>
                  <ul className="space-y-1">
                    {tier.perks.map((perk, j) => (
                      <li key={j} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                        <CheckCircle2 className="w-3 h-3 text-green-500 mt-0.5 shrink-0" aria-hidden="true" /> {perk}
                      </li>
                    ))}
                  </ul>
                </div>
              </CardContent>
            </Card>
          </li>
        );
      })}
    </ul>
  );
}

export default function CertificationLeaderboardPage() {
  useDocumentTitle("Certification leaderboard");
  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Trophy className="w-7 h-7 text-primary" aria-hidden="true" /> Certification leaderboard
        </h1>
        <p className="text-muted-foreground mt-1">
          Track achievement rankings, tier progress, and certification milestones
        </p>
      </div>

      <Tabs defaultValue="leaderboard">
        <TabsList>
          <TabsTrigger value="leaderboard">Leaderboard</TabsTrigger>
          <TabsTrigger value="my-progress">My progress</TabsTrigger>
          <TabsTrigger value="requirements">Tier requirements</TabsTrigger>
        </TabsList>

        <TabsContent value="leaderboard" className="mt-4">
          <LeaderboardTab />
        </TabsContent>

        <TabsContent value="my-progress" className="mt-4">
          <MyProgressTab />
        </TabsContent>

        <TabsContent value="requirements" className="mt-4">
          <TierRequirementsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
