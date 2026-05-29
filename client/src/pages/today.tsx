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
import { Slider } from "@/components/ui/slider";
import { QueryErrorState } from "@/components/query-error-state";
import {
  Users,
  Map,
  ArrowRight,
  Sun,
  Clock,
  Target,
  Sparkles,
  RefreshCw,
  Gauge,
} from "lucide-react";
import { format } from "date-fns";
import { plural } from "@/lib/format";
import { VerticalBadge } from "@/components/ui/vertical-badge";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useToast } from "@/hooks/use-toast";
import { getErrorMessage, getErrorTitle } from "@/lib/error-utils";
import { DecisionQueue, type DecisionItem } from "@/components/today/DecisionQueue";
import { CashStrip } from "@/components/today/CashStrip";
import { TodayActivityFeed } from "@/components/today/ActivityFeed";
import "./today.css";

// Consolidated /api/today payload (server/routes-today.ts).
interface TodayPayload {
  queue: DecisionItem[];
  cash: {
    cashOnHand: number;
    openDealsValue: number;
    openDealsCount: number;
    pendingPayments30: number;
    lateCount: number;
  };
  activity: unknown[];
  meta: {
    pendingDecisionCount: number;
    hasAnyData: boolean;
    generatedAt: string;
  };
}

// Autonomy preferences shape (subset of /api/me/autonomy we read/write).
// We persist the Today autonomy threshold inside the existing
// `pax.thresholdsCents` map under a reserved key so we reuse the existing
// jsonb column + PATCH endpoint without a schema change. The value is a
// confidence percentage (50–100), not cents — the key name disambiguates it.
const AUTONOMY_THRESHOLD_KEY = "confidenceAutoPct";
const AUTONOMY_DEFAULT_PCT = 90;

interface AutonomyPrefs {
  pax?: {
    level?: number;
    perAction?: Record<string, number>;
    thresholdsCents?: Record<string, number>;
  };
  [k: string]: unknown;
}

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

  // ── Consolidated Today payload — one round-trip ────────────────────────
  // Replaces the former ~6 parallel fetches (today-priorities, tasks,
  // alerts/active, dashboard/intelligence, pax/insights, pax/pax-suggestions)
  // plus the deals/notes pulls used for the cash strip. The server now merges
  // + ranks all of those (server/routes-today.ts) so the screen paints from a
  // single query. The Activity feed stays a separate component (it owns its
  // own infinite-scroll pagination) — see TodayActivityFeed below.
  const {
    data: today,
    isLoading: todayLoading,
    isError: todayError,
    error: todayErrorObj,
    refetch: refetchToday,
    isRefetching: todayRefetching,
  } = useQuery<TodayPayload>({
    queryKey: ["/api/today"],
    staleTime: 2 * 60 * 1000,
  });

  const decisionItems: DecisionItem[] = today?.queue ?? [];
  const decisionQueueLoading = todayLoading;
  const pendingDecisionCount = today?.meta?.pendingDecisionCount ?? 0;

  // ── Pax autonomy threshold ─────────────────────────────────────────────
  // Reuses the existing per-user autonomy column via /api/me/autonomy. We
  // read the saved "auto above" confidence threshold (stored in
  // pax.thresholdsCents[confidenceAutoPct]) and let the user adjust it with a
  // slider. Persistence is real (PATCH /api/me/autonomy). What is UI-only:
  // the *visual* "Pax will handle" treatment in the queue. Server-side
  // auto-execution (Pax actually acting above the threshold without asking)
  // is NOT wired here — that engine lands separately.
  const { data: autonomyPrefs } = useQuery<AutonomyPrefs>({
    queryKey: ["/api/me/autonomy"],
    staleTime: 10 * 60 * 1000,
  });

  const savedThresholdPct =
    autonomyPrefs?.pax?.thresholdsCents?.[AUTONOMY_THRESHOLD_KEY] ?? AUTONOMY_DEFAULT_PCT;

  const [thresholdPct, setThresholdPct] = React.useState<number>(AUTONOMY_DEFAULT_PCT);
  const thresholdHydrated = React.useRef(false);
  React.useEffect(() => {
    // Hydrate local slider state from the server value once it loads.
    if (!thresholdHydrated.current && autonomyPrefs !== undefined) {
      setThresholdPct(savedThresholdPct);
      thresholdHydrated.current = true;
    }
  }, [autonomyPrefs, savedThresholdPct]);

  const autonomyMutation = useMutation({
    mutationFn: async (pct: number) => {
      const prevThresholds = autonomyPrefs?.pax?.thresholdsCents ?? {};
      const res = await apiRequest("PATCH", "/api/me/autonomy", {
        pax: {
          ...(autonomyPrefs?.pax ?? {}),
          thresholdsCents: { ...prevThresholds, [AUTONOMY_THRESHOLD_KEY]: pct },
        },
      });
      if (!res.ok) throw new Error("Failed to save autonomy preference");
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["/api/me/autonomy"], data);
    },
    onError: (error) => {
      toast({
        title: getErrorTitle(error),
        description: getErrorMessage(error),
        variant: "destructive",
      });
    },
  });

  // Persist on commit (slider release), not on every drag tick.
  const commitThreshold = React.useCallback(
    (pct: number) => {
      setThresholdPct(pct);
      autonomyMutation.mutate(pct);
    },
    [autonomyMutation],
  );

  // Confidence fraction (0..1) at/above which a Pax item is treated as
  // "Pax will handle" rather than needing a decision.
  const autoThreshold = thresholdPct / 100;

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
    onError: (error) => {
      const title = getErrorTitle(error);
      const description = getErrorMessage(error);
      toast({ title, description, variant: "destructive" });
    },
  });

  const greeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return "Good morning";
    if (hour < 17) return "Good afternoon";
    return "Good evening";
  };

  // Cash strip + pipeline aggregates now arrive pre-computed from /api/today.
  const cash = today?.cash;

  // ── Empty-state / welcome-back state machine (single pathway) ──────────
  const hasAnyData =
    (stats?.activeLeads ?? leads.length) > 0 ||
    (stats?.activeProperties ?? properties.length) > 0 ||
    (today?.meta?.hasAnyData ?? false);

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

      {/* ── /api/today error: one merged fetch, one retry surface ────── */}
      {!showEmptyState && todayError && (
        <QueryErrorState
          error={todayErrorObj instanceof Error ? todayErrorObj : null}
          onRetry={() => refetchToday()}
          isRetrying={todayRefetching}
          compact
          title="Couldn't load Today"
          description="We hit a snag pulling your decision queue. Your data is safe — try again."
          testId="today-query-error"
        />
      )}

      {/* ── Pax autonomy threshold ───────────────────────────────────── */}
      {!showEmptyState && !todayError && (
        <Card className="rounded-card" data-testid="card-pax-autonomy">
          <CardContent className="p-4 md:p-3.5">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="p-2 rounded-card bg-acr-brand-soft shrink-0">
                  <Gauge className="w-4 h-4 text-acr-brand" aria-hidden="true" />
                </div>
                <div className="min-w-0">
                  <h2 className="acr-section-h2">Pax autonomy</h2>
                  <p className="text-xs text-muted-foreground">
                    Preview — your threshold is saved but Pax still asks you first. We'll email you the day auto-execution turns on.
                  </p>
                </div>
              </div>
              <Badge
                variant="secondary"
                className="bg-acr-brand-soft text-acr-brand border-transparent tabular-nums shrink-0"
                aria-live="polite"
              >
                Auto above {thresholdPct}%
              </Badge>
            </div>
            <div className="mt-4 px-1">
              <Slider
                value={[thresholdPct]}
                min={50}
                max={100}
                step={5}
                onValueChange={(v) => setThresholdPct(v[0] ?? AUTONOMY_DEFAULT_PCT)}
                onValueCommit={(v) => commitThreshold(v[0] ?? AUTONOMY_DEFAULT_PCT)}
                aria-label={`Pax auto-handle confidence threshold: ${thresholdPct} percent`}
                data-testid="slider-pax-autonomy"
              />
              <div className="flex justify-between mt-1.5 text-[10px] text-muted-foreground tabular-nums">
                <span>Ask more (50%)</span>
                <span>Auto more (100%)</span>
              </div>
              <div className="mt-2">
                <Link
                  href="/settings/pax"
                  className="text-xs text-acr-brand hover:underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
                  data-testid="link-pax-controls"
                >
                  Pax controls (pause / replay / reset) →
                </Link>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Section 2: Decision queue (merged) ───────────────────────── */}
      {!showEmptyState && !todayError && (
        <DecisionQueue
          items={decisionItems}
          isLoading={decisionQueueLoading}
          autoThreshold={autoThreshold}
        />
      )}

      {/* ── Section 3: Cash strip ────────────────────────────────────── */}
      {!showEmptyState && !todayError && (
        <CashStrip
          isLoading={todayLoading}
          cashOnHand={cash?.cashOnHand ?? 0}
          openDealsValue={cash?.openDealsValue ?? 0}
          openDealsCount={cash?.openDealsCount ?? 0}
          pendingPayments30={cash?.pendingPayments30 ?? 0}
          lateCount={cash?.lateCount ?? 0}
        />
      )}

      {/* ── Section 4: Activity feed ─────────────────────────────────── */}
      {/* Kept as a standalone component — it owns its own infinite-scroll
          pagination, so it is intentionally not merged into /api/today. */}
      {!showEmptyState && !todayError && <TodayActivityFeed />}
    </PageShell>
  );
}
