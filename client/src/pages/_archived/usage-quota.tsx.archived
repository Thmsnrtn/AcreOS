import { useQuery } from "@tanstack/react-query";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { usd } from "@/lib/format";
import { Zap, MessageSquare, Search, Mail, Phone, Image, AlertTriangle, Loader2 } from "lucide-react";

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
    <div
      className="space-y-1.5"
      role={isOverLimit && !item.overageAllowed ? "alert" : undefined}
    >
      <div className="flex items-center justify-between text-xs">
        <div className="flex items-center gap-1.5">
          <Icon className="w-3.5 h-3.5 text-muted-foreground" aria-hidden="true" />
          <span className="font-medium">{item.label}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className={`tabular-nums ${isOverLimit ? "text-acr-neg font-medium" : "text-muted-foreground"}`}>
            {item.used.toLocaleString()} / {item.limit.toLocaleString()}
          </span>
          {isOverLimit && !item.overageAllowed && (
            <Badge variant="destructive" className="text-xs py-0">Limit reached</Badge>
          )}
          {isNearLimit && !isOverLimit && (
            <Badge variant="outline" className="text-xs py-0 border-acr-warn text-acr-warn">Near limit</Badge>
          )}
        </div>
      </div>
      <Progress
        value={pct}
        className={`h-1.5 ${isOverLimit ? "[&>div]:bg-acr-neg" : isNearLimit ? "[&>div]:bg-acr-warn" : ""}`}
        aria-label={`${item.label}: ${item.used.toLocaleString()} of ${item.limit.toLocaleString()} used (${pct}%)`}
      />
    </div>
  );
}

export default function UsageQuotaPage() {
  useDocumentTitle("Usage & quotas");

  const { data, isLoading } = useQuery<UsageData>({
    queryKey: ["/api/usage/quotas"],
    queryFn: () => fetch("/api/usage/quotas").then(r => r.json()),
    refetchInterval: 30_000,
  });

  if (isLoading) {
    return (
      <PageShell>
        <div className="flex items-center gap-2 text-muted-foreground" role="status" aria-live="polite">
          <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> Loading usage data…
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
          Usage &amp; quotas
        </h1>
        <p className="text-muted-foreground text-sm md:text-base">
          Monitor feature usage and AI costs against your plan limits.
        </p>
      </div>

      {data && (
        <>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Card>
              <CardContent className="p-4">
                <dt className="text-xs text-muted-foreground mb-1">Current plan</dt>
                <dd className="text-lg font-bold capitalize">{data.planName}</dd>
                <p className="text-xs text-muted-foreground mt-1 tabular-nums">
                  Resets {new Date(data.billingPeriodEnd).toLocaleDateString()}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <dt className="flex items-center gap-2 mb-2">
                  <Zap className="w-4 h-4 text-acr-warn" aria-hidden="true" />
                  <span className="text-xs text-muted-foreground">AI spend</span>
                  {nearAiLimit && <AlertTriangle className="w-3.5 h-3.5 text-acr-warn" aria-label="near limit" />}
                </dt>
                <dd className="text-lg font-bold tabular-nums">
                  {usd(data.totalAiCostCents / 100)} / {usd(data.aiCostLimitCents / 100)}
                </dd>
                <Progress
                  value={aiCostPct}
                  className={`h-1.5 mt-2 ${nearAiLimit ? "[&>div]:bg-acr-warn" : ""}`}
                  aria-label={`AI spend: ${aiCostPct}% of monthly limit`}
                />
              </CardContent>
            </Card>
          </dl>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Feature quotas</CardTitle>
              <CardDescription>Usage resets at end of billing period.</CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="space-y-4" aria-label="Feature usage quotas">
                {data.quotas.map(q => (
                  <li key={q.feature}>
                    <QuotaBar item={q} />
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </>
      )}
    </PageShell>
  );
}
