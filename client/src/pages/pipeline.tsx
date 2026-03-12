import { useEffect, useState, lazy, Suspense } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageShell } from "@/components/page-shell";
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

const FUNNEL_STAGES = [
  { key: "new",         label: "New",        color: "#94a3b8", statuses: ["new"] },
  { key: "contacted",   label: "Contacted",  color: "#f59e0b", statuses: ["mailed", "responded", "interested"] },
  { key: "qualifying",  label: "Qualifying", color: "#f97316", statuses: ["qualified", "negotiating"] },
  { key: "accepted",    label: "Accepted",   color: "#3b82f6", statuses: ["accepted"] },
  { key: "closed",      label: "Closed",     color: "#22c55e", statuses: ["closed"] },
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
              <TrendingUp className="w-4 h-4 text-primary" />
              <span className="font-semibold text-sm">Pipeline Funnel</span>
            </div>
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span>{totalLeads} active leads</span>
              {totalPipelineValue > 0 && (
                <span className="text-primary font-medium">
                  ${totalPipelineValue >= 1_000_000
                    ? `${(totalPipelineValue / 1_000_000).toFixed(1)}M`
                    : `${(totalPipelineValue / 1000).toFixed(0)}K`} pipeline
                </span>
              )}
            </div>
          </div>

          {/* Horizontal funnel bars */}
          <div className="flex items-stretch gap-0.5 h-10">
            {stageCounts.map((stage, idx) => {
              const widthPct = totalLeads > 0
                ? Math.max(8, (stage.count / (totalLeads || 1)) * 100)
                : 20;
              const convRate = idx > 0 && stageCounts[idx - 1].count > 0
                ? Math.round((stage.count / stageCounts[idx - 1].count) * 100)
                : null;
              return (
                <Tooltip key={stage.key}>
                  <TooltipTrigger asChild>
                    <div
                      className="flex items-center justify-center rounded-sm cursor-default transition-all duration-500 relative group"
                      style={{
                        width: `${widthPct}%`,
                        backgroundColor: stage.color,
                        opacity: stage.count === 0 ? 0.25 : 1,
                      }}
                    >
                      <span className="text-white text-[10px] font-bold truncate px-1">
                        {stage.count > 0 ? stage.count : ""}
                      </span>
                      {idx < stageCounts.length - 1 && (
                        <ChevronRight className="absolute -right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground z-10" />
                      )}
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="text-xs">
                    <div className="font-semibold">{stage.label}</div>
                    <div>{stage.count} leads</div>
                    {convRate !== null && (
                      <div className="text-muted-foreground">{convRate}% conv from prev</div>
                    )}
                  </TooltipContent>
                </Tooltip>
              );
            })}
          </div>

          {/* Stage labels */}
          <div className="flex items-center mt-1.5 gap-4 flex-wrap">
            {stageCounts.map((stage) => (
              <div key={stage.key} className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: stage.color }} />
                <span className="text-[10px] text-muted-foreground">{stage.label}</span>
                <span className="text-[10px] font-semibold">{stage.count}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Velocity metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {hotDeals > 0 && (
          <div className="flex items-center gap-2 rounded-lg border border-orange-200 bg-orange-50 dark:border-orange-800 dark:bg-orange-900/20 px-3 py-2">
            <Flame className="w-4 h-4 text-orange-500 shrink-0" />
            <div>
              <p className="text-xs font-semibold">{hotDeals} Hot</p>
              <p className="text-[10px] text-muted-foreground">accepted/escrow</p>
            </div>
          </div>
        )}
        {stalledDeals > 0 && (
          <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-900/20 px-3 py-2">
            <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
            <div>
              <p className="text-xs font-semibold">{stalledDeals} Stalled</p>
              <p className="text-[10px] text-muted-foreground">14+ days idle</p>
            </div>
          </div>
        )}
        {totalPipelineValue > 0 && (
          <div className="flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-900/20 px-3 py-2">
            <DollarSign className="w-4 h-4 text-blue-500 shrink-0" />
            <div>
              <p className="text-xs font-semibold">
                ${totalPipelineValue >= 1_000_000
                  ? `${(totalPipelineValue / 1_000_000).toFixed(1)}M`
                  : `${(totalPipelineValue / 1000).toFixed(0)}K`}
              </p>
              <p className="text-[10px] text-muted-foreground">in pipeline</p>
            </div>
          </div>
        )}
        {avgScore !== null && (
          <div className="flex items-center gap-2 rounded-lg border border-violet-200 bg-violet-50 dark:border-violet-800 dark:bg-violet-900/20 px-3 py-2">
            <TrendingUp className="w-4 h-4 text-violet-500 shrink-0" />
            <div>
              <p className="text-xs font-semibold">Score {avgScore}</p>
              <p className="text-[10px] text-muted-foreground">avg lead quality</p>
            </div>
          </div>
        )}
        {closedValue > 0 && (
          <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-900/20 px-3 py-2">
            <TrendingUp className="w-4 h-4 text-emerald-500 shrink-0" />
            <div>
              <p className="text-xs font-semibold">
                ${closedValue >= 1_000_000
                  ? `${(closedValue / 1_000_000).toFixed(1)}M`
                  : `${(closedValue / 1000).toFixed(0)}K`}
              </p>
              <p className="text-[10px] text-muted-foreground">{closedDeals.length} closed</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function PipelinePage() {
  const [activeTab, setActiveTab] = useState<TabValue>(getTabFromHash);

  const { data: leads = [] } = useQuery<Lead[]>({
    queryKey: ["/api/leads"],
    staleTime: 2 * 60 * 1000,
  });

  const { data: deals = [] } = useQuery<Deal[]>({
    queryKey: ["/api/deals"],
    queryFn: () => fetch("/api/deals").then((r) => r.json()),
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

  return (
    <PageShell>
      <div>
        <h1 className="text-2xl md:text-3xl font-bold" data-testid="text-pipeline-title">
          Pipeline
        </h1>
        <p className="text-muted-foreground text-sm md:text-base">
          Your complete deal machine — leads, properties, deals, and outreach.
        </p>
      </div>

      {/* Pipeline intelligence header (funnel + velocity) */}
      <PipelineIntelligenceHeader leads={leads} deals={deals} />

      <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-6" data-testid="tabs-pipeline">
        <TabsList className="w-full sm:w-auto overflow-x-auto flex-nowrap" data-testid="tabs-list-pipeline">
          <TabsTrigger value="board" className="flex items-center gap-2 min-w-max" data-testid="tab-board">
            <GitBranch className="h-4 w-4" />
            <span>Board</span>
            {activeDealsCount > 0 && (
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0 ml-0.5">{activeDealsCount}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="leads" className="flex items-center gap-2 min-w-max" data-testid="tab-leads">
            <Users className="h-4 w-4" />
            <span>Leads</span>
            {activeLeads > 0 && (
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0 ml-0.5">{activeLeads}</Badge>
            )}
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
