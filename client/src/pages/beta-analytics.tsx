import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Users, TrendingUp, Activity, MessageSquare } from "lucide-react";
import { useDocumentTitle } from "@/hooks/use-document-title";

interface BetaAnalyticsData {
  signupCount: number;
  onboardingRate: number;
  activationRates: Record<string, { total: number; rate: number }>;
  userTimelines: Array<{
    orgId: number;
    name: string;
    signedUpAt: string;
    onboardingCompleted: boolean;
    tier: string;
    subscriptionStatus: string;
    trialStartedAt: string | null;
    trialEndsAt: string | null;
    lastActive: string | null;
    leadCount: number;
    dealCount: number;
    noteCount: number;
  }>;
  healthIndicators: Array<{
    orgId: number;
    name: string;
    lastActive: string | null;
    health: "green" | "yellow" | "red";
  }>;
  pageVisits: Record<string, number>;
  feedback: Array<{
    id: number;
    userId: string;
    orgId: number;
    page: string;
    feedback: string;
    createdAt: string;
  }>;
}

const EVENT_LABELS: Record<string, string> = {
  first_lead_created: "Created first lead",
  first_lead_imported: "Imported leads",
  first_campaign_created: "Created campaign",
  first_deal_created: "Created deal",
  first_note_created: "Created note",
  first_pax_message: "Used Pax AI",
  first_enrichment_run: "Ran enrichment",
};

const HEALTH_COLORS = {
  green: "bg-acr-pos",
  yellow: "bg-acr-warn",
  red: "bg-acr-neg",
};

const HEALTH_LABELS = {
  green: "Active",
  yellow: "Cooling",
  red: "Stale",
};

export default function BetaAnalyticsPage() {
  useDocumentTitle("Beta analytics");
  const { data, isLoading } = useQuery<BetaAnalyticsData>({
    queryKey: ["/api/admin/beta-analytics"],
  });

  if (isLoading) return (
    <div className="p-8" role="status" aria-live="polite">
      <span className="sr-only">Loading beta analytics…</span>
      <Skeleton className="h-96 w-full" />
    </div>
  );
  if (!data) return <div className="p-8 text-muted-foreground">No analytics data available.</div>;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold">Beta analytics</h1>

      <dl className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
              <Users className="h-4 w-4" aria-hidden="true" /> Total signups
            </CardTitle>
          </CardHeader>
          <CardContent>
            <dt className="sr-only">Total signups</dt>
            <dd className="text-3xl font-bold tabular-nums">{data.signupCount}</dd>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
              <TrendingUp className="h-4 w-4" aria-hidden="true" /> Onboarding rate
            </CardTitle>
          </CardHeader>
          <CardContent>
            <dt className="sr-only">Onboarding rate</dt>
            <dd className="text-3xl font-bold tabular-nums">{data.onboardingRate}%</dd>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
              <Activity className="h-4 w-4" aria-hidden="true" /> Active (48h)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <dt className="sr-only">Active in last 48 hours</dt>
            <dd className="text-3xl font-bold tabular-nums">
              {data.healthIndicators.filter((h) => h.health === "green").length}
            </dd>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
              <MessageSquare className="h-4 w-4" aria-hidden="true" /> Feedback items
            </CardTitle>
          </CardHeader>
          <CardContent>
            <dt className="sr-only">Feedback items</dt>
            <dd className="text-3xl font-bold tabular-nums">{data.feedback.length}</dd>
          </CardContent>
        </Card>
      </dl>

      <Tabs defaultValue="activation">
        <TabsList>
          <TabsTrigger value="activation">Activation</TabsTrigger>
          <TabsTrigger value="users">Users</TabsTrigger>
          <TabsTrigger value="pages">Page usage</TabsTrigger>
          <TabsTrigger value="feedback">Feedback</TabsTrigger>
        </TabsList>

        <TabsContent value="activation" className="space-y-4">
          <Card>
            <CardHeader><CardTitle>Activation events</CardTitle></CardHeader>
            <CardContent>
              <ul className="space-y-3" aria-label="Activation event rates">
                {Object.entries(data.activationRates).map(([event, { total, rate }]) => {
                  const label = EVENT_LABELS[event] || event;
                  return (
                    <li key={event} className="flex items-center gap-4">
                      <span className="text-sm w-48 truncate">{label}</span>
                      <div
                        className="flex-1 bg-muted rounded-full h-3 overflow-hidden"
                        role="progressbar"
                        aria-valuenow={Math.round(rate)}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-label={`${label}: ${total} users, ${rate}%`}
                      >
                        <div
                          className="bg-primary h-full rounded-full transition-all"
                          style={{ width: `${Math.min(rate, 100)}%` }}
                        />
                      </div>
                      <span className="text-sm text-muted-foreground w-20 text-right tabular-nums">
                        {total} ({rate}%)
                      </span>
                    </li>
                  );
                })}
              </ul>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="users" className="space-y-4">
          <Card>
            <CardHeader><CardTitle>User health & timeline</CardTitle></CardHeader>
            <CardContent>
              <div className="overflow-x-auto" role="region" aria-label="User health table" tabIndex={0}>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th scope="col" className="text-left p-2">Health</th>
                      <th scope="col" className="text-left p-2">Org</th>
                      <th scope="col" className="text-left p-2">Tier</th>
                      <th scope="col" className="text-left p-2">Signed up</th>
                      <th scope="col" className="text-left p-2">Last active</th>
                      <th scope="col" className="text-right p-2">Leads</th>
                      <th scope="col" className="text-right p-2">Deals</th>
                      <th scope="col" className="text-right p-2">Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.userTimelines.map((u) => {
                      const health = data.healthIndicators.find((h) => h.orgId === u.orgId);
                      const healthState = health?.health || "red";
                      return (
                        <tr key={u.orgId} className="border-b hover:bg-muted/50">
                          <td className="p-2">
                            <span
                              className={`block h-3 w-3 rounded-full ${HEALTH_COLORS[healthState]}`}
                              aria-label={`Health: ${HEALTH_LABELS[healthState]}`}
                            />
                          </td>
                          <td className="p-2 font-medium">{u.name}</td>
                          <td className="p-2">
                            <Badge variant="outline" className="text-xs capitalize">{u.tier}</Badge>
                            {u.subscriptionStatus === "trialing" && (
                              <Badge variant="secondary" className="text-xs ml-1">Trial</Badge>
                            )}
                          </td>
                          <td className="p-2 text-muted-foreground tabular-nums">
                            {new Date(u.signedUpAt).toLocaleDateString()}
                          </td>
                          <td className="p-2 text-muted-foreground tabular-nums">
                            {u.lastActive ? new Date(u.lastActive).toLocaleDateString() : "Never"}
                          </td>
                          <td className="p-2 text-right tabular-nums">{u.leadCount}</td>
                          <td className="p-2 text-right tabular-nums">{u.dealCount}</td>
                          <td className="p-2 text-right tabular-nums">{u.noteCount}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="pages" className="space-y-4">
          <Card>
            <CardHeader><CardTitle>Page visit frequency</CardTitle></CardHeader>
            <CardContent>
              <ol className="space-y-2" aria-label="Top 20 pages by visit count">
                {Object.entries(data.pageVisits)
                  .sort(([, a], [, b]) => b - a)
                  .slice(0, 20)
                  .map(([path, visits]) => {
                    const max = Math.max(...Object.values(data.pageVisits), 1);
                    const pct = Math.round(Math.min((visits / max) * 100, 100));
                    return (
                      <li key={path} className="flex items-center gap-3">
                        <code className="text-xs bg-muted px-2 py-1 rounded w-48 truncate">{path}</code>
                        <div
                          className="flex-1 bg-muted rounded-full h-2 overflow-hidden"
                          role="progressbar"
                          aria-valuenow={pct}
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-label={`${path}: ${visits} visits (${pct}% of top page)`}
                        >
                          <div
                            className="bg-primary h-full rounded-full"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className="text-xs text-muted-foreground w-12 text-right tabular-nums">{visits}</span>
                      </li>
                    );
                  })}
              </ol>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="feedback" className="space-y-4">
          <Card>
            <CardHeader><CardTitle>User feedback</CardTitle></CardHeader>
            <CardContent>
              {data.feedback.length === 0 ? (
                <p className="text-sm text-muted-foreground">No feedback yet.</p>
              ) : (
                <ol className="space-y-4" aria-label="User feedback, newest first">
                  {data.feedback.map((f) => (
                    <li key={f.id} className="border rounded-lg p-3 space-y-1">
                      <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
                        <code>{f.page}</code>
                        <span aria-hidden="true">·</span>
                        <span className="tabular-nums">{new Date(f.createdAt).toLocaleString()}</span>
                      </div>
                      <p className="text-sm">{f.feedback}</p>
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
