import { Target, TestTube, GitBranch, Send } from "lucide-react";
import { useState, useEffect } from "react";
import { PageShell } from "@/components/page-shell";
import { DoorSections, DEALS_SECTIONS } from "@/components/door-sections";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CampaignsContent } from "@/components/campaigns-content";
import { AbTestsContent } from "@/components/ab-tests-content";
import { SequencesContent } from "@/components/sequences-content";
import { LowBalanceAlert } from "@/components/low-balance-alert";
import { BuyerBlastsPanel } from "@/pages/buyer-blasts";
import { tabForLocation, type TabValue } from "@/lib/marketingHubTabs";
import { useDocumentTitle } from "@/hooks/use-document-title";
import "./today.css";

export default function MarketingHub() {
  useDocumentTitle("Marketing hub");
  const [activeTab, setActiveTab] = useState<TabValue>(() =>
    tabForLocation(window.location.search, window.location.hash),
  );

  useEffect(() => {
    const handleHashChange = () => {
      setActiveTab(tabForLocation(window.location.search, window.location.hash));
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

  // Shell consistency (roadmap W2.4): this page used to mount a SECOND full
  // SidebarProvider/Sidebar whose only nav item exited the page — the
  // activation destination greeted new users with a conflicting app frame.
  // PageShell owns the real sidebar/topbar/main landmark now.
  return (
    <PageShell label="Marketing hub">
      <div className="space-y-6" data-testid="marketing-hub-main">
        <LowBalanceAlert />
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="acr-cc-hero" style={{ marginTop: 0 }}>
            <div>
              <div className="acr-eyebrow">Marketing hub</div>
              <h1 className="acr-cc-greeting" data-testid="text-marketing-hub-title">
                Reach the right sellers.
                <span className="acr-cc-greeting-soft">
                  {" "}Campaigns, A/B tests, and drip sequences in one place.
                </span>
              </h1>
            </div>
          </div>
        </div>

        <DoorSections door="Deals" sections={DEALS_SECTIONS} />

          <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
            <TabsList className="w-full md:w-auto overflow-x-auto flex" data-testid="marketing-hub-tabs">
              <TabsTrigger
                value="campaigns"
                className="flex items-center gap-2"
                data-testid="tab-campaigns"
              >
                <Target className="w-4 h-4" aria-hidden="true" />
                Campaigns
              </TabsTrigger>
              <TabsTrigger
                value="ab-tests"
                className="flex items-center gap-2"
                data-testid="tab-ab-tests"
              >
                <TestTube className="w-4 h-4" aria-hidden="true" />
                A/B tests
              </TabsTrigger>
              <TabsTrigger
                value="sequences"
                className="flex items-center gap-2"
                data-testid="tab-sequences"
              >
                <GitBranch className="w-4 h-4" aria-hidden="true" />
                Sequences
              </TabsTrigger>
              <TabsTrigger
                value="buyer-blasts"
                className="flex items-center gap-2"
                data-testid="tab-buyer-blasts"
              >
                <Send className="w-4 h-4" aria-hidden="true" />
                Buyer blasts
              </TabsTrigger>
            </TabsList>

            <TabsContent value="campaigns" className="mt-6" data-testid="tab-content-campaigns">
              <CampaignsContent />
            </TabsContent>
            
            <TabsContent value="ab-tests" className="mt-6" data-testid="tab-content-ab-tests">
              <AbTestsContent />
            </TabsContent>
            
          <TabsContent value="sequences" className="mt-6" data-testid="tab-content-sequences">
            <SequencesContent />
          </TabsContent>

          <TabsContent value="buyer-blasts" className="mt-6" data-testid="tab-content-buyer-blasts">
            <BuyerBlastsPanel />
          </TabsContent>
        </Tabs>
      </div>
    </PageShell>
  );
}
