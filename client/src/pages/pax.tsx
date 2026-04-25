import { useEffect, useState, lazy, Suspense } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { PageShell } from "@/components/page-shell";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";
import { useDocumentTitle } from "@/hooks/use-document-title";
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
  Settings,
} from "lucide-react";
import { QueryErrorState } from "@/components/query-error-state";
import CommandCenterPage from "@/pages/command-center";

const ActivityPage = lazy(() => import("@/pages/activity"));
const AutomationPage = lazy(() => import("@/pages/automation"));
const AgentCommandCenterPage = lazy(() => import("@/pages/agent-command-center"));

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
    <div className="flex items-center justify-center py-20" role="status" aria-live="polite">
      <div className="animate-pulse text-muted-foreground text-sm">Waking Pax…</div>
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
      className="relative flex items-start gap-3 rounded-lg border border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/40 p-4 mb-4"
      role="region"
      aria-label="First-session greeting from Pax"
    >
      <Sparkles className="h-5 w-5 text-blue-500 mt-0.5 shrink-0" aria-hidden="true" />
      <p className="text-sm text-blue-800 dark:text-blue-200 flex-1">{data.message}</p>
      <button
        type="button"
        onClick={handleDismiss}
        aria-label="Dismiss greeting from Pax"
        className="shrink-0 text-blue-400 hover:text-blue-600 dark:hover:text-blue-200 transition-colors"
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

// ─── Insights Tab Content ─────────────────────────────────────────────────────

function InsightsTabContent() {
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
      <div className="flex flex-col items-center justify-center py-20 text-center space-y-2" role="status">
        <Sparkles className="h-8 w-8 text-muted-foreground mb-2" aria-hidden="true" />
        <p className="text-base font-medium text-muted-foreground">
          All clear — Pax is keeping watch.
        </p>
        <p className="text-sm text-muted-foreground max-w-sm">
          No urgent actions. Your pipeline is in good shape. Check back after your next campaign sends.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Pax Noticed */}
      {observations.length > 0 && (
        <section aria-labelledby="pax-noticed-heading">
          <h2 id="pax-noticed-heading" className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
            Pax noticed
          </h2>
          <ul className="space-y-2 list-none p-0 m-0" aria-label="Observations Pax wants you to know about">
            {observations.map((obs) => {
              const impact = revenueImpact(obs.severity, obs.title);
              const isCritical = obs.severity === "high";
              return (
                <li
                  key={obs.id}
                  className={`rounded-lg border-l-4 border border-border ${SEVERITY_BORDER[obs.severity] ?? SEVERITY_BORDER.info} bg-card p-4`}
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
                            className="text-xs text-emerald-700 border-emerald-300 bg-emerald-50 dark:bg-emerald-900/20"
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
          <h2 id="stale-leads-heading" className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3 flex items-center gap-2">
            <Clock className="w-3.5 h-3.5 text-amber-500" aria-hidden="true" />
            Stale leads
            <Badge variant="outline" className="text-[10px] tabular-nums" aria-label={`${staleLeads.length} stale lead${staleLeads.length === 1 ? "" : "s"}`}>{staleLeads.length}</Badge>
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
                  className="flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-900/10 px-4 py-3"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className={`w-2 h-2 rounded-full shrink-0 ${isAtRisk ? "bg-red-500" : "bg-amber-500"}`}
                      role="img"
                      aria-label={isAtRisk ? "At risk of going cold" : "Stale"}
                    />
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{name}</p>
                      <p className="text-xs text-muted-foreground">
                        <span className="tabular-nums">{sinceText}</span>
                        {isAtRisk && (
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
          <h2 id="expiring-offers-heading" className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3 flex items-center gap-2">
            <AlertCircle className="w-3.5 h-3.5 text-red-500" aria-hidden="true" />
            Expiring offers
            <Badge variant="destructive" className="text-[10px] tabular-nums" aria-label={`${expiringOffers.length} expiring offer${expiringOffers.length === 1 ? "" : "s"}`}>{expiringOffers.length}</Badge>
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
                  className="flex items-center justify-between rounded-lg border border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-900/10 px-4 py-3"
                  role="alert"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <AlertCircle className="h-4 w-4 text-red-500 shrink-0" aria-hidden="true" />
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
          <h2 id="motivated-callers-heading" className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3 flex items-center gap-2">
            <Phone className="w-3.5 h-3.5 text-emerald-500" aria-hidden="true" />
            Motivated callers
            <Badge variant="outline" className="text-[10px] text-emerald-700 border-emerald-300 tabular-nums" aria-label={`${motivatedCallers.length} motivated caller${motivatedCallers.length === 1 ? "" : "s"}`}>{motivatedCallers.length}</Badge>
          </h2>
          <ul className="space-y-2 list-none p-0 m-0" aria-label="Recently active leads who want to hear from you">
            {motivatedCallers.map((caller) => (
              <li
                key={caller.id}
                className="flex items-center justify-between rounded-lg border border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-900/10 px-4 py-3"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className="w-8 h-8 rounded-full bg-emerald-200 dark:bg-emerald-800 flex items-center justify-center shrink-0"
                    aria-hidden="true"
                  >
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

function AiChatGuard({ children }: { children: React.ReactNode }) {
  const { data: healthData, isLoading } = useQuery<{ services: HealthService[] }>({
    queryKey: ["/api/health/cached"],
  });

  const openaiService = healthData?.services?.find(s => s.name === "openai");
  const aiUnavailable = openaiService?.status === "unconfigured";

  if (isLoading) return <Skeleton className="h-64 w-full rounded-lg" />;

  if (aiUnavailable) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center justify-center py-16 text-center space-y-4">
          <div className="p-4 rounded-full bg-muted" aria-hidden="true">
            <Bot className="h-8 w-8 text-muted-foreground" />
          </div>
          <div className="space-y-2 max-w-md">
            <h3 className="text-lg font-semibold">Pax needs an OpenAI API key</h3>
            <p className="text-sm text-muted-foreground">
              Configure it in Settings → Integrations to start chatting with Pax.
            </p>
          </div>
          <Button variant="outline" asChild>
            <Link href="/settings#integrations">
              <Settings className="w-4 h-4 mr-2" aria-hidden="true" />
              Go to integrations
            </Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return <>{children}</>;
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
    <div className="mb-6">
      <p id="suggested-prompts-label" className="text-sm text-muted-foreground mb-3">Try asking Pax:</p>
      <ul
        className="grid grid-cols-1 sm:grid-cols-2 gap-2 list-none p-0 m-0"
        aria-labelledby="suggested-prompts-label"
      >
        {SUGGESTED_PROMPTS.map(({ label, icon: Icon }) => (
          <li key={label}>
            <Button
              variant="outline"
              className="justify-start gap-2 h-auto py-3 text-left w-full"
              onClick={() => handleClick(label)}
              aria-label={`Send to Pax: ${label}`}
            >
              <Icon className="w-4 h-4 shrink-0 text-primary" aria-hidden="true" />
              <span className="text-sm">{label}</span>
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function PaxPage() {
  useDocumentTitle("Pax — AI hub");
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
    <PageShell label="Pax AI hub">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold" data-testid="text-ai-hub-title">
          AI hub
        </h1>
        <p className="text-muted-foreground text-sm md:text-base">
          AI assistant, agents, and automation for your land business.
        </p>
      </div>

      <GreetingBanner />

      <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-6" data-testid="tabs-ai-hub">
        <TabsList className="w-full sm:w-auto overflow-x-auto flex-nowrap" data-testid="tabs-list-ai-hub">
          <TabsTrigger value="insights" className="flex items-center gap-2 min-w-max" data-testid="tab-insights">
            <Sparkles className="h-4 w-4" aria-hidden="true" />
            <span>Insights</span>
          </TabsTrigger>
          <TabsTrigger value="chat" className="flex items-center gap-2 min-w-max" data-testid="tab-chat">
            <MessageSquare className="h-4 w-4" aria-hidden="true" />
            <span>Chat</span>
          </TabsTrigger>
          <TabsTrigger value="activity" className="flex items-center gap-2 min-w-max" data-testid="tab-activity">
            <Activity className="h-4 w-4" aria-hidden="true" />
            <span>Activity</span>
          </TabsTrigger>
          <TabsTrigger value="agents" className="flex items-center gap-2 min-w-max" data-testid="tab-agents">
            <Bot className="h-4 w-4" aria-hidden="true" />
            <span>Agents</span>
          </TabsTrigger>
          <TabsTrigger value="automation" className="flex items-center gap-2 min-w-max" data-testid="tab-automation">
            <Zap className="h-4 w-4" aria-hidden="true" />
            <span>Automation</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="insights" data-testid="tab-content-insights">
          <InsightsTabContent />
        </TabsContent>

        <TabsContent value="chat" data-testid="tab-content-chat">
          <AiChatGuard>
            <SuggestedPrompts />
            <CommandCenterPage />
          </AiChatGuard>
        </TabsContent>

        <TabsContent value="activity" data-testid="tab-content-activity">
          <Suspense fallback={<TabFallback />}>
            <ActivityPage />
          </Suspense>
        </TabsContent>

        <TabsContent value="agents" data-testid="tab-content-agents">
          <Suspense fallback={<TabFallback />}>
            <AgentCommandCenterPage />
          </Suspense>
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
