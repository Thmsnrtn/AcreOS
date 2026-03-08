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

  const allEmpty =
    observations.length === 0 &&
    staleLeads.length === 0 &&
    expiringOffers.length === 0 &&
    motivatedCallers.length === 0;

  if (allEmpty) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center space-y-2">
        <Sparkles className="h-8 w-8 text-muted-foreground mb-2" />
        <p className="text-base font-medium text-muted-foreground">
          All clear — Atlas is keeping watch.
        </p>
        <p className="text-sm text-muted-foreground max-w-sm">
          Check back after your next campaign sends.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Atlas Noticed */}
      {observations.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
            Atlas Noticed
          </h2>
          <div className="space-y-3">
            {observations.map((obs) => (
              <div
                key={obs.id}
                className={`rounded-lg border-l-4 border border-border ${SEVERITY_BORDER[obs.severity] ?? SEVERITY_BORDER.info} bg-card p-4 space-y-1`}
              >
                <div className="flex items-center gap-2">
                  <Badge variant={SEVERITY_BADGE[obs.severity] ?? "outline"} className="capitalize text-xs">
                    {obs.severity}
                  </Badge>
                  <span className="text-sm font-medium">{obs.title}</span>
                </div>
                <p className="text-sm text-muted-foreground">{obs.description}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Stale Leads */}
      {staleLeads.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
            Stale Leads
          </h2>
          <div className="space-y-2">
            {staleLeads.map((lead) => (
              <div
                key={lead.id}
                className="flex items-center justify-between rounded-lg border border-border bg-card px-4 py-3"
              >
                <div className="flex items-center gap-3">
                  <Clock className="h-4 w-4 text-amber-500 shrink-0" />
                  <div>
                    <p className="text-sm font-medium">
                      {lead.firstName} {lead.lastName}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {lead.daysSinceContact >= 999
                        ? "Never contacted"
                        : `${lead.daysSinceContact} days since last contact`}
                    </p>
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    (window.location.href = `/leads/${lead.id}`)
                  }
                >
                  Follow Up
                </Button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Expiring Offers */}
      {expiringOffers.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
            Expiring Offers
          </h2>
          <div className="space-y-2">
            {expiringOffers.map((offer) => (
              <div
                key={offer.id}
                className="flex items-center justify-between rounded-lg border border-border bg-card px-4 py-3"
              >
                <div className="flex items-center gap-3">
                  <AlertCircle className="h-4 w-4 text-red-500 shrink-0" />
                  <div>
                    <p className="text-sm font-medium">{offer.title}</p>
                    {offer.offerExpiresAt && (
                      <p className="text-xs text-muted-foreground">
                        Expires {new Date(offer.offerExpiresAt).toLocaleDateString()}
                      </p>
                    )}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    (window.location.href = `/deals/${offer.id}`)
                  }
                >
                  Review
                </Button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Motivated Callers */}
      {motivatedCallers.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
            Motivated Callers
          </h2>
          <div className="space-y-2">
            {motivatedCallers.map((caller) => (
              <div
                key={caller.id}
                className="flex items-center justify-between rounded-lg border border-border bg-card px-4 py-3"
              >
                <div className="flex items-center gap-3">
                  <Phone className="h-4 w-4 text-green-500 shrink-0" />
                  <div>
                    <p className="text-sm font-medium">{caller.name}</p>
                    {caller.phone && (
                      <p className="text-xs text-muted-foreground">{caller.phone}</p>
                    )}
                    {caller.notes && (
                      <p className="text-xs text-muted-foreground line-clamp-1">
                        {caller.notes}
                      </p>
                    )}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    (window.location.href = `/leads/${caller.id}`)
                  }
                >
                  Contact
                </Button>
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
