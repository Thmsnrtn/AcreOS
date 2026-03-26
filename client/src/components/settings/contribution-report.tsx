import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

interface ContributionData {
  anonymizedDeals: number;
  countiesHelped: number;
  communityImpact: string;
}

/**
 * ContributionReport — small settings widget showing data contribution stats.
 * Fetches from /api/data/contribution-report.
 */
export function ContributionReport() {
  const { data, isLoading, isError } = useQuery<ContributionData>({
    queryKey: ["contribution-report"],
    queryFn: async () => {
      const res = await fetch("/api/data/contribution-report", {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to load contribution report");
      return res.json();
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Your Data Contributions</CardTitle>
        <CardDescription>
          How your anonymized data helps the AcreOS community.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading && (
          <div className="space-y-2">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-4 w-48" />
          </div>
        )}

        {isError && (
          <p className="text-sm text-muted-foreground">
            Unable to load contribution data.
          </p>
        )}

        {data && !isLoading && (
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Anonymized deals contributed</span>
              <span className="font-medium">{data.anonymizedDeals ?? 0}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Counties helped</span>
              <span className="font-medium">{data.countiesHelped ?? 0}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Community impact</span>
              <span className="font-medium">{data.communityImpact ?? "N/A"}</span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
