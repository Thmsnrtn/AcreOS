import { useEffect, useState } from "react";
import { PageShell } from "@/components/page-shell";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import {
  Banknote,
  PieChart,
  TrendingUp,
  BarChart3,
  Landmark,
} from "lucide-react";
import FinancePage from "@/pages/finance";

type TabValue = "notes" | "finance" | "portfolio" | "forecast" | "capital";

function getTabFromHash(): TabValue {
  const hash = window.location.hash.replace("#", "") as TabValue;
  if (["notes", "finance", "portfolio", "forecast", "capital"].includes(hash)) {
    return hash;
  }
  return "notes";
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

export default function MoneyPage() {
  const [activeTab, setActiveTab] = useState<TabValue>(getTabFromHash);

  useEffect(() => {
    const handleHashChange = () => setActiveTab(getTabFromHash());
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  const handleTabChange = (value: string) => {
    const tab = value as TabValue;
    setActiveTab(tab);
    if (tab === "notes") {
      window.history.replaceState(null, "", window.location.pathname);
    } else {
      window.history.replaceState(null, "", `#${tab}`);
    }
  };

  return (
    <PageShell>
      <div>
        <h1 className="text-2xl md:text-3xl font-bold" data-testid="text-money-title">
          Money
        </h1>
        <p className="text-muted-foreground text-sm md:text-base">
          Notes, portfolio, cash flow, and capital markets.
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-6" data-testid="tabs-money">
        <TabsList className="w-full sm:w-auto overflow-x-auto flex-nowrap" data-testid="tabs-list-money">
          <TabsTrigger value="notes" className="flex items-center gap-2 min-w-max" data-testid="tab-notes">
            <Banknote className="h-4 w-4" />
            <span>Notes</span>
          </TabsTrigger>
          <TabsTrigger value="finance" className="flex items-center gap-2 min-w-max" data-testid="tab-finance">
            <BarChart3 className="h-4 w-4" />
            <span>Finance</span>
          </TabsTrigger>
          <TabsTrigger value="portfolio" className="flex items-center gap-2 min-w-max" data-testid="tab-portfolio">
            <PieChart className="h-4 w-4" />
            <span>Portfolio</span>
          </TabsTrigger>
          <TabsTrigger value="forecast" className="flex items-center gap-2 min-w-max" data-testid="tab-forecast">
            <TrendingUp className="h-4 w-4" />
            <span>Forecast</span>
          </TabsTrigger>
          <TabsTrigger value="capital" className="flex items-center gap-2 min-w-max" data-testid="tab-capital">
            <Landmark className="h-4 w-4" />
            <span>Capital</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="notes" data-testid="tab-content-notes">
          <FinancePage />
        </TabsContent>

        <TabsContent value="finance" data-testid="tab-content-finance">
          <LinkPanel
            icon={BarChart3}
            title="Finance"
            description="Full financial management: income tracking, expense reports, and loan details."
            href="/finance"
            cta="Open Finance"
          />
        </TabsContent>

        <TabsContent value="portfolio" data-testid="tab-content-portfolio">
          <LinkPanel
            icon={PieChart}
            title="Portfolio"
            description="View your investment portfolio performance and asset allocation."
            href="/portfolio"
            cta="Open Portfolio"
          />
        </TabsContent>

        <TabsContent value="forecast" data-testid="tab-content-forecast">
          <LinkPanel
            icon={TrendingUp}
            title="Cash Flow Forecast"
            description="Project future cash flows based on existing notes and pipeline."
            href="/analytics"
            cta="Open Forecast"
          />
        </TabsContent>

        <TabsContent value="capital" data-testid="tab-content-capital">
          <LinkPanel
            icon={Landmark}
            title="Capital Markets"
            description="Access lending options, note buyers, and capital partners."
            href="/analytics"
            cta="Open Capital Markets"
          />
        </TabsContent>
      </Tabs>
    </PageShell>
  );
}
