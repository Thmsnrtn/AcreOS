import { useEffect, useState, lazy, Suspense } from "react";
import { PageShell } from "@/components/page-shell";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AnalyticsContent } from "@/components/analytics-content";
import { TeamDashboardContent } from "@/components/team-dashboard-content";
import { ActivityContent } from "@/components/activity-content";
import { CohortAnalytics } from "@/components/cohort-analytics";
import { AttributionAnalytics } from "@/components/attribution-analytics";
import { BarChart3, Users, Activity, GitBranch, Target } from "lucide-react";

type TabValue = "analytics" | "team" | "activity" | "cohorts" | "attribution";

const VALID_TABS: TabValue[] = ["analytics", "team", "activity", "cohorts", "attribution"];

function getTabFromHash(): TabValue {
  const hash = window.location.hash.replace("#", "") as TabValue;
  return VALID_TABS.includes(hash) ? hash : "analytics";
}

function TabFallback() {
  return (
    <div className="flex items-center justify-center py-16">
      <div className="animate-pulse text-muted-foreground text-sm">Loading...</div>
    </div>
  );
}

export default function AnalyticsPage() {
  const [activeTab, setActiveTab] = useState<TabValue>(getTabFromHash);

  useEffect(() => {
    const handleHashChange = () => setActiveTab(getTabFromHash());
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  const handleTabChange = (value: string) => {
    const tab = value as TabValue;
    setActiveTab(tab);
    if (tab === "analytics") {
      window.history.replaceState(null, "", window.location.pathname);
    } else {
      window.history.replaceState(null, "", `#${tab}`);
    }
  };

  return (
    <PageShell>
      <div>
        <h1 className="text-2xl md:text-3xl font-bold" data-testid="text-insights-title">Insights</h1>
        <p className="text-muted-foreground text-sm md:text-base">Analytics, team performance, activity, cohort analysis, and attribution</p>
      </div>

      <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-6" data-testid="tabs-insights">
        <TabsList className="w-full sm:w-auto overflow-x-auto flex-nowrap" data-testid="tabs-list-insights">
          <TabsTrigger
            value="analytics"
            className="flex items-center gap-2 min-w-max"
            data-testid="tab-analytics"
          >
            <BarChart3 className="h-4 w-4" />
            <span>Analytics</span>
          </TabsTrigger>
          <TabsTrigger
            value="team"
            className="flex items-center gap-2 min-w-max"
            data-testid="tab-team"
          >
            <Users className="h-4 w-4" />
            <span>Team</span>
          </TabsTrigger>
          <TabsTrigger
            value="activity"
            className="flex items-center gap-2 min-w-max"
            data-testid="tab-activity"
          >
            <Activity className="h-4 w-4" />
            <span>Activity</span>
          </TabsTrigger>
          <TabsTrigger
            value="cohorts"
            className="flex items-center gap-2 min-w-max"
            data-testid="tab-cohorts"
          >
            <GitBranch className="h-4 w-4" />
            <span>Cohorts</span>
          </TabsTrigger>
          <TabsTrigger
            value="attribution"
            className="flex items-center gap-2 min-w-max"
            data-testid="tab-attribution"
          >
            <Target className="h-4 w-4" />
            <span>Attribution</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="analytics" data-testid="tab-content-analytics">
          <AnalyticsContent />
        </TabsContent>

        <TabsContent value="team" data-testid="tab-content-team">
          <TeamDashboardContent />
        </TabsContent>

        <TabsContent value="activity" data-testid="tab-content-activity">
          <ActivityContent />
        </TabsContent>

        <TabsContent value="cohorts" data-testid="tab-content-cohorts">
          <Suspense fallback={<TabFallback />}>
            <CohortAnalytics />
          </Suspense>
        </TabsContent>

        <TabsContent value="attribution" data-testid="tab-content-attribution">
          <Suspense fallback={<TabFallback />}>
            <AttributionAnalytics />
          </Suspense>
        </TabsContent>
      </Tabs>
    </PageShell>
  );
}
