import React from "react";
import { PageShell } from "@/components/page-shell";
import { useTerm } from "@/hooks/use-persona";
import { GettingStartedChecklist } from "@/components/getting-started-checklist";
import { useOrganization, useDashboardStats } from "@/hooks/use-organization";
import { useAuth } from "@/hooks/use-auth";
import { useLeads } from "@/hooks/use-leads";
import { useProperties } from "@/hooks/use-properties";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Users,
  Map,
  ArrowRight,
  Sun,
  Clock,
  Target,
  Sparkles,
  RefreshCw,
} from "lucide-react";
import { format, isToday, isBefore, startOfDay, subDays } from "date-fns";
import { plural } from "@/lib/format";
import { VerticalBadge } from "@/components/ui/vertical-badge";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useToast } from "@/hooks/use-toast";
import { DecisionQueue, type DecisionItem } from "@/components/today/DecisionQueue";
import { CashStrip } from "@/components/today/CashStrip";
import { TodayActivityFeed } from "@/components/today/ActivityFeed";
import "./today.css";

interface NextBestAction {
  id: string;
  type: string;
  priority: "high" | "medium" | "low";
  title: string;
  description: string;
  actionLabel: string;
  actionUrl: string;
}

interface TodayPriority {
  id: string;
  type: string;
  priority: "high" | "medium" | "low";
  title: string;
  description: string;
  actionLabel: string;
  actionUrl: string;
  count?: number;
}

interface TodayPrioritiesData {
  priorities: TodayPriority[];
  generatedAt: string;
  meta: { unscoredLeads: number; staleFollowUps: number; lastCampaignDaysAgo: number };
}

interface DashboardIntelligence {
  actions: NextBestAction[];
}

interface Task {
  id: number;
  title: string;
  description?: string;
  priority: string;
  status: string;
  dueDate?: string;
  entityType?: string;
  entityId?: number;
}

interface SystemAlert {
  id: number;
  type: string;
  severity: string; // info | warning | critical
  title: string;
  message: string;
  status: string;
  createdAt: string;
}

interface PaxObservation {
  id: number;
  type: string;
  severity: string;
  title: string;
  description: string;
  metadata: Record<string, any> | null;
  createdAt: string | null;
}

interface PaxStaleLead {
  id: number;
  firstName: string;
  lastName: string;
  daysSinceContact: number;
}

interface PaxExpiringOffer {
  id: number;
  title: string;
  offerExpiresAt: string | null;
  leadName: string;
}

interface PaxInsights {
  observations: PaxObservation[];
  staleLeads: PaxStaleLead[];
  expiringOffers: PaxExpiringOffer[];
  generatedAt: string;
}

interface PaxSuggestion {
  id: string;
  suggestion: string;
  rationale: string;
  action: string;
  actionLabel: string;
  actionUrl: string;
  entityId?: number;
  entityType?: string;
  confidence: number;
}

interface PaxSuggestionsResponse {
  suggestions: PaxSuggestion[];
  generatedAt: string;
}

const alertHrefByType: Record<string, string> = {
  note_overdue: "/money",
  stale_leads: "/pipeline#leads",
  stuck_deals: "/pipeline#board",
  stale_avm: "/pipeline#properties",
};

const alertLinkLabelByType: Record<string, string> = {
  note_overdue: "View notes",
  stale_leads: "View leads",
  stuck_deals: "View deals",
  stale_avm: "View properties",
};

const priorityRank: Record<string, number> = { high: 0, medium: 1, low: 2 };

const LAST_VISIT_KEY = "acreos_last_visit_ts";
const WELCOME_BACK_THRESHOLD_DAYS = 7;

export default function TodayPage() {
  useDocumentTitle("Today — AcreOS");
  const propertyLabelPlural = useTerm("entity.property.plural");
  const { toast } = useToast();
  const { data: organization } = useOrganization();
  const { user } = useAuth();
  const { data: stats, isLoading: statsLoading } = useDashboardStats();
  const { data: leadsRaw = [] } = useLeads();
  const leads = Array.isArray(leadsRaw) ? leadsRaw : [];
  const { data: propertiesRaw = [] } = useProperties();
  const properties = Array.isArray(propertiesRaw) ? propertiesRaw : [];

  const { data: tasks = [], isLoading: tasksLoading } = useQuery<Task[]>({
    queryKey: ["/api/tasks"],
    staleTime: 2 * 60 * 1000,
  });
  const { data: systemAlerts = [], isLoading: alertsLoading } = useQuery<SystemAlert[]>({
    queryKey: ["/api/alerts/active"],
    staleTime: 5 * 60 * 1000,
  });

  const { data: intelligence, isLoading: intelligenceLoading } =
    useQuery<DashboardIntelligence>({
      queryKey: ["/api/dashboard/intelligence"],
      staleTime: 5 * 60 * 1000,
    });

  const { data: paxInsights, isLoading: paxLoading } =
    useQuery<PaxInsights>({
      queryKey: ["/api/pax/insights"],
      staleTime: 5 * 60 * 1000,
    });

  const { data: paxSuggestionsData, isLoading: paxSuggestionsLoading } =
    useQuery<PaxSuggestionsResponse>({
      queryKey: ["/api/pax/pax-suggestions"],
      staleTime: 5 * 60 * 1000,
    });

  const { data: allDealsRaw = [] } = useQuery<{ id: number; status: string; offerDate?: string; updatedAt?: string; purchasePrice?: string; offerAmount?: string }[]>({
    queryKey: ["/api/deals"],
    staleTime: 5 * 60 * 1000,
  });
  const allDeals = Array.isArray(allDealsRaw) ? allDealsRaw : [];

  const { data: allNotesRaw = [], isLoading: notesLoading } = useQuery<{
    id: number; status: string; currentBalance: string; monthlyPayment: string;
    nextPaymentDate?: string; borrowerName?: string;
  }[]>({
    queryKey: ["/api/notes"],
    staleTime: 5 * 60 * 1000,
  });
  const allNotes = Array.isArray(allNotesRaw) ? allNotesRaw : [];

  const pendingDecisionCount = (() => {
    const nowTs = new Date();
    const stalledLeads = leads.filter((l: any) => {
      if (["closed", "dead", "converted"].includes(l.status)) return false;
      if (!l.lastContactedAt) return true;
      return new Date(l.lastContactedAt) < subDays(nowTs, 14);
    }).length;
    const waitingCounters = allDeals.filter((d) => {
      if (d.status !== "offer_sent") return false;
      if (!d.offerDate) return false;
      return new Date(d.offerDate) < subDays(nowTs, 7);
    }).length;
    const stuckDeals = allDeals.filter((d) => {
      if (["closed", "cancelled", "offer_sent"].includes(d.status)) return false;
      if (!d.updatedAt) return false;
      return new Date(d.updatedAt) < subDays(nowTs, 14);
    }).length;
    return stalledLeads + waitingCounters + stuckDeals;
  })();

  // Dismiss mutation retained for /alerts surface; no longer wired into
  // /today JSX (decision queue handles the high-level fan-out). Keeping
  // the hook means we can re-introduce inline dismiss without re-fetching.
  void useMutation({
    mutationFn: async (alertId: number) => {
      await apiRequest("DELETE", `/api/alerts/${alertId}/dismiss`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/alerts/active"] });
    },
  });

  const greeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return "Good morning";
    if (hour < 17) return "Good afternoon";
    return "Good evening";
  };

  const todayActions = tasks.filter((t) => {
    if (t.status === "completed" || t.status === "done") return false;
    if (!t.dueDate) return false;
    const due = new Date(t.dueDate);
    return isToday(due) || isBefore(due, startOfDay(new Date()));
  });

  const { data: todayPriorities, isLoading: prioritiesLoading } =
    useQuery<TodayPrioritiesData>({
      queryKey: ["/api/dashboard/today-priorities"],
      staleTime: 5 * 60 * 1000,
    });

  // ── Decision queue merge ───────────────────────────────────────────────
  // Pulse, Start-here, Today's actions, Pax suggests, Pax noticed,
  // Portfolio alerts, AI action queue → one prioritized list. Provenance
  // pill (source) tells the user which surface noticed each item.
  const decisionItems: DecisionItem[] = React.useMemo(() => {
    const items: DecisionItem[] = [];

    // Pax priorities (AI-prioritized 1/2/3) — top rank.
    (todayPriorities?.priorities ?? []).forEach((p, idx) => {
      items.push({
        id: `priority-${p.id}`,
        source: "pax-priority",
        priority: p.priority,
        title: p.title,
        description: p.description,
        actionLabel: p.actionLabel,
        actionUrl: p.actionUrl,
        rank: idx, // already pre-sorted by the backend
      });
    });

    // Today's actions (tasks due today/overdue).
    todayActions.forEach((t) => {
      const isOverdue = t.dueDate && isBefore(new Date(t.dueDate), startOfDay(new Date()));
      items.push({
        id: `task-${t.id}`,
        source: "ai-queue",
        priority: (t.priority as "high" | "medium" | "low") ?? "medium",
        title: t.title,
        description: t.dueDate
          ? `${isOverdue ? "Overdue · " : ""}Due ${format(new Date(t.dueDate), "MMM d")}`
          : (t.description ?? ""),
        actionLabel: "Open task",
        actionUrl: "/pipeline",
        rank: 100 + (isOverdue ? 0 : 10) + (priorityRank[t.priority] ?? 1),
      });
    });

    // Portfolio alerts.
    systemAlerts.forEach((a) => {
      const sev: "high" | "medium" | "low" =
        a.severity === "critical" ? "high" : a.severity === "warning" ? "medium" : "low";
      items.push({
        id: `alert-${a.id}`,
        source: "portfolio-alert",
        priority: sev,
        title: a.title,
        description: a.message,
        actionLabel: alertLinkLabelByType[a.type] ?? "View",
        actionUrl: alertHrefByType[a.type] ?? "/",
        rank: 200 + priorityRank[sev],
      });
    });

    // Pax noticed — observations, stale leads, expiring offers.
    (paxInsights?.observations ?? []).forEach((obs) => {
      const sev: "high" | "medium" | "low" =
        obs.severity === "high" ? "high" : obs.severity === "medium" ? "medium" : "low";
      items.push({
        id: `obs-${obs.id}`,
        source: "pax-noticed",
        priority: sev,
        title: obs.title,
        description: obs.description,
        actionLabel: "Review",
        actionUrl: "/pax#insights",
        rank: 300 + priorityRank[sev],
      });
    });
    (paxInsights?.staleLeads ?? []).forEach((lead) => {
      items.push({
        id: `stale-lead-${lead.id}`,
        source: "pax-noticed",
        priority: "medium",
        title: `${lead.firstName} ${lead.lastName} hasn't been contacted`,
        description: lead.daysSinceContact >= 999
          ? "Never contacted"
          : `${lead.daysSinceContact} days since last contact`,
        actionLabel: "Follow up",
        actionUrl: "/leads",
        rank: 310,
      });
    });
    (paxInsights?.expiringOffers ?? []).forEach((offer) => {
      items.push({
        id: `expiring-offer-${offer.id}`,
        source: "pax-noticed",
        priority: "high",
        title: offer.title,
        description: `Offer expires ${offer.offerExpiresAt ? format(new Date(offer.offerExpiresAt), "MMM d, h:mm a") : "soon"}`,
        actionLabel: "View deal",
        actionUrl: "/deals",
        rank: 250,
      });
    });

    // Pax suggests.
    (paxSuggestionsData?.suggestions ?? []).forEach((s) => {
      items.push({
        id: `suggest-${s.id}`,
        source: "pax-suggests",
        priority: s.confidence >= 0.85 ? "high" : s.confidence >= 0.7 ? "medium" : "low",
        title: s.suggestion,
        description: s.rationale,
        actionLabel: s.actionLabel,
        actionUrl: s.actionUrl,
        rank: 400 + (1 - s.confidence) * 10,
        confidence: s.confidence,
      });
    });

    // AI action queue (dashboard intelligence).
    (intelligence?.actions ?? []).slice(0, 5).forEach((a) => {
      items.push({
        id: `ai-${a.id}`,
        source: "ai-queue",
        priority: a.priority,
        title: a.title,
        description: a.description,
        actionLabel: a.actionLabel,
        actionUrl: a.actionUrl,
        rank: 500 + priorityRank[a.priority],
      });
    });

    return items;
  }, [
    todayPriorities,
    todayActions,
    systemAlerts,
    paxInsights,
    paxSuggestionsData,
    intelligence,
  ]);

  const decisionQueueLoading =
    prioritiesLoading || tasksLoading || alertsLoading ||
    paxLoading || paxSuggestionsLoading || intelligenceLoading;

  // ── Cash strip aggregates ──────────────────────────────────────────────
  const activeDeals = allDeals.filter(
    (d) => !["closed", "cancelled"].includes(d.status)
  );
  const pipelineValue = activeDeals.reduce(
    (sum, d: any) => sum + (parseFloat(d.purchasePrice || d.offerAmount || "0")),
    0
  );

  const cashAggregates = React.useMemo(() => {
    const now = new Date();
    const activeNotes = allNotes.filter(
      (n) => n.status === "active" || n.status === "late" || n.status === "delinquent"
    );
    const lateCount = allNotes.filter(
      (n) => n.status === "late" || n.status === "delinquent"
    ).length;
    const within = (days: number) =>
      activeNotes.filter((n) => {
        if (!n.nextPaymentDate) return false;
        const diff = (new Date(n.nextPaymentDate).getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
        return diff >= 0 && diff <= days;
      });
    const sum = (arr: typeof activeNotes) =>
      arr.reduce((s, n) => s + parseFloat(n.monthlyPayment || "0"), 0);
    return {
      projected30: sum(within(30)),
      projected90: sum(within(90)),
      lateCount,
    };
  }, [allNotes]);

  // ── Empty-state / welcome-back state machine (single pathway) ──────────
  const hasAnyData =
    (stats?.activeLeads ?? leads.length) > 0 ||
    (stats?.activeProperties ?? properties.length) > 0 ||
    allDeals.length > 0;

  const [welcomeBackDismissed, setWelcomeBackDismissed] = React.useState(false);
  const lastVisitTs = React.useMemo(() => {
    try {
      const stored = localStorage.getItem(LAST_VISIT_KEY);
      return stored ? parseInt(stored, 10) : null;
    } catch {
      return null;
    }
  }, []);
  const daysSinceLastVisit = lastVisitTs
    ? Math.floor((Date.now() - lastVisitTs) / (1000 * 60 * 60 * 24))
    : null;
  const showWelcomeBack =
    hasAnyData &&
    !welcomeBackDismissed &&
    daysSinceLastVisit !== null &&
    daysSinceLastVisit >= WELCOME_BACK_THRESHOLD_DAYS;

  React.useEffect(() => {
    try {
      localStorage.setItem(LAST_VISIT_KEY, Date.now().toString());
    } catch {
      // ignore
    }
  }, []);

  const dismissWelcomeBack = React.useCallback(() => {
    setWelcomeBackDismissed(true);
    try {
      localStorage.setItem(LAST_VISIT_KEY, Date.now().toString());
    } catch {
      // ignore
    }
  }, []);

  // Sample-data CTA: seed a realistic dataset directly from /today's
  // empty state without forcing the user into the onboarding wizard.
  const loadSampleDataMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/onboarding/sample-data", {});
      if (!res.ok) throw new Error("Failed to load sample data");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries();
      toast({
        title: "Sample data loaded",
        description: "Take a look around — this is a realistic snapshot you can safely explore.",
      });
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: "Couldn't load sample data",
        description: `${error?.message ?? "Try again in a moment"} — your workspace is unchanged.`,
      });
    },
  });

  const showEmptyState = !statsLoading && !hasAnyData && !showWelcomeBack;

  return (
    <PageShell label="Today">
      {/* ── Section 1: Hero greeting ─────────────────────────────────── */}
      <div className="acr-cc-hero">
        <div>
          <div className="acr-eyebrow flex items-center gap-2">
            <Sun className="w-3 h-3" aria-hidden="true" />
            <span className="tabular-nums">{format(new Date(), "EEEE, MMMM d")}</span>
            <VerticalBadge className="ml-1" />
          </div>
          <h1 className="acr-cc-greeting" data-testid="text-today-title">
            {greeting()}{user?.firstName ? `, ${user.firstName}` : ""}.
            {pendingDecisionCount > 0 ? (
              <span className="acr-cc-greeting-soft">
                {" "}{plural(pendingDecisionCount, "deal")} need your attention today.
              </span>
            ) : (
              <span className="acr-cc-greeting-soft">
                {" "}Here's what's on the horizon.
              </span>
            )}
          </h1>
          {pendingDecisionCount > 0 && (
            <Link
              href="/decision-queue"
              className="inline-flex items-center gap-2 mt-3 md:mt-2 px-3 py-1.5 md:px-2.5 md:py-1 rounded-full bg-acr-neg-soft border border-[color:var(--acr-neg)]/30 text-sm md:text-xs text-acr-neg hover:opacity-80 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={`${plural(pendingDecisionCount, "pending decision")} — review now`}
            >
              <Clock className="w-4 h-4 md:w-3.5 md:h-3.5" aria-hidden="true" />
              <span className="font-medium">Review now</span>
              <Badge variant="destructive" className="text-xs px-1.5 py-0 tabular-nums">{pendingDecisionCount}</Badge>
              <ArrowRight className="w-3.5 h-3.5 md:w-3 md:h-3" aria-hidden="true" />
            </Link>
          )}
        </div>
      </div>

      {/* ── Empty-state: single pathway ──────────────────────────────── */}
      {showEmptyState && (
        <div className="space-y-4">
          <Card className="border-primary/20 bg-gradient-to-br from-primary/5 to-accent/5">
            <CardContent className="p-6 md:p-5 text-center space-y-3 md:space-y-2.5">
              <div className="inline-flex items-center justify-center w-12 h-12 md:w-10 md:h-10 rounded-full bg-primary/10">
                <Target className="w-6 h-6 md:w-5 md:h-5 text-primary" aria-hidden="true" />
              </div>
              <h2 className="text-xl md:text-lg font-bold md:font-semibold">Ready to find your first deal?</h2>
              <p className="text-muted-foreground md:text-sm max-w-md mx-auto leading-relaxed">
                Add a parcel, import a lead list, or explore with a realistic sample dataset — your workspace is yours to shape.
              </p>
              <div className="flex flex-wrap gap-2 justify-center pt-2">
                <Button asChild size="sm" className="min-h-11 sm:min-h-9">
                  <Link href="/properties">
                    <Map className="w-4 h-4 mr-1.5" aria-hidden="true" />
                    Add your first parcel
                  </Link>
                </Button>
                <Button asChild size="sm" variant="outline" className="min-h-11 sm:min-h-9">
                  <Link href="/leads">
                    <Users className="w-4 h-4 mr-1.5" aria-hidden="true" />
                    Import leads
                  </Link>
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="min-h-11 sm:min-h-9"
                  onClick={() => loadSampleDataMutation.mutate()}
                  disabled={loadSampleDataMutation.isPending}
                  data-testid="button-try-sample-data"
                >
                  <Sparkles className="w-4 h-4 mr-1.5" aria-hidden="true" />
                  {loadSampleDataMutation.isPending ? "Loading…" : "Try with sample data"}
                </Button>
              </div>
            </CardContent>
          </Card>
          <GettingStartedChecklist />
        </div>
      )}

      {/* ── Welcome back (returning user, single card) ───────────────── */}
      {showWelcomeBack && (
        <Card className="rounded-card border-[color:var(--acr-brand)]/30 bg-acr-brand-soft" data-testid="welcome-back-card">
          <CardContent className="p-5 md:p-4 flex items-start justify-between gap-4 md:gap-3">
            <div className="flex items-center gap-3 md:gap-2.5">
              <div className="p-2.5 md:p-2 rounded-card bg-acr-brand-soft shrink-0">
                <RefreshCw className="w-5 h-5 md:w-4 md:h-4 text-acr-brand" aria-hidden="true" />
              </div>
              <div>
                <h3 className="font-semibold text-base md:text-sm">
                  Welcome back{user?.firstName ? `, ${user.firstName}` : ""}.
                </h3>
                <p className="text-sm md:text-xs text-muted-foreground">
                  It's been <span className="tabular-nums">{plural(daysSinceLastVisit, "day")}</span> since you stopped by. Here's where things stand.
                </p>
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="shrink-0"
              onClick={dismissWelcomeBack}
              aria-label="Dismiss welcome back card"
            >
              Dismiss
            </Button>
          </CardContent>
        </Card>
      )}

      {/* ── Section 2: Decision queue (merged) ───────────────────────── */}
      {!showEmptyState && (
        <DecisionQueue items={decisionItems} isLoading={decisionQueueLoading} />
      )}

      {/* ── Section 3: Cash strip ────────────────────────────────────── */}
      {!showEmptyState && (
        <CashStrip
          isLoading={notesLoading}
          cashOnHand={cashAggregates.projected90}
          openDealsValue={pipelineValue}
          openDealsCount={activeDeals.length}
          pendingPayments30={cashAggregates.projected30}
          lateCount={cashAggregates.lateCount}
        />
      )}

      {/* ── Section 4: Activity feed ─────────────────────────────────── */}
      {!showEmptyState && <TodayActivityFeed />}
    </PageShell>
  );
}
