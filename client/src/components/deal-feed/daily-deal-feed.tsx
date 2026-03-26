import { useState, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { staggerContainer, staggerItem, scaleIn } from "@/lib/animations";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
  ChevronDown,
  Star,
} from "lucide-react";
import { Link } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { AIReasoning } from "@/components/ai-reasoning";

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
  legal?: {
    multipleOwners?: boolean;
    ownerCount?: number;
    taxDelinquent?: boolean;
    redemptionMonths?: number;
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

/** Determines an acreage bucket for pass-tracking (e.g. "8+" or "0-5") */
function acreageBucket(acreage: number): string {
  if (acreage <= 2) return "0-2";
  if (acreage <= 5) return "2-5";
  if (acreage <= 8) return "5-8";
  return "8+";
}

function HeroDealCard({
  opportunity,
  onAction,
}: {
  opportunity: DealOpportunity;
  onAction: (id: string, action: string) => void;
}) {
  const { parcel, scores, signals, financials, enrichment, matchReason, legal } = opportunity;
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
      <Card className="floating-window hover-elevate transition-all border-primary/30">
        <CardContent className="p-6 space-y-4">
          {/* Hero header */}
          <div className="flex items-start justify-between">
            <div className="space-y-1 flex-1">
              <div className="flex items-center gap-2">
                <Badge className="bg-primary text-primary-foreground text-xs">
                  <Star className="w-3 h-3 mr-1" />
                  #1 Today
                </Badge>
                <Badge variant="outline" className="text-xs">
                  <MapPin className="w-3 h-3 mr-1" />
                  {parcel.county}, {parcel.state}
                </Badge>
                <span className="text-sm font-medium">{acreageDisplay}</span>
              </div>
              <p className="text-base font-semibold">{displayName}</p>
            </div>

            {/* Larger LCS badge */}
            <div className="flex flex-col items-center ml-4">
              <div
                className={`w-14 h-14 rounded-full flex items-center justify-center text-white text-lg font-bold ${lcsColor(scores.landCreditGrade)}`}
              >
                {scores.landCredit}
              </div>
              <span className="text-xs text-muted-foreground mt-1">
                {scores.landCreditGrade}
              </span>
            </div>
          </div>

          {/* Why this is #1 */}
          <div className="rounded-md bg-primary/5 border border-primary/10 p-3">
            <p className="text-xs font-medium text-primary mb-1">Why this is #1 for you</p>
            <p className="text-sm text-foreground">{matchReason}</p>
          </div>

          {/* Composite bar + signals */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="flex-1 h-2.5 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary rounded-full transition-all"
                  style={{ width: `${scores.composite}%` }}
                />
              </div>
              <span className="text-sm font-medium tabular-nums w-8 text-right">
                {scores.composite}
              </span>
            </div>

            <div className="flex flex-wrap gap-1">
              {signals.motivation.map((s) => (
                <Badge
                  key={s}
                  variant="secondary"
                  className={`text-xs ${motivationColors[s] || "bg-muted"}`}
                >
                  {s}
                </Badge>
              ))}
              {signals.environmental.slice(0, 3).map((s) => (
                <Badge key={s} variant="secondary" className="text-xs bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
                  {s}
                </Badge>
              ))}
              {legal?.multipleOwners && (
                <Badge variant="secondary" className="text-xs bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                  Multi-owner{legal.ownerCount ? ` (${legal.ownerCount})` : ""}
                </Badge>
              )}
              {legal?.taxDelinquent && legal?.redemptionMonths != null && (
                <Badge variant="secondary" className="text-xs bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300">
                  Tax lien — {legal.redemptionMonths} mo redemption
                </Badge>
              )}
            </div>

            {enrichmentLine && (
              <p className="text-sm text-muted-foreground">{enrichmentLine}</p>
            )}
          </div>

          {/* Financials — more prominent */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <p className="text-xs text-muted-foreground">Estimated Value</p>
              <p className="text-sm font-semibold">{formatCurrency(financials.estimatedValue)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Aggressive Offer</p>
              <p className="text-sm font-semibold">{formatCurrency(financials.suggestedOffer.aggressive)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Market Offer</p>
              <p className="text-sm font-semibold">{formatCurrency(financials.suggestedOffer.market)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Cash Flip Profit</p>
              <p className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">
                {formatCurrency(financials.cashFlipProfit.market)}
              </p>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 pt-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onAction(opportunity.id, "pass")}
              aria-label="Pass on this opportunity"
            >
              <X className="w-3 h-3 mr-1" /> Pass
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => onAction(opportunity.id, "interested")}
              aria-label="Save this opportunity"
            >
              <Bookmark className="w-3 h-3 mr-1" /> Save
            </Button>
            <Button
              size="sm"
              onClick={() => onAction(opportunity.id, "offer_sent")}
              aria-label="Send offer for this opportunity"
            >
              <Send className="w-3 h-3 mr-1" /> Send Offer
            </Button>
          </div>

          {/* AI Reasoning — why this deal was ranked #1 */}
          <AIReasoning
            feature="recommendation"
            decision={`Ranked #1 with composite score ${scores.composite}`}
            reasoning={matchReason}
            confidence={Math.min(95, Math.round(scores.composite * 1.2))}
            inputs={{
              landCredit: scores.landCredit,
              radarScore: scores.radarScore,
              ownerMotivation: scores.ownerMotivation,
              countyOpportunity: scores.countyOpportunity,
              estimatedValue: financials.estimatedValue,
            }}
          />
        </CardContent>
      </Card>
    </motion.div>
  );
}

function DealCard({
  opportunity,
  onAction,
}: {
  opportunity: DealOpportunity;
  onAction: (id: string, action: string) => void;
}) {
  const { parcel, scores, signals, financials, enrichment, matchReason, legal } = opportunity;
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
              {legal?.multipleOwners && (
                <Badge variant="secondary" className="text-[10px] bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                  Multi-owner{legal.ownerCount ? ` (${legal.ownerCount})` : ""}
                </Badge>
              )}
              {legal?.taxDelinquent && legal?.redemptionMonths != null && (
                <Badge variant="secondary" className="text-[10px] bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300">
                  Tax lien — {legal.redemptionMonths} mo redemption
                </Badge>
              )}
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

            {/* AI Reasoning — collapsed by default */}
            <AIReasoning
              feature="recommendation"
              decision={`Composite score: ${scores.composite}`}
              reasoning={matchReason}
              confidence={Math.min(95, Math.round(scores.composite * 1.2))}
              inputs={{
                landCredit: scores.landCredit,
                radarScore: scores.radarScore,
                ownerMotivation: scores.ownerMotivation,
              }}
              className="mt-1"
            />
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

export function DailyDealFeed({ compact = false }: { compact?: boolean }) {
  const queryClient = useQueryClient();
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [showAll, setShowAll] = useState(false);
  const [passPromptShown, setPassPromptShown] = useState(false);
  const [showPassDialog, setShowPassDialog] = useState(false);
  const [passDialogBucket, setPassDialogBucket] = useState("");
  const passCountRef = useRef<Record<string, number>>({});
  const passPromptFiredRef = useRef(false);

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

  const preferenceMutation = useMutation({
    mutationFn: async (preference: { focusSmaller: boolean; bucket: string }) => {
      return apiRequest("POST", "/api/deal-feed/preference", preference);
    },
  });

  const refreshMutation = useMutation({
    mutationFn: async () => apiRequest("POST", "/api/deal-feed/refresh"),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/deal-feed"] }),
  });

  const handleAction = useCallback(
    (id: string, action: string) => {
      // Track passes for the acreage prompt
      if (action === "pass" && data?.opportunities) {
        const opp = data.opportunities.find((o) => o.id === id);
        if (opp && opp.parcel.acreage > 0) {
          const bucket = acreageBucket(opp.parcel.acreage);
          passCountRef.current[bucket] = (passCountRef.current[bucket] || 0) + 1;

          if (passCountRef.current[bucket] >= 3 && !passPromptFiredRef.current) {
            passPromptFiredRef.current = true;
            setPassDialogBucket(bucket);
            setShowPassDialog(true);
          }
        }
      }
      actionMutation.mutate({ id, action });
    },
    [actionMutation, data?.opportunities],
  );

  const handleFocusSmaller = () => {
    preferenceMutation.mutate({ focusSmaller: true, bucket: passDialogBucket });
    setShowPassDialog(false);
    setPassPromptShown(true);
  };

  const handleKeepAll = () => {
    setShowPassDialog(false);
    setPassPromptShown(true);
  };

  // Loading state: hero skeleton + 2 card skeletons
  if (isLoading) {
    return (
      <div className="space-y-4">
        <Card className="floating-window">
          <CardContent className="p-6 space-y-4">
            <div className="flex justify-between">
              <div className="space-y-2 flex-1">
                <Skeleton className="h-5 w-48" />
                <Skeleton className="h-4 w-64" />
              </div>
              <Skeleton className="h-14 w-14 rounded-full" />
            </div>
            <Skeleton className="h-12 w-full rounded-md" />
            <Skeleton className="h-2.5 w-full" />
            <div className="grid grid-cols-4 gap-3">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          </CardContent>
        </Card>
        <div className={`grid grid-cols-1 ${compact ? "" : "md:grid-cols-2"} gap-4`}>
          {[1, 2].map((i) => (
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

  // In compact mode, keep old behavior
  if (compact) {
    const displayOpportunities = opportunities.slice(0, 3);
    return (
      <div className="space-y-4">
        <AnimatePresence mode="popLayout">
          <motion.div
            variants={staggerContainer}
            initial="hidden"
            animate="visible"
            className="grid grid-cols-1 gap-4"
          >
            {displayOpportunities.map((opp) => (
              <DealCard key={opp.id} opportunity={opp} onAction={handleAction} />
            ))}
          </motion.div>
        </AnimatePresence>

        {opportunities.length > 3 && (
          <Link href="/deal-feed">
            <Button variant="ghost" size="sm" className="w-full text-xs">
              View All {opportunities.length} <ArrowRight className="w-3 h-3 ml-1" />
            </Button>
          </Link>
        )}
      </div>
    );
  }

  // Full feed: hero (#1) + standard (#2, #3) + collapsed rest
  const heroOpportunity = opportunities[0];
  const standardOpportunities = opportunities.slice(1, 3);
  const restOpportunities = opportunities.slice(3);
  const restCount = restOpportunities.length;

  // Determine the acreage threshold text for the pass dialog
  const bucketLabel =
    passDialogBucket === "8+"
      ? "over 8 acres"
      : passDialogBucket === "5-8"
        ? "between 5 and 8 acres"
        : passDialogBucket === "2-5"
          ? "between 2 and 5 acres"
          : "under 2 acres";

  return (
    <div className="space-y-4">
      {/* Pass-tracking dialog */}
      <AlertDialog open={showPassDialog} onOpenChange={setShowPassDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Refine your feed?</AlertDialogTitle>
            <AlertDialogDescription>
              You've passed on 3 parcels {bucketLabel} today. Focus the feed on smaller parcels?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleKeepAll}>
              No, keep showing all
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleFocusSmaller}>
              Yes, focus smaller
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AnimatePresence mode="popLayout">
        <motion.div
          variants={staggerContainer}
          initial="hidden"
          animate="visible"
          className="space-y-4"
        >
          {/* #1: Hero card — full width */}
          {heroOpportunity && (
            <HeroDealCard
              opportunity={heroOpportunity}
              onAction={handleAction}
            />
          )}

          {/* #2 and #3: Standard cards in a grid */}
          {standardOpportunities.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {standardOpportunities.map((opp) => (
                <DealCard key={opp.id} opportunity={opp} onAction={handleAction} />
              ))}
            </div>
          )}

          {/* #4+: Collapsed behind toggle */}
          {restCount > 0 && (
            <>
              {!showAll && (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full text-xs"
                  onClick={() => setShowAll(true)}
                >
                  <ChevronDown className="w-3 h-3 mr-1" />
                  {restCount} more {restCount === 1 ? "opportunity" : "opportunities"} — Show All
                </Button>
              )}

              {showAll && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {restOpportunities.map((opp) => (
                    <DealCard key={opp.id} opportunity={opp} onAction={handleAction} />
                  ))}
                </div>
              )}
            </>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
