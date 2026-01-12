import { SidebarProvider, Sidebar, SidebarContent, SidebarGroup, SidebarGroupLabel, SidebarGroupContent, SidebarMenu, SidebarMenuItem, SidebarMenuButton, SidebarHeader } from "@/components/ui/sidebar";
import { Target, TestTube, GitBranch, TrendingUp } from "lucide-react";
import { Link, useLocation } from "wouter";
import { useState, useEffect } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CampaignsContent } from "@/components/campaigns-content";
import { ABTestsContent } from "@/components/ab-tests-content";
import { SequencesContent } from "@/components/sequences-content";
import { LowBalanceAlert } from "@/components/low-balance-alert";

const menuItems = [
  { title: "Dashboard", href: "/", icon: TrendingUp },
];

type TabValue = "campaigns" | "ab-tests" | "sequences";

export default function MarketingHub() {
  const [, setLocation] = useLocation();
  const [activeTab, setActiveTab] = useState<TabValue>("campaigns");

  useEffect(() => {
    const hash = window.location.hash.replace("#", "");
    if (hash === "ab-tests" || hash === "sequences") {
      setActiveTab(hash as TabValue);
    } else if (hash === "campaigns" || !hash) {
      setActiveTab("campaigns");
    }

    const handleHashChange = () => {
      const newHash = window.location.hash.replace("#", "");
      if (newHash === "ab-tests" || newHash === "sequences") {
        setActiveTab(newHash as TabValue);
      } else {
        setActiveTab("campaigns");
      }
    };

    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  const handleTabChange = (value: string) => {
    setActiveTab(value as TabValue);
    if (value === "campaigns") {
      window.history.replaceState(null, "", "/campaigns");
    } else {
      window.history.replaceState(null, "", `/campaigns#${value}`);
    }
  };

  return (
    <SidebarProvider>
      <Sidebar>
        <SidebarHeader className="p-4 border-b">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary to-primary/70 flex items-center justify-center text-primary-foreground">
              <Target className="w-5 h-5" />
            </div>
            <span className="font-bold text-lg">Marketing Hub</span>
          </div>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Navigation</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {menuItems.map((item) => (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton asChild>
                      <Link href={item.href}>
                        <item.icon className="w-4 h-4" />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
      </Sidebar>

      <main className="flex-1 flex flex-col overflow-auto" data-testid="marketing-hub-main">
        <LowBalanceAlert />
        <div className="max-w-7xl mx-auto space-y-6 p-6 flex-1">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold" data-testid="text-marketing-hub-title">Marketing Hub</h1>
              <p className="text-muted-foreground">Manage campaigns, A/B tests, and drip sequences</p>
            </div>
          </div>

          <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
            <TabsList className="w-full md:w-auto overflow-x-auto flex" data-testid="marketing-hub-tabs">
              <TabsTrigger 
                value="campaigns" 
                className="flex items-center gap-2"
                data-testid="tab-campaigns"
              >
                <Target className="w-4 h-4" />
                Campaigns
              </TabsTrigger>
              <TabsTrigger 
                value="ab-tests" 
                className="flex items-center gap-2"
                data-testid="tab-ab-tests"
              >
                <TestTube className="w-4 h-4" />
                A/B Tests
              </TabsTrigger>
              <TabsTrigger 
                value="sequences" 
                className="flex items-center gap-2"
                data-testid="tab-sequences"
              >
                <GitBranch className="w-4 h-4" />
                Sequences
              </TabsTrigger>
            </TabsList>

            <TabsContent value="campaigns" className="mt-6" data-testid="tab-content-campaigns">
              <CampaignsContent />
            </TabsContent>
            
            <TabsContent value="ab-tests" className="mt-6" data-testid="tab-content-ab-tests">
              <ABTestsContent />
            </TabsContent>
            
            <TabsContent value="sequences" className="mt-6" data-testid="tab-content-sequences">
              <SequencesContent />
            </TabsContent>
          </Tabs>
        </div>
      </main>
    </SidebarProvider>
  );
}
