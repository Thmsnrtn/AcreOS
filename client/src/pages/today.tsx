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
  Car,
  X as XIcon,
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
import { MorningBrief } from "@/components/today/MorningBrief";
import "./today.css";

// Consolidated /api/today payload (server/routes-today.ts).
interface TodayPayload {
  queue: DecisionItem[];
  brief: string | null;
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

// Autonomy preferences shape (subset of /api/me/autonomy we read).
// The Today autonomy threshold lives in `pax.thresholdsCents` under a
// reserved key (value is a confidence pct, not cents — the key name
// disambiguates it). The slider that EDITS this value moved to
// /settings/pax — Today just reads the saved threshold to pass into the
// Decision Queue for the "Pax would handle" visual treatment.
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

// ── "Heading out?" affordance (Hank) ─────────────────────────────────────
// The two days a week the operator is driving Bastrop and Caldwell, Today
// already has the data to know it. This affordance surfaces Drive Mode at
// the moment of need rather than waiting for the operator to remember the
// feature exists. Triggers when:
//   (a) at least one DriveMode capture lives in /api/leads from the last
//       14 days (source === "driving_for_dollars"), AND
//   (b) it's currently a weekday morning (local time 6am–11am).
// Dismissible per-day via the localStorage key below — the prefix is
// stable, the suffix is YYYY-MM-DD so a new day un-dismisses it.
const HEADING_OUT_DISMISS_KEY_PREFIX = "acreos-today-heading-out-dismissed-";
const HEADING_OUT_LOOKBACK_DAYS = 14;
const HEADING_OUT_MORNING_START_HOUR = 6;
const HEADING_OUT_MORNING_END_HOUR = 11; // exclusive
const DRIVE_MODE_LEAD_SOURCE = "driving_for_dollars";
const DRIVE_MODE_ROUTE = "/drivemode";

function isHeadingOutMorning(now: Date): boolean {
  const day = now.getDay(); // 0=Sun, 6=Sat
  if (day === 0 || day === 6) return false;
  const hour = now.getHours();
  return hour >= HEADING_OUT_MORNING_START_HOUR && hour < HEADING_OUT_MORNING_END_HOUR;
}

function headingOutDismissKey(now: Date): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${HEADING_OUT_DISMISS_KEY_PREFIX}${y}-${m}-${d}`;
}

// A DriveMode capture is "recent" if its createdAt is within the lookback
// window. We use the leads cache the page already has — no extra fetch.
function hasRecentDriveModeCapture(
  leads: ReadonlyArray<{ source?: string | null; createdAt?: string | Date | null }>,
  now: Date,
  lookbackDays: number = HEADING_OUT_LOOKBACK_DAYS,
): boolean {
  const cutoff = now.getTime() - lookbackDays * 24 * 60 * 60 * 1000;
  for (const l of leads) {
    if (l.source !== DRIVE_MODE_LEAD_SOURCE) continue;
    const created = l.createdAt ? new Date(l.createdAt).getTime() : NaN;
    if (Number.isFinite(created) && created >= cutoff) return true;
  }
  return false;
}

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

  // ── Pax autonomy threshold (read-only on Today) ────────────────────────
  // Today only READS the saved threshold to inform the "Pax would handle"
  // visual in the Decision Queue. The slider that edits this value moved
  // to /settings/pax — autonomy is a monthly-tune control, not a daily
  // one, so it shouldn't compete with decisions for screen real estate.
  const { data: autonomyPrefs } = useQuery<AutonomyPrefs>({
    queryKey: ["/api/me/autonomy"],
    staleTime: 10 * 60 * 1000,
  });

  const savedThresholdPct =
    autonomyPrefs?.pax?.thresholdsCents?.[AUTONOMY_THRESHOLD_KEY] ?? AUTONOMY_DEFAULT_PCT;

  // Confidence fraction (0..1) at/above which a Pax item is treated as
  // "Pax will handle" rather than needing a decision.
  const autoThreshold = savedThresholdPct / 100;

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

  // ── "Heading out?" affordance state (Hank) ───────────────────────────
  // Surfaces Drive Mode at the moment of need: weekday morning AND the
  // org has captured at least one drive-mode lead in the last 14 days.
  // Re-computed every render off the same `leads` cache the page already
  // holds — no extra fetch, no extra round-trip.
  const now = React.useMemo(() => new Date(), []);
  const headingOutDismissKey_ = React.useMemo(() => headingOutDismissKey(now), [now]);
  const [headingOutDismissed, setHeadingOutDismissed] = React.useState<boolean>(() => {
    try {
      return localStorage.getItem(headingOutDismissKey_) === "1";
    } catch {
      return false;
    }
  });
  const dismissHeadingOut = React.useCallback(() => {
    setHeadingOutDismissed(true);
    try {
      localStorage.setItem(headingOutDismissKey_, "1");
    } catch {
      // ignore — best-effort dismiss persistence
    }
  }, [headingOutDismissKey_]);
  const showHeadingOut =
    !headingOutDismissed &&
    isHeadingOutMorning(now) &&
    hasRecentDriveModeCapture(leads, now);

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
          <h1 className="acr-cc-greeting text-hero" data-testid="text-today-title">
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
              className="inline-flex items-center gap-2 mt-3 md:mt-2 min-h-11 sm:min-h-9 md:min-h-0 px-3 py-1.5 md:px-2.5 md:py-1 rounded-full bg-acr-neg-soft border border-[color:var(--acr-neg)]/30 text-sm md:text-xs text-acr-neg hover:opacity-80 active:opacity-60 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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

      {/* ── "Heading out?" affordance (Hank) ──────────────────────────
          Surfaces Drive Mode at the moment of need rather than waiting
          for the operator to remember the feature exists. Renders ABOVE
          the morning brief because it's about the *next two hours*, not
          the *last twelve*. Conditions: weekday 6am–11am local AND at
          least one drive-mode lead captured in the last 14 days. */}
      {!showEmptyState && !todayError && showHeadingOut && (
        <Card
          className="rounded-card border-[color:var(--acr-brand)]/30 bg-acr-brand-soft mb-4"
          data-testid="card-heading-out"
        >
          <CardContent className="p-4 md:p-3 flex items-start justify-between gap-3">
            <div className="flex items-center gap-3 md:gap-2.5 min-w-0">
              <div className="p-2 rounded-card bg-background/60 shrink-0">
                <Car className="w-5 h-5 md:w-4 md:h-4 text-acr-brand" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <h3 className="font-semibold text-sm md:text-[13px] leading-snug">
                  Heading out?
                </h3>
                <p className="text-xs md:text-[11px] text-muted-foreground leading-snug">
                  Open Drive Mode — Pax saves curbside leads to the county
                  the moment you tap the wheel.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <Button
                asChild
                size="sm"
                className="min-h-11 sm:min-h-9 md:h-8"
                data-testid="button-heading-out-open"
              >
                <Link href={DRIVE_MODE_ROUTE}>Open Drive Mode</Link>
              </Button>
              <button
                type="button"
                onClick={dismissHeadingOut}
                aria-label="Dismiss Heading out card for today"
                className="min-h-11 min-w-11 sm:min-h-9 sm:min-w-9 md:h-8 md:w-8 -mr-1 flex items-center justify-center rounded-full text-muted-foreground hover:bg-background/60 active:bg-background/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                data-testid="button-heading-out-dismiss"
              >
                <XIcon className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Morning brief (Chesky) ───────────────────────────────────── */}
      {/* Replaces the autonomy slider in this slot. The slider was a
          monthly-tune control; this is a daily one-paragraph read-out of
          what happened overnight. The slider now lives at /settings/pax. */}
      {!showEmptyState && !todayError && <MorningBrief brief={today?.brief ?? null} />}

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
