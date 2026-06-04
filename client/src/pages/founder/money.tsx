/**
 * /founder/money — the fourth of the five founder doors (Phase 5 of the Solene
 * migration).
 *
 * Mostly a Phase 0 placeholder until Lena (CFO) activates in Phase 1. The
 * Constitution L4 envelopes (Build / Brand / Ops) aren't wired to a live
 * capital_events table yet, so this surface is intentionally lean:
 *
 *   - "Runway" and "Cash on hand" as big numbers — pulled when a downstream
 *     endpoint lands, placeholder otherwise.
 *   - Three envelope status cards (Build / Brand / Ops) shown as Phase 0
 *     placeholders with a Lena-activates banner.
 *   - Recent capital events list — empty list with a placeholder if the
 *     endpoint is absent.
 *   - "Ask Solene about money" link at the bottom.
 *
 * No deep tables. Tom is layperson. One screen, scannable.
 *
 * Krieger-bar A11y discipline mirrors today.tsx + team.tsx.
 */

import React from "react";
import { motion } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import {
  DollarSign,
  Hammer,
  Megaphone,
  Cog,
  Sparkles,
  ArrowRight,
  Info,
} from "lucide-react";

import { PageShell } from "@/components/page-shell";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { PrefetchLink as Link } from "@/components/prefetch-link";
import { staggerContainer, staggerItem } from "@/lib/animations";

// ─── API contracts (provisional — Lena's surfaces land in Phase 1) ────────

/**
 * GET /api/founder/money/summary — Phase 1 (Lena).
 * Provisional shape:
 *   { asOf, cashOnHandUsd, monthlyBurnUsd, runwayMonths }
 *
 * Currently returns 404 / 501. The page renders a placeholder when so.
 */
interface MoneySummary {
  asOf: string;
  cashOnHandUsd: number;
  monthlyBurnUsd: number;
  runwayMonths: number;
}

/**
 * GET /api/founder/money/envelopes — Phase 1 (Lena).
 * Provisional shape:
 *   { envelopes: [{ id, label, limitUsd, spentUsd, statusTone }] }
 */
interface EnvelopeRow {
  id: "build" | "brand" | "ops";
  label: string;
  limitUsd: number;
  spentUsd: number;
  /** "ok" | "warn" | "over" — render tone */
  statusTone: "ok" | "warn" | "over";
}

/** GET /api/founder/money/events — Phase 1 (Lena). */
interface CapitalEvent {
  id: number | string;
  occurredAt: string;
  label: string;
  amountUsd: number;
  envelopeId?: string | null;
}

// ─── Helpers ────────────────────────────────────────────────────────────

function fmtUsd(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function fmtMonths(value: number): string {
  if (!Number.isFinite(value)) return "—";
  if (value < 1) return "<1 mo";
  return `${value.toFixed(1)} mo`;
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "—";
  const diffMs = Date.now() - then;
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// ─── Phase 0 banner ──────────────────────────────────────────────────────

function LenaPhase0Banner() {
  return (
    <Card
      className="border-primary/30 bg-primary/5"
      data-testid="money-lena-banner"
    >
      <CardContent className="p-4 md:p-5">
        <div className="flex items-start gap-3">
          <div className="rounded-card bg-primary/10 p-2 shrink-0">
            <Info className="h-5 w-5 text-primary" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold text-foreground">
              Lena (CFO) activates in Phase 1
            </h2>
            <p className="mt-1 text-sm text-muted-foreground leading-relaxed">
              The deeper money analysis — capital allocation, unit economics,
              founder draw schedule, envelope drift — lands when Lena comes
              online. Until then, this surface is read-only placeholders.
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Runway + cash KPIs ──────────────────────────────────────────────────

function RunwaySection() {
  const { data, isLoading } = useQuery<MoneySummary | null>({
    queryKey: ["/api/founder/money/summary"],
    queryFn: async () => {
      const res = await fetch("/api/founder/money/summary", {
        credentials: "include",
      });
      if (!res.ok) return null;
      try {
        return (await res.json()) as MoneySummary;
      } catch {
        return null;
      }
    },
    staleTime: 5 * 60_000,
    retry: false,
  });

  return (
    <div
      className="grid gap-3 md:gap-4 grid-cols-1 sm:grid-cols-2"
      aria-busy={isLoading}
      data-testid="money-runway-section"
    >
      <Card>
        <CardContent className="p-4">
          <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">
            Runway
          </div>
          {isLoading ? (
            <Skeleton className="h-9 w-24" />
          ) : (
            <div className="text-3xl font-semibold tabular-nums text-foreground">
              {data ? fmtMonths(data.runwayMonths) : "—"}
            </div>
          )}
          <p className="text-xs text-muted-foreground mt-2">
            {data
              ? `at ${fmtUsd(data.monthlyBurnUsd)} / mo burn`
              : "wired up in Phase 1"}
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-4">
          <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">
            Cash on hand
          </div>
          {isLoading ? (
            <Skeleton className="h-9 w-24" />
          ) : (
            <div className="text-3xl font-semibold tabular-nums text-foreground">
              {data ? fmtUsd(data.cashOnHandUsd) : "—"}
            </div>
          )}
          <p className="text-xs text-muted-foreground mt-2">
            {data
              ? `as of ${new Date(data.asOf).toLocaleDateString()}`
              : "wired up in Phase 1"}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Constitution L4 envelopes ───────────────────────────────────────────
//
// The three envelopes are Build / Brand / Ops per acreos_constitution.md L4.
// Until /api/founder/money/envelopes lands, render Phase 0 placeholders.

const ENVELOPE_TEMPLATES: Array<{
  id: EnvelopeRow["id"];
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  description: string;
}> = [
  {
    id: "build",
    label: "Build",
    icon: Hammer,
    description: "Engineering + product + infra spend.",
  },
  {
    id: "brand",
    label: "Brand",
    icon: Megaphone,
    description: "Acquisition, content, ads, partnerships.",
  },
  {
    id: "ops",
    label: "Ops",
    icon: Cog,
    description: "Salaries, tooling, admin, taxes.",
  },
];

function EnvelopeCard({
  template,
  row,
}: {
  template: (typeof ENVELOPE_TEMPLATES)[number];
  row: EnvelopeRow | null;
}) {
  const Icon = template.icon;
  const toneClass =
    row?.statusTone === "over"
      ? "border-acr-neg/40"
      : row?.statusTone === "warn"
        ? "border-acr-warn/40"
        : "border-border";
  const badgeLabel =
    row?.statusTone === "over"
      ? "Over"
      : row?.statusTone === "warn"
        ? "Tight"
        : row?.statusTone === "ok"
          ? "Healthy"
          : "Phase 0";

  return (
    <motion.div variants={staggerItem}>
      <Card
        className={toneClass}
        data-testid={`money-envelope-${template.id}`}
      >
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center justify-between text-base">
            <span className="inline-flex items-center gap-2">
              <Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              {template.label}
            </span>
            <Badge
              variant={row ? "default" : "outline"}
              className="text-xs"
            >
              {badgeLabel}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          {row ? (
            <>
              <div className="text-2xl font-semibold tabular-nums text-foreground">
                {fmtUsd(row.spentUsd)}
                <span className="text-sm font-normal text-muted-foreground ml-1">
                  / {fmtUsd(row.limitUsd)}
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {template.description}
              </p>
            </>
          ) : (
            <>
              <div className="text-sm text-muted-foreground">
                Envelope tracking ships with Lena's Phase 1.
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {template.description}
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}

function EnvelopesSection() {
  const { data, isLoading } = useQuery<{ envelopes: EnvelopeRow[] }>({
    queryKey: ["/api/founder/money/envelopes"],
    queryFn: async () => {
      const res = await fetch("/api/founder/money/envelopes", {
        credentials: "include",
      });
      if (!res.ok) return { envelopes: [] };
      try {
        return await res.json();
      } catch {
        return { envelopes: [] };
      }
    },
    staleTime: 5 * 60_000,
    retry: false,
  });

  const byId = new Map<string, EnvelopeRow>();
  for (const e of data?.envelopes ?? []) byId.set(e.id, e);

  return (
    <section aria-busy={isLoading} data-testid="money-envelopes-section">
      <h2 className="text-sm font-semibold text-foreground mb-3">
        Capital envelopes
      </h2>
      <motion.div
        variants={staggerContainer}
        initial="hidden"
        animate="visible"
        className="grid gap-3 md:gap-4 grid-cols-1 sm:grid-cols-3"
      >
        {ENVELOPE_TEMPLATES.map((t) => (
          <EnvelopeCard
            key={t.id}
            template={t}
            row={byId.get(t.id) ?? null}
          />
        ))}
      </motion.div>
    </section>
  );
}

// ─── Recent capital events ───────────────────────────────────────────────

function RecentEventsSection() {
  const { data, isLoading } = useQuery<{ events: CapitalEvent[] }>({
    queryKey: ["/api/founder/money/events", "recent"],
    queryFn: async () => {
      const res = await fetch("/api/founder/money/events?limit=5", {
        credentials: "include",
      });
      if (!res.ok) return { events: [] };
      try {
        return await res.json();
      } catch {
        return { events: [] };
      }
    },
    staleTime: 60_000,
    retry: false,
  });

  const events = data?.events ?? [];

  return (
    <Card aria-busy={isLoading} data-testid="money-events-section">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <DollarSign
            className="h-4 w-4 text-muted-foreground"
            aria-hidden="true"
          />
          Recent capital events
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {isLoading ? (
          <div className="space-y-2" aria-label="Loading events">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : events.length === 0 ? (
          <EmptyState
            icon={DollarSign}
            headline="No capital events yet"
            subtitle="When Lena comes online she'll log every inflow, outflow, and envelope adjustment here."
            // TODO(cta): Lena (CFO) is dormant until Phase 1 — no founder action available
            cta={{ label: "", _noOp: true }}
            actionIcon={null}
            testId="money-events-empty"
          />
        ) : (
          <ul className="space-y-1.5" aria-live="polite">
            {events.slice(0, 5).map((e) => (
              <li
                key={e.id}
                className="flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-muted/40 transition-colors"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-foreground truncate">
                    {e.label}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {relativeTime(e.occurredAt)}
                    {e.envelopeId ? ` · ${e.envelopeId}` : ""}
                  </p>
                </div>
                <span className="text-sm font-medium tabular-nums shrink-0">
                  {fmtUsd(e.amountUsd)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────

export default function FounderMoneyPage() {
  useDocumentTitle("Money · Founder");

  return (
    <PageShell maxWidth="5xl" label="Founder money">
      <div className="space-y-4 md:space-y-6">
        <header className="space-y-1">
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-foreground">
            Money
          </h1>
          <p className="text-sm text-muted-foreground">
            Runway, envelopes, and recent capital events.
          </p>
        </header>

        <LenaPhase0Banner />

        <RunwaySection />

        <EnvelopesSection />

        <RecentEventsSection />

        <div className="pt-2 text-center">
          <Link
            href="/founder/solene-chat"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            data-testid="link-ask-solene-money"
          >
            <Sparkles className="h-3 w-3" aria-hidden="true" />
            Ask Solene about money
            <ArrowRight className="h-3 w-3" aria-hidden="true" />
          </Link>
        </div>
      </div>
    </PageShell>
  );
}
