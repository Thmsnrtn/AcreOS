import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Shield, Eye, EyeOff, BarChart3 } from "lucide-react";

interface ContributionStats {
  totalContributions: number;
  lastContributionAt: string | null;
  networkSize: number;
}

interface DataNetworkSettings {
  enabled: boolean;
}

export function DataNetworkSettings() {
  const { toast } = useToast();

  const settingsQuery = useQuery<DataNetworkSettings>({
    queryKey: ["/api/settings/data-network"],
  });

  const statsQuery = useQuery<ContributionStats>({
    queryKey: ["/api/data-network/contributions"],
  });

  const [optimisticEnabled, setOptimisticEnabled] = useState<boolean | null>(null);

  const toggleMutation = useMutation({
    mutationFn: async (enabled: boolean) => {
      const res = await apiRequest("POST", "/api/settings/data-network", { enabled });
      if (!res.ok) {
        throw new Error("Failed to update data network setting");
      }
      return res.json();
    },
    onMutate: (enabled) => {
      setOptimisticEnabled(enabled);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings/data-network"] });
      toast({
        title: "Setting updated",
        description: "Your data network preference has been saved.",
      });
    },
    onError: () => {
      setOptimisticEnabled(null);
      toast({
        title: "Error",
        description: "Failed to update your data network preference. Please try again.",
        variant: "destructive",
      });
    },
    onSettled: () => {
      setOptimisticEnabled(null);
    },
  });

  const isEnabled = optimisticEnabled ?? settingsQuery.data?.enabled ?? true;
  const stats = statsQuery.data;

  if (settingsQuery.isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-full mt-2" />
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Shield className="h-5 w-5 text-muted-foreground" />
          Data Network
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Your anonymized deal data helps improve market intelligence for all AcreOS investors.
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* What's shared vs what's never shared */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Eye className="h-4 w-4 text-muted-foreground" />
              Shared (anonymized)
            </div>
            <ul className="text-sm text-muted-foreground space-y-1 pl-6 list-disc">
              <li>County-level pricing trends</li>
              <li>Acreage and land-type distributions</li>
              <li>Days-on-market aggregates</li>
              <li>General deal outcome categories</li>
            </ul>
          </div>
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              <EyeOff className="h-4 w-4 text-muted-foreground" />
              Never shared
            </div>
            <ul className="text-sm text-muted-foreground space-y-1 pl-6 list-disc">
              <li>Your name, email, or account details</li>
              <li>Specific property addresses or APNs</li>
              <li>Buyer or seller contact information</li>
              <li>Financial details or profit margins</li>
            </ul>
          </div>
        </div>

        {/* Toggle */}
        <div className="flex items-center justify-between rounded-lg border p-4">
          <div className="space-y-0.5">
            <label
              htmlFor="data-network-toggle"
              className="text-sm font-medium cursor-pointer"
            >
              Contribute to AcreOS Market Intelligence
            </label>
            <p className="text-xs text-muted-foreground">
              {isEnabled ? "Your anonymized data is contributing to the network" : "Contribution is paused"}
            </p>
          </div>
          <Switch
            id="data-network-toggle"
            checked={isEnabled}
            onCheckedChange={(checked) => toggleMutation.mutate(checked)}
            disabled={toggleMutation.isPending}
            aria-label="Toggle data network contribution"
          />
        </div>

        {/* Contribution stats */}
        {stats && (
          <div className="flex items-center gap-4 rounded-lg bg-muted/50 p-4">
            <BarChart3 className="h-5 w-5 text-muted-foreground flex-shrink-0" />
            <div className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">{stats.totalContributions.toLocaleString()}</span>
              {" "}data points contributed
              {stats.networkSize > 0 && (
                <span>
                  {" "}across a network of{" "}
                  <span className="font-medium text-foreground">{stats.networkSize.toLocaleString()}</span>
                  {" "}investors
                </span>
              )}
              {stats.lastContributionAt && (
                <span className="block mt-1">
                  Last contribution: {new Date(stats.lastContributionAt).toLocaleDateString()}
                </span>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
