import { useEffect, useState, lazy, Suspense } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageShell } from "@/components/page-shell";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  MessageSquare,
  Activity,
  Bot,
  Zap,
  Sparkles,
  X,
  AlertCircle,
  Clock,
  Phone,
  DollarSign,
  TrendingUp,
  ArrowRight,
  CheckCircle2,
  Flame,
} from "lucide-react";
import CommandCenterPage from "@/pages/command-center";

const ActivityPage = lazy(() => import("@/pages/activity"));
const AutomationPage = lazy(() => import("@/pages/automation"));

type TabValue = "insights" | "chat" | "activity" | "agents" | "automation";

function getTabFromHash(): TabValue {
  const hash = window.location.hash.replace("#", "") as TabValue;
  if (["insights", "chat", "activity", "agents", "automation"].includes(hash)) {
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

// ─── Types ────────────────────────────────────────────────────────────────────

type Observation = {
  id: string | number;
  severity: "high" | "medium" | "low" | "info";
  title: string;
  description: string;
};

type StaleLead = {
  id: number;
  firstName: string;
  lastName: string;
  daysSinceContact: number;
};

type ExpiringOffer = {
  id: number;
  title: string;
  offerExpiresAt: string | null;
  leadName: string;
};

type MotivatedCaller = {
  id: number;
  name: string;
  phone: string | null;
  status: string;
  notes: string | null;
  tags: string[] | null;
};

type InsightsData = {
  observations: Observation[];
  staleLeads: StaleLead[];
  expiringOffers: ExpiringOffer[];
  motivatedCallers: MotivatedCaller[];
  generatedAt: string;
};

// ─── Severity helpers ─────────────────────────────────────────────────────────

const SEVERITY_BORDER: Record<string, string> = {
  high: "border-red-400",
  medium: "border-amber-400",
  low: "border-blue-400",
  info: "border-gray-300",
};

const SEVERITY_BADGE: Record<
  string,
  "destructive" | "default" | "secondary" | "outline"
> = {
  high: "destructive",
  medium: "default",
  low: "secondary",
  info: "outline",
};

// ─── Greeting Banner ──────────────────────────────────────────────────────────

const GREETING_DISMISSED_KEY = "atlas_greeting_dismissed";

function GreetingBanner() {
  const [dismissed, setDismissed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(GREETING_DISMISSED_KEY) === "true";
    } catch {
      return false;
    }
  });

  const { data } = useQuery<{ message: string | null; isFirstSession: boolean }>({
    queryKey: ["/api/atlas/greeting"],
    enabled: !dismissed,
  });

  if (dismissed || !data?.isFirstSession || !data.message) {
    return null;
  }

  function handleDismiss() {
    try {
      localStorage.setItem(GREETING_DISMISSED_KEY, "true");
    } catch {
      // ignore
    }
    setDismissed(true);
  }

  return (
    <div className="relative flex items-start gap-3 rounded-lg border border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/40 p-4 mb-4">
      <Sparkles className="h-5 w-5 text-blue-500 mt-0.5 shrink-0" />
      <p className="text-sm text-blue-800 dark:text-blue-200 flex-1">{data.message}</p>
      <button
        onClick={handleDismiss}
        aria-label="Dismiss greeting"
        className="shrink-0 text-blue-400 hover:text-blue-600 dark:hover:text-blue-200 transition-colors"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

// ─── Revenue impact estimator ─────────────────────────────────────────────────

function revenueImpact(severity: string, type?: string): string | null {
  if (severity === "high") return type?.includes("offer") ? "+$25K–$80K" : "+$5K–$20K potential";
  if (severity === "medium") return "+$2K–$8K potential";
  return null;
}

// ─── Insights Tab Content ─────────────────────────────────────────────────────

function InsightsTabContent() {
  const { data, isLoading } = useQuery<InsightsData>({
    queryKey: ["/api/atlas/insights"],
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="space-y-3">
          <Skeleton className="h-5 w-40" />
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-20 w-full rounded-lg" />
          ))}
        </div>
        <div className="space-y-3">
          <Skeleton className="h-5 w-32" />
          {[1, 2].map((i) => (
            <Skeleton key={i} className="h-14 w-full rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  const observations = data?.observations ?? [];
  const staleLeads = data?.staleLeads ?? [];
  const expiringOffers = data?.expiringOffers ?? [];
  const motivatedCallers = data?.motivatedCallers ?? [];

  const totalItems = observations.length + staleLeads.length + expiringOffers.length + motivatedCallers.length;
  const highPriorityCount = observations.filter((o) => o.severity === "high").length + expiringOffers.length;

  if (totalItems === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center space-y-2">
        <div className="w-14 h-14 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center mb-2">
          <CheckCircle2 className="h-7 w-7 text-emerald-600" />
        </div>
        <p className="text-base font-medium">All clear — Atlas is keeping watch.</p>
        <p className="text-sm text-muted-foreground max-w-sm">
          No urgent actions. Your pipeline is in good shape. Check back after your next campaign sends.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary banner */}
      {totalItems > 0 && (
        <div className="flex items-center gap-3 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3">
          <Sparkles className="h-5 w-5 text-primary shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-semibold">
              {totalItems} item{totalItems !== 1 ? "s" : ""} need{totalItems === 1 ? "s" : ""} your attention
              {highPriorityCount > 0 && ` · ${highPriorityCount} high-priority`}
            </p>
            <p className="text-xs text-muted-foreground">
              Atlas has detected these opportunities and risks in your pipeline.
            </p>
          </div>
          {highPriorityCount > 0 && (
            <Badge variant="destructive" className="text-xs shrink-0">{highPriorityCount} urgent</Badge>
          )}
        </div>
      )}

      {/* Observations with revenue impact */}
      {observations.length > 0 && (
        <section>
          <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3 flex items-center gap-2">
            <Flame className="w-3.5 h-3.5 text-primary" />
            Atlas Noticed
          </h2>
          <div className="space-y-2">
            {observations.map((obs) => {
              const impact = revenueImpact(obs.severity, obs.title);
              return (
                <div
                  key={obs.id}
                  className={`rounded-lg border-l-4 border border-border ${SEVERITY_BORDER[obs.severity] ?? SEVERITY_BORDER.info} bg-card p-4`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <Badge variant={SEVERITY_BADGE[obs.severity] ?? "outline"} className="capitalize text-xs">
                          {obs.severity}
                        </Badge>
                        {impact && (
                          <Badge variant="outline" className="text-xs text-emerald-700 border-emerald-300 bg-emerald-50 dark:bg-emerald-900/20">
                            <DollarSign className="w-2.5 h-2.5 mr-0.5" />
                            {impact}
                          </Badge>
                        )}
                        <span className="text-sm font-medium">{obs.title}</span>
                      </div>
                      <p className="text-sm text-muted-foreground">{obs.description}</p>
                    </div>
                    <Button size="sm" variant="outline" className="shrink-0 h-7 text-xs gap-1" asChild>
                      <a href="/pipeline">
                        Act <ArrowRight className="w-3 h-3" />
                      </a>
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Stale Leads */}
      {staleLeads.length > 0 && (
        <section>
          <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3 flex items-center gap-2">
            <Clock className="w-3.5 h-3.5 text-amber-500" />
            Stale Leads
            <Badge variant="outline" className="text-[10px]">{staleLeads.length}</Badge>
          </h2>
          <div className="space-y-2">
            {staleLeads.map((lead) => (
              <div
                key={lead.id}
                className="flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-900/10 px-4 py-3"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className={`w-2 h-2 rounded-full shrink-0 ${lead.daysSinceContact >= 30 ? "bg-red-500" : "bg-amber-500"}`} />
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">
                      {lead.firstName} {lead.lastName}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {lead.daysSinceContact >= 999
                        ? "Never contacted"
                        : `${lead.daysSinceContact}d since contact`}
                      {lead.daysSinceContact >= 30 && (
                        <span className="ml-1 text-red-500 font-medium">· at risk of going cold</span>
                      )}
                    </p>
                  </div>
                </div>
                <div className="flex gap-1.5 shrink-0">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    onClick={() => (window.location.href = `/leads/${lead.id}`)}
                  >
                    Follow Up
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Expiring Offers */}
      {expiringOffers.length > 0 && (
        <section>
          <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3 flex items-center gap-2">
            <AlertCircle className="w-3.5 h-3.5 text-red-500" />
            Expiring Offers
            <Badge variant="destructive" className="text-[10px]">{expiringOffers.length}</Badge>
          </h2>
          <div className="space-y-2">
            {expiringOffers.map((offer) => {
              const daysLeft = offer.offerExpiresAt
                ? Math.ceil((new Date(offer.offerExpiresAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
                : null;
              return (
                <div
                  key={offer.id}
                  className="flex items-center justify-between rounded-lg border border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-900/10 px-4 py-3"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <AlertCircle className="h-4 w-4 text-red-500 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{offer.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {offer.leadName && <span className="mr-1">for {offer.leadName} ·</span>}
                        {offer.offerExpiresAt
                          ? daysLeft !== null && daysLeft <= 0
                            ? "Expired"
                            : daysLeft === 1
                            ? "Expires tomorrow"
                            : `${daysLeft} days left`
                          : "Expiring soon"}
                      </p>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="destructive"
                    className="h-7 text-xs shrink-0"
                    onClick={() => (window.location.href = `/deals/${offer.id}`)}
                  >
                    Review Now
                  </Button>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Motivated Callers */}
      {motivatedCallers.length > 0 && (
        <section>
          <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3 flex items-center gap-2">
            <Phone className="w-3.5 h-3.5 text-emerald-500" />
            Motivated Callers
            <Badge variant="outline" className="text-[10px] text-emerald-700 border-emerald-300">{motivatedCallers.length}</Badge>
          </h2>
          <div className="space-y-2">
            {motivatedCallers.map((caller) => (
              <div
                key={caller.id}
                className="flex items-center justify-between rounded-lg border border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-900/10 px-4 py-3"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-8 h-8 rounded-full bg-emerald-200 dark:bg-emerald-800 flex items-center justify-center shrink-0">
                    <span className="text-xs font-bold text-emerald-800 dark:text-emerald-200">
                      {caller.name?.charAt(0)?.toUpperCase() ?? "?"}
                    </span>
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{caller.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {caller.phone ?? "No phone"}{caller.notes && ` · ${caller.notes}`}
                    </p>
                  </div>
                </div>
                <div className="flex gap-1.5 shrink-0">
                  {caller.phone && (
                    <Button size="sm" variant="outline" className="h-7 text-xs gap-1" asChild>
                      <a href={`tel:${caller.phone}`}>
                        <Phone className="w-3 h-3" />
                        Call
                      </a>
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="default"
                    className="h-7 text-xs"
                    onClick={() => (window.location.href = `/leads/${caller.id}`)}
                  >
                    View
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

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

      <GreetingBanner />

      <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-6" data-testid="tabs-atlas">
        <TabsList className="w-full sm:w-auto overflow-x-auto flex-nowrap" data-testid="tabs-list-atlas">
          <TabsTrigger value="insights" className="flex items-center gap-2 min-w-max" data-testid="tab-insights">
            <Sparkles className="h-4 w-4" />
            <span>Insights</span>
          </TabsTrigger>
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

        <TabsContent value="insights" data-testid="tab-content-insights">
          <InsightsTabContent />
        </TabsContent>

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
