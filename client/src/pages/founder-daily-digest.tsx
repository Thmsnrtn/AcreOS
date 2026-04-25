import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Mail, TrendingUp, DollarSign, Server, AlertTriangle } from "lucide-react";
import { InfoTooltip } from "@/components/info-tooltip";
import { useDocumentTitle } from "@/hooks/use-document-title";

interface DigestSections {
  growth?: { newSignups?: number; activeUsers?: number };
  revenue?: { mrrFormatted?: string; payingCustomers?: number | string };
  customers?: { emailsSent?: number; emailsQueued?: number };
  operations?: { dataSources?: string; services?: string };
  needsAttention?: Array<{ action: string; reason: string }>;
}

interface LatestDigest {
  content?: { sections?: DigestSections };
}

export default function FounderDailyDigestPage() {
  useDocumentTitle("Daily digest");

  const { isLoading } = useQuery<unknown[]>({
    queryKey: ["/api/admin/digests"],
  });

  const { data: latest } = useQuery<LatestDigest>({
    queryKey: ["/api/admin/digests/latest"],
  });

  if (isLoading) return (
    <div className="p-8" role="status" aria-live="polite">
      <span className="sr-only">Loading daily digest…</span>
      <Skeleton className="h-96 w-full" />
    </div>
  );

  const digest = latest?.content?.sections;

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold">Daily digest</h1>
      {!digest ? (
        <p className="text-muted-foreground">No digest available yet. The digest agent generates one daily around 8am.</p>
      ) : (
        <ul className="grid gap-4" aria-label="Daily digest sections">
          <li>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <TrendingUp className="h-4 w-4" aria-hidden="true" /> Growth
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-1 text-sm">
                  <li><span className="tabular-nums">{digest.growth?.newSignups ?? 0}</span> new signups (yesterday)</li>
                  <li><span className="tabular-nums">{digest.growth?.activeUsers ?? 0}</span> active users (this week)</li>
                </ul>
              </CardContent>
            </Card>
          </li>

          <li>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <DollarSign className="h-4 w-4" aria-hidden="true" /> Revenue
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-1 text-sm">
                  <li>
                    <InfoTooltip term="Monthly Revenue" explanation="The total recurring revenue from all paying customers this month">MRR</InfoTooltip>
                    : <span className="tabular-nums">{digest.revenue?.mrrFormatted ?? "N/A"}</span>
                  </li>
                  <li>Paying customers: <span className="tabular-nums">{digest.revenue?.payingCustomers ?? "N/A"}</span></li>
                </ul>
              </CardContent>
            </Card>
          </li>

          <li>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Mail className="h-4 w-4" aria-hidden="true" /> Customers
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-1 text-sm">
                  <li><span className="tabular-nums">{digest.customers?.emailsSent ?? 0}</span> emails auto-sent (today)</li>
                  <li><span className="tabular-nums">{digest.customers?.emailsQueued ?? 0}</span> emails queued for approval (today)</li>
                </ul>
              </CardContent>
            </Card>
          </li>

          <li>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Server className="h-4 w-4" aria-hidden="true" /> Operations
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-1 text-sm">
                  <li>Data sources: <span className="tabular-nums">{digest.operations?.dataSources ?? "N/A"}</span></li>
                  <li>Services: <span className="tabular-nums">{digest.operations?.services ?? "N/A"}</span></li>
                </ul>
              </CardContent>
            </Card>
          </li>

          {digest.needsAttention && digest.needsAttention.length > 0 && (
            <li>
              <Card className="border-yellow-500">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-yellow-500" aria-hidden="true" />
                    Needs your attention (<span className="tabular-nums">{digest.needsAttention.length}</span>)
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2" aria-label="Items that need your attention">
                    {digest.needsAttention.map((item, i) => (
                      <li key={i} className="text-sm border rounded p-2">
                        <Badge variant="outline" className="mr-2">{item.action}</Badge>
                        {item.reason}
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
