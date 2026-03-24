import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Users, TrendingUp, Activity, MessageSquare } from "lucide-react";

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
  first_lead_created: "Created First Lead",
  first_lead_imported: "Imported Leads",
  first_campaign_created: "Created Campaign",
  first_deal_created: "Created Deal",
  first_note_created: "Created Note",
  first_pax_message: "Used Pax AI",
  first_enrichment_run: "Ran Enrichment",
};

const HEALTH_COLORS = {
  green: "bg-green-500",
  yellow: "bg-yellow-500",
  red: "bg-red-500",
};

export default function BetaAnalyticsPage() {
  const { data, isLoading } = useQuery<BetaAnalyticsData>({
    queryKey: ["/api/admin/beta-analytics"],
  });

  if (isLoading) return <div className="p-8"><Skeleton className="h-96 w-full" /></div>;
  if (!data) return <div className="p-8 text-muted-foreground">No analytics data available.</div>;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold">Beta Analytics</h1>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
              <Users className="h-4 w-4" /> Total Signups
            </CardTitle>
          </CardHeader>
          <CardContent><span className="text-3xl font-bold">{data.signupCount}</span></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
              <TrendingUp className="h-4 w-4" /> Onboarding Rate
            </CardTitle>
          </CardHeader>
          <CardContent><span className="text-3xl font-bold">{data.onboardingRate}%</span></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
              <Activity className="h-4 w-4" /> Active (48h)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <span className="text-3xl font-bold">
              {data.healthIndicators.filter((h) => h.health === "green").length}
            </span>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
              <MessageSquare className="h-4 w-4" /> Feedback Items
            </CardTitle>
          </CardHeader>
          <CardContent><span className="text-3xl font-bold">{data.feedback.length}</span></CardContent>
        </Card>
      </div>

      <Tabs defaultValue="activation">
        <TabsList>
          <TabsTrigger value="activation">Activation</TabsTrigger>
          <TabsTrigger value="users">Users</TabsTrigger>
          <TabsTrigger value="pages">Page Usage</TabsTrigger>
          <TabsTrigger value="feedback">Feedback</TabsTrigger>
        </TabsList>

        {/* Activation Rates */}
        <TabsContent value="activation" className="space-y-4">
          <Card>
            <CardHeader><CardTitle>Activation Events</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-3">
                {Object.entries(data.activationRates).map(([event, { total, rate }]) => (
                  <div key={event} className="flex items-center gap-4">
                    <span className="text-sm w-48 truncate">{EVENT_LABELS[event] || event}</span>
                    <div className="flex-1 bg-muted rounded-full h-3 overflow-hidden">
                      <div
                        className="bg-primary h-full rounded-full transition-all"
                        style={{ width: `${Math.min(rate, 100)}%` }}
                      />
                    </div>
                    <span className="text-sm text-muted-foreground w-20 text-right">
                      {total} ({rate}%)
                    </span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* User Timelines */}
        <TabsContent value="users" className="space-y-4">
          <Card>
            <CardHeader><CardTitle>User Health & Timeline</CardTitle></CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left p-2">Health</th>
                      <th className="text-left p-2">Org</th>
                      <th className="text-left p-2">Tier</th>
                      <th className="text-left p-2">Signed Up</th>
                      <th className="text-left p-2">Last Active</th>
                      <th className="text-right p-2">Leads</th>
                      <th className="text-right p-2">Deals</th>
                      <th className="text-right p-2">Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.userTimelines.map((u) => {
                      const health = data.healthIndicators.find((h) => h.orgId === u.orgId);
                      return (
                        <tr key={u.orgId} className="border-b hover:bg-muted/50">
                          <td className="p-2">
                            <div className={`h-3 w-3 rounded-full ${HEALTH_COLORS[health?.health || "red"]}`} />
                          </td>
                          <td className="p-2 font-medium">{u.name}</td>
                          <td className="p-2">
                            <Badge variant="outline" className="text-xs">{u.tier}</Badge>
                            {u.subscriptionStatus === "trialing" && (
                              <Badge variant="secondary" className="text-xs ml-1">trial</Badge>
                            )}
                          </td>
                          <td className="p-2 text-muted-foreground">
                            {new Date(u.signedUpAt).toLocaleDateString()}
                          </td>
                          <td className="p-2 text-muted-foreground">
                            {u.lastActive ? new Date(u.lastActive).toLocaleDateString() : "Never"}
                          </td>
                          <td className="p-2 text-right">{u.leadCount}</td>
                          <td className="p-2 text-right">{u.dealCount}</td>
                          <td className="p-2 text-right">{u.noteCount}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Page Visit Frequency */}
        <TabsContent value="pages" className="space-y-4">
          <Card>
            <CardHeader><CardTitle>Page Visit Frequency</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-2">
                {Object.entries(data.pageVisits)
                  .sort(([, a], [, b]) => b - a)
                  .slice(0, 20)
                  .map(([path, visits]) => (
                    <div key={path} className="flex items-center gap-3">
                      <code className="text-xs bg-muted px-2 py-1 rounded w-48 truncate">{path}</code>
                      <div className="flex-1 bg-muted rounded-full h-2 overflow-hidden">
                        <div
                          className="bg-primary h-full rounded-full"
                          style={{
                            width: `${Math.min((visits / Math.max(...Object.values(data.pageVisits), 1)) * 100, 100)}%`,
                          }}
                        />
                      </div>
                      <span className="text-xs text-muted-foreground w-12 text-right">{visits}</span>
                    </div>
                  ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Feedback */}
        <TabsContent value="feedback" className="space-y-4">
          <Card>
            <CardHeader><CardTitle>User Feedback</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-4">
                {data.feedback.length === 0 && (
                  <p className="text-sm text-muted-foreground">No feedback yet.</p>
                )}
                {data.feedback.map((f) => (
                  <div key={f.id} className="border rounded-lg p-3 space-y-1">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <code>{f.page}</code>
                      <span>·</span>
                      <span>{new Date(f.createdAt).toLocaleString()}</span>
                    </div>
                    <p className="text-sm">{f.feedback}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
