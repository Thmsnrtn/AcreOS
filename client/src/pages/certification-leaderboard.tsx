import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import {
  Trophy, Medal, Award, Star, Share2, Search, TrendingUp,
  CheckCircle2, Lock, ChevronRight, Crown,
} from "lucide-react";

// ─── Types ──────────────────────────────────────────────────────────────────

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
  icon: React.ComponentType<{ className?: string }>;
  perks: string[];
}

// ─── Tier Config ─────────────────────────────────────────────────────────────

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

// ─── Helpers ─────────────────────────────────────────────────────────────────

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
    <span className={`px-2 py-0.5 rounded text-xs font-semibold flex items-center gap-1 ${colorMap[tier]}`}>
      {config && <config.icon className="w-3 h-3" />}
      {tier}
    </span>
  );
}

function RankDisplay({ rank }: { rank: number }) {
  if (rank === 1) return <span className="text-lg">🥇</span>;
  if (rank === 2) return <span className="text-lg">🥈</span>;
  if (rank === 3) return <span className="text-lg">🥉</span>;
  return <span className="font-bold text-muted-foreground">#{rank}</span>;
}

// ─── Top Achievers Cards ──────────────────────────────────────────────────────

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
    <div className="flex items-end justify-center gap-4 py-4">
      {podium.map((entry, i) => {
        const isCenter = top3.length >= 2 && podium.indexOf(top3[0]) === i;
        return (
          <div
            key={entry.userId}
            className={`flex flex-col items-center gap-2 ${isCenter ? "order-2 scale-105" : "scale-95 opacity-90"}`}
          >
            <div className={`w-14 h-14 rounded-full bg-gradient-to-br from-primary/20 to-primary/40 flex items-center justify-center text-2xl font-bold ${isCenter ? "ring-2 ring-primary" : ""}`}>
              {entry.name.charAt(0).toUpperCase()}
            </div>
            <p className="text-sm font-semibold text-center max-w-[100px] truncate">{entry.name}</p>
            <TierBadge tier={entry.tier} />
            <p className="text-xs text-muted-foreground">{entry.points.toLocaleString()} pts</p>
            <div className={`h-1.5 w-1.5 rounded-full ${isCenter ? "bg-yellow-400" : "bg-muted-foreground"}`} />
            <RankDisplay rank={entry.rank} />
          </div>
        );
      })}
    </div>
  );
}

// ─── Leaderboard Table Tab ────────────────────────────────────────────────────

function LeaderboardTab() {
  const { toast } = useToast();
  const [tierFilter, setTierFilter] = useState<string>("");
  const [search, setSearch] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["/api/certification/leaderboard", tierFilter],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: "100" });
      if (tierFilter) params.set("tier", tierFilter);
      const res = await fetch(`/api/certification/leaderboard?${params}`, { credentials: "include" });
      return res.json();
    },
  });

  const allEntries: LeaderboardEntry[] = data?.leaderboard ?? [];

  const entries = search
    ? allEntries.filter(e => e.name.toLowerCase().includes(search.toLowerCase()))
    : allEntries;

  // Detect current user — in real app this would come from auth context
  const currentUserId = "me"; // placeholder

  function handleShare(entry: LeaderboardEntry) {
    const text = `${entry.name} is ranked #${entry.rank} on the AcreOS Certification Leaderboard with ${entry.certificationsEarned} certifications! 🏆`;
    if (navigator.share) {
      navigator.share({ text, title: "AcreOS Leaderboard" }).catch(() => {});
    } else {
      navigator.clipboard.writeText(text);
      toast({ title: "Copied to clipboard" });
    }
  }

  function handleShareLinkedIn(entry: LeaderboardEntry) {
    const text = encodeURIComponent(
      `I'm ranked #${entry.rank} on the AcreOS Certification Leaderboard with ${entry.certificationsEarned} land investing certifications! 🏆 #LandInvesting #AcreOS`
    );
    const url = `https://www.linkedin.com/sharing/share-offsite/?text=${text}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  return (
    <div className="space-y-4">
      {/* Top 3 Podium */}
      {!isLoading && entries.length >= 2 && <TopAchieversRow entries={entries} />}

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[160px]">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-muted-foreground" />
            <Input className="pl-8 h-8" placeholder="Search by name…" value={search}
              onChange={e => setSearch(e.target.value)} />
          </div>
        </div>
        <div className="w-40">
          <Select value={tierFilter} onValueChange={setTierFilter}>
            <SelectTrigger className="h-8"><SelectValue placeholder="All tiers" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="">All Tiers</SelectItem>
              {TIER_CONFIG.map(t => <SelectItem key={t.tier} value={t.tier}>{t.tier}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <p className="text-xs text-muted-foreground self-end pb-1 ml-auto">{entries.length} members</p>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="space-y-2">{[1,2,3,4,5,6].map(i => <Skeleton key={i} className="h-14" />)}</div>
      ) : entries.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <Trophy className="w-12 h-12 mx-auto mb-3 text-muted-foreground" />
            <p className="text-muted-foreground">No leaderboard entries found</p>
          </CardContent>
        </Card>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-16">Rank</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Tier</TableHead>
                <TableHead>Certifications</TableHead>
                <TableHead>Completion</TableHead>
                <TableHead>Points</TableHead>
                <TableHead>Last Earned</TableHead>
                <TableHead className="w-10"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map(entry => {
                const isCurrentUser = entry.userId === currentUserId || entry.rank === Math.ceil(entries.length / 2); // demo: highlight middle entry as "me"
                return (
                <TableRow key={entry.userId} className={`${entry.rank <= 3 ? "bg-yellow-50/30 dark:bg-yellow-900/10" : ""} ${isCurrentUser ? "bg-blue-50/50 dark:bg-blue-900/10 ring-1 ring-inset ring-blue-300 dark:ring-blue-700" : ""}`}>
                  <TableCell>
                    <RankDisplay rank={entry.rank} />
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold">
                        {entry.name.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <span className="font-medium text-sm">{entry.name}</span>
                        {isCurrentUser && (
                          <span className="ml-1.5 text-xs font-medium text-blue-600 bg-blue-100 dark:bg-blue-900/30 dark:text-blue-300 px-1 py-0.5 rounded">You</span>
                        )}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell><TierBadge tier={entry.tier} /></TableCell>
                  <TableCell>
                    <span className="font-semibold">{entry.certificationsEarned}</span>
                    <span className="text-muted-foreground text-xs"> / {entry.totalCertifications}</span>
                  </TableCell>
                  <TableCell>
                    <div className="space-y-1 w-28">
                      <div className="flex justify-between text-xs">
                        <span>{entry.completionPct.toFixed(0)}%</span>
                      </div>
                      <Progress value={entry.completionPct} className="h-1.5" />
                    </div>
                  </TableCell>
                  <TableCell>
                    <span className="font-semibold">{entry.points.toLocaleString()}</span>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {entry.lastEarnedAt ? fmtDate(entry.lastEarnedAt) : "—"}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0" title="Share"
                        onClick={() => handleShare(entry)}>
                        <Share2 className="w-3.5 h-3.5" />
                      </Button>
                      {isCurrentUser && (
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" title="Share to LinkedIn"
                          onClick={() => handleShareLinkedIn(entry)}>
                          <TrendingUp className="w-3.5 h-3.5 text-blue-600" />
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

// ─── My Progress Tab ──────────────────────────────────────────────────────────

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
      <div className="space-y-4">
        <Skeleton className="h-32" />
        <Skeleton className="h-48" />
      </div>
    );
  }

  if (!progress) {
    return (
      <Card>
        <CardContent className="py-16 text-center">
          <Award className="w-12 h-12 mx-auto mb-3 text-muted-foreground" />
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
      {/* Current Status */}
      <Card>
        <CardContent className="p-5">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-full bg-gradient-to-br from-primary/20 to-primary/40 flex items-center justify-center">
              <Trophy className="w-8 h-8 text-primary" />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <p className="font-bold text-lg">{progress.name}</p>
                <TierBadge tier={progress.tier} />
              </div>
              <p className="text-sm text-muted-foreground">
                {progress.certificationsEarned} certifications earned · {progress.points.toLocaleString()} points
              </p>
              <p className="text-sm text-muted-foreground">
                Rank #{progress.rank} overall
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Progress to Next Tier */}
      {nextTier && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <ChevronRight className="w-4 h-4 text-primary" /> Progress to {nextTier.tier}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <div className="flex justify-between text-xs mb-1">
                <span>Certifications: {progress.certificationsEarned} / {nextTier.minCertifications}</span>
                <span>{Math.min(100, Math.round((progress.certificationsEarned / nextTier.minCertifications) * 100))}%</span>
              </div>
              <Progress value={Math.min(100, (progress.certificationsEarned / nextTier.minCertifications) * 100)} className="h-2" />
            </div>
            <div>
              <div className="flex justify-between text-xs mb-1">
                <span>Points: {progress.points.toLocaleString()} / {nextTier.minPoints.toLocaleString()}</span>
                <span>{Math.min(100, Math.round((progress.points / nextTier.minPoints) * 100))}%</span>
              </div>
              <Progress value={Math.min(100, (progress.points / nextTier.minPoints) * 100)} className="h-2" />
            </div>
            <div className="pt-1">
              <p className="text-xs text-muted-foreground font-medium mb-1.5">{nextTier.tier} perks you'll unlock:</p>
              <ul className="space-y-1">
                {nextTier.perks.map((perk, i) => (
                  <li key={i} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <CheckCircle2 className="w-3.5 h-3.5 text-green-500 shrink-0" /> {perk}
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

// ─── Tier Requirements Tab ────────────────────────────────────────────────────

function TierRequirementsTab() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {TIER_CONFIG.map((tier, i) => {
        const Icon = tier.icon;
        return (
          <Card key={tier.tier} className="relative overflow-hidden">
            <div className={`absolute top-0 left-0 right-0 h-1 ${
              tier.tier === "Bronze" ? "bg-amber-700" :
              tier.tier === "Silver" ? "bg-gray-400" :
              tier.tier === "Gold" ? "bg-yellow-500" :
              tier.tier === "Platinum" ? "bg-cyan-400" :
              "bg-purple-500"
            }`} />
            <CardContent className="p-4 pt-5">
              <div className="flex items-center gap-2 mb-3">
                <Icon className={`w-5 h-5 ${tier.color}`} />
                <p className="font-bold">{tier.tier}</p>
              </div>
              <div className="space-y-2 mb-3">
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Min Certifications</span>
                  <span className="font-semibold">{tier.minCertifications}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Min Points</span>
                  <span className="font-semibold">{tier.minPoints.toLocaleString()}</span>
                </div>
              </div>
              <div className="border-t pt-2 mt-2">
                <p className="text-xs font-medium text-muted-foreground mb-1.5">Perks</p>
                <ul className="space-y-1">
                  {tier.perks.map((perk, j) => (
                    <li key={j} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                      <CheckCircle2 className="w-3 h-3 text-green-500 mt-0.5 shrink-0" /> {perk}
                    </li>
                  ))}
                </ul>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function CertificationLeaderboardPage() {
  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Trophy className="w-7 h-7 text-primary" /> Certification Leaderboard
        </h1>
        <p className="text-muted-foreground mt-1">
          Track achievement rankings, tier progress, and certification milestones
        </p>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="leaderboard">
        <TabsList>
          <TabsTrigger value="leaderboard">Leaderboard</TabsTrigger>
          <TabsTrigger value="my-progress">My Progress</TabsTrigger>
          <TabsTrigger value="requirements">Tier Requirements</TabsTrigger>
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
