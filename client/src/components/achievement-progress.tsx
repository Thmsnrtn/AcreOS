/**
 * Achievement Progress Widget — dashboard sidebar widget showing badge progress.
 * Shows earned badges and progress toward the next badge.
 */

import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { motion } from "framer-motion";
import { staggerContainer, staggerItem } from "@/lib/animations";
import {
  Award, Shield, ShieldCheck, Sparkles, Star, Target,
} from "lucide-react";

interface TrustScoreData {
  trustScore: number;
  trustTier: string;
  badges: string[];
  verifiedDeals: number;
  components?: {
    dealVolumeScore: number;
    dealValueScore: number;
    responseRateScore: number;
    fulfillmentRateScore: number;
    tenureScore: number;
    peerReviewScore: number;
    verificationScore: number;
  };
}

const BADGE_ICONS: Record<string, typeof Award> = {
  "First Deal": Star,
  "5 Deals Closed": Shield,
  "10 Deals Closed": ShieldCheck,
  "25 Deals Closed": Award,
  "50 Deals Closed": Sparkles,
  "Verified Investor": ShieldCheck,
  "Top Responder": Target,
};

const BADGE_MILESTONES = [
  { name: "First Deal", threshold: 1 },
  { name: "5 Deals Closed", threshold: 5 },
  { name: "10 Deals Closed", threshold: 10 },
  { name: "25 Deals Closed", threshold: 25 },
  { name: "50 Deals Closed", threshold: 50 },
];

function getBadgeIcon(badgeName: string) {
  const Icon = BADGE_ICONS[badgeName] ?? Award;
  return Icon;
}

export function AchievementProgress() {
  const { data, isLoading, isError } = useQuery<TrustScoreData>({
    queryKey: ["trust-score"],
    queryFn: async () => {
      const res = await fetch("/api/investor-network/trust-score", {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch trust score");
      return res.json();
    },
  });

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <Skeleton className="h-5 w-40" />
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-8 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (isError || !data) {
    return null;
  }

  const badges = data.badges ?? [];
  const dealCount = data.verifiedDeals ?? 0;

  // Only show when user has at least 1 badge or 1 deal
  if (badges.length === 0 && dealCount === 0) {
    return null;
  }

  // Find next milestone
  const nextMilestone = BADGE_MILESTONES.find((m) => dealCount < m.threshold);
  const progressPercent = nextMilestone
    ? Math.min(100, Math.round((dealCount / nextMilestone.threshold) * 100))
    : 100;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
          <Award className="h-4 w-4 text-primary" />
          Achievement Progress
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Earned badges */}
        {badges.length > 0 && (
          <motion.div
            variants={staggerContainer}
            initial="hidden"
            animate="visible"
            className="flex flex-wrap gap-1.5"
          >
            {badges.map((badgeName) => {
              const Icon = getBadgeIcon(badgeName);
              return (
                <motion.div key={badgeName} variants={staggerItem}>
                  <Badge variant="secondary" className="gap-1 text-xs">
                    <Icon className="h-3 w-3" />
                    {badgeName}
                  </Badge>
                </motion.div>
              );
            })}
          </motion.div>
        )}

        {/* Progress toward next badge */}
        {nextMilestone && (
          <div className="space-y-1.5">
            <p className="text-xs text-muted-foreground">
              Next badge: {nextMilestone.name} — {dealCount}/{nextMilestone.threshold} complete
            </p>
            <div className="h-1.5 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-primary rounded-full transition-all"
                style={{ width: `${Math.max(2, progressPercent)}%` }}
              />
            </div>
          </div>
        )}

        {!nextMilestone && (
          <p className="text-xs text-muted-foreground">
            All deal milestones achieved
          </p>
        )}

        {/* Trust score summary */}
        <p className="text-xs text-muted-foreground">
          Trust Score: <span className="font-medium text-foreground">{data.trustScore}</span>/1000
          {" — "}
          <span className="capitalize font-medium text-foreground">{data.trustTier}</span> tier
        </p>
      </CardContent>
    </Card>
  );
}
