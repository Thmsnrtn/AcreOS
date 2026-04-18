import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import { Network, Database, BarChart3 } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

interface CountyOverview {
  totalCounties: number;
  totalProperties: number;
  totalContributingOrgs: number;
}

interface ContributionMetrics {
  propertiesContributed: number;
  countiesReached: number;
  dealsCompleted: number;
  percentileRank: number;
}

interface LcsBenchmark {
  county: string;
  state: string;
  avgOverallScore: number;
  propertyCount: number;
}

function StatRow({
  icon: Icon,
  label,
  value,
  tooltip,
}: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  tooltip: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="flex items-center justify-between py-2">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Icon className="h-4 w-4" />
            <span>{label}</span>
          </div>
          <span className="text-sm font-semibold">{value}</span>
        </div>
      </TooltipTrigger>
      <TooltipContent>
        <p>{tooltip}</p>
      </TooltipContent>
    </Tooltip>
  );
}

export function DataNetworkCard() {
  const { data: overview, isLoading: overviewLoading } = useQuery<CountyOverview>({
    queryKey: ["/api/data-network/overview"],
    queryFn: () => apiRequest("GET", "/api/data-network/overview").then(r => r.json()),
  });

  const { data: metrics, isLoading: metricsLoading } = useQuery<ContributionMetrics>({
    queryKey: ["/api/data-network/contributions"],
    queryFn: () => apiRequest("GET", "/api/data-network/contributions").then(r => r.json()),
  });

  const { data: benchmarks, isLoading: benchmarksLoading } = useQuery<LcsBenchmark[]>({
    queryKey: ["/api/data-network/lcs-benchmarks"],
    queryFn: () => apiRequest("GET", "/api/data-network/lcs-benchmarks").then(r => r.json()),
  });

  const isLoading = overviewLoading || metricsLoading || benchmarksLoading;

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-40" />
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </CardContent>
      </Card>
    );
  }

  const topBenchmark = benchmarks?.[0];

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-base font-medium">Data Network</CardTitle>
        <Badge variant="secondary" className="text-xs">
          {overview?.totalContributingOrgs ?? 0} orgs
        </Badge>
      </CardHeader>
      <CardContent className="space-y-1">
        <StatRow
          icon={Network}
          label="Counties with data"
          value={overview?.totalCounties ?? 0}
          tooltip="Number of unique counties with property data across the network"
        />
        <StatRow
          icon={Database}
          label="Network properties"
          value={(overview?.totalProperties ?? 0).toLocaleString()}
          tooltip="Total properties contributed by all organizations"
        />
        <StatRow
          icon={Database}
          label="Your contributions"
          value={metrics?.propertiesContributed ?? 0}
          tooltip={`You cover ${metrics?.countiesReached ?? 0} counties with ${metrics?.dealsCompleted ?? 0} completed deals`}
        />
        <StatRow
          icon={BarChart3}
          label="Top county LCS avg"
          value={topBenchmark ? `${topBenchmark.avgOverallScore} (${topBenchmark.county})` : "N/A"}
          tooltip="Highest average Land Credit Score by county across the network"
        />

        {metrics && metrics.percentileRank > 0 && (
          <div className="pt-2 border-t">
            <p className="text-xs text-muted-foreground">
              Your data contribution ranks in the{" "}
              <span className="font-semibold text-foreground">
                {metrics.percentileRank}th
              </span>{" "}
              percentile across the network.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
