import { lazy, Suspense, useState } from "react";
import { motion } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { PageShell } from "@/components/page-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useDocumentTitle } from "@/hooks/use-document-title";
import {
  Bot,
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
import { QueryErrorState } from "@/components/query-error-state";
import { EmptyState } from "@/components/empty-state";
import { PaxOverflowMenu } from "@/components/pax/pax-overflow-menu";
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
  high: "border-acr-neg",
  medium: "border-acr-warn",
  low: "border-acr-brand",
  info: "border-border",
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

const GREETING_DISMISSED_KEY = "pax_greeting_dismissed";

function GreetingBanner() {
  const [dismissed, setDismissed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(GREETING_DISMISSED_KEY) === "true";
    } catch {
      return false;
    }
  });

  const { data } = useQuery<{ message: string | null; isFirstSession: boolean }>({
    queryKey: ["/api/pax/greeting"],
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
    <div
      className="relative flex items-start gap-3 rounded-card border border-acr-brand/30 bg-acr-brand-soft p-4 mb-4"
      role="region"
      aria-label="First-session greeting from Pax"
    >
      <Sparkles className="h-5 w-5 text-acr-brand mt-0.5 shrink-0" aria-hidden="true" />
      <p className="text-sm text-acr-brand flex-1">{data.message}</p>
      <button
        type="button"
        onClick={handleDismiss}
        aria-label="Dismiss greeting from Pax"
        className="shrink-0 text-acr-brand/60 hover:text-acr-brand transition-colors"
      >
        <X className="h-4 w-4" aria-hidden="true" />
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

// ─── Insights Panel (rendered in the overflow drawer) ──────────────────────────

function InsightsPanel() {
  const [, setLocation] = useLocation();
  const { data, isLoading, error, refetch, isRefetching } = useQuery<InsightsData>({
    queryKey: ["/api/pax/insights"],
  });

  if (isLoading) {
    return (
      <div className="space-y-6" role="status" aria-label="Loading Pax insights">
        <div className="space-y-3">
          <Skeleton className="h-5 w-40" />
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-20 w-full rounded-card" />
          ))}
        </div>
        <div className="space-y-3">
          <Skeleton className="h-5 w-32" />
          {[1, 2].map((i) => (
            <Skeleton key={i} className="h-14 w-full rounded-card" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <QueryErrorState
        error={error}
        onRetry={() => refetch()}
        isRetrying={isRefetching}
        title="Couldn't load insights"
        description="Pax was unable to fetch your latest insights. Please try again."
        testId="insights-error"
      />
    );
  }

  const observations = data?.observations ?? [];
  const staleLeads = data?.staleLeads ?? [];
  const expiringOffers = data?.expiringOffers ?? [];
  const motivatedCallers = data?.motivatedCallers ?? [];

  const totalItems = observations.length + staleLeads.length + expiringOffers.length + motivatedCallers.length;

  if (totalItems === 0) {
    return (
      <EmptyState
        icon={Sparkles}
        headline="All clear — Pax is keeping watch."
        subtitle="No urgent actions. Your pipeline is in good shape. Check back after your next campaign sends."
        tone="celebratory"
        // TODO(cta): insights panel — no action available when all clear
        cta={{ label: "", _noOp: true }}
        testId="pax-insights-empty"
      />
    );
  }

  return (
    <div className="space-y-8">
      {/* Pax Noticed */}
      {observations.length > 0 && (
        <section aria-labelledby="pax-noticed-heading">
          <h2 id="pax-noticed-heading" className="text-xs font-semibold text-acr-ink-2 uppercase tracking-wide mb-3">
            Pax noticed
          </h2>
          <ul className="space-y-2 list-none p-0 m-0" aria-label="Observations Pax wants you to know about">
            {observations.map((obs) => {
              const impact = revenueImpact(obs.severity, obs.title);
              const isCritical = obs.severity === "high";
              return (
                <li
                  key={obs.id}
                  className={`rounded-card border-l-4 border border-border ${SEVERITY_BORDER[obs.severity] ?? SEVERITY_BORDER.info} bg-card p-4`}
                  role={isCritical ? "alert" : undefined}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <Badge
                          variant={SEVERITY_BADGE[obs.severity] ?? "outline"}
                          className="capitalize text-xs"
                          aria-label={`Severity: ${obs.severity}`}
                        >
                          {obs.severity}
                        </Badge>
                        {impact && (
                          <Badge
                            variant="outline"
                            className="text-xs text-acr-pos border-acr-pos/30 bg-acr-pos-soft"
                            aria-label={`Estimated revenue impact: ${impact.replace(/–/g, " to ")}`}
                          >
                            <DollarSign className="w-2.5 h-2.5 mr-0.5" aria-hidden="true" />
                            <span className="tabular-nums">{impact}</span>
                          </Badge>
                        )}
                        <span className="text-sm font-medium">{obs.title}</span>
                      </div>
                      <p className="text-sm text-muted-foreground">{obs.description}</p>
                    </div>
                    <Button size="sm" variant="outline" className="shrink-0 h-7 text-xs gap-1" asChild>
                      <Link href="/pipeline" aria-label={`Act on: ${obs.title}`}>
                        Act <ArrowRight className="w-3 h-3" aria-hidden="true" />
                      </Link>
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* Stale Leads */}
      {staleLeads.length > 0 && (
        <section aria-labelledby="stale-leads-heading">
          <h2 id="stale-leads-heading" className="text-xs font-semibold text-acr-ink-2 uppercase tracking-wide mb-3 flex items-center gap-2">
            <Clock className="w-3.5 h-3.5 text-acr-warn" aria-hidden="true" />
            Stale leads
            <Badge variant="outline" className="text-micro tabular-nums" aria-label={`${staleLeads.length} stale lead${staleLeads.length === 1 ? "" : "s"}`}>{staleLeads.length}</Badge>
          </h2>
          <ul className="space-y-2 list-none p-0 m-0" aria-label="Leads with no recent contact">
            {staleLeads.map((lead) => {
              const name = `${lead.firstName} ${lead.lastName}`.trim();
              const isAtRisk = lead.daysSinceContact >= 30;
              const sinceText = lead.daysSinceContact >= 999
                ? "Never contacted"
                : `${lead.daysSinceContact} day${lead.daysSinceContact === 1 ? "" : "s"} since contact`;
              return (
                <li
                  key={lead.id}
                  className="flex items-center justify-between rounded-card border border-acr-warn/30 bg-acr-warn-soft px-4 py-3"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className={`w-2 h-2 rounded-full shrink-0 ${isAtRisk ? "bg-acr-neg" : "bg-acr-warn"}`}
                      role="img"
                      aria-label={isAtRisk ? "At risk of going cold" : "Stale"}
                    />
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{name}</p>
                      <p className="text-xs text-muted-foreground">
                        <span className="tabular-nums">{sinceText}</span>
                        {isAtRisk && (
                          <span className="ml-1 text-acr-neg font-medium">· at risk of going cold</span>
                        )}
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-1.5 shrink-0">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs"
                      onClick={() => setLocation(`/leads/${lead.id}`)}
                      aria-label={`Follow up with ${name}`}
                    >
                      Follow up
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* Expiring Offers */}
      {expiringOffers.length > 0 && (
        <section aria-labelledby="expiring-offers-heading">
          <h2 id="expiring-offers-heading" className="text-xs font-semibold text-acr-ink-2 uppercase tracking-wide mb-3 flex items-center gap-2">
            <AlertCircle className="w-3.5 h-3.5 text-acr-neg" aria-hidden="true" />
            Expiring offers
            <Badge variant="destructive" className="text-micro tabular-nums" aria-label={`${expiringOffers.length} expiring offer${expiringOffers.length === 1 ? "" : "s"}`}>{expiringOffers.length}</Badge>
          </h2>
          <ul className="space-y-2 list-none p-0 m-0" aria-label="Offers nearing expiration">
            {expiringOffers.map((offer) => {
              const daysLeft = offer.offerExpiresAt
                ? Math.ceil((new Date(offer.offerExpiresAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
                : null;
              const expiryText = offer.offerExpiresAt
                ? daysLeft !== null && daysLeft <= 0
                  ? "Expired"
                  : daysLeft === 1
                  ? "Expires tomorrow"
                  : `${daysLeft} days left`
                : "Expiring soon";
              return (
                <li
                  key={offer.id}
                  className="flex items-center justify-between rounded-card border border-acr-neg/30 bg-acr-neg-soft px-4 py-3"
                  role="alert"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <AlertCircle className="h-4 w-4 text-acr-neg shrink-0" aria-hidden="true" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{offer.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {offer.leadName && <span className="mr-1">for {offer.leadName} ·</span>}
                        <span className="tabular-nums">{expiryText}</span>
                      </p>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="destructive"
                    className="h-7 text-xs shrink-0"
                    onClick={() => setLocation(`/deals/${offer.id}`)}
                    aria-label={`Review expiring offer: ${offer.title}`}
                  >
                    Review now
                  </Button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* Motivated Callers */}
      {motivatedCallers.length > 0 && (
        <section aria-labelledby="motivated-callers-heading">
          <h2 id="motivated-callers-heading" className="text-xs font-semibold text-acr-ink-2 uppercase tracking-wide mb-3 flex items-center gap-2">
            <Phone className="w-3.5 h-3.5 text-acr-pos" aria-hidden="true" />
            Motivated callers
            <Badge variant="outline" className="text-micro text-acr-pos border-acr-pos/30 tabular-nums" aria-label={`${motivatedCallers.length} motivated caller${motivatedCallers.length === 1 ? "" : "s"}`}>{motivatedCallers.length}</Badge>
          </h2>
          <ul className="space-y-2 list-none p-0 m-0" aria-label="Recently active leads who want to hear from you">
            {motivatedCallers.map((caller) => (
              <li
                key={caller.id}
                className="flex items-center justify-between rounded-card border border-acr-pos/30 bg-acr-pos-soft px-4 py-3"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className="w-8 h-8 rounded-full bg-acr-pos/20 flex items-center justify-center shrink-0"
                    aria-hidden="true"
                  >
                    <span className="text-xs font-bold text-acr-pos">
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
                      <a href={`tel:${caller.phone}`} aria-label={`Call ${caller.name} at ${caller.phone}`}>
                        <Phone className="w-3 h-3" aria-hidden="true" />
                        Call
                      </a>
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="default"
                    className="h-7 text-xs"
                    onClick={() => setLocation(`/leads/${caller.id}`)}
                    aria-label={`View lead: ${caller.name}`}
                  >
                    View
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
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
}

function PaxDailyCapBadge() {
  // Free tier: always show ("X/25 messages today") so the limit is visible
  // up-front rather than arriving as a surprise 429.
  // Paid (Starter/Pro): show only when usage >= 80% of cap, so the badge
  // becomes a warning instead of constant clutter. At 100% it flips to
  // destructive styling and surfaces an Upgrade CTA.
  // Scale tier has an unlimited cap (limit === null) and is skipped.
  const { data } = useQuery<UsageLimitsResponse>({
    queryKey: ["/api/usage"],
  });

  if (!data) return null;
  const { tier, usage } = data;
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
      ? `Daily ${tierLabel.toLowerCase()} limit reached — upgrade for more headroom.`
      : "Daily free-tier limit reached — upgrade for unlimited."
    : isWarning
      ? `Approaching daily ${tierLabel.toLowerCase()} limit — resets at midnight.`
      : "Free tier — resets daily at midnight.";

  return (
    <div
      className={containerClass}
      role={atLimit ? "alert" : isWarning ? "status" : undefined}
      aria-label={`Pax daily usage: ${cap.current} of ${cap.limit} messages today`}
    >
      <div className="flex items-center gap-2 text-sm">
        <Sparkles className={iconClass} aria-hidden="true" />
        <span className={valueClass}>
          {cap.current}/{cap.limit} messages today
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
    return (
      <EmptyState
        icon={Bot}
        headline="Pax is temporarily unavailable"
        subtitle="The AI service is not reachable right now. This usually clears in a minute or two."
        // TODO(cta): auto-recovers — no manual action available
        cta={{ label: "", _noOp: true }}
        testId="pax-ai-unavailable"
      />
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

const SUGGESTED_PROMPTS = [
  { label: "What's my pipeline worth?", icon: TrendingUp },
  { label: "Help me analyze a deal", icon: DollarSign },
  { label: "How's my note portfolio doing?", icon: CheckCircle2 },
  { label: "What should I work on today?", icon: Flame },
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
      animate="show"
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

export default function PaxPage() {
  useDocumentTitle("Pax");
  // Pax is ONE conversation. The chat is the primary, full-screen surface.
  // Everything that used to be a peer tab — Insights, Activity ("What Pax
  // did"), Agents (founder-only), Automation — is re-homed into the header
  // overflow menu, reachable FROM the conversation without competing with it.
  // The agent roster (Atlas/Sophie/Forge/Shield) remains founder-only per the
  // persona-architecture rule; PaxOverflowMenu gates the Agents entry behind
  // isFounder. Customers see Pax, not the dozen-agent roster underneath.
  return (
    <PageShell label="Pax">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-hero" data-testid="text-ai-hub-title">
            Pax
          </h1>
          <p className="text-sm text-acr-ink-2 mt-1">
            Ask anything about your portfolio, deals, or leads.
          </p>
        </div>
        <div className="shrink-0">
          <PaxOverflowMenu insightsContent={<InsightsPanel />} />
        </div>
      </div>

      <GreetingBanner />

      <div data-testid="pax-conversation">
        <AiChatGuard>
          <SuggestedPrompts />
          <Suspense fallback={<ChatFallback />}>
            <CommandCenterPage />
          </Suspense>
        </AiChatGuard>
      </div>
    </PageShell>
  );
}
