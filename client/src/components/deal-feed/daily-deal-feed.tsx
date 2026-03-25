import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { staggerContainer, staggerItem, scaleIn } from "@/lib/animations";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  MapPin,
  TrendingUp,
  Send,
  Bookmark,
  X,
  RefreshCw,
  AlertCircle,
  Target,
  ArrowRight,
} from "lucide-react";
import { Link } from "wouter";
import { apiRequest } from "@/lib/queryClient";

interface DealOpportunity {
  id: string;
  parcel: {
    apn: string;
    address: string | null;
    county: string;
    state: string;
    acreage: number;
    lat: number;
    lng: number;
  };
  scores: {
    landCredit: number;
    landCreditGrade: string;
    radarScore: number;
    ownerMotivation: number;
    countyOpportunity: number;
    composite: number;
  };
  signals: {
    motivation: string[];
    environmental: string[];
    market: string[];
    risks: string[];
  };
  financials: {
    estimatedValue: number;
    suggestedOffer: { aggressive: number; market: number; generous: number };
    cashFlipProfit: { aggressive: number; market: number; generous: number };
    sellerFinanceYield: number | null;
  };
  enrichment: {
    floodZone: string;
    elevation: number | null;
    roadAccess: string;
    terrain: string;
    soil: string;
    nearestTown: string | null;
    nearestTownDistance: number | null;
  };
  matchReason: string;
}

interface FeedResponse {
  opportunities: DealOpportunity[];
  generatedAt: string;
}

const motivationColors: Record<string, string> = {
  "Tax delinquent": "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
  "Out of state": "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
  "Inherited property": "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300",
};

function lcsColor(grade: string): string {
  if (grade.startsWith("A")) return "bg-emerald-500";
  if (grade.startsWith("B")) return "bg-blue-500";
  if (grade.startsWith("C")) return "bg-amber-500";
  if (grade === "D") return "bg-orange-500";
  return "bg-red-500";
}

function formatCurrency(val: number | null | undefined): string {
  if (val == null) return "—";
  if (val === 0) return "$0";
  return `$${val.toLocaleString()}`;
}

function DealCard({
  opportunity,
  onAction,
}: {
  opportunity: DealOpportunity;
  onAction: (id: string, action: string) => void;
}) {
  const { parcel, scores, signals, financials, enrichment, matchReason } = opportunity;
  const displayName = parcel.address
    ? parcel.address
    : parcel.apn
      ? `Unaddressed Parcel — ${parcel.apn}`
      : `${parcel.county} County Parcel`;

  const acreageDisplay =
    parcel.acreage > 0 ? `${parcel.acreage.toLocaleString()} acres` : "Acreage unknown";

  const enrichmentLine = [
    enrichment.floodZone !== "Unknown" ? `${enrichment.floodZone === "X" || enrichment.floodZone === "None" ? "No" : ""} flood risk` : null,
    enrichment.roadAccess !== "Unknown" ? `${enrichment.roadAccess} road` : null,
    enrichment.terrain !== "Unknown" ? `${enrichment.terrain} terrain` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <motion.div variants={staggerItem}>
      <Card className="floating-window hover-elevate transition-all">
        <CardContent className="p-4 space-y-3">
          {/* Top: county badge + acreage + LCS */}
          <div className="flex items-start justify-between">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-xs">
                  <MapPin className="w-3 h-3 mr-1" />
                  {parcel.county}, {parcel.state}
                </Badge>
                <span className="text-sm font-medium">{acreageDisplay}</span>
              </div>
              <p className="text-sm font-semibold truncate max-w-[240px]">{displayName}</p>
            </div>

            {/* LCS badge */}
            <div className="flex flex-col items-center">
              <div
                className={`w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-bold ${lcsColor(scores.landCreditGrade)}`}
              >
                {scores.landCredit}
              </div>
              <span className="text-[10px] text-muted-foreground mt-0.5">
                {scores.landCreditGrade}
              </span>
            </div>
          </div>

          {/* Middle: composite bar + signals */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary rounded-full transition-all"
                  style={{ width: `${scores.composite}%` }}
                />
              </div>
              <span className="text-xs font-medium tabular-nums w-8 text-right">
                {scores.composite}
              </span>
            </div>

            <div className="flex flex-wrap gap-1">
              {signals.motivation.map((s) => (
                <Badge
                  key={s}
                  variant="secondary"
                  className={`text-[10px] ${motivationColors[s] || "bg-muted"}`}
                >
                  {s}
                </Badge>
              ))}
              {signals.environmental.slice(0, 2).map((s) => (
                <Badge key={s} variant="secondary" className="text-[10px] bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
                  {s}
                </Badge>
              ))}
            </div>

            {enrichmentLine && (
              <p className="text-xs text-muted-foreground">{enrichmentLine}</p>
            )}
          </div>

          {/* Bottom: offer range + actions */}
          <div className="space-y-2">
            <p className="text-sm font-medium">
              {formatCurrency(financials.suggestedOffer.aggressive)} —{" "}
              {formatCurrency(financials.suggestedOffer.generous)}
              {financials.estimatedValue > 0 && (
                <span className="text-xs text-muted-foreground ml-1">
                  {Math.round(
                    ((financials.estimatedValue - financials.suggestedOffer.market) /
                      financials.estimatedValue) *
                      100,
                  )}
                  % below estimated market value
                </span>
              )}
            </p>

            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                className="text-xs"
                onClick={() => onAction(opportunity.id, "pass")}
                aria-label="Pass on this opportunity"
              >
                <X className="w-3 h-3 mr-1" /> Pass
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="text-xs"
                onClick={() => onAction(opportunity.id, "interested")}
                aria-label="Save this opportunity"
              >
                <Bookmark className="w-3 h-3 mr-1" /> Save
              </Button>
              <Button
                size="sm"
                className="text-xs"
                onClick={() => onAction(opportunity.id, "offer_sent")}
                aria-label="Send offer for this opportunity"
              >
                <Send className="w-3 h-3 mr-1" /> Send Offer
              </Button>
            </div>

            <p className="text-xs text-muted-foreground">{matchReason}</p>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

export function DailyDealFeed({ compact = false }: { compact?: boolean }) {
  const queryClient = useQueryClient();
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const { data, isLoading, error } = useQuery<FeedResponse>({
    queryKey: ["/api/deal-feed"],
    staleTime: 5 * 60 * 1000,
  });

  const actionMutation = useMutation({
    mutationFn: async ({ id, action }: { id: string; action: string }) => {
      return apiRequest("POST", `/api/deal-feed/${id}/action`, { action });
    },
    onSuccess: (_, { id, action }) => {
      if (action === "pass") {
        setDismissed((prev) => new Set([...prev, id]));
      }
      queryClient.invalidateQueries({ queryKey: ["/api/deal-feed"] });
    },
  });

  const refreshMutation = useMutation({
    mutationFn: async () => apiRequest("POST", "/api/deal-feed/refresh"),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/deal-feed"] }),
  });

  const handleAction = (id: string, action: string) => {
    actionMutation.mutate({ id, action });
  };

  // Loading state: 3 skeleton cards
  if (isLoading) {
    return (
      <div className={`grid grid-cols-1 ${compact ? "" : "md:grid-cols-2 lg:grid-cols-3"} gap-4`}>
        {[1, 2, 3].map((i) => (
          <Card key={i} className="floating-window">
            <CardContent className="p-4 space-y-3">
              <div className="flex justify-between">
                <Skeleton className="h-5 w-32" />
                <Skeleton className="h-10 w-10 rounded-full" />
              </div>
              <Skeleton className="h-2 w-full" />
              <div className="flex gap-1">
                <Skeleton className="h-5 w-20" />
                <Skeleton className="h-5 w-16" />
              </div>
              <Skeleton className="h-4 w-48" />
              <div className="flex gap-2">
                <Skeleton className="h-8 w-16" />
                <Skeleton className="h-8 w-16" />
                <Skeleton className="h-8 w-24" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <Card className="border-destructive/20">
        <CardContent className="p-6 text-center space-y-3">
          <AlertCircle className="w-8 h-8 text-destructive mx-auto" />
          <p className="text-sm">
            Couldn't generate today's deals — one of our data sources is taking a break.
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refreshMutation.mutate()}
            disabled={refreshMutation.isPending}
          >
            <RefreshCw className={`w-3 h-3 mr-1 ${refreshMutation.isPending ? "animate-spin" : ""}`} />
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  const opportunities = (data?.opportunities || []).filter((o) => !dismissed.has(o.id));

  // Empty — no targets set
  if (!data?.opportunities || data.opportunities.length === 0) {
    return (
      <Card className="border-primary/20">
        <CardContent className="p-6 text-center space-y-3">
          <Target className="w-8 h-8 text-primary mx-auto" />
          <p className="text-sm font-medium">
            Set your target counties to start finding deals
          </p>
          <p className="text-xs text-muted-foreground">
            We'll scan daily and surface the best opportunities for your strategy.
          </p>
          <Link href="/settings">
            <Button variant="outline" size="sm">
              Configure Target Counties <ArrowRight className="w-3 h-3 ml-1" />
            </Button>
          </Link>
        </CardContent>
      </Card>
    );
  }

  // Empty after filtering — no new matches
  if (opportunities.length === 0) {
    return (
      <Card>
        <CardContent className="p-6 text-center space-y-3">
          <TrendingUp className="w-8 h-8 text-muted-foreground mx-auto" />
          <p className="text-sm">
            No new matches today — your criteria are selective, and that's smart investing.
          </p>
          <p className="text-xs text-muted-foreground">
            We're scanning {data.opportunities.length > 0 ? `${new Set(data.opportunities.map(o => o.parcel.county)).size} counties` : "your target counties"} and will surface opportunities as they appear.
          </p>
        </CardContent>
      </Card>
    );
  }

  const displayOpportunities = compact ? opportunities.slice(0, 3) : opportunities;

  return (
    <div className="space-y-4">
      <AnimatePresence mode="popLayout">
        <motion.div
          variants={staggerContainer}
          initial="hidden"
          animate="visible"
          className={`grid grid-cols-1 ${compact ? "" : "md:grid-cols-2 lg:grid-cols-3"} gap-4`}
        >
          {displayOpportunities.map((opp) => (
            <DealCard key={opp.id} opportunity={opp} onAction={handleAction} />
          ))}
        </motion.div>
      </AnimatePresence>

      {compact && opportunities.length > 3 && (
        <Link href="/deal-feed">
          <Button variant="ghost" size="sm" className="w-full text-xs">
            View All {opportunities.length} <ArrowRight className="w-3 h-3 ml-1" />
          </Button>
        </Link>
      )}
    </div>
  );
}
