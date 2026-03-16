import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, ArrowUp, ArrowDown, Sparkles, Users } from "lucide-react";

interface GrowthData {
  tierDistribution: Array<{ tier: string; count: number; percentage: number }>;
  expansionSignals: {
    upgrades30d: number;
    downgrades30d: number;
    netExpansion: number;
    freeToPayConversions30d: number;
    freeToPayConversionRate: string;
  };
  growthOpportunities: string[];
}

const TIER_STYLES: Record<string, { bar: string; label: string }> = {
  free:         { bar: "bg-slate-400",   label: "Free" },
  sprout:       { bar: "bg-emerald-400", label: "Sprout" },
  starter:      { bar: "bg-blue-400",    label: "Starter" },
  professional: { bar: "bg-purple-500",  label: "Pro" },
  scale:        { bar: "bg-orange-500",  label: "Scale" },
  enterprise:   { bar: "bg-amber-500",   label: "Enterprise" },
};

export function GrowthEngine() {
  const { data, isLoading } = useQuery<GrowthData>({
    queryKey: ["/api/founder/intelligence/growth"],
    staleTime: 300_000,
  });

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-green-500" />
            Growth Engine
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3 animate-pulse">
            {[0, 1, 2, 3, 4].map(i => (
              <div key={i} className="h-7 bg-muted rounded" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!data) return null;

  const { tierDistribution, expansionSignals, growthOpportunities } = data;
  const netPos = expansionSignals.netExpansion >= 0;
  const convRate = parseFloat(expansionSignals.freeToPayConversionRate);

  // Revenue-generating tiers (non-free)
  const payingTiers = tierDistribution.filter(t => t.tier !== "free");
  const freeTier = tierDistribution.find(t => t.tier === "free");

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-green-500" />
            Growth Engine
          </CardTitle>
          <Badge
            variant="outline"
            className={`text-xs ${netPos
              ? "bg-green-500/10 text-green-600 border-green-500/20"
              : "bg-red-500/10 text-red-600 border-red-500/20"
            }`}
          >
            {netPos
              ? <ArrowUp className="h-3 w-3 mr-1" />
              : <ArrowDown className="h-3 w-3 mr-1" />
            }
            {netPos ? "+" : ""}{expansionSignals.netExpansion} net 30d
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Tier distribution bars */}
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground flex items-center gap-1">
            <Users className="h-3 w-3" />
            Customer distribution
          </p>
          {tierDistribution.map(({ tier, count, percentage }) => {
            const style = TIER_STYLES[tier] ?? { bar: "bg-blue-400", label: tier };
            return (
              <div key={tier} className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground w-16 shrink-0 capitalize">{style.label}</span>
                <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${style.bar}`}
                    style={{ width: `${Math.max(2, percentage)}%` }}
                  />
                </div>
                <span className="text-xs font-semibold w-6 text-right">{count}</span>
                <span className="text-[10px] text-muted-foreground w-7 text-right">{percentage}%</span>
              </div>
            );
          })}
        </div>

        {/* Conversion funnel */}
        <div className="border-t pt-3">
          <p className="text-xs font-medium text-muted-foreground mb-2">Free → Paid conversion (30d)</p>
          <div className="flex items-stretch gap-2">
            {/* Free pool */}
            <div className="flex-1 rounded-lg bg-muted/50 border px-2 py-2 text-center">
              <p className="text-lg font-bold">{freeTier?.count ?? "—"}</p>
              <p className="text-[10px] text-muted-foreground">free accounts</p>
            </div>
            <div className="flex items-center text-muted-foreground text-xs">→</div>
            {/* Conversions */}
            <div className="flex-1 rounded-lg bg-green-500/5 border border-green-500/20 px-2 py-2 text-center">
              <p className="text-lg font-bold text-green-600">{expansionSignals.freeToPayConversions30d}</p>
              <p className="text-[10px] text-muted-foreground">converted</p>
            </div>
            <div className="flex items-center text-muted-foreground text-xs">=</div>
            {/* Conversion rate */}
            <div className={`flex-1 rounded-lg border px-2 py-2 text-center ${convRate >= 5 ? "bg-green-500/5 border-green-500/20" : convRate >= 2 ? "bg-amber-500/5 border-amber-500/20" : "bg-muted/50"}`}>
              <p className={`text-lg font-bold ${convRate >= 5 ? "text-green-600" : convRate >= 2 ? "text-amber-600" : "text-foreground"}`}>
                {convRate.toFixed(1)}%
              </p>
              <p className="text-[10px] text-muted-foreground">conv. rate</p>
            </div>
          </div>
        </div>

        {/* Expansion signals */}
        <div className="grid grid-cols-2 gap-2 border-t pt-3">
          <div className="rounded-lg bg-green-500/5 border border-green-500/10 px-3 py-2 text-center">
            <p className="text-xl font-bold text-green-600">{expansionSignals.upgrades30d}</p>
            <p className="text-[10px] text-muted-foreground">upgrades</p>
          </div>
          <div className="rounded-lg bg-red-500/5 border border-red-500/10 px-3 py-2 text-center">
            <p className="text-xl font-bold text-red-500">{expansionSignals.downgrades30d}</p>
            <p className="text-[10px] text-muted-foreground">downgrades</p>
          </div>
        </div>

        {/* AI opportunities */}
        {growthOpportunities.length > 0 && (
          <div className="space-y-1.5 border-t pt-2">
            <p className="text-xs font-medium text-muted-foreground flex items-center gap-1">
              <Sparkles className="h-3 w-3 text-amber-500" />
              Growth opportunities
            </p>
            {growthOpportunities.slice(0, 3).map((opp, i) => (
              <p key={i} className="text-xs text-muted-foreground flex items-start gap-1.5">
                <span className="text-emerald-500 shrink-0 mt-0.5">→</span>
                <span>{opp}</span>
              </p>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
