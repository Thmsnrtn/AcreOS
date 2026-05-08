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
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import {
  Users,
  Map,
  Banknote,
  GitBranch,
  ArrowRight,
  Sun,
  CheckCircle2,
  AlertTriangle,
  Bell,
  Calendar,
  Clock,
  X,
  Target,
  Sparkles,
  TrendingUp,
  AlertCircle,
  Activity,
  DollarSign,
  Flame,
  BarChart3,
  Zap,
  Moon,
  Bot,
  RefreshCw,
  Briefcase,
  MessageSquare,
} from "lucide-react";
import { format, isToday, isBefore, startOfDay, subDays } from "date-fns";
import { AnimatedCounter } from "@/components/ui/animated-counter";
import { plural, usd, dollarsCompact } from "@/lib/format";
import { VerticalBadge } from "@/components/ui/vertical-badge";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useToast } from "@/hooks/use-toast";
import { ClearedEmpty } from "@/components/empty-states";
import { GlossaryTerm } from "@/components/Glossary";
import { ContentReveal } from "@/components/ContentReveal";
import "./today.css";

interface GoalWithProgress {
  id: number;
  label: string;
  goalType: string;
  targetValue: string;
  periodStart: string;
  periodEnd: string;
  currentValue: number;
  progressPct: number;
  isActive: boolean;
}

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
  severity: string; // high | medium | low | info
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

// Priority → semantic --acr-* tone (Tier 1 platform pattern, applied here
// in Phase G polish on /today's carryforward).
const priorityColors: Record<string, string> = {
  high: "bg-acr-neg-soft text-acr-neg border-transparent",
  medium: "bg-acr-warn-soft text-acr-warn border-transparent",
  low: "bg-acr-brand-soft text-acr-brand border-transparent",
};


const LAST_VISIT_KEY = "acreos_last_visit_ts";
const WELCOME_BACK_THRESHOLD_DAYS = 7;

export default function TodayPage() {
  useDocumentTitle("Today — AcreOS");
  // Persona-aware labels for the entity counts. Defaults to land_investor
  // copy ("Properties") when persona is unset; switches to "Notes" /
  // "Subject properties" / etc when the user picks a different archetype.
  const propertyLabelPlural = useTerm("entity.property.plural");
  const { toast } = useToast();
  const { data: organization } = useOrganization();
  const { user } = useAuth();
  const { data: stats, isLoading: statsLoading } = useDashboardStats();
  const { data: leadsRaw = [] } = useLeads();
  const leads = Array.isArray(leadsRaw) ? leadsRaw : [];
  const { data: propertiesRaw = [] } = useProperties();
  const properties = Array.isArray(propertiesRaw) ? propertiesRaw : [];

  // r5 Eleanor WF-R5-001: progressive disclosure for first-time users.
  // If the org has very little data (≤ 2 leads + 0 properties) we
  // treat the dashboard as "new user mode" and hide the
  // information-dense AI / Pulse / Action Queue sections. The
  // Getting Started checklist and the hero become the focus.
  // A user can toggle the full dashboard on via localStorage once
  // they've decided they want it — we persist that preference.
  const hasEngaged = leads.length >= 3 || properties.filter((p: any) => p.status === "owned").length >= 1;
  const newUserModeOverride =
    typeof window !== "undefined" &&
    window.localStorage.getItem("acreos.dashboardMode") === "full";
  const isNewUserMode = !hasEngaged && !newUserModeOverride;
  const switchToFullMode = () => {
    try {
      window.localStorage.setItem("acreos.dashboardMode", "full");
    } catch { /* noop */ }
    window.location.reload();
  };
  const { data: tasks = [], isLoading: tasksLoading } = useQuery<Task[]>({
    queryKey: ["/api/tasks"],
    staleTime: 2 * 60 * 1000,
  });
  const { data: systemAlerts = [], isLoading: alertsLoading } = useQuery<SystemAlert[]>({
    queryKey: ["/api/alerts/active"],
    staleTime: 5 * 60 * 1000,
  });
  const { data: activeGoals = [] } = useQuery<GoalWithProgress[]>({
    queryKey: ["/api/goals"],
    staleTime: 5 * 60 * 1000,
    select: (data) => Array.isArray(data) ? data.filter((g) => g.isActive) : [],
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

  // Decision queue: derive pending count from leads + deals already fetched
  const { data: allDealsRaw = [] } = useQuery<{ id: number; status: string; offerDate?: string; updatedAt?: string }[]>({
    queryKey: ["/api/deals"],
    staleTime: 5 * 60 * 1000,
  });
  const allDeals = Array.isArray(allDealsRaw) ? allDealsRaw : [];

  // Cash position: upcoming note payments in next 30/60/90 days
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

  const dismissMutation = useMutation({
    mutationFn: async (alertId: number) => {
      await apiRequest("DELETE", `/api/alerts/${alertId}/dismiss`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/alerts/active"] });
    },
    onError: () => {
      toast({
        variant: "destructive",
        title: "Couldn't dismiss alert",
        description: "The alert is still active. Try again, or check the system status.",
      });
    },
  });

  // ── Agent Activity for Today page ─────────────────────────────────────
  const { data: agentActivity = [] } = useQuery<any[]>({
    queryKey: ["/api/founder/v12/lifecycle/agents"],
    staleTime: 30_000,
  });
  const { data: pendingApprovals = [] } = useQuery<any[]>({
    queryKey: ["/api/autonomous/tasks/pending-approval"],
    staleTime: 15_000,
  });
  const { data: autonomyData } = useQuery<any>({
    queryKey: ["/api/founder/v14/autonomy/score"],
    staleTime: 60_000,
  });

  const activeAgentCount = Array.isArray(agentActivity)
    ? agentActivity.filter((a: any) => a.status === "running" || a.status === "active").length
    : 0;
  const pendingApprovalCount = Array.isArray(pendingApprovals) ? pendingApprovals.length : 0;
  const autonomyScore = autonomyData?.score ?? autonomyData?.overallScore ?? 0;

  const greeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return "Good morning";
    if (hour < 17) return "Good afternoon";
    return "Good evening";
  };

  // --- Today's Actions: tasks due today or overdue (not completed) ---
  const todayActions = tasks.filter((t) => {
    if (t.status === "completed" || t.status === "done") return false;
    if (!t.dueDate) return false;
    const due = new Date(t.dueDate);
    return isToday(due) || isBefore(due, startOfDay(new Date()));
  });

  const aiActions = intelligence?.actions?.slice(0, 5) ?? [];

  const paxObservations = paxInsights?.observations ?? [];
  const paxStaleLeads = paxInsights?.staleLeads ?? [];
  const paxExpiringOffers = paxInsights?.expiringOffers ?? [];
  const paxItemCount = paxObservations.length + paxStaleLeads.length + paxExpiringOffers.length;

  const paxSuggestions = paxSuggestionsData?.suggestions ?? [];

  const { data: todayPriorities, isLoading: prioritiesLoading } =
    useQuery<TodayPrioritiesData>({
      queryKey: ["/api/dashboard/today-priorities"],
      staleTime: 5 * 60 * 1000,
    });

  // Business Pulse computed values
  const activeDeals = allDeals.filter(
    (d) => !["closed", "cancelled"].includes(d.status)
  );
  const pipelineValue = activeDeals.reduce(
    (sum, d: any) => sum + (parseFloat(d.purchasePrice || d.offerAmount || "0")),
    0
  );
  const hotDeals = allDeals.filter(
    (d) => d.status === "accepted" || d.status === "in_escrow"
  ).length;
  const avgWinProbability = activeDeals.length > 0
    ? Math.round(
        activeDeals.reduce((sum, d: any) => sum + (d.winProbability ?? 0), 0) /
          activeDeals.length
      )
    : 0;
  const closedDealsThisMonth = allDeals.filter((d) => {
    if (d.status !== "closed") return false;
    if (!d.updatedAt) return false;
    const date = new Date(d.updatedAt);
    const now = new Date();
    return date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
  });
  const closedRevenueThisMonth = closedDealsThisMonth.reduce(
    (sum, d: any) => sum + (parseFloat(d.purchasePrice || d.offerAmount || "0")),
    0
  );

  // Pulse score: simple heuristic based on active deals, hot deals, pipeline
  const pulseScore = Math.min(
    100,
    Math.round(
      (activeDeals.length > 0 ? 20 : 0) +
      (hotDeals > 0 ? 25 : 0) +
      (pipelineValue > 0 ? 20 : 0) +
      (avgWinProbability > 0 ? avgWinProbability * 0.35 : 0)
    )
  );
  // Pulse tonal projection — replaces hardcoded emerald/amber/blue with
  // semantic --acr-* tones so per-theme switching works.
  const pulseBg =
    pulseScore >= 80
      ? "from-acr-pos-soft to-transparent"
      : pulseScore >= 55
      ? "from-acr-warn-soft to-transparent"
      : "from-acr-brand-soft to-transparent";
  const pulseColor =
    pulseScore >= 80
      ? "text-acr-pos"
      : pulseScore >= 55
      ? "text-acr-warn"
      : "text-acr-brand";
  const pulseLabel =
    pulseScore >= 80 ? "Strong" : pulseScore >= 55 ? "Steady" : "Building";

  // Cash position calculations
  const cashPosition = (() => {
    const now = new Date();
    const activeNotes = allNotes.filter(n => n.status === "active" || n.status === "late" || n.status === "delinquent");
    const lateCount = allNotes.filter(n => n.status === "late" || n.status === "delinquent").length;
    const upcoming30 = activeNotes.filter(n => {
      if (!n.nextPaymentDate) return false;
      const due = new Date(n.nextPaymentDate);
      const diff = (due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
      return diff >= 0 && diff <= 30;
    });
    const next3 = upcoming30
      .sort((a, b) => new Date(a.nextPaymentDate!).getTime() - new Date(b.nextPaymentDate!).getTime())
      .slice(0, 3);
    const projected30 = upcoming30.reduce((s, n) => s + parseFloat(n.monthlyPayment || "0"), 0);
    const projected60 = activeNotes.filter(n => {
      if (!n.nextPaymentDate) return false;
      const due = new Date(n.nextPaymentDate);
      const diff = (due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
      return diff >= 0 && diff <= 60;
    }).reduce((s, n) => s + parseFloat(n.monthlyPayment || "0"), 0);
    const projected90 = activeNotes.filter(n => {
      if (!n.nextPaymentDate) return false;
      const due = new Date(n.nextPaymentDate);
      const diff = (due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
      return diff >= 0 && diff <= 90;
    }).reduce((s, n) => s + parseFloat(n.monthlyPayment || "0"), 0);
    return { next3, lateCount, projected30, projected60, projected90, activeCount: activeNotes.length };
  })();

  const onboardingComplete = organization?.onboardingCompleted === true;
  const [onboardingDismissed, setOnboardingDismissed] = React.useState(() => {
    return sessionStorage.getItem("onboarding_banner_dismissed") === "true";
  });
  const showOnboardingBanner = !onboardingComplete && !onboardingDismissed;

  // ── Welcome Back: detect returning users after extended absence ─────
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
    !welcomeBackDismissed &&
    daysSinceLastVisit !== null &&
    daysSinceLastVisit >= WELCOME_BACK_THRESHOLD_DAYS;

  // Update the last-visit timestamp on mount (after reading the old value)
  React.useEffect(() => {
    try {
      localStorage.setItem(LAST_VISIT_KEY, Date.now().toString());
    } catch {
      // localStorage unavailable — ignore
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

  const userName = user?.firstName || organization?.name || "";

  // Persona-aware quick-jump banners. /today's parcel-flip layout doesn't
  // serve sub-vertical operators (Linnea/Note Investor flagged it; Marcus/
  // Tax-Delinquent flagged it). Until a full per-persona /today rebuild
  // lands, surface fast links to each persona's actual workspace.
  const investorType = (organization as any)?.investorType as string | undefined;
  const isNoteOrg = investorType === "notes" || investorType === "both";
  const businessType = (organization?.onboardingData as any)?.businessType as string | undefined;
  const isTaxDelinquentOrg = businessType === "tax_lien_deed";

  return (
    <PageShell label="Today">
      {/* Tax-delinquent quick-jump — visible for tax_lien_deed business type. */}
      {isTaxDelinquentOrg && (
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h3 className="font-semibold text-sm">Tax-delinquent surfaces</h3>
              <p className="text-sm text-muted-foreground">
                Redemption clock, auction worksheet, state rules, quiet-title
                workflow — the surfaces tuned for tax-deed and tax-lien
                operators.
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0 flex-wrap">
              <Button asChild size="sm" variant="outline">
                <Link href="/redemption-clock">Redemption clock</Link>
              </Button>
              <Button asChild size="sm" variant="outline">
                <Link href="/auction-worksheet">Auction worksheet</Link>
              </Button>
              <Button asChild size="sm" variant="outline">
                <Link href="/counties">Counties</Link>
              </Button>
              <Button asChild size="sm" variant="outline">
                <Link href="/state-rules">State rules</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Note investor quick-jump — visible for notes/both orgs only. */}
      {isNoteOrg && (
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h3 className="font-semibold text-sm">Note investor surfaces</h3>
              <p className="text-sm text-muted-foreground">
                Servicing book, acquisition pipeline, and 1099-INT readiness — all
                tuned for note-investor workflows.
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0 flex-wrap">
              <Button asChild size="sm" variant="outline">
                <Link href="/notes">Servicing book</Link>
              </Button>
              <Button asChild size="sm" variant="outline">
                <Link href="/notes/pipeline">Pipeline</Link>
              </Button>
              <Button asChild size="sm" variant="outline">
                <Link href="/notes/tax-readiness">Tax readiness</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Onboarding prompt for new users */}
      {showOnboardingBanner && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10 shrink-0">
                <Sparkles className="w-5 h-5 text-primary" aria-hidden="true" />
              </div>
              <div>
                <h3 className="font-semibold text-sm">Welcome to AcreOS.</h3>
                <p className="text-sm text-muted-foreground">Complete a quick setup to personalize AcreOS for your land-investing business.</p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button asChild size="sm" className="min-h-11 sm:min-h-9">
                <Link href="/onboarding-v2">
                  Get started <ArrowRight className="w-3.5 h-3.5 ml-1" aria-hidden="true" />
                </Link>
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-11 w-11 sm:h-9 sm:w-9"
                onClick={() => { setOnboardingDismissed(true); sessionStorage.setItem("onboarding_banner_dismissed", "true"); }}
                aria-label="Dismiss onboarding banner"
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Welcome Back card for returning users after extended absence */}
      {showWelcomeBack && (
        <Card className="rounded-card border-[color:var(--acr-brand)]/30 bg-acr-brand-soft" data-testid="welcome-back-card">
          <CardContent className="p-5">
            <div className="flex items-start justify-between gap-4 mb-4">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-card bg-acr-brand-soft shrink-0">
                  <RefreshCw className="w-5 h-5 text-acr-brand" aria-hidden="true" />
                </div>
                <div>
                  <h3 className="font-semibold text-base">
                    Welcome back{userName ? `, ${userName}` : ""}!
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    It's been {plural(daysSinceLastVisit, "day")} since your last visit. Here's what's happening:
                  </p>
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="shrink-0 h-11 w-11 sm:h-9 sm:w-9"
                onClick={dismissWelcomeBack}
                aria-label="Dismiss welcome back card"
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </Button>
            </div>

            {/* Summary stats */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
              <div className="bg-white/70 dark:bg-background/40 rounded-lg p-3 text-center">
                <p className="text-lg font-bold text-foreground tabular-nums">
                  {statsLoading ? "—" : stats?.activeLeads ?? 0}
                </p>
                <p className="text-xs text-muted-foreground">Active leads</p>
              </div>
              <div className="bg-white/70 dark:bg-background/40 rounded-lg p-3 text-center">
                <p className="text-lg font-bold text-foreground tabular-nums">
                  {statsLoading ? "—" : stats?.activeDeals ?? 0}
                </p>
                <p className="text-xs text-muted-foreground">Active deals</p>
              </div>
              <div className="bg-white/70 dark:bg-background/40 rounded-lg p-3 text-center">
                <p className="text-lg font-bold text-foreground tabular-nums">
                  {statsLoading ? "—" : stats?.activeProperties ?? 0}
                </p>
                <p className="text-xs text-muted-foreground">{propertyLabelPlural}</p>
              </div>
              <div className="bg-white/70 dark:bg-background/40 rounded-lg p-3 text-center">
                <p className="text-lg font-bold text-foreground tabular-nums">
                  {pendingDecisionCount > 0 ? pendingDecisionCount : 0}
                </p>
                <p className="text-xs text-muted-foreground">Pending decisions</p>
              </div>
            </div>

            {/* Quick action links */}
            <div className="flex flex-wrap gap-2">
              <Button asChild size="sm" variant="default" className="gap-1.5 min-h-11 sm:min-h-9">
                <Link href="/decision-queue">
                  <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                  Review decisions
                </Link>
              </Button>
              <Button asChild size="sm" variant="outline" className="gap-1.5 bg-white/60 dark:bg-background/40 min-h-11 sm:min-h-9">
                <Link href="/portfolio">
                  <Briefcase className="w-3.5 h-3.5" aria-hidden="true" />
                  View portfolio
                </Link>
              </Button>
              <Button asChild size="sm" variant="outline" className="gap-1.5 bg-white/60 dark:bg-background/40 min-h-11 sm:min-h-9">
                <Link href="/team-inbox">
                  <MessageSquare className="w-3.5 h-3.5" aria-hidden="true" />
                  Check messages
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Getting Started Checklist — shown when user has no data yet */}
      {!statsLoading && (stats?.activeLeads ?? 0) === 0 && (stats?.activeProperties ?? 0) === 0 && (
        <div className="space-y-4">
          <Card className="border-primary/20 bg-gradient-to-br from-primary/5 to-accent/5">
            <CardContent className="p-6 text-center space-y-3">
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-primary/10">
                <Target className="w-6 h-6 text-primary" aria-hidden="true" />
              </div>
              <h2 className="text-xl font-bold">Ready to find your first deal?</h2>
              <p className="text-muted-foreground max-w-md mx-auto">
                Your AcreOS workspace is set up. Follow these steps to start evaluating parcels and closing deals.
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
              </div>
            </CardContent>
          </Card>
          <GettingStartedChecklist />
        </div>
      )}

      {/* Header — homestead Command Center editorial greeting (prototype: acreos/command-center.jsx hero) */}
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
              className="inline-flex items-center gap-2 mt-3 px-3 py-1.5 rounded-full bg-acr-neg-soft border border-[color:var(--acr-neg)]/30 text-sm text-acr-neg hover:opacity-80 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={`${plural(pendingDecisionCount, "pending decision")} — review now`}
            >
              <Clock className="w-4 h-4" aria-hidden="true" />
              <span className="font-medium">Review now</span>
              <Badge variant="destructive" className="text-xs px-1.5 py-0 tabular-nums">{pendingDecisionCount}</Badge>
              <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
            </Link>
          )}
        </div>
      </div>

      {/* Agent Activity — sovereign system status */}
      {(activeAgentCount > 0 || pendingApprovalCount > 0) && (
        <div className="rounded-xl border bg-gradient-to-br from-primary/5 to-transparent p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Bot className="w-4 h-4 text-primary" aria-hidden="true" />
              <span className="font-semibold text-sm">Agent activity</span>
              {autonomyScore > 0 && (
                <Badge variant="outline" className="text-xs tabular-nums">
                  {Math.round(autonomyScore)}% autonomy
                </Badge>
              )}
            </div>
            <Link href="/sovereign">
              <Badge variant="secondary" className="text-xs cursor-pointer hover:bg-primary/10">
                Sovereign dashboard &rarr;
              </Badge>
            </Link>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="text-center">
              <AnimatedCounter value={activeAgentCount} className="text-lg font-bold tabular-nums" />
              <p className="text-xs text-muted-foreground">Active agents</p>
            </div>
            <div className="text-center">
              <Link href="/ai#agents">
                <AnimatedCounter
                  value={pendingApprovalCount}
                  className={`text-lg font-bold tabular-nums ${pendingApprovalCount > 0 ? "text-acr-warn" : ""}`}
                />
                <p className="text-xs text-muted-foreground">Pending approvals</p>
              </Link>
            </div>
            <div className="text-center">
              <AnimatedCounter
                value={Math.round(autonomyScore)}
                format={(n) => `${Math.round(n)}%`}
                className="text-lg font-bold tabular-nums"
              />
              <p className="text-xs text-muted-foreground">Autonomy score</p>
            </div>
          </div>
        </div>
      )}

      {/* r5 Eleanor WF-R5-001: collapse the dense sections behind a
          "Show full dashboard" toggle while the org is still in
          first-deal discovery. Keeps the onboarding checklist + hero
          in focus. */}
      {isNewUserMode && (
        <div className="rounded-lg border border-dashed border-muted-foreground/40 p-4 text-sm text-muted-foreground flex items-center justify-between gap-3">
          <span>
            Simplified dashboard. Complete a lead or a property to unlock the full metrics view.
          </span>
          <button
            type="button"
            onClick={switchToFullMode}
            className="underline hover:text-foreground whitespace-nowrap"
            data-testid="button-show-full-dashboard"
          >
            Show full dashboard
          </button>
        </div>
      )}

      {/* Business Pulse — live business momentum snapshot */}
      {!isNewUserMode && (
      <div data-testid="section-business-pulse">
        <div className={`rounded-xl border bg-gradient-to-br ${pulseBg} p-4`}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Activity className={`w-4 h-4 ${pulseColor}`} aria-hidden="true" />
              <span className="font-semibold text-sm">Business pulse</span>
              <Badge variant="outline" className={`text-xs ${pulseColor} border-current`}>
                {pulseLabel}
              </Badge>
            </div>
            <div className="flex items-center gap-1">
              <div className={`w-2 h-2 rounded-full ${pulseScore >= 55 ? "bg-acr-pos animate-pulse" : "bg-muted-foreground"}`} aria-hidden="true" />
              <span className="text-xs text-muted-foreground tabular-nums" aria-label={`Pulse score ${pulseScore} out of 100`}>{pulseScore}/100</span>
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-background/60 rounded-lg p-3 text-center">
              <div className="flex items-center justify-center gap-1 mb-1">
                <DollarSign className="w-3.5 h-3.5 text-primary" aria-hidden="true" />
                <span className="text-[10px] text-muted-foreground uppercase tracking-wide">Pipeline</span>
              </div>
              <p className="text-lg font-bold text-foreground tabular-nums">
                {pipelineValue > 0 ? dollarsCompact(pipelineValue * 100) : "—"}
              </p>
              <p className="text-[10px] text-muted-foreground">
                <span className="tabular-nums">{activeDeals.length}</span> active deals
              </p>
            </div>
            <div className="bg-background/60 rounded-lg p-3 text-center">
              <div className="flex items-center justify-center gap-1 mb-1">
                <Flame className="w-3.5 h-3.5 text-acr-brand" aria-hidden="true" />
                <span className="text-[10px] text-muted-foreground uppercase tracking-wide">Hot deals</span>
              </div>
              <p className="text-lg font-bold text-foreground tabular-nums">{hotDeals}</p>
              <p className="text-[10px] text-muted-foreground">accepted / in escrow</p>
            </div>
            <div className="bg-background/60 rounded-lg p-3 text-center">
              <div className="flex items-center justify-center gap-1 mb-1">
                <BarChart3 className="w-3.5 h-3.5 text-primary" aria-hidden="true" />
                <span className="text-[10px] text-muted-foreground uppercase tracking-wide">Avg win prob</span>
              </div>
              <p className="text-lg font-bold text-foreground tabular-nums">
                {avgWinProbability > 0 ? `${avgWinProbability}%` : "—"}
              </p>
              <p className="text-[10px] text-muted-foreground">across pipeline</p>
            </div>
            <div className="bg-background/60 rounded-lg p-3 text-center">
              <div className="flex items-center justify-center gap-1 mb-1">
                <TrendingUp className="w-3.5 h-3.5 text-acr-pos" aria-hidden="true" />
                <span className="text-[10px] text-muted-foreground uppercase tracking-wide">This month</span>
              </div>
              <p className="text-lg font-bold text-foreground tabular-nums">
                {closedRevenueThisMonth > 0 ? dollarsCompact(closedRevenueThisMonth * 100) : "—"}
              </p>
              <p className="text-[10px] text-muted-foreground">
                <span className="tabular-nums">{closedDealsThisMonth.length}</span> closed
              </p>
            </div>
          </div>
          {/* Pulse progress bar */}
          <div className="mt-3">
            <div className="w-full bg-background/60 rounded-full h-1.5 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-700 ${
                  pulseScore >= 80 ? "bg-acr-pos" : pulseScore >= 55 ? "bg-acr-warn" : "bg-acr-brand"
                }`}
                style={{ width: `${pulseScore}%` }}
              />
            </div>
          </div>
        </div>
      </div>
      )}

      {/* r5 Eleanor: Start Here Today + Pax Suggests + AI Action Queue
          are also hidden in new-user mode. Getting Started checklist
          (above this block) + Portfolio Overview (below) remain. */}
      {!isNewUserMode && (
      <>
      {/* Epic J: Section 0 — Start Here Today (3 AI-prioritized actions) */}
      <div data-testid="section-start-here-today">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-acr-brand" aria-hidden="true" />
            <h2 className="acr-section-h2">Start here today</h2>
          </div>
          <Button asChild variant="ghost" size="sm" className="gap-1 text-xs">
            <Link href="/evening-review">
              <Moon className="w-3 h-3" aria-hidden="true" /> Evening review
            </Link>
          </Button>
        </div>

        <ContentReveal
          ready={!prioritiesLoading}
          skeleton={
            <div className="space-y-2">
              {[1, 2, 3].map(i => <Skeleton key={i} className="h-16 w-full" />)}
            </div>
          }
        >
        {(todayPriorities?.priorities ?? []).length > 0 ? (
          <div className="space-y-2">
            {(todayPriorities?.priorities ?? []).map((priority, idx) => (
              <Card key={priority.id} className={`rounded-card hover:shadow-md transition-shadow ${idx === 0 ? "border-[color:var(--acr-brand)]/30" : ""}`}>
                <CardContent className="flex items-center gap-4 p-4">
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${idx === 0 ? "bg-acr-brand text-acr-brand-ink" : "bg-muted text-muted-foreground"}`}>
                    {idx + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="font-medium text-sm truncate">{priority.title}</span>
                      <Badge variant="secondary" className={priorityColors[priority.priority]}>
                        {priority.priority}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground line-clamp-1">{priority.description}</p>
                  </div>
                  <Button asChild size="sm" variant={idx === 0 ? "default" : "outline"} className="shrink-0 text-xs">
                    <Link href={priority.actionUrl}>{priority.actionLabel}</Link>
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <Card>
            <CardContent className="flex items-center gap-3 py-5 px-4">
              <CheckCircle2 className="w-5 h-5 text-acr-pos shrink-0" />
              <p className="text-sm text-muted-foreground">Nothing pressing today.</p>
            </CardContent>
          </Card>
        )}
        </ContentReveal>
      </div>

      {/* Section 1: Today's Actions (tasks due today or overdue) */}
      <div data-testid="section-todays-actions">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-primary" aria-hidden="true" />
            <h2 className="acr-section-h2">
              <GlossaryTerm slug="decision_queue">Today's actions</GlossaryTerm>
            </h2>
            {todayActions.length > 0 && (
              <Badge variant="secondary" className="bg-primary/10 text-primary text-xs tabular-nums">
                {todayActions.length}
              </Badge>
            )}
          </div>
          <Button asChild variant="ghost" size="sm" className="gap-1 text-xs">
            <Link href="/pipeline">
              All tasks <ArrowRight className="w-3 h-3" aria-hidden="true" />
            </Link>
          </Button>
        </div>

        {tasksLoading ? (
          <div className="space-y-2">
            {[1, 2].map((i) => <Skeleton key={i} className="h-14 w-full" />)}
          </div>
        ) : todayActions.length === 0 ? (
          <Card>
            <CardContent className="flex items-center gap-3 py-5 px-4">
              <CheckCircle2 className="w-5 h-5 text-acr-pos shrink-0" />
              <p className="text-sm text-muted-foreground">No tasks due today.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {todayActions.map((task) => {
              const isOverdue = task.dueDate && isBefore(new Date(task.dueDate), startOfDay(new Date()));
              return (
                <Card key={task.id} className="hover:shadow-sm transition-shadow">
                  <CardContent className="flex items-center gap-4 py-3 px-4">
                    <Clock className={`w-4 h-4 shrink-0 ${isOverdue ? "text-acr-neg" : "text-acr-warn"}`} aria-hidden="true" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm truncate">{task.title}</span>
                        {task.priority && (
                          <Badge variant="secondary" className={`${priorityColors[task.priority] ?? ""} text-xs capitalize`}>
                            {task.priority}
                          </Badge>
                        )}
                        {isOverdue && (
                          <Badge variant="secondary" className="bg-acr-neg-soft text-acr-neg text-xs">Overdue</Badge>
                        )}
                      </div>
                      {task.dueDate && (
                        <p className="text-xs text-muted-foreground tabular-nums">
                          Due {format(new Date(task.dueDate), "MMM d")}
                        </p>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* Section 2: Portfolio Health Alerts */}
      {!alertsLoading && systemAlerts.length > 0 && (
        <div data-testid="section-alerts">
          <div className="flex items-center gap-2 mb-3">
            <Bell className="w-4 h-4 text-acr-warn" aria-hidden="true" />
            <h2 className="acr-section-h2">Portfolio alerts</h2>
            <Badge variant="secondary" className="bg-acr-warn-soft text-acr-warn text-xs tabular-nums">
              {systemAlerts.length}
            </Badge>
          </div>
          <div className="space-y-2">
            {systemAlerts.map((alert) => {
              const isCritical = alert.severity === "critical";
              const isWarning = alert.severity === "warning";
              const borderClass = isCritical
                ? "border-acr-neg/30 bg-acr-neg-soft dark:border-acr-neg/30 dark:bg-acr-neg-soft"
                : isWarning
                ? "border-acr-warn/30 bg-acr-warn-soft dark:border-acr-warn/30 dark:bg-acr-warn-soft"
                : "border-acr-accent bg-acr-accent dark:border-acr-accent dark:bg-acr-accent/20";
              const iconClass = isCritical ? "text-acr-neg" : isWarning ? "text-acr-warn" : "text-primary";
              const href = alertHrefByType[alert.type] ?? "/";
              const linkLabel = alertLinkLabelByType[alert.type] ?? "View";
              return (
                <div
                  key={alert.id}
                  className={`flex items-start gap-3 rounded-lg border p-3 ${borderClass}`}
                  role={isCritical ? "alert" : "status"}
                  aria-live={isCritical ? "assertive" : "polite"}
                >
                  <AlertTriangle className={`w-4 h-4 shrink-0 mt-0.5 ${iconClass}`} aria-hidden="true" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{alert.title}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{alert.message}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button asChild variant="outline" size="sm" className="text-xs h-7">
                      <Link href={href}>{linkLabel}</Link>
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => dismissMutation.mutate(alert.id)}
                      disabled={dismissMutation.isPending}
                      aria-label={`Dismiss alert: ${alert.title}`}
                    >
                      <X className="w-3 h-3" aria-hidden="true" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Section 2b: Pax Noticed
          Per design-system §1.3: agent attribution lives in the section
          header itself ("Pax noticed"). No additional "AI" badge — the
          name IS the byline. */}
      {!paxLoading && paxItemCount > 0 && (
        <div data-testid="section-pax-noticed">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-acr-brand" aria-hidden="true" />
              <h2 className="acr-section-h2">Pax noticed</h2>
              {paxItemCount > 0 && (
                <Badge variant="secondary" className="bg-acr-brand-soft text-acr-brand border-transparent text-xs tabular-nums">
                  {paxItemCount}
                </Badge>
              )}
            </div>
            <Button asChild variant="ghost" size="sm" className="gap-1 text-xs">
              <Link href="/pax#insights">
                View all <ArrowRight className="w-3 h-3" aria-hidden="true" />
              </Link>
            </Button>
          </div>

          <div className="space-y-2">
            {/* Observation cards */}
            {paxObservations.map((obs) => {
              const isHigh = obs.severity === "high";
              const isMedium = obs.severity === "medium";
              const isLow = obs.severity === "low";
              // Use semantic --acr-* tones so observation cards re-skin
              // automatically across all five themes (homestead/quarry/
              // nocturne/meadow/slate). Severity → tone:
              //   high → neg (destructive)
              //   medium → warn
              //   low → accent (informational)
              const toneClass = isHigh
                ? "border-[color:var(--acr-neg)]/30 bg-acr-neg-soft"
                : isMedium
                ? "border-[color:var(--acr-warn)]/30 bg-acr-warn-soft"
                : isLow
                ? "border-acr-line bg-acr-surface-2"
                : "border-acr-line bg-acr-surface-2";
              const badgeClass = isHigh
                ? "bg-acr-neg-soft text-acr-neg border-transparent"
                : isMedium
                ? "bg-acr-warn-soft text-acr-warn border-transparent"
                : isLow
                ? "bg-acr-surface-2 text-acr-ink-2 border-transparent"
                : "bg-acr-surface-2 text-acr-ink-3 border-transparent";
              const iconColor = isHigh
                ? "text-acr-neg"
                : isMedium
                ? "text-acr-warn"
                : "text-acr-brand";
              return (
                <div key={`obs-${obs.id}`} className={`flex items-start gap-3 rounded-card border p-3 ${toneClass}`}>
                  <Sparkles className={`w-4 h-4 shrink-0 mt-0.5 ${iconColor}`} aria-hidden="true" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-medium">{obs.title}</p>
                      <Badge variant="secondary" className={`text-xs capitalize ${badgeClass}`}>
                        {obs.severity}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{obs.description}</p>
                  </div>
                </div>
              );
            })}

            {/* Stale lead cards */}
            {paxStaleLeads.map((lead) => (
              <div key={`stale-${lead.id}`} className="flex items-start gap-3 rounded-card border border-[color:var(--acr-warn)]/30 bg-acr-warn-soft p-3">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-acr-warn" aria-hidden="true" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">
                    {lead.firstName} {lead.lastName} hasn't been contacted
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5 tabular-nums">
                    {lead.daysSinceContact >= 999 ? "Never contacted" : `${lead.daysSinceContact} days since last contact`}
                  </p>
                </div>
                <Button asChild variant="outline" size="sm" className="text-xs h-7 shrink-0">
                  <Link href="/leads">Follow up</Link>
                </Button>
              </div>
            ))}

            {/* Expiring offer cards */}
            {paxExpiringOffers.map((offer) => (
              <div
                key={`offer-${offer.id}`}
                className="flex items-start gap-3 rounded-card border border-[color:var(--acr-neg)]/30 bg-acr-neg-soft p-3"
                role="alert"
              >
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-acr-neg" aria-hidden="true" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{offer.title}</p>
                  <p className="text-xs text-muted-foreground mt-0.5 tabular-nums">
                    Offer expires {offer.offerExpiresAt ? format(new Date(offer.offerExpiresAt), "MMM d, h:mm a") : "soon"}
                  </p>
                </div>
                <Button asChild variant="outline" size="sm" className="text-xs h-7 shrink-0">
                  <Link href="/deals">View deal</Link>
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Section 2c: Pax Suggests
          Same byline pattern as Pax Noticed — section header IS the
          attribution (design-system §1.3). */}
      <div data-testid="section-pax-suggests">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-acr-brand" aria-hidden="true" />
            <h2 className="acr-section-h2">Pax suggests</h2>
          </div>
          <Button asChild variant="ghost" size="sm" className="gap-1 text-xs">
            <Link href="/leads">
              All leads <ArrowRight className="w-3 h-3" aria-hidden="true" />
            </Link>
          </Button>
        </div>

        {paxLoading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => <Skeleton key={i} className="h-16 w-full" />)}
          </div>
        ) : paxSuggestions.length === 0 ? (
          <Card>
            <CardContent className="flex items-center gap-3 py-5 px-4">
              <CheckCircle2 className="w-5 h-5 text-acr-pos shrink-0" />
              <p className="text-sm text-muted-foreground">No proactive suggestions right now. Pax is monitoring your pipeline.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {paxSuggestions.map((s) => {
              const confidencePct = Math.round(s.confidence * 100);
              const confBadgeClass = confidencePct >= 85
                ? "bg-acr-pos-soft text-acr-pos dark:bg-acr-pos-soft dark:text-acr-pos"
                : confidencePct >= 70
                ? "bg-acr-warn-soft text-acr-warn dark:bg-acr-warn-soft dark:text-acr-warn"
                : "bg-muted text-muted-foreground dark:bg-acr-bg-sunken dark:text-muted-foreground";
              return (
                <Card key={s.id} className="hover:shadow-sm transition-shadow border-acr-pos/20 dark:border-acr-pos/30">
                  <CardContent className="flex items-start gap-4 py-3 px-4">
                    <Sparkles className="w-4 h-4 shrink-0 mt-1 text-acr-pos" aria-hidden="true" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-0.5">
                        <span className="font-medium text-sm">{s.suggestion}</span>
                        <Badge variant="secondary" className={`text-xs tabular-nums ${confBadgeClass}`}>
                          {confidencePct}% confidence
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">{s.rationale}</p>
                    </div>
                    <Button asChild size="sm" variant="outline" className="shrink-0 text-xs h-8 border-acr-pos/30 hover:bg-acr-pos-soft dark:border-acr-pos/30 dark:hover:bg-acr-pos-soft">
                      <Link href={s.actionUrl}>{s.actionLabel}</Link>
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* Section 3: Goal Progress */}
      {activeGoals.length > 0 && (
        <div data-testid="section-goals">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Target className="w-4 h-4 text-primary" aria-hidden="true" />
              <h2 className="acr-section-h2">Goal progress</h2>
              <Badge variant="secondary" className="bg-primary/10 text-primary text-xs tabular-nums">
                {activeGoals.length}
              </Badge>
            </div>
            <Button asChild variant="ghost" size="sm" className="gap-1 text-xs">
              <Link href="/settings">
                Manage goals <ArrowRight className="w-3 h-3" aria-hidden="true" />
              </Link>
            </Button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {activeGoals.map((goal) => (
              <Card key={goal.id}>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium truncate">{goal.label}</span>
                    <span className="text-xs text-muted-foreground ml-2 shrink-0 tabular-nums">
                      {goal.progressPct}%
                    </span>
                  </div>
                  <Progress
                    value={goal.progressPct}
                    className="h-2 mb-2"
                    aria-label={`${goal.label}: ${goal.progressPct}% complete`}
                  />
                  <p className="text-xs text-muted-foreground tabular-nums">
                    {typeof goal.currentValue === "number" && goal.goalType === "revenue_earned"
                      ? `${usd(goal.currentValue, { noCents: true })} of ${usd(goal.targetValue, { noCents: true })}`
                      : `${goal.currentValue} of ${Number(goal.targetValue)}`}
                    {" · "}ends {format(new Date(goal.periodEnd), "MMM d, yyyy")}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Section 4: AI Action Queue */}
      <div data-testid="section-ai-actions">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <GitBranch className="w-4 h-4 text-primary" aria-hidden="true" />
            <h2 className="acr-section-h2">AI action queue</h2>
          </div>
          <Button asChild variant="ghost" size="sm" className="gap-1 text-xs">
            <Link href="/pipeline">
              View pipeline <ArrowRight className="w-3 h-3" aria-hidden="true" />
            </Link>
          </Button>
        </div>

        {intelligenceLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => <Skeleton key={i} className="h-16 w-full" />)}
          </div>
        ) : aiActions.length === 0 ? (
          <ClearedEmpty
            headline="All clear — nothing needs you right now"
            subtitle="No AI-suggested actions. Check back as new signals come in."
          />
        ) : (
          <div className="space-y-3">
            {aiActions.map((action) => (
              <Card key={action.id} className="hover:shadow-md transition-shadow">
                <CardContent className="flex items-center gap-4 p-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium text-sm truncate">{action.title}</span>
                      <Badge variant="secondary" className={`capitalize ${priorityColors[action.priority]}`}>
                        {action.priority}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground truncate">{action.description}</p>
                  </div>
                  <Button asChild size="sm" variant="outline" className="shrink-0">
                    <Link href={action.actionUrl}>{action.actionLabel}</Link>
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Section 3b: Cash Position */}
      {(cashPosition.activeCount > 0 || notesLoading) && (
        <div data-testid="section-cash-position">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-acr-pos" aria-hidden="true" />
              <h2 className="acr-section-h2">Cash position</h2>
              {cashPosition.lateCount > 0 && (
                <Badge variant="secondary" className="bg-acr-neg-soft text-acr-neg dark:bg-acr-neg-soft dark:text-acr-neg text-xs tabular-nums">
                  {cashPosition.lateCount} late
                </Badge>
              )}
            </div>
            <Button asChild variant="ghost" size="sm" className="gap-1 text-xs">
              <Link href="/finance">
                View finance <ArrowRight className="w-3 h-3" aria-hidden="true" />
              </Link>
            </Button>
          </div>
          {notesLoading ? (
            <Skeleton className="h-28 w-full" />
          ) : (
            <div className="space-y-2">
              {/* 30/60/90 forecast row */}
              <div className="grid grid-cols-3 gap-2">
                {[
                  { label: "30d", value: cashPosition.projected30 },
                  { label: "60d", value: cashPosition.projected60 },
                  { label: "90d", value: cashPosition.projected90 },
                ].map(({ label, value }) => (
                  <Card key={label} className="border-acr-pos/20 dark:border-acr-pos/30">
                    <CardContent className="py-3 px-3 text-center">
                      <p className="text-xs text-muted-foreground mb-0.5 tabular-nums">{label} projected</p>
                      <p className="text-base font-semibold tabular-nums text-acr-pos">
                        {usd(value, { noCents: true })}
                      </p>
                    </CardContent>
                  </Card>
                ))}
              </div>
              {/* Upcoming payments */}
              {cashPosition.next3.length > 0 && (
                <div className="space-y-1.5">
                  {cashPosition.next3.map((note) => {
                    const isLate = note.status === "late" || note.status === "delinquent";
                    return (
                      <Card key={note.id} className="hover:shadow-sm transition-shadow">
                        <CardContent className="flex items-center justify-between py-2.5 px-4">
                          <div className="flex items-center gap-2.5">
                            {isLate ? (
                              <AlertCircle className="w-4 h-4 text-acr-neg shrink-0" aria-hidden="true" />
                            ) : (
                              <Banknote className="w-4 h-4 text-acr-pos shrink-0" aria-hidden="true" />
                            )}
                            <div>
                              <p className="text-sm font-medium leading-tight">
                                {note.borrowerName ?? `Note #${note.id}`}
                              </p>
                              <p className="text-xs text-muted-foreground tabular-nums">
                                Due {note.nextPaymentDate ? format(new Date(note.nextPaymentDate), "MMM d") : "—"}
                              </p>
                            </div>
                          </div>
                          <span
                            className={`text-sm font-semibold tabular-nums ${isLate ? "text-acr-neg" : "text-acr-pos"}`}
                            aria-label={isLate ? `Late payment: ${usd(note.monthlyPayment, { noCents: true })}` : undefined}
                          >
                            {usd(note.monthlyPayment, { noCents: true })}
                          </span>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}
      </>
      )}

      {/* Section 4: KPI strip — homestead .acr-cc-metrics (prototype: 5-column metric strip) */}
      <div data-testid="section-stats">
        <h2 className="acr-eyebrow mb-3" style={{ color: "var(--acr-ink-3)" }}>
          Portfolio overview
        </h2>
        <div className="acr-cc-metrics" data-testid="stats-grid">
          <div className="acr-metric" data-testid="stat-active-leads">
            <div className="acr-metric-label">Active leads</div>
            <div className="acr-metric-value">
              {statsLoading ? "—" : (stats?.activeLeads ?? leads.length)}
            </div>
            <div className="acr-metric-delta acr-delta-pos">
              {leads.filter((l) => l.status === "new").length} new
            </div>
          </div>
          <div className="acr-metric" data-testid="stat-properties">
            <div className="acr-metric-label">{propertyLabelPlural}</div>
            <div className="acr-metric-value">
              {statsLoading ? "—" : properties.length}
            </div>
            <div className="acr-metric-delta">
              {(() => {
                const owned = properties.filter((p) => p.status === "owned").length;
                const prospects = properties.filter((p) => p.status === "prospect").length;
                if (owned > 0 && prospects > 0) return `${owned} owned · ${prospects} prospect`;
                if (owned > 0) return `${owned} owned`;
                if (prospects > 0) return `${prospects} prospect`;
                return "none";
              })()}
            </div>
          </div>
          <div className="acr-metric" data-testid="stat-active-notes">
            <div className="acr-metric-label">Active notes</div>
            <div className="acr-metric-value">
              {statsLoading ? "—" : (stats?.activeNotes ?? 0)}
            </div>
            <div className="acr-metric-delta">&nbsp;</div>
          </div>
          <div className="acr-metric" data-testid="stat-open-deals">
            <div className="acr-metric-label">Open deals</div>
            <div className="acr-metric-value">
              {statsLoading ? "—" : (stats?.activeDeals ?? 0)}
            </div>
            <div className="acr-metric-delta">&nbsp;</div>
          </div>
          <div className="acr-metric" data-testid="stat-pending-decisions">
            <div className="acr-metric-label">Pending decisions</div>
            <div className="acr-metric-value">
              {pendingDecisionCount}
            </div>
            <div className={`acr-metric-delta ${pendingDecisionCount > 0 ? "acr-delta-neg" : "acr-muted"}`}>
              {pendingDecisionCount > 0 ? "needs review" : "all clear"}
            </div>
          </div>
        </div>
      </div>
    </PageShell>
  );
}
