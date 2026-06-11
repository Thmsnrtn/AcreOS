import { useEffect, useState, lazy, Suspense } from "react";
import { PageShell } from "@/components/page-shell";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import {
  Banknote,
  PieChart,
  TrendingUp,
  BarChart3,
  Landmark,
  Upload,
} from "lucide-react";
// All embedded pages are lazy-loaded so opening /money doesn't ship the
// entire FinancePage (1,824 LOC) + PortfolioPage / Optimizer / CashFlow /
// CapitalMarkets bundle. The active tab loads on mount; siblings load on
// click via Suspense fallback.
import { NotesImportDialog } from "@/components/notes-import-dialog";
import { useDocumentTitle } from "@/hooks/use-document-title";

const FinancePage = lazy(() => import("@/pages/finance"));
const PortfolioOptimizerPage = lazy(() => import("@/pages/portfolio-optimizer"));
const CashFlowPage = lazy(() => import("@/pages/cash-flow"));
const CapitalMarketsPage = lazy(() => import("@/pages/capital-markets"));
const PortfolioPage = lazy(() => import("@/pages/portfolio"));

// Tab values now MATCH their labels (and their mounted content). Previously
// the labels were swapped to match content while the values were left stale,
// so a deep link to #portfolio opened the Optimizer. Old hashes are migrated
// in getTabFromHash so existing links/bookmarks still land correctly.
type TabValue = "notes" | "portfolio" | "optimizer" | "forecast" | "capital";

const TAB_VALUES: TabValue[] = ["notes", "portfolio", "optimizer", "forecast", "capital"];

// Legacy hash → current value. The old "finance" value rendered the Portfolio
// page; map it forward so bookmarks don't break.
const LEGACY_HASH: Record<string, TabValue> = { finance: "portfolio" };

function getTabFromHash(): TabValue {
  const raw = window.location.hash.replace("#", "");
  const migrated = LEGACY_HASH[raw] ?? raw;
  return (TAB_VALUES as string[]).includes(migrated) ? (migrated as TabValue) : "notes";
}

function TabFallback() {
  return (
    <div className="space-y-4 py-4" role="status" aria-live="polite">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-24 rounded-card bg-muted/40 animate-pulse" />
        ))}
      </div>
      <div className="h-40 rounded-card bg-muted/30 animate-pulse" />
      <span className="sr-only">Loading Finance…</span>
    </div>
  );
}

export default function FinancePageShell() {
  useDocumentTitle("Finance");
  const [activeTab, setActiveTab] = useState<TabValue>(getTabFromHash);
  const [importOpen, setImportOpen] = useState(false);

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
      {/* §2.3 generous editorial rhythm: the door header→content gap steps up to
          the bold mb-8 (32px). The `.acr-cc-hero*` editorial wrapper is NOT used
          here — those classes live only in page-scoped today.css, which this lazy
          door shell does not import; the global `.acr-cc-greeting` H1 below already
          carries the Fraunces editorial identity (index.css). Visible copy and the
          activeTab-gated Import button are unchanged. */}
      <div className="flex items-start justify-between gap-4">
        <div>
          {/* §1.3: dual class + Tailwind utility for the page H1. */}
          <h1 className="acr-cc-greeting text-hero" data-testid="text-money-title">
            Finance
          </h1>
          <p className="text-muted-foreground text-sm md:text-base">
            Your notes, portfolio health, and forward cash flow — in one place.
          </p>
        </div>
        {activeTab === "notes" && (
          <Button variant="outline" size="sm" onClick={() => setImportOpen(true)} className="shrink-0">
            <Upload className="w-4 h-4 mr-2" aria-hidden="true" />
            Import notes
          </Button>
        )}
      </div>
      <NotesImportDialog open={importOpen} onOpenChange={setImportOpen} />

      {/* §2.3 generous editorial rhythm: the door's tab section stack steps up
          from space-y-6 to the bold space-y-8 (32px), matching the PageShell
          default. Layout-only. */}
      <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-8" data-testid="tabs-money">
        <TabsList className="h-12 w-full sm:w-auto overflow-x-auto flex-nowrap" data-testid="tabs-list-money">
          <TabsTrigger value="notes" className="flex min-h-11 items-center gap-2 min-w-max" data-testid="tab-notes">
            <Banknote className="h-4 w-4" aria-hidden="true" />
            <span>Notes</span>
          </TabsTrigger>
          <TabsTrigger value="portfolio" className="flex min-h-11 items-center gap-2 min-w-max" data-testid="tab-portfolio">
            <PieChart className="h-4 w-4" aria-hidden="true" />
            <span>Portfolio</span>
          </TabsTrigger>
          <TabsTrigger value="optimizer" className="flex min-h-11 items-center gap-2 min-w-max" data-testid="tab-optimizer">
            <BarChart3 className="h-4 w-4" aria-hidden="true" />
            <span>Optimizer</span>
          </TabsTrigger>
          <TabsTrigger value="forecast" className="flex min-h-11 items-center gap-2 min-w-max" data-testid="tab-forecast">
            <TrendingUp className="h-4 w-4" aria-hidden="true" />
            <span>Forecast</span>
          </TabsTrigger>
          <TabsTrigger value="capital" className="flex min-h-11 items-center gap-2 min-w-max" data-testid="tab-capital">
            <Landmark className="h-4 w-4" aria-hidden="true" />
            <span>Capital</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="notes" data-testid="tab-content-notes">
          <Suspense fallback={<TabFallback />}>
            {/* embedded — this PageShell already provides the app chrome;
                without it FinancePage nested a second sidebar/topbar and a
                duplicate id="main-content" (T0-9). */}
            <FinancePage embedded />
          </Suspense>
        </TabsContent>

        <TabsContent value="portfolio" data-testid="tab-content-portfolio">
          <Suspense fallback={<TabFallback />}>
            <PortfolioPage embedded />
          </Suspense>
        </TabsContent>

        <TabsContent value="optimizer" data-testid="tab-content-optimizer">
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
