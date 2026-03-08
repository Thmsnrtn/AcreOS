import { useEffect, useState, lazy, Suspense } from "react";
import { PageShell } from "@/components/page-shell";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  MessageSquare,
  Activity,
  Bot,
  Zap,
} from "lucide-react";
import CommandCenterPage from "@/pages/command-center";

const ActivityPage = lazy(() => import("@/pages/activity"));
const AutomationPage = lazy(() => import("@/pages/automation"));

type TabValue = "chat" | "activity" | "agents" | "automation";

function getTabFromHash(): TabValue {
  const hash = window.location.hash.replace("#", "") as TabValue;
  if (["chat", "activity", "agents", "automation"].includes(hash)) {
    return hash;
  }
  return "chat";
}

function TabFallback() {
  return (
    <div className="flex items-center justify-center py-20">
      <div className="animate-pulse text-muted-foreground text-sm">Loading...</div>
    </div>
  );
}

export default function AtlasPage() {
  const [activeTab, setActiveTab] = useState<TabValue>(getTabFromHash);

  useEffect(() => {
    const handleHashChange = () => setActiveTab(getTabFromHash());
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  const handleTabChange = (value: string) => {
    const tab = value as TabValue;
    setActiveTab(tab);
    if (tab === "chat") {
      window.history.replaceState(null, "", window.location.pathname);
    } else {
      window.history.replaceState(null, "", `#${tab}`);
    }
  };

  return (
    <PageShell>
      <div>
        <h1 className="text-2xl md:text-3xl font-bold" data-testid="text-atlas-title">
          Atlas
        </h1>
        <p className="text-muted-foreground text-sm md:text-base">
          AI assistant, agents, and automation for your land business.
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-6" data-testid="tabs-atlas">
        <TabsList className="w-full sm:w-auto overflow-x-auto flex-nowrap" data-testid="tabs-list-atlas">
          <TabsTrigger value="chat" className="flex items-center gap-2 min-w-max" data-testid="tab-chat">
            <MessageSquare className="h-4 w-4" />
            <span>Chat</span>
          </TabsTrigger>
          <TabsTrigger value="activity" className="flex items-center gap-2 min-w-max" data-testid="tab-activity">
            <Activity className="h-4 w-4" />
            <span>Activity</span>
          </TabsTrigger>
          <TabsTrigger value="agents" className="flex items-center gap-2 min-w-max" data-testid="tab-agents">
            <Bot className="h-4 w-4" />
            <span>Agents</span>
          </TabsTrigger>
          <TabsTrigger value="automation" className="flex items-center gap-2 min-w-max" data-testid="tab-automation">
            <Zap className="h-4 w-4" />
            <span>Automation</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="chat" data-testid="tab-content-chat">
          <CommandCenterPage />
        </TabsContent>

        <TabsContent value="activity" data-testid="tab-content-activity">
          <Suspense fallback={<TabFallback />}>
            <ActivityPage />
          </Suspense>
        </TabsContent>

        <TabsContent value="agents" data-testid="tab-content-agents">
          <CommandCenterPage />
        </TabsContent>

        <TabsContent value="automation" data-testid="tab-content-automation">
          <Suspense fallback={<TabFallback />}>
            <AutomationPage />
          </Suspense>
        </TabsContent>
      </Tabs>
    </PageShell>
  );
}
