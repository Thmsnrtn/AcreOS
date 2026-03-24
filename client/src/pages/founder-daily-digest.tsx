import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Mail, TrendingUp, DollarSign, Server, AlertTriangle } from "lucide-react";

export default function FounderDailyDigestPage() {
  const { data: briefs, isLoading } = useQuery<any[]>({
    queryKey: ["/api/admin/digests"],
  });

  // Fetch latest digest
  const { data: latest } = useQuery<any>({
    queryKey: ["/api/admin/digests/latest"],
  });

  if (isLoading) return <div className="p-8"><Skeleton className="h-96 w-full" /></div>;

  const digest = latest?.content?.sections;

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold">Daily Digest</h1>
      {!digest ? (
        <p className="text-muted-foreground">No digest available yet. The digest agent generates one daily around 8am.</p>
      ) : (
        <div className="grid gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="h-4 w-4" /> Growth
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-1 text-sm">
                <li>{digest.growth?.newSignups ?? 0} new signups yesterday</li>
                <li>{digest.growth?.activeUsers ?? 0} active users</li>
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <DollarSign className="h-4 w-4" /> Revenue
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-1 text-sm">
                <li>MRR: {digest.revenue?.mrrFormatted ?? "N/A"}</li>
                <li>Paying customers: {digest.revenue?.payingCustomers ?? "N/A"}</li>
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Mail className="h-4 w-4" /> Customers
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-1 text-sm">
                <li>{digest.customers?.emailsSent ?? 0} emails auto-sent</li>
                <li>{digest.customers?.emailsQueued ?? 0} emails queued for approval</li>
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Server className="h-4 w-4" /> Operations
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-1 text-sm">
                <li>Data sources: {digest.operations?.dataSources ?? "N/A"}</li>
                <li>Services: {digest.operations?.services ?? "N/A"}</li>
              </ul>
            </CardContent>
          </Card>

          {digest.needsAttention?.length > 0 && (
            <Card className="border-yellow-500">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-yellow-500" />
                  Needs Your Attention ({digest.needsAttention.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2">
                  {digest.needsAttention.map((item: any, i: number) => (
                    <li key={i} className="text-sm border rounded p-2">
                      <Badge variant="outline" className="mr-2">{item.action}</Badge>
                      {item.reason}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
