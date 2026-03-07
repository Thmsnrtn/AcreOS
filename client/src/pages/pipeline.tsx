import { useEffect, useState } from "react";
import { PageShell } from "@/components/page-shell";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import {
  GitBranch,
  Users,
  Map,
  Briefcase,
  Mail,
} from "lucide-react";
import DealsPage from "@/pages/deals";

type TabValue = "board" | "leads" | "properties" | "deals" | "outreach";

function getTabFromHash(): TabValue {
  const hash = window.location.hash.replace("#", "") as TabValue;
  if (["board", "leads", "properties", "deals", "outreach"].includes(hash)) {
    return hash;
  }
  return "board";
}

function LinkPanel({
  icon: Icon,
  title,
  description,
  href,
  cta,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  href: string;
  cta: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-20 gap-4">
      <Icon className="w-10 h-10 text-muted-foreground" />
      <h3 className="text-lg font-medium">{title}</h3>
      <p className="text-sm text-muted-foreground text-center max-w-xs">{description}</p>
      <Button asChild>
        <Link href={href}>{cta}</Link>
      </Button>
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
          <LinkPanel
            icon={Users}
            title="Leads CRM"
            description="Manage your land seller leads, skip trace, and track nurturing stages."
            href="/leads"
            cta="Open Leads CRM"
          />
        </TabsContent>

        <TabsContent value="properties" data-testid="tab-content-properties">
          <LinkPanel
            icon={Map}
            title="Property Inventory"
            description="Track properties you own, are evaluating, or have listed for sale."
            href="/properties"
            cta="Open Properties"
          />
        </TabsContent>

        <TabsContent value="deals" data-testid="tab-content-deals">
          <LinkPanel
            icon={Briefcase}
            title="Deal Pipeline"
            description="Visualize and manage your deal flow from offer to close."
            href="/deals"
            cta="Open Deals"
          />
        </TabsContent>

        <TabsContent value="outreach" data-testid="tab-content-outreach">
          <LinkPanel
            icon={Mail}
            title="Campaigns & Outreach"
            description="Run email, SMS, and direct mail campaigns to reach sellers."
            href="/campaigns"
            cta="Open Campaigns"
          />
        </TabsContent>
      </Tabs>
    </PageShell>
  );
}
