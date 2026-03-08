import { useEffect, useState, lazy, Suspense } from "react";
import { PageShell } from "@/components/page-shell";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Banknote,
  PieChart,
  TrendingUp,
  BarChart3,
  Landmark,
} from "lucide-react";
import FinancePage from "@/pages/finance";

const PortfolioOptimizerPage = lazy(() => import("@/pages/portfolio-optimizer"));
const CashFlowPage = lazy(() => import("@/pages/cash-flow"));
const CapitalMarketsPage = lazy(() => import("@/pages/capital-markets"));
const PortfolioPage = lazy(() => import("@/pages/portfolio"));

type TabValue = "notes" | "finance" | "portfolio" | "forecast" | "capital";

function getTabFromHash(): TabValue {
  const hash = window.location.hash.replace("#", "") as TabValue;
  if (["notes", "finance", "portfolio", "forecast", "capital"].includes(hash)) {
    return hash;
  }
  return "notes";
}

function TabFallback() {
  return (
    <div className="flex items-center justify-center py-20">
      <div className="animate-pulse text-muted-foreground text-sm">Loading...</div>
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
          <Suspense fallback={<TabFallback />}>
            <PortfolioPage />
          </Suspense>
        </TabsContent>

        <TabsContent value="portfolio" data-testid="tab-content-portfolio">
          <Suspense fallback={<TabFallback />}>
            <PortfolioOptimizerPage />
          </Suspense>
        </TabsContent>

        <TabsContent value="forecast" data-testid="tab-content-forecast">
          <Suspense fallback={<TabFallback />}>
            <CashFlowPage />
          </Suspense>
        </TabsContent>

        <TabsContent value="capital" data-testid="tab-content-capital">
          <Suspense fallback={<TabFallback />}>
            <CapitalMarketsPage />
          </Suspense>
        </TabsContent>
      </Tabs>
    </PageShell>
  );
}
