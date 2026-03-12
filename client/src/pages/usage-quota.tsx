import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Zap, MessageSquare, Search, Mail, Phone, Image, AlertTriangle, RefreshCw, Loader2 } from "lucide-react";

interface QuotaItem {
  feature: string;
  label: string;
  used: number;
  limit: number;
  resetDate: string;
  icon: string;
  overageAllowed: boolean;
}

interface UsageData {
  planName: string;
  billingPeriodEnd: string;
  quotas: QuotaItem[];
  totalAiCostCents: number;
  aiCostLimitCents: number;
}

const ICON_MAP: Record<string, React.ElementType> = {
  ai: Zap,
  messages: MessageSquare,
  searches: Search,
  emails: Mail,
  calls: Phone,
  images: Image,
};

function QuotaBar({ item }: { item: QuotaItem }) {
  const pct = Math.min(100, Math.round((item.used / item.limit) * 100));
  const isNearLimit = pct >= 80;
  const isOverLimit = item.used >= item.limit;
  const Icon = ICON_MAP[item.icon] ?? Zap;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs">
        <div className="flex items-center gap-1.5">
          <Icon className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="font-medium">{item.label}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className={isOverLimit ? "text-red-600 font-medium" : "text-muted-foreground"}>
            {item.used.toLocaleString()} / {item.limit.toLocaleString()}
          </span>
          {isOverLimit && !item.overageAllowed && (
            <Badge variant="destructive" className="text-xs py-0">Limit reached</Badge>
          )}
          {isNearLimit && !isOverLimit && (
            <Badge variant="outline" className="text-xs py-0 border-yellow-400 text-yellow-600">Near limit</Badge>
          )}
        </div>
      </div>
      <Progress
        value={pct}
        className={`h-1.5 ${isOverLimit ? "[&>div]:bg-red-500" : isNearLimit ? "[&>div]:bg-yellow-500" : ""}`}
      />
    </div>
  );
}

export default function UsageQuotaPage() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery<UsageData>({
    queryKey: ["/api/usage/quotas"],
    queryFn: () => fetch("/api/usage/quotas").then(r => r.json()),
    refetchInterval: 30_000,
  });

  const resetMutation = useMutation({
    mutationFn: (feature: string) => apiRequest("POST", `/api/usage/reset/${feature}`),
    onSuccess: () => {
      toast({ title: "Usage counter reset" });
      qc.invalidateQueries({ queryKey: ["/api/usage/quotas"] });
    },
    onError: () => toast({ title: "Reset failed", variant: "destructive" }),
  });

  if (isLoading) {
    return (
      <PageShell>
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading usage data...
        </div>
      </PageShell>
    );
  }

  const aiCostPct = data ? Math.min(100, Math.round((data.totalAiCostCents / data.aiCostLimitCents) * 100)) : 0;
  const nearAiLimit = aiCostPct >= 80;

  return (
    <PageShell>
      <div>
        <h1 className="text-2xl md:text-3xl font-bold" data-testid="text-usage-quota-title">
          Usage & Quotas
        </h1>
        <p className="text-muted-foreground text-sm md:text-base">
          Monitor feature usage and AI costs against your plan limits.
        </p>
      </div>

      {data && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground mb-1">Current Plan</p>
                <p className="text-lg font-bold capitalize">{data.planName}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Resets {new Date(data.billingPeriodEnd).toLocaleDateString()}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Zap className="w-4 h-4 text-yellow-500" />
                  <p className="text-xs text-muted-foreground">AI Spend</p>
                  {nearAiLimit && <AlertTriangle className="w-3.5 h-3.5 text-yellow-500" />}
                </div>
                <p className="text-lg font-bold">
                  ${(data.totalAiCostCents / 100).toFixed(2)} / ${(data.aiCostLimitCents / 100).toFixed(2)}
                </p>
                <Progress value={aiCostPct} className={`h-1.5 mt-2 ${nearAiLimit ? "[&>div]:bg-yellow-500" : ""}`} />
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Feature Quotas</CardTitle>
              <CardDescription>Usage resets at end of billing period.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {data.quotas.map(q => (
                <QuotaBar key={q.feature} item={q} />
              ))}
            </CardContent>
          </Card>
        </>
      )}
    </PageShell>
  );
}
