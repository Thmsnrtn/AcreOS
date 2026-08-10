import React from "react";
import { PageShell } from "@/components/page-shell";
import { useTerm, usePersona } from "@/hooks/use-persona";
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
import { StaleDataChip } from "@/lib/stale-while-error";
import { PullToRefresh } from "@/components/mobile/PullToRefresh";
import { AnimatedCounter } from "@/components/ui/animated-counter";
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
import { DecisionQueue, type DecisionItem, type ResolveAction } from "@/components/today/DecisionQueue";
import { ReceiptsStrip, type ReceiptItem } from "@/components/today/ReceiptsStrip";
import { trackEvent } from "@/lib/telemetry";
import { CashStrip } from "@/components/today/CashStrip";
import { TodayActivityFeed } from "@/components/today/ActivityFeed";
import { MorningBrief } from "@/components/today/MorningBrief";
import { ParcelAlerts } from "@/components/today/ParcelAlerts";
import { getTodayLayout } from "@/components/today/TodayLayout";
import "./today.css";

// Consolidated /api/today payload (server/routes-today.ts).
interface TodayPayload {
  queue: DecisionItem[];
  brief: string | null;
  // Finishability (Tier 3C): real completions today (today_queue_state
  // "done" rows since the user's local midnight) + the day's total.
  progress?: { cleared: number; total: number };
  // Receipts (Tier 3C): completed events since last visit, each traceable
  // to real rows (pax_sends, completed payments, successful scheduled-task
  // runs). Empty → render nothing.
  receipts?: ReceiptItem[];
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

// ── Referral nudge (Tier 2C) ─────────────────────────────────────────────
// The referral program existed (settings → Account → refer & earn) but had
// zero surfacing post-first-value, so nobody found it. This is the single
// in-product touch: a quiet, permanently-dismissible card on Today that
// only renders once the org has real data (hasAnyData — the "it's working"
// proxy). Lives behind the Today door per the five-doors rule; the CTA
// deep-links to the existing referral section in Settings.
const REFERRAL_NUDGE_DISMISS_KEY = "acreos-today-referral-nudge-dismissed";

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
  // Last-visit timestamp (read BEFORE the effect below overwrites it) — feeds
  // both the welcome-back card and the server's receipts window.
  const lastVisitTs = React.useMemo(() => {
    try {
      const stored = localStorage.getItem(LAST_VISIT_KEY);
      return stored ? parseInt(stored, 10) : null;
    } catch {
      return null;
    }
  }, []);

  // Tier 3C: the consolidated fetch carries `since` (receipts window, server-
  // clamped to [7d, 12h] ago) and `tz` (user-local midnight for the "N of M
  // cleared" progress). The key stays ["/api/today", "?..."] so prefix
  // invalidation on ["/api/today"] keeps working; values are stable per
  // mount, so refetches reuse the same cache entry.
  const todayQueryKey = React.useMemo(() => {
    const tz = new Date().getTimezoneOffset();
    const since = lastVisitTs ?? Date.now() - 24 * 60 * 60 * 1000;
    return ["/api/today", `?since=${since}&tz=${tz}`] as const;
  }, [lastVisitTs]);

  const {
    data: today,
    isLoading: todayLoading,
    isError: todayError,
    error: todayErrorObj,
    refetch: refetchToday,
    isRefetching: todayRefetching,
    dataUpdatedAt: todayDataUpdatedAt,
  } = useQuery<TodayPayload>({
    queryKey: todayQueryKey,
    staleTime: 2 * 60 * 1000,
    // Perceived speed (Tier 3C): the key embeds since/tz, which change
    // between visits — without this, every return to Today would paint a
    // cold skeleton even though the previous payload is still cached. Paint
    // the door from the most recent /api/today entry while the fresh fetch
    // runs; the receipts/progress refresh in place when it lands.
    placeholderData: () => {
      const cached = queryClient
        .getQueryCache()
        .findAll({ queryKey: ["/api/today"] })
        .filter((q) => q.state.data !== undefined)
        .sort((a, b) => b.state.dataUpdatedAt - a.state.dataUpdatedAt)[0];
      return cached?.state.data as TodayPayload | undefined;
    },
  });

  const decisionItems: DecisionItem[] = today?.queue ?? [];
  const decisionQueueLoading = todayLoading;
  const pendingDecisionCount = today?.meta?.pendingDecisionCount ?? 0;

  // ── Stale-while-error (Wave 1.2, lib/stale-while-error.tsx) ────────────
  // A failed REFETCH over cached data must not blank the whole door: keep
  // rendering the cached payload with the quiet stale chip. Only when
  // nothing is cached (first visit + fetch failed) does the door fall to
  // the full error card. `today` includes placeholderData borrowed from
  // the previous visit's cache entry, which is exactly the data we want
  // to keep showing.
  const todayHardError = todayError && today === undefined;
  const todayStaleError = todayError && today !== undefined;

  // ── Inline queue resolution (Maren CPO #2) ─────────────────────────────
  // The habit-loop core: resolve a Decision Queue item in place (Done /
  // Snooze 3d / Dismiss) so the queue shrinks toward the rewarding "you're
  // clear for today" zero-state. We optimistically drop the row from the
  // cached /api/today payload, then PATCH; on error we restore + toast. The
  // server's resolution ledger keeps the item hidden on the next fetch.
  const [resolvingIds, setResolvingIds] = React.useState<Set<string>>(() => new Set());
  const resolveItem = useMutation<
    unknown,
    Error,
    { itemId: string; action: ResolveAction },
    { previous?: TodayPayload }
  >({
    mutationFn: async ({ itemId, action }) => {
      const res = await apiRequest("PATCH", `/api/today/queue/${encodeURIComponent(itemId)}`, { action });
      if (!res.ok) throw new Error("Failed to resolve item");
      return res.json();
    },
    onMutate: async ({ itemId, action }) => {
      setResolvingIds((prev) => new Set(prev).add(itemId));
      await queryClient.cancelQueries({ queryKey: ["/api/today"] });
      const previous = queryClient.getQueryData<TodayPayload>(todayQueryKey);
      if (previous) {
        queryClient.setQueryData<TodayPayload>(todayQueryKey, {
          ...previous,
          queue: previous.queue.filter((q) => q.id !== itemId),
          // Optimistic finishability: a "done" counts toward today's cleared
          // tally immediately; the server recomputes on the next fetch.
          progress:
            action === "done" && previous.progress
              ? { cleared: previous.progress.cleared + 1, total: previous.progress.total }
              : action !== "done" && previous.progress
                ? { cleared: previous.progress.cleared, total: Math.max(previous.progress.cleared, previous.progress.total - 1) }
                : previous.progress,
        });
      }
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(todayQueryKey, context.previous);
      }
      toast({
        variant: "destructive",
        title: "Couldn't update that item",
        description: "It's back in your queue — try again in a moment.",
      });
    },
    onSettled: (_data, _err, vars) => {
      setResolvingIds((prev) => {
        const next = new Set(prev);
        next.delete(vars.itemId);
        return next;
      });
      queryClient.invalidateQueries({ queryKey: ["/api/today"] });
    },
  });

  const handleResolve = React.useCallback(
    (itemId: string, action: ResolveAction) => {
      resolveItem.mutate({ itemId, action });
    },
    [resolveItem],
  );

  // ── Permanent clear-all (Founder ask) ──────────────────────────────────
  // POST /api/today/queue/clear server-side dismisses the ENTIRE active queue
  // (server-computes-all — independent of what the client paginated). On
  // success we invalidate /api/today so the queue refetches empty. The
  // DecisionQueue's confirm dialog gates this destructive action.
  const clearQueue = useMutation<{ cleared: number }, Error, void>({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/today/queue/clear", {});
      if (!res.ok) throw new Error("Failed to clear queue");
      return res.json();
    },
    onSuccess: (data) => {
      const cleared = data?.cleared ?? 0;
      toast({
        title: "Queue cleared",
        description:
          cleared > 0
            ? `${cleared} decision${cleared === 1 ? "" : "s"} cleared.`
            : "Your queue was already clear.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/today"] });
    },
    onError: () => {
      toast({
        variant: "destructive",
        title: "Couldn't clear the queue",
        description: "Nothing was changed — try again in a moment.",
      });
    },
  });

  const handleClearAll = React.useCallback(() => {
    clearQueue.mutate();
  }, [clearQueue]);

  // ── Pull-to-refresh (mobile only) ──────────────────────────────────────
  // A pull gesture at the top re-pulls the consolidated /api/today payload
  // and invalidates the sibling caches Today renders (parcel alerts, the
  // dashboard stats lede). No-ops on pointer/desktop (PullToRefresh gates on
  // useIsMobile). Haptic fires inside PullToRefresh at the threshold commit.
  const handlePullRefresh = React.useCallback(async () => {
    await Promise.all([
      refetchToday(),
      queryClient.invalidateQueries({ queryKey: ["/api/parcel-alerts"] }),
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] }),
    ]);
  }, [refetchToday]);

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

  // ── Measured (Tier 3C) ─────────────────────────────────────────────────
  // One event when the queue first paints with data, through the existing
  // trackEvent pipeline (/api/telemetry) — no new telemetry system.
  const mountedAtRef = React.useRef(typeof performance !== "undefined" ? performance.now() : 0);
  const paintTrackedRef = React.useRef(false);
  React.useEffect(() => {
    if (paintTrackedRef.current || !today) return;
    paintTrackedRef.current = true;
    trackEvent("today_queue_rendered", {
      items: today.queue.length,
      cleared: today.progress?.cleared ?? 0,
      total: today.progress?.total ?? 0,
      receipts: today.receipts?.length ?? 0,
      msToData: Math.round(
        (typeof performance !== "undefined" ? performance.now() : 0) - mountedAtRef.current,
      ),
    });
  }, [today]);

  // ── Persona Today (Maren CPO #3 / Krieger UX) ──────────────────────────
  // Each persona's actual JOB leads the day, not a relabeled clone: land
  // investors see sourcing/offer momentum, note investors the tape they own,
  // note originators the origination pipeline, note servicers the servicing
  // queue, tax-lien operators the redemption clock. Generic stays the default.
  // The lede composes data the page already has — no extra fetch — and is
  // rendered above the Decision Queue.
  const persona = usePersona();
  const todayLayout = getTodayLayout(persona);

  // W2.3 — the brand-new-org empty state speaks the persona's language:
  // note investors don't have "parcels", subdividers start from acreage,
  // wholesalers from contracts. Copy + CTA targets only; layout is shared.
  const emptyStateContent = (() => {
    switch (persona) {
      case "note_investor":
      case "note_originator":
      case "note_servicer":
        return {
          headline: "Ready to build your note book?",
          subtitle:
            "Import your note portfolio, add your first note, or explore with a realistic sample dataset — amortization schedules render automatically.",
          primaryLabel: "Add your first note",
          primaryHref: "/notes?action=new",
          secondaryLabel: "Import your portfolio",
          secondaryHref: "/finance",
        };
      case "subdivider":
        return {
          headline: "Ready to split your first parcel?",
          subtitle:
            "Add the parent acreage, or import a lead list of land owners — lots, permits, and county timelines light up from there.",
          primaryLabel: "Add your acreage",
          primaryHref: "/properties",
          secondaryLabel: "Import leads",
          secondaryHref: "/leads",
        };
      case "wholesaler":
        return {
          headline: "Ready to lock your first contract?",
          subtitle:
            "Import a seller list or add your first property — outreach, offers, and assignment tracking start from here.",
          primaryLabel: "Add your first property",
          primaryHref: "/properties",
          secondaryLabel: "Import sellers",
          secondaryHref: "/leads",
        };
      default:
        return {
          headline: "Ready to find your first deal?",
          subtitle:
            "Add a parcel, import a lead list, or explore with a realistic sample dataset — your workspace is yours to shape.",
          primaryLabel: "Add your first parcel",
          primaryHref: "/properties",
          secondaryLabel: "Import leads",
          secondaryHref: "/leads",
        };
    }
  })();

  // ── Empty-state / welcome-back state machine (single pathway) ──────────
  const hasAnyData =
    (stats?.activeLeads ?? leads.length) > 0 ||
    (stats?.activeProperties ?? properties.length) > 0 ||
    (today?.meta?.hasAnyData ?? false);

  const [welcomeBackDismissed, setWelcomeBackDismissed] = React.useState(false);
  // lastVisitTs is read once near the top of the component (it also feeds
  // the /api/today receipts window) — see todayQueryKey above.
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

  // ── Referral nudge state (Tier 2C) ───────────────────────────────────
  // Permanent dismiss (no date suffix) — a growth nudge the user closed
  // should stay closed; re-surfacing it would erode trust in dismissal.
  const [referralNudgeDismissed, setReferralNudgeDismissed] = React.useState<boolean>(() => {
    try {
      return localStorage.getItem(REFERRAL_NUDGE_DISMISS_KEY) === "1";
    } catch {
      return false;
    }
  });
  const dismissReferralNudge = React.useCallback(() => {
    setReferralNudgeDismissed(true);
    try {
      localStorage.setItem(REFERRAL_NUDGE_DISMISS_KEY, "1");
    } catch {
      // ignore — best-effort dismiss persistence
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
      <PullToRefresh onRefresh={handlePullRefresh} className="space-y-6 md:space-y-8">
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
              className="inline-flex items-center gap-2 mt-3 md:mt-2 min-h-11 pointer-fine:sm:min-h-9 pointer-fine:md:min-h-0 px-3 py-1.5 md:px-2.5 md:py-1 rounded-full bg-acr-neg-soft border border-[color:var(--acr-neg)]/30 text-sm md:text-xs text-acr-neg hover:opacity-80 active:opacity-60 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={`${plural(pendingDecisionCount, "pending decision")} — review now`}
            >
              <Clock className="w-4 h-4 md:w-3.5 md:h-3.5" aria-hidden="true" />
              <span className="font-medium">Review now</span>
              <Badge variant="destructive" className="text-xs px-1.5 py-0 tabular-nums">
                <AnimatedCounter value={pendingDecisionCount} />
              </Badge>
              <ArrowRight className="w-3.5 h-3.5 md:w-3 md:h-3" aria-hidden="true" />
            </Link>
          )}
        </div>
      </div>

      {/* ── Empty-state: single pathway, persona-branched (W2.3) ─────── */}
      {showEmptyState && (
        <div className="space-y-4">
          <Card className="rounded-card border-primary/20 bg-gradient-to-br from-primary/5 to-accent/5 shadow-acr-2">
            <CardContent className="p-6 md:p-5 text-center space-y-3 md:space-y-2.5">
              <div className="inline-flex items-center justify-center w-12 h-12 md:w-10 md:h-10 rounded-full bg-primary/10">
                <Target className="w-6 h-6 md:w-5 md:h-5 text-primary" aria-hidden="true" />
              </div>
              <h2 className="text-xl md:text-lg font-bold md:font-semibold">{emptyStateContent.headline}</h2>
              <p className="text-muted-foreground md:text-sm max-w-md mx-auto leading-relaxed">
                {emptyStateContent.subtitle}
              </p>
              <div className="flex flex-wrap gap-2 justify-center pt-2">
                <Button asChild size="sm" className="min-h-11 pointer-fine:sm:min-h-9">
                  <Link href={emptyStateContent.primaryHref}>
                    <Map className="w-4 h-4 mr-1.5" aria-hidden="true" />
                    {emptyStateContent.primaryLabel}
                  </Link>
                </Button>
                <Button asChild size="sm" variant="outline" className="min-h-11 pointer-fine:sm:min-h-9">
                  <Link href={emptyStateContent.secondaryHref}>
                    <Users className="w-4 h-4 mr-1.5" aria-hidden="true" />
                    {emptyStateContent.secondaryLabel}
                  </Link>
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="min-h-11 pointer-fine:sm:min-h-9"
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
        </div>
      )}

      {/* ── Getting-started checklist (onboarding rebuild, 2026-07-29) ── */}
      {/* Mounted UNCONDITIONALLY — not inside the empty-state branch. The
          old mount made the checklist unreachable for any org with data,
          so it never functioned as onboarding. The component self-hides
          (returns null) once dismissed or genuinely complete, and shows
          for skipped-onboarding users as their gentle path in. */}
      <GettingStartedChecklist />

      {/* ── Welcome back (returning user, single card) ───────────────── */}
      {showWelcomeBack && (
        <Card className="rounded-card border-[color:var(--acr-brand)]/30 bg-acr-brand-soft shadow-acr-2" data-testid="welcome-back-card">
          <CardContent className="p-6 md:p-5 flex items-start justify-between gap-4 md:gap-3">
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
      {/* Hard error (nothing cached): the full error card replaces the
          sections below. Stale error (refetch failed over cached data):
          the quiet chip — the sections keep rendering the cached payload. */}
      {!showEmptyState && todayHardError && (
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
      {!showEmptyState && todayStaleError && (
        <StaleDataChip
          dataUpdatedAt={todayDataUpdatedAt}
          onRetry={() => refetchToday()}
          isRetrying={todayRefetching}
          testId="today-stale-chip"
        />
      )}

      {/* ── "Heading out?" affordance (Hank) ──────────────────────────
          Surfaces Drive Mode at the moment of need rather than waiting
          for the operator to remember the feature exists. Renders ABOVE
          the morning brief because it's about the *next two hours*, not
          the *last twelve*. Conditions: weekday 6am–11am local AND at
          least one drive-mode lead captured in the last 14 days. */}
      {!showEmptyState && !todayHardError && showHeadingOut && (
        <Card
          className="rounded-card border-[color:var(--acr-brand)]/30 bg-acr-brand-soft shadow-acr-1 mb-4"
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
                className="min-h-11 pointer-fine:sm:min-h-9 pointer-fine:md:h-8"
                data-testid="button-heading-out-open"
              >
                <Link href={DRIVE_MODE_ROUTE}>Open Drive Mode</Link>
              </Button>
              <button
                type="button"
                onClick={dismissHeadingOut}
                aria-label="Dismiss Heading out card for today"
                className="min-h-11 min-w-11 pointer-fine:sm:min-h-9 pointer-fine:sm:min-w-9 pointer-fine:md:h-8 pointer-fine:md:w-8 -mr-1 flex items-center justify-center rounded-full text-muted-foreground hover:bg-background/60 active:bg-background/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                data-testid="button-heading-out-dismiss"
              >
                <XIcon className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Morning brief — collapsed queue preamble (Tier 3C) ───────── */}
      {/* One-line disclosure directly above the queue, not a separate
          destination. Expands in place; Pax controls live behind it. */}
      {!showEmptyState && !todayHardError && <MorningBrief brief={today?.brief ?? null} />}

      {/* ── Receipts strip (Tier 3C) ─────────────────────────────────── */}
      {/* Completed events since the last visit, each traceable to real
          rows (pax_sends, completed payments). Renders nothing when there
          are none — no padding. */}
      {!showEmptyState && !todayHardError && (
        <ReceiptsStrip receipts={today?.receipts ?? []} />
      )}

      {/* ── Persona lede (Maren CPO #3 / Krieger UX) ─────────────────── */}
      {/* Each persona's own job, surfaced first: sourcing momentum (land),
          the owned tape (note investor), the origination pipeline (note
          originator), the servicing queue (note servicer), the redemption
          clock (tax-lien). Generic verticals render nothing here. */}
      {!showEmptyState && !todayHardError && todayLayout.Lede && (
        <todayLayout.Lede
          data={{
            pendingPayments30: cash?.pendingPayments30 ?? 0,
            lateCount: cash?.lateCount ?? 0,
            openDealsCount: cash?.openDealsCount ?? 0,
            openDealsValue: cash?.openDealsValue ?? 0,
          }}
        />
      )}

      {/* ── Section 2: Decision queue (merged) ───────────────────────── */}
      {!showEmptyState && !todayHardError && (
        <DecisionQueue
          items={decisionItems}
          isLoading={decisionQueueLoading}
          autoThreshold={autoThreshold}
          onResolve={handleResolve}
          resolvingIds={resolvingIds}
          clearedToday={today?.progress?.cleared ?? 0}
          totalToday={today?.progress?.total ?? 0}
          onClearAll={handleClearAll}
          isClearing={clearQueue.isPending}
        />
      )}

      {/* ── Section 3: Cash strip ────────────────────────────────────── */}
      {!showEmptyState && !todayHardError && (
        <CashStrip
          isLoading={todayLoading}
          cashOnHand={cash?.cashOnHand ?? 0}
          openDealsValue={cash?.openDealsValue ?? 0}
          openDealsCount={cash?.openDealsCount ?? 0}
          pendingPayments30={cash?.pendingPayments30 ?? 0}
          lateCount={cash?.lateCount ?? 0}
        />
      )}

      {/* ── Section 4: Parcel alerts (Iyari #5) ──────────────────────── */}
      {/* Owner-change / tax-status deltas detected on parcels in the
          pipeline, derived free from county records. Owns its own query
          + mark-read; behind the Today door per the five-doors rule. */}
      {!showEmptyState && !todayHardError && <ParcelAlerts />}

      {/* ── Referral nudge (Tier 2C) ─────────────────────────────────── */}
      {/* Post-first-value only (hasAnyData) and permanently dismissible.
          Sits low on the page on purpose — it's a quiet suggestion, not
          a banner competing with the operator's actual work. */}
      {!showEmptyState && !todayHardError && hasAnyData && !referralNudgeDismissed && (
        <Card className="rounded-card shadow-acr-1" data-testid="card-referral-nudge">
          <CardContent className="p-4 md:p-3 flex items-start justify-between gap-3">
            <div className="flex items-center gap-3 md:gap-2.5 min-w-0">
              <div className="p-2 rounded-card bg-primary/10 shrink-0">
                <Sparkles className="w-5 h-5 md:w-4 md:h-4 text-primary" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <h3 className="font-semibold text-sm md:text-[13px] leading-snug">
                  Working well?
                </h3>
                <p className="text-xs md:text-[11px] text-muted-foreground leading-snug">
                  Refer another Land Investor — you both earn a free month
                  when they close their first deal.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <Button
                asChild
                size="sm"
                variant="outline"
                className="min-h-11 pointer-fine:sm:min-h-9 pointer-fine:md:h-8"
                data-testid="button-referral-nudge-open"
              >
                <Link href="/settings?tab=account">Get your link</Link>
              </Button>
              <button
                type="button"
                onClick={dismissReferralNudge}
                aria-label="Dismiss referral suggestion"
                className="min-h-11 min-w-11 pointer-fine:sm:min-h-9 pointer-fine:sm:min-w-9 pointer-fine:md:h-8 pointer-fine:md:w-8 -mr-1 flex items-center justify-center rounded-full text-muted-foreground hover:bg-muted active:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                data-testid="button-referral-nudge-dismiss"
              >
                <XIcon className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Section 5: Activity feed ─────────────────────────────────── */}
      {/* Kept as a standalone component — it owns its own infinite-scroll
          pagination, so it is intentionally not merged into /api/today. */}
      {!showEmptyState && !todayHardError && <TodayActivityFeed />}
      </PullToRefresh>
    </PageShell>
  );
}
