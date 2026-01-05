import { useEffect, useState } from "react";
import { Sidebar } from "@/components/layout-sidebar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AnalyticsContent } from "@/components/analytics-content";
import { TeamDashboardContent } from "@/components/team-dashboard-content";
import { ActivityContent } from "@/components/activity-content";
import { BarChart3, Users, Activity } from "lucide-react";

type TabValue = "analytics" | "team" | "activity";

function getTabFromHash(): TabValue {
  const hash = window.location.hash.replace("#", "");
  if (hash === "team" || hash === "activity") {
    return hash;
  }
  return "analytics";
}

export default function AnalyticsPage() {
  const [activeTab, setActiveTab] = useState<TabValue>(getTabFromHash);

  useEffect(() => {
    const handleHashChange = () => {
      setActiveTab(getTabFromHash());
    };

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
    <div className="flex min-h-screen bg-background desert-gradient">
      <Sidebar />
      <main className="flex-1 md:ml-[17rem] p-4 pt-16 md:pt-8 md:p-8 pb-24 md:pb-8 overflow-x-hidden">
        <div className="max-w-7xl mx-auto space-y-6 md:space-y-8">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold" data-testid="text-insights-title">Insights</h1>
            <p className="text-muted-foreground text-sm md:text-base">Analytics, team performance, and activity tracking</p>
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
          </Tabs>
        </div>
      </main>
    </div>
  );
}
