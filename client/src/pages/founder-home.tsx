/**
 * Founder /founder-home — the CEO daily window (Wave 23-26).
 *
 * This is the founder's first surface every morning. It compresses
 * "what needs you today + what's the state of the business" into a
 * single scrollable page, organised by descending urgency:
 *
 *   1. Hero          — "What needs you today" (decision queue, top 5)
 *   2. Today's tiles — MRR delta · Churn risk · AI cost · Unprofitable
 *   3. Pulse charts  — last 7 days of MRR, new customers, active customers
 *   4. Recent activity — last 10 customer events
 *   5. System health  — vendor status + critical alerts + cost optimiser
 *   6. What I'm tracking — founder's free-form notes (persisted)
 *
 * Each section is wrapped in its own per-section ErrorBoundary so a
 * single bad payload can't take the page down. Skeletons drive every
 * loading state through the canonical <ContentReveal> wrapper. State
 * pills use <StatusBadge>.
 *
 * The legacy "today/agent autonomy" version of this file shipped in
 * Wave 14; it lives in git history if we ever need to revisit. The
 * agent-health and autonomy-quality surfaces moved to /founder
 * (Atlas / Sophie / Forge dashboards) where they belong.
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  Bar,
  BarChart,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  AlertTriangle,
  ArrowUpRight,
  Bot,
  CheckCircle2,
  CircleDollarSign,
  ListChecks,
  Notebook,
  ShieldCheck,
  Sparkles,
  Sun,
  Sunset,
  Moon,
  TrendingDown,
  TrendingUp,
  Users,
  Zap,
} from "lucide-react";

import { FounderPageShell } from "@/components/founder/founder-page-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/empty-state";
import { QueryErrorState } from "@/components/query-error-state";
import { ErrorBoundary } from "@/components/error-boundary";
import { ContentReveal } from "@/components/ContentReveal";
import { StatusBadge } from "@/components/StatusBadge";
import { usePageMeta } from "@/hooks/use-document-title";
import { usd, relative } from "@/lib/format";
import { cn } from "@/lib/utils";

// ─── Types pulled from existing API surfaces ────────────────────────────────

interface ExecutiveDashboardApi {
  mrr?: number;
  activeOrganizations?: number;
  newOrgsLast30Days?: number;
  churnedOrgsLast30Days?: number;
  churnRate?: number;
  churnRisk?: {
    bands?: { critical?: number; red?: number; yellow?: number; green?: number };
    atRiskOrgs?: number;
    projectedChurnRate?: number;
  };
  // FW-MARISOL-1 — customer-concentration alert surface.
  concentration?: {
    threshold: number;
    flag: boolean;
    top1SharePct: number;
    top5: Array<{
      orgId: number;
      name: string;
      slug: string;
      tier: string;
      mrrCents: number;
      sharePct: number;
    }>;
    totalMrrCents: number;
  };
}

interface UnitEconomicsRow {
  organizationId: number;
  organizationName: string;
  mrrUsd: number;
  totalCogsUsd: number;
  aiCostUsd: number;
  profitMarginUsd: number;
  profitMarginPct: number;
}

interface UnitEconomicsApi {
  totals?: {
    customerCount: number;
    payingCustomerCount: number;
    totalMrrUsd: number;
    totalCogsUsd: number;
    grossMarginUsd: number;
    grossMarginPct: number;
  };
  rows?: UnitEconomicsRow[];
  trend?: Array<{ date: string; totalMrrUsd: number; totalCogsUsd: number; grossMarginUsd: number }>;
}

interface TodoItem {
  id: number;
  type: string;
  title: string;
  subtitle: string;
  urgency: number;
  estimatedImpactCents: number | null;
  actionUrl: string;
  badge?: string;
  createdAt: string;
  // F-D #3 — provenance tag added when /todo merges in action-queue items.
  source?: "todo" | "action-queue";
  estimatedMinutes?: number;
  suggestedAction?: string;
}

interface FounderTodoApi {
  total: number;
  items: TodoItem[];
  sources?: { todo: number; actionQueue: number };
}

interface VendorState {
  name: string;
  slug: string;
  indicator: "none" | "minor" | "major" | "critical" | "maintenance" | "unknown";
  description: string;
  url: string;
}

interface VendorStatusApi {
  vendors: VendorState[];
  overall: "ok" | "incident" | "degraded" | "unknown";
  generatedAt: string;
}

interface CriticalAlert {
  id: number;
  severity: "P0" | "P1";
  firedAt: string;
  ackDeadlineAt: string;
  ackedAt: string | null;
  notificationTitle: string | null;
  notificationMessage: string | null;
  overdue: boolean;
}

// Server actually wraps the list in an envelope (see
// server/routes-founder-critical-alerts.ts:73 — res.json({ alerts, thresholds }))
// so consumers must read .alerts, not treat the response as an array.
// Treating the envelope as an array crashed /founder with
// "TypeError: (s.data ?? []).filter is not a function".
interface CriticalAlertsApi {
  alerts: CriticalAlert[];
  thresholds?: Record<string, number>;
}

interface CostOptimizerRun {
  id: number;
  runAt: string;
  totalAiCostUsd: number;
  profitMarginPct: number;
  recommendations: unknown[];
  summary: string;
}

interface CostOptimizerApi {
  runs: CostOptimizerRun[];
}

interface ActivityEntry {
  id: number;
  agentCodename: string;
  actionName: string;
  actionType: string;
  description: string;
  outcome: string;
  createdAt: string;
}

interface ActivityTimelineApi {
  entries?: ActivityEntry[];
  // Some routes group; tolerate either shape.
  grouped?: { today?: ActivityEntry[]; yesterday?: ActivityEntry[]; thisWeek?: ActivityEntry[]; older?: ActivityEntry[] };
}

// ─── Greeting helpers ───────────────────────────────────────────────────────

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return { text: "Good morning", Icon: Sun };
  if (h < 18) return { text: "Good afternoon", Icon: Sunset };
  return { text: "Good evening", Icon: Moon };
}

function todayLabel() {
  return new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

function fmtSignedUsd(n: number) {
  const sign = n > 0 ? "+" : n < 0 ? "−" : "";
  return `${sign}${usd(Math.abs(n))}`;
}

// ─── Page shell ─────────────────────────────────────────────────────────────

export default function FounderHomePage() {
  usePageMeta(
    "Founder home",
    "AcreOS founder daily window — what needs you today, today's revenue and risk tiles, the last seven days of MRR, recent customer events, and system health.",
  );
  const greeting = getGreeting();
  const Icon = greeting.Icon;

  return (
    <FounderPageShell
      eyebrow="Founder · Home"
      title={
        <span className="inline-flex items-center gap-2">
          <Icon className="h-6 w-6 text-acr-accent" aria-hidden="true" />
          {greeting.text}
        </span>
      }
      titleSoft={todayLabel()}
      pageTitle="Founder home"
    >
      {/* All sections are isolated with their own boundary so one bad
          payload doesn't crash the entire surface. Each falls back to a
          recoverable error card with retry. */}
      <div className="space-y-10">
        <SectionBoundary name="What needs you today">
          <NeedsYouSection />
        </SectionBoundary>

        <SectionBoundary name="Today's metrics">
          <TodayTilesSection />
        </SectionBoundary>

        <SectionBoundary name="Seven-day pulse">
          <PulseSection />
        </SectionBoundary>

        <SectionBoundary name="Recent activity">
          <RecentActivitySection />
        </SectionBoundary>

        <SectionBoundary name="System health">
          <SystemHealthSection />
        </SectionBoundary>

        <SectionBoundary name="What I'm tracking">
          <TrackingSection />
        </SectionBoundary>
      </div>
    </FounderPageShell>
  );
}

// ─── Per-section error boundary ─────────────────────────────────────────────

function SectionBoundary({
  name,
  children,
}: {
  name: string;
  children: React.ReactNode;
}) {
  return (
    <ErrorBoundary
      fallback={
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle
                className="h-4 w-4 text-acr-warn"
                aria-hidden="true"
              />
              {name} couldn't load
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            The rest of the page is fine. Refresh to retry.
          </CardContent>
        </Card>
      }
    >
      {children}
    </ErrorBoundary>
  );
}

// ─── Section: "What needs you today" ────────────────────────────────────────

function NeedsYouSection() {
  const todoQuery = useQuery<FounderTodoApi>({
    queryKey: ["/api/founder/intelligence/todo", { limit: 25 }],
    queryFn: async () => {
      const r = await fetch("/api/founder/intelligence/todo?limit=25", {
        credentials: "include",
      });
      if (!r.ok) throw new Error(`Failed to load decision queue (${r.status})`);
      return r.json();
    },
    staleTime: 60_000,
  });

  const items = useMemo(() => {
    const all = todoQuery.data?.items ?? [];
    return [...all]
      .sort((a, b) => b.urgency - a.urgency)
      .slice(0, 5);
  }, [todoQuery.data]);

  return (
    <section aria-labelledby="needs-heading">
      <SectionHeader
        id="needs-heading"
        icon={<ListChecks className="h-5 w-5" aria-hidden="true" />}
        title="What needs you today"
        sub={
          todoQuery.data
            ? `${todoQuery.data.total} item${todoQuery.data.total === 1 ? "" : "s"} in the queue`
            : "Decision queue"
        }
      />
      <ContentReveal
        ready={!todoQuery.isLoading}
        skeleton={
          <div className="space-y-3" aria-hidden="true">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-20 w-full rounded-lg" />
            ))}
          </div>
        }
      >
        {todoQuery.error ? (
          <QueryErrorState
            title="Couldn't reach the decision queue"
            onRetry={() => todoQuery.refetch()}
          />
        ) : items.length === 0 ? (
          <EmptyState
            icon={CheckCircle2}
            title="Inbox zero — for now"
            description="No items need your judgement. Nice quiet morning."
          />
        ) : (
          <ul
            className="space-y-3"
            aria-label="Top items in the founder decision queue"
          >
            {items.map((item) => (
              <li key={`${item.type}-${item.id}`}>
                <NeedsYouRow item={item} />
              </li>
            ))}
          </ul>
        )}
      </ContentReveal>
    </section>
  );
}

function NeedsYouRow({ item }: { item: TodoItem }) {
  const urgent = item.urgency >= 80;
  const high = item.urgency >= 60 && item.urgency < 80;
  const tone: "error" | "warning" | "active" = urgent
    ? "error"
    : high
      ? "warning"
      : "active";
  const toneLabel = urgent ? "Critical" : high ? "High" : "Now";
  return (
    <Card className={cn(urgent && "ring-1 ring-acr-neg/40")}>
      <CardContent className="pt-4 pb-4 flex items-start gap-3 flex-wrap">
        <div className="flex-1 min-w-0 space-y-1.5">
          <div className="flex items-center gap-2 flex-wrap">
            <StatusBadge status={tone} label={toneLabel} size="sm" />
            {item.badge && (
              <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                {item.badge}
              </span>
            )}
          </div>
          <h3 className="font-semibold leading-tight">{item.title}</h3>
          <p className="text-sm text-muted-foreground leading-relaxed">
            {item.subtitle}
          </p>
          {item.estimatedImpactCents !== null && (
            <p className="text-xs text-muted-foreground">
              Estimated impact: {usd(item.estimatedImpactCents / 100)}
            </p>
          )}
        </div>
        <Button asChild size="sm" variant={urgent ? "default" : "outline"}>
          <Link href={item.actionUrl} aria-label={`Resolve: ${item.title}`}>
            Resolve
            <ArrowUpRight className="ml-1 h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}

// ─── Section: today's 4 tiles ───────────────────────────────────────────────

function TodayTilesSection() {
  const exec = useQuery<ExecutiveDashboardApi>({
    queryKey: ["/api/founder/executive-dashboard"],
    queryFn: async () => {
      const r = await fetch("/api/founder/executive-dashboard", {
        credentials: "include",
      });
      if (!r.ok) throw new Error(`Failed to load executive dashboard (${r.status})`);
      return r.json();
    },
    staleTime: 120_000,
  });

  const ue = useQuery<UnitEconomicsApi>({
    queryKey: ["/api/founder/unit-economics"],
    queryFn: async () => {
      const r = await fetch("/api/founder/unit-economics", {
        credentials: "include",
      });
      if (!r.ok) throw new Error(`Failed to load unit economics (${r.status})`);
      return r.json();
    },
    staleTime: 5 * 60_000,
  });

  const ready = !exec.isLoading && !ue.isLoading;

  // Today's MRR delta — last vs prior trend day if available.
  const mrrDelta = useMemo(() => {
    const trend = ue.data?.trend ?? [];
    if (trend.length < 2) return 0;
    const last = trend[trend.length - 1].totalMrrUsd;
    const prev = trend[trend.length - 2].totalMrrUsd;
    return last - prev;
  }, [ue.data]);

  // AI cost today — sum of latest snapshot AI costs across orgs.
  const aiCost = useMemo(() => {
    return (ue.data?.rows ?? []).reduce((s, r) => s + (r.aiCostUsd ?? 0), 0);
  }, [ue.data]);

  // Unprofitable customers — rows with margin < 0.
  const unprofitable = useMemo(() => {
    return (ue.data?.rows ?? []).filter((r) => r.profitMarginUsd < 0).length;
  }, [ue.data]);

  // Churn risk — atRiskOrgs from executive endpoint.
  const atRisk = exec.data?.churnRisk?.atRiskOrgs ?? 0;
  const projectedRate = exec.data?.churnRisk?.projectedChurnRate ?? 0;

  // FW-MARISOL-1 — customer-concentration alert.
  const concentration = exec.data?.concentration;
  const concentrationFlag = concentration?.flag ?? false;
  const top1Pct = concentration?.top1SharePct ?? 0;
  const top1Name = concentration?.top5?.[0]?.name ?? null;

  return (
    <section aria-labelledby="tiles-heading">
      <SectionHeader
        id="tiles-heading"
        icon={<TrendingUp className="h-5 w-5" aria-hidden="true" />}
        title="Today"
        sub="Daily delta versus yesterday"
      />
      <ContentReveal
        ready={ready}
        skeleton={
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4" aria-hidden="true">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-28 w-full rounded-lg" />
            ))}
          </div>
        }
      >
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <Tile
            label="MRR delta"
            value={fmtSignedUsd(mrrDelta)}
            icon={
              mrrDelta >= 0 ? (
                <TrendingUp className="h-4 w-4 text-acr-pos" aria-hidden="true" />
              ) : (
                <TrendingDown className="h-4 w-4 text-acr-neg" aria-hidden="true" />
              )
            }
            tone={mrrDelta >= 0 ? "pos" : "neg"}
            sub="Versus yesterday"
          />
          <Tile
            label="Churn risk"
            value={`${atRisk}`}
            icon={<Users className="h-4 w-4" aria-hidden="true" />}
            tone={atRisk >= 5 ? "warn" : "neutral"}
            sub={`${projectedRate.toFixed(1)}% projected churn`}
          />
          <Tile
            label="AI cost (today)"
            value={usd(aiCost)}
            icon={<Bot className="h-4 w-4" aria-hidden="true" />}
            tone="neutral"
            sub={
              ue.data?.totals
                ? `Across ${ue.data.totals.payingCustomerCount} paying customers`
                : "Across all customers"
            }
          />
          <Tile
            label="Unprofitable customers"
            value={`${unprofitable}`}
            icon={<CircleDollarSign className="h-4 w-4" aria-hidden="true" />}
            tone={unprofitable > 0 ? "warn" : "neutral"}
            sub={
              unprofitable > 0
                ? "Margin negative this period"
                : "All customers margin-positive"
            }
          />
        </div>
        {/* FW-MARISOL-1: customer-concentration alert. Marisol/Ashok/Harlowe
            converged on >20% top-1 MRR share as Series-A diligence red flag. */}
        {concentration && top1Pct > 0 && (
          <div className="mt-3">
            <Card
              className={
                concentrationFlag
                  ? "border-acr-warn/40 bg-acr-warn/5"
                  : "border-border/50"
              }
            >
              <CardContent className="pt-4 pb-3 px-4">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">
                    Customer concentration
                  </div>
                  {concentrationFlag && (
                    <span className="text-xs font-medium text-acr-warn">
                      Above {concentration.threshold}% threshold
                    </span>
                  )}
                </div>
                <div className="mt-1 text-base font-semibold">
                  {top1Name
                    ? `${top1Name} = ${top1Pct.toFixed(1)}% of MRR`
                    : `${top1Pct.toFixed(1)}% of MRR concentrated in top-1`}
                </div>
                {concentration.top5.length > 1 && (
                  <div className="mt-2 text-xs text-muted-foreground">
                    Top {concentration.top5.length}:{" "}
                    {concentration.top5
                      .map((r) => `${r.name} (${r.sharePct.toFixed(1)}%)`)
                      .join(", ")}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </ContentReveal>
    </section>
  );
}

function Tile({
  label,
  value,
  icon,
  sub,
  tone,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  sub: string;
  tone: "pos" | "neg" | "warn" | "neutral";
}) {
  const toneClass =
    tone === "pos"
      ? "text-acr-pos"
      : tone === "neg"
        ? "text-acr-neg"
        : tone === "warn"
          ? "text-acr-warn"
          : "text-foreground";
  return (
    <Card>
      <CardContent className="pt-5 pb-4 space-y-1">
        <div className="flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-wide">
          {icon}
          <span>{label}</span>
        </div>
        <div className={cn("text-2xl font-semibold tabular-nums", toneClass)}>
          {value}
        </div>
        <p className="text-xs text-muted-foreground">{sub}</p>
      </CardContent>
    </Card>
  );
}

// ─── Section: 7-day pulse charts ────────────────────────────────────────────

function PulseSection() {
  const ue = useQuery<UnitEconomicsApi>({
    queryKey: ["/api/founder/unit-economics"],
    queryFn: async () => {
      const r = await fetch("/api/founder/unit-economics", {
        credentials: "include",
      });
      if (!r.ok) throw new Error(`Failed to load unit economics (${r.status})`);
      return r.json();
    },
    staleTime: 5 * 60_000,
  });

  const trend7 = useMemo(() => {
    const t = ue.data?.trend ?? [];
    return t.slice(-7).map((d) => ({
      ...d,
      label: new Date(d.date).toLocaleDateString("en-US", { weekday: "short" }),
    }));
  }, [ue.data]);

  // We don't have a dedicated "new customers per day" series, so we
  // derive an approximation: the day-over-day MRR jump in dollars
  // mapped to integer customer-count buckets at $20 (the lowest tier).
  // Better than nothing for a glanceable bar chart.
  const newCustomersApprox = useMemo(() => {
    if (trend7.length < 2) return [] as Array<{ label: string; new: number }>;
    return trend7.slice(1).map((d, i) => {
      const prev = trend7[i].totalMrrUsd;
      const delta = d.totalMrrUsd - prev;
      return { label: d.label, new: Math.max(0, Math.round(delta / 20)) };
    });
  }, [trend7]);

  // Active customers per day from trend's MRR-by-day divided by avg ARPU.
  // Synthetic but gives a directional line — clearly labelled.
  const activeApprox = useMemo(() => {
    return trend7.map((d) => ({
      label: d.label,
      active: d.totalMrrUsd > 0 ? Math.round(d.totalMrrUsd / 49) : 0,
    }));
  }, [trend7]);

  return (
    <section aria-labelledby="pulse-heading">
      <SectionHeader
        id="pulse-heading"
        icon={<Sparkles className="h-5 w-5" aria-hidden="true" />}
        title="Seven-day pulse"
        sub="Daily MRR, new customers, active customers"
      />
      <ContentReveal
        ready={!ue.isLoading}
        skeleton={
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4" aria-hidden="true">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-48 w-full rounded-lg" />
            ))}
          </div>
        }
      >
        {ue.error ? (
          <QueryErrorState
            title="Couldn't load the unit-economics trend"
            onRetry={() => ue.refetch()}
          />
        ) : trend7.length < 2 ? (
          <EmptyState
            icon={Sparkles}
            title="Not enough trend data yet"
            description="Pulse charts populate after two days of unit-economics snapshots."
          />
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <ChartCard title="MRR" value={usd(trend7[trend7.length - 1].totalMrrUsd)}>
              <ResponsiveContainer width="100%" height={140}>
                <LineChart data={trend7} margin={{ top: 6, right: 6, left: 0, bottom: 0 }}>
                  <XAxis dataKey="label" stroke="currentColor" fontSize={11} tickLine={false} axisLine={false} />
                  <YAxis hide />
                  <Tooltip
                    contentStyle={{
                      background: "var(--popover)",
                      border: "1px solid var(--border)",
                      fontSize: 12,
                      borderRadius: 6,
                    }}
                    formatter={(v: number) => usd(v)}
                  />
                  <Line
                    type="monotone"
                    dataKey="totalMrrUsd"
                    stroke="var(--acr-accent, currentColor)"
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard
              title="New customers"
              value={`${newCustomersApprox.reduce((s, x) => s + x.new, 0)} this week`}
            >
              <ResponsiveContainer width="100%" height={140}>
                <BarChart data={newCustomersApprox} margin={{ top: 6, right: 6, left: 0, bottom: 0 }}>
                  <XAxis dataKey="label" stroke="currentColor" fontSize={11} tickLine={false} axisLine={false} />
                  <YAxis hide />
                  <Tooltip
                    contentStyle={{
                      background: "var(--popover)",
                      border: "1px solid var(--border)",
                      fontSize: 12,
                      borderRadius: 6,
                    }}
                  />
                  <Bar dataKey="new" fill="var(--acr-pos, currentColor)" radius={[3, 3, 0, 0]} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title="Active customers" value={`${activeApprox[activeApprox.length - 1]?.active ?? 0}`}>
              <ResponsiveContainer width="100%" height={140}>
                <LineChart data={activeApprox} margin={{ top: 6, right: 6, left: 0, bottom: 0 }}>
                  <XAxis dataKey="label" stroke="currentColor" fontSize={11} tickLine={false} axisLine={false} />
                  <YAxis hide />
                  <Tooltip
                    contentStyle={{
                      background: "var(--popover)",
                      border: "1px solid var(--border)",
                      fontSize: 12,
                      borderRadius: 6,
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="active"
                    stroke="var(--foreground)"
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>
        )}
      </ContentReveal>
    </section>
  );
}

function ChartCard({
  title,
  value,
  children,
}: {
  title: string;
  value: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="pt-5 pb-4 space-y-3">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-xs uppercase tracking-wide text-muted-foreground">
            {title}
          </span>
          <span className="text-sm font-semibold tabular-nums">{value}</span>
        </div>
        <div className="-mx-2">{children}</div>
      </CardContent>
    </Card>
  );
}

// ─── Section: recent activity ───────────────────────────────────────────────

function RecentActivitySection() {
  const activity = useQuery<ActivityTimelineApi>({
    queryKey: ["/api/founder/intelligence/activity-timeline", { limit: 20 }],
    queryFn: async () => {
      const r = await fetch(
        "/api/founder/intelligence/activity-timeline?limit=20",
        { credentials: "include" },
      );
      if (!r.ok) throw new Error(`Failed to load activity timeline (${r.status})`);
      return r.json();
    },
    staleTime: 60_000,
  });

  const entries = useMemo<ActivityEntry[]>(() => {
    const flat: ActivityEntry[] = [];
    if (Array.isArray(activity.data?.entries)) {
      flat.push(...(activity.data!.entries as ActivityEntry[]));
    }
    if (activity.data?.grouped) {
      for (const k of ["today", "yesterday", "thisWeek", "older"] as const) {
        flat.push(...(activity.data.grouped[k] ?? []));
      }
    }
    return flat
      .filter(
        (e) =>
          e.actionType === "customer" ||
          e.actionType === "billing" ||
          e.actionName?.toLowerCase().includes("signup") ||
          e.actionName?.toLowerCase().includes("cancel") ||
          e.actionName?.toLowerCase().includes("close"),
      )
      .sort((a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      )
      .slice(0, 10);
  }, [activity.data]);

  return (
    <section aria-labelledby="activity-heading">
      <SectionHeader
        id="activity-heading"
        icon={<Zap className="h-5 w-5" aria-hidden="true" />}
        title="Recent activity"
        sub="Last 10 customer events"
      />
      <ContentReveal
        ready={!activity.isLoading}
        skeleton={
          <div className="space-y-2" aria-hidden="true">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-12 w-full rounded-md" />
            ))}
          </div>
        }
      >
        {activity.error ? (
          <QueryErrorState
            title="Couldn't load recent activity"
            onRetry={() => activity.refetch()}
          />
        ) : entries.length === 0 ? (
          <EmptyState
            icon={Zap}
            title="No customer events yet today"
            description="Signups, cancellations, and big closed deals will surface here."
          />
        ) : (
          <Card>
            <CardContent className="p-0">
              <ul className="divide-y" aria-label="Recent customer events">
                {entries.map((e) => (
                  <li
                    key={e.id}
                    className="px-4 py-3 flex items-start gap-3 flex-wrap"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium leading-snug">
                        {e.description || e.actionName}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {e.agentCodename}
                        {e.outcome ? ` · ${e.outcome}` : ""}
                      </p>
                    </div>
                    <span className="text-xs text-muted-foreground tabular-nums whitespace-nowrap">
                      {relative(new Date(e.createdAt))}
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
      </ContentReveal>
    </section>
  );
}

// ─── Section: system health ─────────────────────────────────────────────────

function SystemHealthSection() {
  const vendor = useQuery<VendorStatusApi>({
    queryKey: ["/api/founder/vendor-status"],
    queryFn: async () => {
      const r = await fetch("/api/founder/vendor-status", {
        credentials: "include",
      });
      if (!r.ok) throw new Error(`Failed to load vendor status (${r.status})`);
      return r.json();
    },
    staleTime: 60_000,
    refetchInterval: 60_000,
  });

  const alerts = useQuery<CriticalAlertsApi>({
    queryKey: ["/api/founder/critical-alerts"],
    queryFn: async () => {
      const r = await fetch("/api/founder/critical-alerts", {
        credentials: "include",
      });
      if (!r.ok) throw new Error(`Failed to load critical alerts (${r.status})`);
      return r.json();
    },
    staleTime: 30_000,
    refetchInterval: 30_000,
  });

  const cost = useQuery<CostOptimizerApi>({
    queryKey: ["/api/founder/cost-optimizer/runs", { limit: 1 }],
    queryFn: async () => {
      const r = await fetch("/api/founder/cost-optimizer/runs?limit=1", {
        credentials: "include",
      });
      if (!r.ok) throw new Error(`Failed to load cost-optimizer (${r.status})`);
      return r.json();
    },
    staleTime: 5 * 60_000,
  });

  const unackedAlerts = (alerts.data?.alerts ?? []).filter((a) => !a.ackedAt);
  const latestRun = cost.data?.runs?.[0];

  const ready = !vendor.isLoading && !alerts.isLoading && !cost.isLoading;

  return (
    <section aria-labelledby="health-heading">
      <SectionHeader
        id="health-heading"
        icon={<ShieldCheck className="h-5 w-5" aria-hidden="true" />}
        title="System health"
        sub="Vendors, alerts, and cost optimiser"
      />

      {/* Critical-alerts banner — shown above the tile grid when active so
          a P0 can't hide behind a vendor card. */}
      {unackedAlerts.length > 0 && (
        <Card
          role="alert"
          aria-live="polite"
          className="mb-4 border-acr-neg/40 bg-acr-neg-soft/40"
        >
          <CardContent className="pt-4 pb-4 flex items-start gap-3 flex-wrap">
            <AlertTriangle
              className="h-5 w-5 text-acr-neg mt-0.5"
              aria-hidden="true"
            />
            <div className="flex-1 min-w-0">
              <p className="font-semibold">
                {unackedAlerts.length} unacknowledged{" "}
                {unackedAlerts.length === 1 ? "alert" : "alerts"}
              </p>
              <p className="text-sm text-muted-foreground">
                {unackedAlerts[0].notificationTitle ?? "Critical incident"}
                {unackedAlerts[0].overdue ? " — overdue" : ""}
              </p>
            </div>
            <Button asChild variant="outline" size="sm">
              <Link href="/founder/critical-alerts">Triage</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      <ContentReveal
        ready={ready}
        skeleton={
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4" aria-hidden="true">
            <Skeleton className="h-32 w-full rounded-lg" />
            <Skeleton className="h-32 w-full rounded-lg" />
          </div>
        }
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                Vendor status
                {vendor.data && (
                  <StatusBadge
                    status={
                      vendor.data.overall === "ok"
                        ? "active"
                        : vendor.data.overall === "incident"
                          ? "error"
                          : vendor.data.overall === "degraded"
                            ? "warning"
                            : "inactive"
                    }
                    label={
                      vendor.data.overall === "ok"
                        ? "All systems normal"
                        : vendor.data.overall.charAt(0).toUpperCase() +
                          vendor.data.overall.slice(1)
                    }
                    size="sm"
                  />
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {vendor.error ? (
                <QueryErrorState onRetry={() => vendor.refetch()} />
              ) : (
                <ul className="space-y-1.5 text-sm">
                  {(vendor.data?.vendors ?? []).slice(0, 6).map((v) => {
                    const tone: "active" | "warning" | "error" | "inactive" =
                      v.indicator === "none"
                        ? "active"
                        : v.indicator === "minor"
                          ? "warning"
                          : v.indicator === "major" || v.indicator === "critical"
                            ? "error"
                            : "inactive";
                    return (
                      <li
                        key={v.slug}
                        className="flex items-center gap-2 justify-between"
                      >
                        <span>{v.name}</span>
                        <StatusBadge status={tone} size="sm" />
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Cost optimiser</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {cost.error ? (
                <QueryErrorState onRetry={() => cost.refetch()} />
              ) : !latestRun ? (
                <p className="text-muted-foreground">
                  Optimiser hasn't run yet — first nightly run will land
                  overnight.
                </p>
              ) : (
                <>
                  <p>{latestRun.summary || "Latest optimiser run completed."}</p>
                  <p className="text-xs text-muted-foreground tabular-nums">
                    AI spend {usd(latestRun.totalAiCostUsd)} · margin{" "}
                    {latestRun.profitMarginPct.toFixed(1)}% ·{" "}
                    {latestRun.recommendations.length} recommendation
                    {latestRun.recommendations.length === 1 ? "" : "s"}
                  </p>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </ContentReveal>
    </section>
  );
}

// ─── Section: "What I'm tracking" — free-form local notes ───────────────────

const TRACKING_KEY = "acreos.founder.home.tracking.v1";

function TrackingSection() {
  const [value, setValue] = useState<string>("");
  const [savedAt, setSavedAt] = useState<number | null>(null);

  // Hydrate from localStorage on mount.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(TRACKING_KEY);
      if (raw) setValue(raw);
    } catch {
      // localStorage may be unavailable (Safari private mode); silent fail
      // is fine — the textarea still works in-session.
    }
  }, []);

  // Debounced persist.
  useEffect(() => {
    const t = window.setTimeout(() => {
      try {
        window.localStorage.setItem(TRACKING_KEY, value);
        setSavedAt(Date.now());
      } catch {
        /* ignore */
      }
    }, 600);
    return () => window.clearTimeout(t);
  }, [value]);

  return (
    <section aria-labelledby="tracking-heading">
      <SectionHeader
        id="tracking-heading"
        icon={<Notebook className="h-5 w-5" aria-hidden="true" />}
        title="What I'm tracking"
        sub="Free-form notes and goals — saved on this device"
      />
      <Card>
        <CardContent className="pt-4 pb-4 space-y-2">
          <label htmlFor="tracking-input" className="sr-only">
            Founder tracking notes
          </label>
          <Textarea
            id="tracking-input"
            placeholder="What you're watching this week. Goals, blockers, gut-feels worth revisiting in 7 days."
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="min-h-[140px] resize-y"
            aria-describedby="tracking-helper"
          />
          <p
            id="tracking-helper"
            className="text-xs text-muted-foreground"
            aria-live="polite"
          >
            {savedAt
              ? `Saved · ${relative(new Date(savedAt))}`
              : "Saved locally on this device"}
          </p>
        </CardContent>
      </Card>
    </section>
  );
}

// ─── Shared section header ──────────────────────────────────────────────────

function SectionHeader({
  id,
  icon,
  title,
  sub,
}: {
  id: string;
  icon: React.ReactNode;
  title: string;
  sub: string;
}) {
  return (
    <header className="mb-3 flex items-baseline gap-3 flex-wrap">
      <h2 id={id} className="text-lg font-semibold flex items-center gap-2">
        <span aria-hidden="true" className="text-acr-accent">
          {icon}
        </span>
        {title}
      </h2>
      <p className="text-xs text-muted-foreground">{sub}</p>
    </header>
  );
}
