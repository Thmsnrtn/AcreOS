import { useEffect, useState, lazy, Suspense } from "react";
import { PageShell } from "@/components/page-shell";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  GitBranch,
  Users,
  Map,
  Briefcase,
  Mail,
} from "lucide-react";
import DealsPage from "@/pages/deals";

const LeadsPage = lazy(() => import("@/pages/leads"));
const PropertiesPage = lazy(() => import("@/pages/properties"));
const CampaignsPage = lazy(() => import("@/pages/campaigns"));

type TabValue = "board" | "leads" | "properties" | "deals" | "outreach";

function getTabFromHash(): TabValue {
  const hash = window.location.hash.replace("#", "") as TabValue;
  if (["board", "leads", "properties", "deals", "outreach"].includes(hash)) {
    return hash;
  }
  return "board";
}

function TabFallback() {
  return (
    <div className="flex items-center justify-center py-20">
      <div className="animate-pulse text-muted-foreground text-sm">Loading...</div>
    </div>
  );
}

export default function PipelinePage() {
  const [activeTab, setActiveTab] = useState<TabValue>(getTabFromHash);

  useEffect(() => {
    const handleHashChange = () => setActiveTab(getTabFromHash());
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  const handleTabChange = (value: string) => {
    const tab = value as TabValue;
    setActiveTab(tab);
    if (tab === "board") {
      window.history.replaceState(null, "", window.location.pathname);
    } else {
      window.history.replaceState(null, "", `#${tab}`);
    }
  };

  return (
    <PageShell>
      <div>
        <h1 className="text-2xl md:text-3xl font-bold" data-testid="text-pipeline-title">
          Pipeline
        </h1>
        <p className="text-muted-foreground text-sm md:text-base">
          Leads, properties, deals, and outreach in one place.
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-6" data-testid="tabs-pipeline">
        <TabsList className="w-full sm:w-auto overflow-x-auto flex-nowrap" data-testid="tabs-list-pipeline">
          <TabsTrigger value="board" className="flex items-center gap-2 min-w-max" data-testid="tab-board">
            <GitBranch className="h-4 w-4" />
            <span>Board</span>
          </TabsTrigger>
          <TabsTrigger value="leads" className="flex items-center gap-2 min-w-max" data-testid="tab-leads">
            <Users className="h-4 w-4" />
            <span>Leads</span>
          </TabsTrigger>
          <TabsTrigger value="properties" className="flex items-center gap-2 min-w-max" data-testid="tab-properties">
            <Map className="h-4 w-4" />
            <span>Properties</span>
          </TabsTrigger>
          <TabsTrigger value="deals" className="flex items-center gap-2 min-w-max" data-testid="tab-deals">
            <Briefcase className="h-4 w-4" />
            <span>Deals</span>
          </TabsTrigger>
          <TabsTrigger value="outreach" className="flex items-center gap-2 min-w-max" data-testid="tab-outreach">
            <Mail className="h-4 w-4" />
            <span>Outreach</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="board" data-testid="tab-content-board">
          <DealsPage />
        </TabsContent>

        <TabsContent value="leads" data-testid="tab-content-leads">
          <Suspense fallback={<TabFallback />}>
            <LeadsPage />
          </Suspense>
        </TabsContent>

        <TabsContent value="properties" data-testid="tab-content-properties">
          <Suspense fallback={<TabFallback />}>
            <PropertiesPage />
          </Suspense>
        </TabsContent>

        <TabsContent value="deals" data-testid="tab-content-deals">
          <Suspense fallback={<TabFallback />}>
            <DealsPage />
          </Suspense>
        </TabsContent>

        <TabsContent value="outreach" data-testid="tab-content-outreach">
          <Suspense fallback={<TabFallback />}>
            <CampaignsPage />
          </Suspense>
        </TabsContent>
      </Tabs>
    </PageShell>
  );
}
