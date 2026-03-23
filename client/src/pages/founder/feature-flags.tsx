import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Flag } from "lucide-react";

interface FeatureFlag {
  key: string;
  enabled: boolean;
  description?: string;
}

export default function FeatureFlagsPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: flags, isLoading } = useQuery<FeatureFlag[]>({
    queryKey: ["/api/admin/feature-flags"],
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ key, enabled }: { key: string; enabled: boolean }) => {
      const res = await apiRequest("PATCH", `/api/admin/feature-flags/${key}`, { enabled });
      return res.json();
    },
    onSuccess: (_data, { key, enabled }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/feature-flags"] });
      toast({
        title: "Flag updated",
        description: `${key} is now ${enabled ? "enabled" : "disabled"}.`,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Failed to update flag",
        description: error.message || "Something went wrong.",
        variant: "destructive",
      });
    },
  });

  return (
    <PageShell>
      <div>
        <h1 className="text-3xl font-bold">Feature Flags</h1>
        <p className="text-muted-foreground">Manage feature flags across the platform.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Flag className="w-5 h-5" />
            All Flags
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-4">
              {[1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : !flags || flags.length === 0 ? (
            <p className="text-muted-foreground text-sm">No feature flags configured.</p>
          ) : (
            <div className="space-y-3">
              {flags.map((flag) => (
                <div
                  key={flag.key}
                  className="flex items-center justify-between p-3 rounded-lg border"
                >
                  <div className="flex items-center gap-3">
                    <Badge variant={flag.enabled ? "default" : "secondary"} className="text-xs">
                      {flag.enabled ? "ON" : "OFF"}
                    </Badge>
                    <div>
                      <p className="text-sm font-medium font-mono">{flag.key}</p>
                      {flag.description && (
                        <p className="text-xs text-muted-foreground">{flag.description}</p>
                      )}
                    </div>
                  </div>
                  <Switch
                    checked={flag.enabled}
                    onCheckedChange={(enabled) =>
                      toggleMutation.mutate({ key: flag.key, enabled })
                    }
                    disabled={toggleMutation.isPending}
                  />
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </PageShell>
  );
}
