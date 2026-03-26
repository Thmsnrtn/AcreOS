/**
 * County Intelligence Card — displays network-derived intelligence for a county.
 * Shows transaction data, community reviews, and LCS benchmarks when cohort >= 5.
 */

import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { staggerContainer, staggerItem } from "@/lib/animations";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { MapPin, BarChart3, Users, Star, Lock } from "lucide-react";

interface CountyIntelligenceData {
  state: string;
  county: string;
  networkData: {
    dealCount: number;
    medianPricePerAcre: number;
    avgDaysToClose: number;
    topStrategy: string;
  } | null;
  reviews: Array<{
    rating: number;
    pros: string;
    cons: string;
    investorTrustScore: number;
  }>;
  avgRating: number | null;
  reviewCount: number;
  hasSufficientData: boolean;
}

interface CountyIntelligenceCardProps {
  state: string;
  county: string;
  compact?: boolean;
}

export function CountyIntelligenceCard({ state, county, compact = false }: CountyIntelligenceCardProps) {
  const { data, isLoading } = useQuery<CountyIntelligenceData>({
    queryKey: [`/api/county-intelligence/${state}/${county}`],
    enabled: !!state && !!county,
    staleTime: 10 * 60 * 1000,
  });

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-4 space-y-2">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-3 w-48" />
          <Skeleton className="h-3 w-40" />
        </CardContent>
      </Card>
    );
  }

  if (!data) return null;

  return (
    <motion.div variants={staggerContainer} initial="hidden" animate="visible">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <MapPin className="w-4 h-4" />
            {county} County, {state}
            {data.avgRating && (
              <Badge variant="outline" className="text-xs ml-auto">
                <Star className="w-3 h-3 mr-1 text-amber-500 fill-amber-500" />
                {data.avgRating} ({data.reviewCount} reviews)
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Network intelligence — only when sufficient data */}
          {data.hasSufficientData && data.networkData ? (
            <motion.div variants={staggerItem} className="space-y-2">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <BarChart3 className="w-3 h-3" />
                <span>Based on {data.networkData.dealCount} AcreOS transactions</span>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <p className="text-[10px] text-muted-foreground">Median $/acre</p>
                  <p className="text-sm font-semibold">
                    ${data.networkData.medianPricePerAcre?.toLocaleString() || "—"}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground">Avg days to close</p>
                  <p className="text-sm font-semibold">
                    {data.networkData.avgDaysToClose || "—"}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground">Top strategy</p>
                  <p className="text-sm font-semibold capitalize">
                    {data.networkData.topStrategy?.replace(/_/g, " ") || "—"}
                  </p>
                </div>
              </div>
            </motion.div>
          ) : (
            <motion.div variants={staggerItem} className="flex items-center gap-2 text-xs text-muted-foreground">
              <Lock className="w-3 h-3" />
              <span>Network intelligence unlocks with 5+ transactions in this county</span>
            </motion.div>
          )}

          {/* Community reviews — top pro/con */}
          {!compact && data.reviews.length > 0 && (
            <motion.div variants={staggerItem} className="space-y-1.5 border-t pt-2">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Users className="w-3 h-3" />
                <span>Investor reviews</span>
              </div>
              {data.reviews.slice(0, 2).map((r, i) => (
                <div key={i} className="text-xs space-y-0.5">
                  <p className="text-emerald-600 dark:text-emerald-400">+ {r.pros}</p>
                  <p className="text-red-600 dark:text-red-400">- {r.cons}</p>
                </div>
              ))}
            </motion.div>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}
