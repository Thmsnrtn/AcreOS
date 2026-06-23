/**
 * /founder/admin/costs — the unified Costs & economics instrument.
 *
 * Founder-nav consolidation (Phase 2): seven separate cost/economics routes
 * (/founder/cost, /ai-costs, /cost-optimizer, /unit-economics,
 * /observability-cost, /providers, /paid-data-eval) collapsed into one tabbed
 * hub under the /founder/admin/* deliberate-instrument namespace. Each tab
 * renders the original page's shell-less *Content component verbatim — zero
 * behavior change, one PageShell, one nav entry instead of seven.
 *
 * Deep-link a tab with ?tab=<value> (e.g. ?tab=ai-spend) so the command palette
 * and bookmarks can land directly on a sub-view.
 */
import { useSearch } from "wouter";
import { PageShell } from "@/components/page-shell";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useDocumentTitle } from "@/hooks/use-document-title";

import { CostContent } from "@/pages/founder/cost";
import { AiCostsContent } from "@/pages/founder/ai-costs";
import { CostOptimizerContent } from "@/pages/founder/cost-optimizer";
import { UnitEconomicsContent } from "@/pages/founder/unit-economics";
import { ObservabilityCostContent } from "@/pages/founder/observability-cost";
import { ProvidersContent } from "@/pages/founder-providers";
import { PaidDataEvalContent } from "@/pages/founder/paid-data-eval";

const TABS = [
  { value: "overview", label: "Overview" },
  { value: "ai-spend", label: "AI spend" },
  { value: "optimizer", label: "Optimizer" },
  { value: "unit-economics", label: "Unit economics" },
  { value: "sentry", label: "Observability" },
  { value: "providers", label: "Providers" },
  { value: "paid-data", label: "Paid-data trial" },
] as const;

export default function FounderAdminCostsPage() {
  useDocumentTitle("Costs & economics — AcreOS");
  const search = useSearch();
  const requested = new URLSearchParams(search).get("tab");
  const initial = TABS.some((t) => t.value === requested) ? requested! : "overview";

  return (
    <PageShell label="Costs & economics">
      <Tabs defaultValue={initial} className="w-full">
        <TabsList className="mb-4 flex h-auto flex-wrap justify-start gap-1">
          {TABS.map((t) => (
            <TabsTrigger key={t.value} value={t.value} className="text-xs sm:text-sm">
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="overview"><CostContent /></TabsContent>
        <TabsContent value="ai-spend"><AiCostsContent /></TabsContent>
        <TabsContent value="optimizer"><CostOptimizerContent /></TabsContent>
        <TabsContent value="unit-economics"><UnitEconomicsContent /></TabsContent>
        <TabsContent value="sentry"><ObservabilityCostContent /></TabsContent>
        <TabsContent value="providers"><ProvidersContent /></TabsContent>
        <TabsContent value="paid-data"><PaidDataEvalContent /></TabsContent>
      </Tabs>
    </PageShell>
  );
}
