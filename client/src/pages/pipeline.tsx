import { useEffect, useState, lazy, Suspense } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchJsonArray } from "@/lib/queryClient";
import { PageShell } from "@/components/page-shell";
import { useTerm } from "@/hooks/use-persona";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  GitBranch,
  Users,
  Map,
  Briefcase,
  Mail,
  TrendingUp,
  TrendingDown,
  Clock,
  DollarSign,
  ChevronRight,
  Flame,
  AlertTriangle,
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { QueryErrorState } from "@/components/query-error-state";
import { ConversionFunnel, type FunnelStage } from "@/components/ui/conversion-funnel";
import { dollarsCompact, plural } from "@/lib/format";
import { useDocumentTitle } from "@/hooks/use-document-title";
import "./today.css";

// All embedded tab content is lazy. Opening /pipeline used to ship
// DealsPage (~2,234 LOC) + LeadsPage + PropertiesPage + CampaignsPage in
// the parent's chunk. Each tab now loads on click via Suspense fallback.
const DealsPage = lazy(() => import("@/pages/deals"));
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
    <div
      className="flex items-center justify-center py-20"
      role="status"
      aria-live="polite"
    >
      <div className="animate-pulse text-muted-foreground text-sm">Loading…</div>
    </div>
  );
}

// ─── Pipeline Intelligence Header ─────────────────────────────────────────────

interface Lead {
  id: number;
  status: string;
  score?: number | null;
  lastContactedAt?: string | null;
  updatedAt?: string | null;
}

interface Deal {
  id: number;
  status: string;
  acceptedAmount?: number | null;
  offerDate?: string | null;
  updatedAt?: string | null;
}

// Theme-respondent funnel colors. Each token resolves at render time so the
// funnel re-tints when user switches themes (Homestead/Quarry/Nocturne/etc.).
// Pre-port version had raw Tailwind hexes that bled through every theme.
const FUNNEL_STAGES = [
  { key: "new",         label: "New",        color: "var(--muted-foreground)", statuses: ["new"] },
  { key: "contacted",   label: "Contacted",  color: "var(--acr-warn)",         statuses: ["mailed", "responded", "interested"] },
  { key: "qualifying",  label: "Qualifying", color: "var(--acr-warn)",         statuses: ["qualified", "negotiating"] },
  { key: "accepted",    label: "Accepted",   color: "var(--acr-brand)",        statuses: ["accepted"] },
  { key: "closed",      label: "Closed",     color: "var(--acr-pos)",          statuses: ["closed"] },
];

function PipelineIntelligenceHeader({ leads, deals }: { leads: Lead[]; deals: Deal[] }) {
  const stageCounts = FUNNEL_STAGES.map((stage) => ({
    ...stage,
    count: leads.filter((l) => stage.statuses.includes(l.status)).length,
  }));
  const totalLeads = leads.filter((l) => !["dead", "converted"].includes(l.status)).length;

  const activeDeals = deals.filter((d) => !["closed", "cancelled", "dead"].includes(d.status));
  const closedDeals = deals.filter((d) => d.status === "closed");
  const totalPipelineValue = activeDeals.reduce((s, d) => s + Number(d.acceptedAmount || 0), 0);
  const closedValue = closedDeals.reduce((s, d) => s + Number(d.acceptedAmount || 0), 0);

  // Stalled deals: not updated in 14+ days
  const now = new Date();
  const stalledDeals = activeDeals.filter((d) => {
    if (!d.updatedAt) return false;
    const daysStale = (now.getTime() - new Date(d.updatedAt).getTime()) / (1000 * 60 * 60 * 24);
    return daysStale > 14;
  }).length;

  // Hot deals: accepted or in escrow
  const hotDeals = deals.filter((d) => ["accepted", "in_escrow"].includes(d.status)).length;

  // Average lead score
  const scoredLeads = leads.filter((l) => l.score != null);
  const avgScore = scoredLeads.length > 0
    ? Math.round(scoredLeads.reduce((s, l) => s + (l.score ?? 0), 0) / scoredLeads.length)
    : null;

  if (leads.length === 0 && deals.length === 0) return null;

  return (
    <div className="space-y-3" data-testid="pipeline-intelligence-header">
      {/* Funnel visualization */}
      <Card className="border-primary/10 bg-card">
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-primary" aria-hidden="true" />
              <span className="font-semibold text-sm">Pipeline funnel</span>
            </div>
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span><span className="tabular-nums">{totalLeads}</span> active leads</span>
              {totalPipelineValue > 0 && (
                <span className="text-primary font-medium tabular-nums">
                  {dollarsCompact(totalPipelineValue * 100)} pipeline
                </span>
              )}
            </div>
          </div>

          <ConversionFunnel
            stages={stageCounts.map<FunnelStage>((s) => ({
              key: s.key,
              label: s.label,
              count: s.count,
              color: s.color,
            }))}
          />
        </CardContent>
      </Card>

      {/* Velocity metrics — semantic --acr-* tones so all five themes
          re-skin automatically. brand=hot, warn=stalled, accent=value,
          pos=closed, brand-soft=quality */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2" role="group" aria-label="Pipeline velocity metrics">
        {hotDeals > 0 && (
          <div className="flex items-center gap-2 rounded-card border border-[color:var(--acr-brand)]/30 bg-acr-brand-soft px-3 py-2">
            <Flame className="w-4 h-4 text-acr-brand shrink-0" aria-hidden="true" />
            <div>
              <p className="text-xs font-semibold tabular-nums">{hotDeals} hot</p>
              <p className="text-micro text-muted-foreground">accepted / in escrow</p>
            </div>
          </div>
        )}
        {stalledDeals > 0 && (
          <div className="flex items-center gap-2 rounded-card border border-[color:var(--acr-warn)]/30 bg-acr-warn-soft px-3 py-2">
            <AlertTriangle className="w-4 h-4 text-acr-warn shrink-0" aria-hidden="true" />
            <div>
              <p className="text-xs font-semibold tabular-nums">{stalledDeals} stalled</p>
              <p className="text-micro text-muted-foreground">14+ days idle</p>
            </div>
          </div>
        )}
        {totalPipelineValue > 0 && (
          <div className="flex items-center gap-2 rounded-card border border-acr-line bg-acr-surface-2 px-3 py-2">
            <DollarSign className="w-4 h-4 text-acr-accent shrink-0" aria-hidden="true" />
            <div>
              <p className="text-xs font-semibold tabular-nums">
                {dollarsCompact(totalPipelineValue * 100)}
              </p>
              <p className="text-micro text-muted-foreground">in pipeline</p>
            </div>
          </div>
        )}
        {avgScore !== null && (
          <div className="flex items-center gap-2 rounded-card border border-[color:var(--acr-brand)]/20 bg-acr-brand-soft px-3 py-2">
            <TrendingUp className="w-4 h-4 text-acr-brand shrink-0" aria-hidden="true" />
            <div>
              <p className="text-xs font-semibold tabular-nums">Score {avgScore}</p>
              <p className="text-micro text-muted-foreground">avg lead quality</p>
            </div>
          </div>
        )}
        {closedValue > 0 && (
          <div className="flex items-center gap-2 rounded-card border border-[color:var(--acr-pos)]/30 bg-acr-pos-soft px-3 py-2">
            <TrendingUp className="w-4 h-4 text-acr-pos shrink-0" aria-hidden="true" />
            <div>
              <p className="text-xs font-semibold tabular-nums">
                {dollarsCompact(closedValue * 100)}
              </p>
              <p className="text-micro text-muted-foreground">
                <span className="tabular-nums">{closedDeals.length}</span> closed
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function PipelinePage() {
  useDocumentTitle("Pipeline — AcreOS");
  // Persona-aware tab labels — switches to "Note sellers / Subject
  // properties / Note acquisitions / etc" when persona ≠ land_investor.
  const leadsLabel = useTerm("entity.lead.plural");
  const propertiesLabel = useTerm("entity.property.plural");
  const dealsLabel = useTerm("entity.deal.plural");
  const [activeTab, setActiveTab] = useState<TabValue>(getTabFromHash);

  const {
    data: leads = [],
    isError: leadsError,
    error: leadsErrorObj,
    refetch: refetchLeads,
    isRefetching: leadsRefetching,
  } = useQuery<Lead[]>({
    queryKey: ["/api/leads"],
    queryFn: () => fetchJsonArray<Lead>("/api/leads"),
    staleTime: 2 * 60 * 1000,
  });

  const { data: deals = [] } = useQuery<Deal[]>({
    queryKey: ["/api/deals"],
    queryFn: () => fetchJsonArray<Deal>("/api/deals"),
    staleTime: 2 * 60 * 1000,
  });

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

  // Derive tab badge counts
  const activeLeads = leads.filter((l) => !["closed", "dead"].includes(l.status)).length;
  const activeDealsCount = deals.filter((d) => !["closed", "cancelled", "dead"].includes(d.status)).length;

  // Homestead editorial pipeline summary (prototype: acreos/pages-tier1.jsx
  // Pipeline header — "{n} active deals · {value} in flight")
  const totalActiveDeals = activeDealsCount;

  // The board is built entirely from /api/leads (+ /api/deals). If the
  // primary leads fetch fails, the `= []` default would otherwise paint a
  // silent empty pipeline indistinguishable from "no leads yet" — surface
  // the failure with a retry instead.
  if (leadsError) {
    return (
      <PageShell>
        <div className="acr-cc-hero">
          <div>
            <div className="acr-eyebrow">Pipeline</div>
            <h1 className="acr-cc-greeting" data-testid="text-pipeline-title">
              Your deal machine.
            </h1>
          </div>
        </div>
        <QueryErrorState
          error={leadsErrorObj instanceof Error ? leadsErrorObj : null}
          onRetry={() => refetchLeads()}
          isRetrying={leadsRefetching}
          compact
          title="Couldn't load your pipeline"
          description="We hit a snag loading your leads and deals. Your data is safe — try again."
          testId="pipeline-query-error"
        />
      </PageShell>
    );
  }

  return (
    <PageShell>
      <div className="acr-cc-hero">
        <div>
          <div className="acr-eyebrow">Pipeline</div>
          <h1 className="acr-cc-greeting" data-testid="text-pipeline-title">
            {totalActiveDeals > 0 ? (
              <>
                {plural(totalActiveDeals, "active deal")}
                <span className="acr-cc-greeting-soft">
                  {" "}across leads, properties, and outreach.
                </span>
              </>
            ) : (
              <>
                Your deal machine.
                <span className="acr-cc-greeting-soft">
                  {" "}Bring in your first lead to get going.
                </span>
              </>
            )}
          </h1>
        </div>
      </div>

      {/* Pipeline intelligence header (funnel + velocity) */}
      <PipelineIntelligenceHeader leads={leads} deals={deals} />

      <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-6" data-testid="tabs-pipeline">
        <TabsList className="w-full sm:w-auto overflow-x-auto flex-nowrap" data-testid="tabs-list-pipeline">
          <TabsTrigger value="board" className="flex items-center gap-2 min-w-max" data-testid="tab-board">
            <GitBranch className="h-4 w-4" aria-hidden="true" />
            <span>Board</span>
            {activeDealsCount > 0 && (
              <Badge variant="secondary" className="text-micro px-1.5 py-0 ml-0.5 tabular-nums">{activeDealsCount}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="leads" className="flex items-center gap-2 min-w-max" data-testid="tab-leads">
            <Users className="h-4 w-4" aria-hidden="true" />
            <span>{leadsLabel}</span>
            {activeLeads > 0 && (
              <Badge variant="secondary" className="text-micro px-1.5 py-0 ml-0.5 tabular-nums">{activeLeads}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="properties" className="flex items-center gap-2 min-w-max" data-testid="tab-properties">
            <Map className="h-4 w-4" aria-hidden="true" />
            <span>{propertiesLabel}</span>
          </TabsTrigger>
          <TabsTrigger value="deals" className="flex items-center gap-2 min-w-max" data-testid="tab-deals">
            <Briefcase className="h-4 w-4" aria-hidden="true" />
            <span>{dealsLabel}</span>
          </TabsTrigger>
          <TabsTrigger value="outreach" className="flex items-center gap-2 min-w-max" data-testid="tab-outreach">
            <Mail className="h-4 w-4" aria-hidden="true" />
            <span>Outreach</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="board" data-testid="tab-content-board">
          <Suspense fallback={<TabFallback />}>
            {/* embedded — this PageShell already provides the app chrome;
                without it each tab page nested a second sidebar/topbar and a
                duplicate id="main-content" (T0-9). */}
            <DealsPage embedded />
          </Suspense>
        </TabsContent>

        <TabsContent value="leads" data-testid="tab-content-leads">
          <Suspense fallback={<TabFallback />}>
            <LeadsPage embedded />
          </Suspense>
        </TabsContent>

        <TabsContent value="properties" data-testid="tab-content-properties">
          <Suspense fallback={<TabFallback />}>
            <PropertiesPage embedded />
          </Suspense>
        </TabsContent>

        <TabsContent value="deals" data-testid="tab-content-deals">
          <Suspense fallback={<TabFallback />}>
            <DealsPage embedded />
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
