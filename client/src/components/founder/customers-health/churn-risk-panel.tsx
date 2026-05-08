/**
 * ChurnRiskPanel — extracted from founder-dashboard.tsx (F-D #4).
 *
 * Pure move; no behavior change. Same /api/admin/churn-risk query key
 * + 5-min refetchInterval + /rescue mutation.
 */

import { useQuery } from "@tanstack/react-query";
import { ShieldAlert, CircleCheck, BrainCircuit } from "lucide-react";

import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export function ChurnRiskPanel() {
  const { toast } = useToast();
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["/api/admin/churn-risk"],
    queryFn: () => apiRequest("GET", "/api/admin/churn-risk?minScore=40").then(r => r.json()),
    refetchInterval: 5 * 60_000,
  });

  const orgs: any[] = data?.orgs ?? [];

  const triggerRescue = async (orgId: number, orgName: string) => {
    try {
      await apiRequest("POST", `/api/admin/churn-risk/${orgId}/rescue`);
      toast({ title: "Rescue triggered", description: `Pax will reach out to ${orgName}` });
      refetch();
    } catch {
      toast({ title: "Couldn't trigger rescue", description: "No outreach was queued. Try again or check the system status.", variant: "destructive" });
    }
  };

  const riskColor = (score: number) =>
    score >= 80 ? "text-acr-neg font-bold" :
    score >= 60 ? "text-acr-warn font-semibold" :
    "text-muted-foreground";

  return (
    <Card className="col-span-full md:col-span-1">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 text-acr-neg" />
          Churn risk radar
        </CardTitle>
        <CardDescription className="text-xs">Paying orgs with elevated churn risk — Pax auto-rescues at 85+</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
        ) : orgs.length === 0 ? (
          <div className="flex flex-col items-center py-6 gap-1">
            <CircleCheck className="w-8 h-8 text-acr-pos" aria-hidden="true" />
            <p className="text-sm text-muted-foreground">No orgs at elevated churn risk</p>
          </div>
        ) : (
          <div className="space-y-2 max-h-72 overflow-y-auto">
            {orgs.map((org: any) => (
              <div key={org.id} className="flex items-center justify-between py-1.5 border-b border-border/40 last:border-0 gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{org.name}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <Badge variant="outline" className="text-xs py-0">{org.subscriptionTier}</Badge>
                    {org.churnRescueSentAt && (
                      <span className="text-xs text-acr-brand flex items-center gap-1">
                        <BrainCircuit className="w-3 h-3" /> Pax intervened
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={`text-lg font-mono ${riskColor(org.churnRiskScore)}`}>
                    {org.churnRiskScore}
                  </span>
                  {!org.churnRescueSentAt && org.churnRiskScore >= 60 && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-6 px-2 text-xs"
                      onClick={() => triggerRescue(org.id, org.name)}
                    >
                      Rescue
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
