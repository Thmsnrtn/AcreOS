import { lazy, Suspense, useEffect } from "react";
import { trackCanonicalEvent } from "@/lib/analytics";
import { motion } from "framer-motion";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useDocumentTitle } from "@/hooks/use-document-title";
import {
  Bot,
  Sparkles,
  X,
  Clock,
  DollarSign,
  TrendingUp,
  CheckCircle2,
} from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { ErrorBoundary } from "@/components/error-boundary";
import { PaxOverflowMenu } from "@/components/pax/pax-overflow-menu";
import { PaxDisclosureRail } from "@/components/pax/pax-disclosure-rail";
import { PullToRefresh } from "@/components/mobile/PullToRefresh";
import { DURATIONS, EASINGS } from "@/lib/motion-tokens";
import { staggerContainer, staggerItem } from "@/lib/animations";
// The conversation is the primary surface. CommandCenterPage (~2,264 LOC) is
// lazy so opening /pax doesn't ship it in the parent chunk; it loads behind a
// Suspense fallback.
const CommandCenterPage = lazy(() => import("@/pages/command-center"));

// Lazy-load fallback — uses canonical motion tokens.
// Duration: DURATIONS.normal (0.25s); easing: linearExpo (snappy start, soft land).
function ChatFallback() {
  return (
    <motion.div
      className="flex items-center justify-center py-20"
      role="status"
      aria-live="polite"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: DURATIONS.normal, ease: EASINGS.linearExpo }}
    >
      <span className="text-sm text-acr-ink-3">Waking Pax…</span>
    </motion.div>
  );
}

// Chat-crash fallback — a VISIBLE, recoverable state shown if the lazy chat
// subtree (CommandCenterPage) throws at render. Without an error boundary
// scoped to JUST the chat, a single chat-render crash bubbles to PageShell's
// page-level boundary and blanks the WHOLE Pax surface (header + chat). This
// keeps the editorial header alive and degrades only the chat, with a path
// back (hard refresh pulls a fresh bundle if it was a stale-chunk crash).
function ChatErrorFallback() {
  return (
    <div
      role="alert"
      data-testid="pax-chat-error"
      className="flex flex-col items-center justify-center gap-3 rounded-card border border-border bg-muted/40 px-4 py-10 text-center"
    >
      <Bot className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
      <div className="text-sm">
        <span className="font-medium">Pax couldn't open the conversation.</span>{" "}
        <span className="text-muted-foreground">
          This usually clears with a refresh. Your tasks and history are safe.
        </span>
      </div>
      <Button
        size="sm"
        variant="outline"
        onClick={() => window.location.reload()}
        data-testid="pax-chat-error-refresh"
      >
        Refresh
      </Button>
    </div>
  );
}

// ─── Greeting Banner ──────────────────────────────────────────────────────────
//
// Phase Zero-Three (Beatrice audit 2026-06-01): server-side disclosure
// acknowledgement. The prior implementation gated visibility on a
// `pax_greeting_dismissed` localStorage key, which is not auditable for
// Constitution §7 / CO SB 24-205 §6-1-1703. The banner now persists until
// the user dismisses it, at which point we POST to
// /api/pax/acknowledge-disclosure (idempotent server set) and update the
// `/api/auth/user` cache so subsequent visits don't re-show the banner.
// The banner doubles as the first-interaction AI-disclosure surface —
// the copy explicitly names Pax as AI ("Pax is your AI-powered assistant…").

function GreetingBanner() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const acknowledged = user?.paxDisclosureAcknowledgedAt != null;

  // Only fetch the greeting copy while we still need to show it. Once the
  // server records the acknowledgement, the query stays disabled.
  const { data } = useQuery<{ message: string | null; isFirstSession: boolean }>({
    queryKey: ["/api/pax/greeting"],
    enabled: !!user && !acknowledged,
  });

  // Optimistic disclosure-ack: dismissing the banner stamps
  // `paxDisclosureAcknowledgedAt` into the auth-user cache the instant the
  // user taps, so the banner slides away without waiting on the round-trip
  // (which gates the banner via `acknowledged`). On error we restore the
  // pre-tap snapshot and the banner reappears; onSuccess swaps in the
  // server's canonical payload. The server set is idempotent, so a late
  // success after optimistic dismiss is harmless.
  const ackMutation = useMutation<
    unknown,
    unknown,
    void,
    { previousUser: unknown }
  >({
    mutationFn: async () => {
      const resp = await apiRequest("POST", "/api/pax/acknowledge-disclosure", {});
      return resp.json();
    },
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: ["/api/auth/user"] });
      const previousUser = queryClient.getQueryData(["/api/auth/user"]);
      queryClient.setQueryData(["/api/auth/user"], (prev: unknown) =>
        prev && typeof prev === "object"
          ? { ...(prev as Record<string, unknown>), paxDisclosureAcknowledgedAt: new Date().toISOString() }
          : prev,
      );
      return { previousUser };
    },
    onSuccess: (updatedUser) => {
      // Replace the optimistic stamp with the canonical payload returned by
      // the server, then invalidate so any other consumers re-read it.
      queryClient.setQueryData(["/api/auth/user"], updatedUser);
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
    },
    onError: (_err, _vars, context) => {
      // Restore the banner — the dismiss didn't land.
      if (context) {
        queryClient.setQueryData(["/api/auth/user"], context.previousUser);
      }
    },
  });

  // 2026-06-05 Krieger P2: idempotent fire-and-forget ack for users whose
  // history predates the schema add (server returns isFirstSession=false
  // + no message). Moved from inside the render branch to a useEffect so
  // React-18 strict-mode double-renders don't double-fire the POST.
  useEffect(() => {
    if (!user || acknowledged) return;
    if (data && !data.isFirstSession && !data.message) {
      if (!ackMutation.isPending && !ackMutation.isSuccess) {
        ackMutation.mutate();
      }
    }
    // ackMutation is stable across renders; we intentionally don't list it
    // in deps to avoid re-firing on transient state changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, acknowledged, data]);

  if (!user || acknowledged) {
    return null;
  }
  // Defer rendering until the greeting copy resolves — the server may return
  // isFirstSession=false for users whose history predates the schema add,
  // in which case the banner is suppressed without requiring a click.
  // 2026-06-05 Krieger P2: previously this branch fired ackMutation during
  // render. React-18 strict-mode double-renders intentionally, which
  // double-fired the POST. The effect below moves the fire-and-forget into
  // commit phase + makes it idempotent against the React lifecycle.
  if (!data?.isFirstSession || !data.message) {
    return null;
  }

  function handleDismiss() {
    ackMutation.mutate();
  }

  return (
    <div
      className="relative flex items-start gap-3 rounded-card border border-acr-brand/30 bg-acr-brand-soft p-4 mb-4"
      role="region"
      aria-label="First-session AI disclosure and greeting from Pax"
    >
      <Sparkles className="h-5 w-5 text-acr-brand mt-0.5 shrink-0" aria-hidden="true" />
      <p className="text-sm text-acr-brand flex-1">{data.message}</p>
      <button
        type="button"
        onClick={handleDismiss}
        disabled={ackMutation.isPending}
        aria-label="Dismiss greeting from Pax"
        className="shrink-0 flex h-11 w-11 -m-3 items-center justify-center text-acr-brand/60 active:text-acr-brand transition-colors disabled:opacity-50"
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}

// ─── AI Availability Check ───────────────────────────────────────────────────

interface HealthService {
  name: string;
  status: string;
  message?: string;
}

interface UsageLimitsResponse {
  tier: string;
  usage: {
    ai_requests: { current: number; limit: number | null; percentage: number | null };
  };
  /** Tier 1I — monthly AI-turn BYOK threshold snapshot. */
  aiTurns?: {
    current: number;
    threshold: number | null;
    percentage: number | null;
    warning: boolean;
    blocked: boolean;
    byokActive: boolean;
    byokAvailable: boolean;
    byokSettingsUrl: string;
  };
}

function PaxDailyCapBadge() {
  // Free tier: always show ("X/75 messages this month") so the limit is
  // visible up-front rather than arriving as a surprise 429.
  // Paid (Starter/Pro): show only when usage >= 80% of cap, so the badge
  // becomes a warning instead of constant clutter. At 100% it flips to
  // destructive styling and surfaces an Upgrade CTA.
  // Scale tier has an unlimited cap (limit === null) and is skipped.
  //
  // Window correction (2026-06-06): copy used to say "today" / "resets at
  // midnight" — that was the daily-window mistake. The cap is and has
  // always been a monthly budget; copy now matches the semantics.
  const { data } = useQuery<UsageLimitsResponse>({
    queryKey: ["/api/usage"],
  });

  if (!data) return null;
  const { tier, usage, aiTurns } = data;

  // ── Tier 1I — BYOK threshold banners (paid tiers) ────────────────────
  // An active AI key means unlimited turns on the customer's own key — no
  // badge at all. Otherwise: warn at ≥80% of the included allotment, and
  // render a helpful blocked state (never a dead end) at/past it.
  if (aiTurns?.byokActive) return null;
  if (aiTurns && aiTurns.threshold !== null && (aiTurns.blocked || aiTurns.warning)) {
    const blocked = aiTurns.blocked;
    return (
      <div
        className={
          blocked
            ? "mb-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-acr-neg/40 bg-acr-neg-soft px-3 py-2"
            : "mb-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-acr-warn/40 bg-acr-warn-soft px-3 py-2"
        }
        role={blocked ? "alert" : "status"}
        aria-label={`Pax included AI usage: ${aiTurns.current} of ${aiTurns.threshold} turns this month`}
      >
        <div className="flex items-center gap-2 text-sm">
          <Sparkles
            className={blocked ? "h-4 w-4 text-acr-neg" : "h-4 w-4 text-acr-warn"}
            aria-hidden="true"
          />
          <span className={blocked ? "font-medium tabular-nums text-acr-neg" : "font-medium tabular-nums text-acr-warn"}>
            {aiTurns.current}/{aiTurns.threshold} included turns this month
          </span>
          <span className={blocked ? "text-acr-neg" : "text-acr-warn"}>
            {blocked
              ? aiTurns.byokAvailable
                ? "Included AI usage is used up — add your own AI key to continue unlimited. Your data and drafts stay available."
                : "Included AI usage is used up — upgrade to bring your own AI key. Your data and drafts stay available."
              : "Approaching your included AI usage — add your own Anthropic key to continue unlimited."}
          </span>
        </div>
        <Button size="sm" variant={blocked ? "destructive" : "outline"} asChild>
          {aiTurns.byokAvailable ? (
            <Link href={aiTurns.byokSettingsUrl || "/settings/byok"}>Add your key</Link>
          ) : (
            <Link href="/pricing">Upgrade</Link>
          )}
        </Button>
      </div>
    );
  }

  const cap = usage.ai_requests;
  // Unlimited tier (Scale / founder) — no badge needed.
  if (cap.limit === null) return null;

  const ratio = cap.limit > 0 ? cap.current / cap.limit : 0;
  const atLimit = cap.current >= cap.limit;
  const isPaid = tier !== "free";
  const isWarning = ratio >= 0.8 && !atLimit;

  // Paid tiers below 80% stay quiet — no badge clutter.
  if (isPaid && ratio < 0.8) return null;

  const containerClass = atLimit
    ? "mb-4 flex items-center justify-between gap-3 rounded-md border border-acr-neg/40 bg-acr-neg-soft px-3 py-2"
    : isWarning
      ? "mb-4 flex items-center justify-between gap-3 rounded-md border border-acr-warn/40 bg-acr-warn-soft px-3 py-2"
      : "mb-4 flex items-center justify-between gap-3 rounded-md border border-dashed bg-muted/30 px-3 py-2";

  const iconClass = atLimit
    ? "h-4 w-4 text-acr-neg"
    : isWarning
      ? "h-4 w-4 text-acr-warn"
      : "h-4 w-4 text-muted-foreground";

  const valueClass = atLimit
    ? "font-medium tabular-nums text-acr-neg"
    : isWarning
      ? "font-medium tabular-nums text-acr-warn"
      : "font-medium tabular-nums";

  const captionClass = atLimit
    ? "text-acr-neg"
    : isWarning
      ? "text-acr-warn"
      : "text-muted-foreground";

  const tierLabel = isPaid
    ? tier.charAt(0).toUpperCase() + tier.slice(1)
    : "Free tier";

  const caption = atLimit
    ? isPaid
      ? `Monthly ${tierLabel.toLowerCase()} limit reached — upgrade for more headroom.`
      : "Monthly free-tier limit reached — upgrade for unlimited."
    : isWarning
      ? `Approaching monthly ${tierLabel.toLowerCase()} limit — resets on the 1st.`
      : "Free tier — resets on the 1st of the month.";

  return (
    <div
      className={containerClass}
      role={atLimit ? "alert" : isWarning ? "status" : undefined}
      aria-label={`Pax monthly usage: ${cap.current} of ${cap.limit} messages this month`}
    >
      <div className="flex items-center gap-2 text-sm">
        <Sparkles className={iconClass} aria-hidden="true" />
        <span className={valueClass}>
          {cap.current}/{cap.limit} messages this month
        </span>
        <span className={captionClass}>{caption}</span>
      </div>
      {(atLimit || isWarning) && (
        <Button size="sm" variant={atLimit ? "destructive" : "outline"} asChild>
          <Link href="/pricing">Upgrade</Link>
        </Button>
      )}
    </div>
  );
}

function AiChatGuard({ children }: { children: React.ReactNode }) {
  const { data: healthData, isLoading } = useQuery<{ services: HealthService[] }>({
    queryKey: ["/api/health/cached"],
  });

  // Platform AI is OpenRouter-only — the tiered router (SIMPLE → DeepSeek,
  // MODERATE → Haiku, COMPLEX → Sonnet, CRITICAL → Opus) keeps cost as low
  // as the task allows. Health check exposes the OpenRouter status; show a
  // soft empty state only when the underlying provider can't be reached.
  const aiService = healthData?.services?.find(
    s => s.name === "openrouter" || s.name === "openai",
  );
  const aiUnavailable = aiService?.status === "unconfigured";

  if (isLoading) {
    return (
      <div role="status" aria-busy="true" aria-label="Loading Pax availability">
        <Skeleton className="h-64 w-full rounded-card" />
        <span className="sr-only">Loading…</span>
      </div>
    );
  }

  if (aiUnavailable) {
    // Degrade the CHAT capability, not the whole surface. Tasks, the
    // conversation list, and the founder tabs (Team / Agents / AI Ops) don't
    // depend on the chat provider — replacing all of them with a dead-end
    // EmptyState turned a provider blip into a full-page outage. Render a
    // calm status banner and keep the surface alive; a send attempt while
    // down gets the server's own error toast, and health re-polls clear the
    // banner automatically.
    return (
      <>
        <div
          role="status"
          data-testid="pax-ai-unavailable"
          className="flex items-center gap-3 rounded-card border border-border bg-muted/50 px-4 py-3 mb-4"
        >
          <Bot className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <div className="text-sm">
            <span className="font-medium">Pax is temporarily unavailable.</span>{" "}
            <span className="text-muted-foreground">
              The AI service is not reachable right now — this usually clears in
              a minute or two. Your tasks and conversation history still work.
            </span>
          </div>
        </div>
        {children}
      </>
    );
  }

  return (
    <>
      <PaxDailyCapBadge />
      {children}
    </>
  );
}

// ─── Suggested Prompts ────────────────────────────────────────────────────────

// One ACTION prompt + three question prompts. Pax's differentiator is that it
// DOES the work (draft offers, draft follow-ups — every message waits for
// your tap), so the first impression must advertise the worker, not just the
// analyst. Skip-tracing is on the Never list (never from chat), so it is not
// advertised here. (Five-lens audit, wedge #3; Pax controls spec §6.)
const SUGGESTED_PROMPTS = [
  { label: "Draft a blind offer on my hottest lead", icon: DollarSign },
  { label: "Which of my leads went quiet this week?", icon: Clock },
  { label: "What's my pipeline worth?", icon: TrendingUp },
  { label: "What should I work on today?", icon: CheckCircle2 },
];

function SuggestedPrompts() {
  const { data: conversations } = useQuery<{ id: number }[]>({
    queryKey: ["/api/ai/conversations"],
  });

  // Only show when user has no conversations yet
  if (conversations && conversations.length > 0) return null;

  const handleClick = (prompt: string) => {
    // Find the textarea in the command center and populate it
    const textarea = document.querySelector<HTMLTextAreaElement>(
      '[data-testid="chat-input"], textarea[placeholder*="message"], textarea[placeholder*="Ask"]'
    );
    if (textarea) {
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      nativeInputValueSetter?.call(textarea, prompt);
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
      textarea.focus();
      // Try to submit by finding the send button
      setTimeout(() => {
        const sendBtn = textarea
          .closest("form")
          ?.querySelector<HTMLButtonElement>('button[type="submit"]');
        if (sendBtn) sendBtn.click();
      }, 100);
    }
  };

  return (
    <motion.div
      className="mb-6"
      variants={staggerContainer}
      initial="hidden"
      animate="visible"
    >
      <p id="suggested-prompts-label" className="text-xs font-semibold text-acr-ink-3 uppercase tracking-wide mb-3">
        Try asking Pax:
      </p>
      <ul
        className="grid grid-cols-1 sm:grid-cols-2 gap-2 list-none p-0 m-0"
        aria-labelledby="suggested-prompts-label"
      >
        {SUGGESTED_PROMPTS.map(({ label, icon: Icon }) => (
          <motion.li key={label} variants={staggerItem}>
            <Button
              variant="outline"
              className="justify-start gap-2 h-auto py-3 text-left w-full"
              onClick={() => handleClick(label)}
              aria-label={`Send to Pax: ${label}`}
            >
              <Icon className="w-4 h-4 shrink-0 text-acr-brand" aria-hidden="true" />
              <span className="text-sm">{label}</span>
            </Button>
          </motion.li>
        ))}
      </ul>
    </motion.div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

/**
 * Phase Zero-Two — canonical funnel event 4 of 5. Fires once per user on
 * the FIRST /pax visit, gated on the server-side disclosure timestamp
 * (users.pax_disclosure_acknowledged_at). Prior to Phase Zero-Three the
 * gate was a localStorage key; replaced with the auditable server-side
 * column required by Beatrice's audit (Constitution §7 + CO SB 24-205
 * §6-1-1703). Firing on the same signal as the disclosure ack means the
 * analytics event and the audit row are co-located: if the row exists,
 * the event was fired; if it doesn't, both will be on the next visit.
 *
 * Implementation note: we observe the auth-user object. When
 * paxDisclosureAcknowledgedAt is still null at first paint, we know this
 * IS the user's first /pax visit — fire the analytics event. The actual
 * server write happens in GreetingBanner's mutation; we only fire
 * analytics from the page-level observer so it doesn't double-fire if
 * the banner is suppressed (no greeting copy returned).
 */
export default function PaxPage() {
  useDocumentTitle("Pax");
  const { user } = useAuth();
  const queryClient = useQueryClient();

  // ── Pull-to-refresh (mobile only) ──────────────────────────────────────
  // A pull at the top re-pulls the queries the Pax door renders: the monthly
  // usage cap badge, the conversation list (which gates the suggested
  // prompts), the cached AI-health probe and the "Waiting for your tap"
  // queue. No-ops on pointer/desktop. Haptic fires inside PullToRefresh at
  // the threshold.
  const handlePullRefresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["/api/pax/needs-you"] }),
      queryClient.invalidateQueries({ queryKey: ["/api/pax/needs-you/count"] }),
      queryClient.invalidateQueries({ queryKey: ["/api/usage"] }),
      queryClient.invalidateQueries({ queryKey: ["/api/ai/conversations"] }),
      queryClient.invalidateQueries({ queryKey: ["/api/health/cached"] }),
    ]);
  };
  useEffect(() => {
    if (!user) return;
    if (user.paxDisclosureAcknowledgedAt != null) return;
    trackCanonicalEvent("pax_first_interaction", {
      surface: "pax_page_visit",
    });
    // Intentionally only depend on the boolean transition, not the full
    // user object — re-renders that don't change ack-state must not
    // re-fire the event.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, user?.paxDisclosureAcknowledgedAt]);
  // Pax is ONE conversation. The chat is the primary, full-screen surface.
  // Everything that used to be a peer tab — Controls, Activity ("What Pax
  // did"), Appeals, Agents (founder-only), Automation — is re-homed into the
  // header overflow menu, reachable FROM the conversation without competing
  // with it.
  // The agent roster (Atlas/Sophie/Forge/Shield) remains founder-only per the
  // persona-architecture rule; PaxOverflowMenu gates the Agents entry behind
  // isFounder. Customers see Pax, not the dozen-agent roster underneath.
  return (
    <PageShell label="Pax">
      {/* Pull-to-refresh wraps only the header + disclosure banner — the
          natural top-of-page pull zone — so it re-pulls Pax's sibling
          queries (usage cap / conversation list / health / queue) without
          fighting the chat composer's own scroll + input handling below.
          No-ops on pointer/desktop. */}
      <PullToRefresh onRefresh={handlePullRefresh}>
        {/* Bold Tahoe re-skin (Wave R, §3.1 signature editorial header):
            the eyebrow + Fraunces greeting + soft trailing clause pattern.
            `acr-cc-greeting` carries the Fraunces 600 / −0.03em identity that a
            raw `text-hero` would lose; the subtitle becomes the muted
            `acr-cc-greeting-soft` clause. data-testid preserved; visual-only. */}
        <div className="acr-cc-hero">
          <div>
            <div className="acr-eyebrow">Pax</div>
            <h1 className="acr-cc-greeting" data-testid="text-ai-hub-title">
              Ask Pax{" "}
              <span className="acr-cc-greeting-soft">
                anything about your portfolio, deals, or leads.
              </span>
            </h1>
          </div>
          <div className="acr-cc-hero-actions shrink-0">
            {/* The overflow menu carries the only founder-divergent header
                element (the isFounder-gated Agents entry). Scope a boundary
                here so a crash in the tools menu can't
                blank the header or, via PageShell's page-level boundary, the
                whole Pax door. It degrades to nothing — the menu is auxiliary;
                the conversation below is the primary surface. */}
            <ErrorBoundary fallback={null}>
              <PaxOverflowMenu />
            </ErrorBoundary>
          </div>
        </div>

        {/* The disclosure banner is non-essential chrome; never let it blank
            the surface. */}
        <ErrorBoundary fallback={null}>
          <GreetingBanner />
        </ErrorBoundary>
      </PullToRefresh>

      <div data-testid="pax-conversation">
        <AiChatGuard>
          <SuggestedPrompts />
          {/* Scoped boundary: a chat-render crash (incl. a stale lazy-chunk
              reject post-deploy — ErrorBoundary.componentDidCatch self-heals
              those by reloading) degrades ONLY the chat to a visible,
              refreshable fallback. It can no longer bubble to PageShell's
              page-level boundary and blank the whole Pax door (header +
              chat). The editorial header above stays rendered regardless. */}
          <ErrorBoundary fallback={<ChatErrorFallback />}>
            <Suspense fallback={<ChatFallback />}>
              <CommandCenterPage />
            </Suspense>
          </ErrorBoundary>
          {/* Standing AI-disclosure rail — always present beneath the composer
              on the Pax door. "Tool, not advisor" (doctrine pillar #1 +
              customer immutable #7). Calm, non-dismissible, copy sourced from a
              single constant in pax-disclosure-rail.tsx. */}
          <PaxDisclosureRail className="mt-3" />
        </AiChatGuard>
      </div>
    </PageShell>
  );
}
