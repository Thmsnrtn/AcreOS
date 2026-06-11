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
  Gauge,
  BarChart3,
} from "lucide-react";

import { PageShell } from "@/components/page-shell";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { PrefetchLink as Link } from "@/components/prefetch-link";
import { staggerContainer, staggerItem } from "@/lib/animations";
import { formatDate, formatRelative } from "@/lib/format";

// ─── API contracts (provisional — Lena's surfaces land in Phase 1) ────────

/**
 * GET /api/founder/money/summary (Lena #1).
 *
 * Now backed by the REAL three-scenario runway model
 * (server/services/finance/runwayModel.ts). `runwayMonths` is the BASE
 * scenario's months-to-zero (null only when there's no cash basis at all).
 * `scenarios` carries base / downside / upside, each with months-to-zero +
 * a week-over-week trend delta.
 */
interface RunwayScenario {
  monthsToZero: number | null;
  netMonthlyBurnUsd: number;
  monthlyCostsUsd: number;
  mrrUsd: number;
  monthsToZeroPriorWeek: number | null;
  wowDeltaMonths: number | null;
}

interface MoneySummary {
  asOf: string;
  cashOnHandUsd: number;
  monthlyBurnUsd: number;
  runwayMonths: number | null;
  method?: string;
  basis?: string;
  /** True — the surface is now a model, not an estimate. */
  isModeled?: boolean;
  /** True when the founder-declared override fed the cash basis. */
  cashDeclared?: boolean;
  /** "ledger" | "founder-declared". */
  cashBasis?: "ledger" | "founder-declared";
  scenarios?: {
    base: RunwayScenario;
    downside: RunwayScenario;
    upside: RunwayScenario;
  };
}

/** GET /api/founder/money/unit-economics (Lena #3). */
interface UnitEconomics {
  asOf: string;
  blendedGrossMarginPct: number;
  blendedGrossMarginUsd: number;
  totalMrrUsd: number;
  payingCustomerCount: number;
  cohortContribution: Array<{
    cohort: string;
    customers: number;
    mrrUsd: number;
    contributionUsd: number;
    contributionPerCustomerUsd: number;
  }>;
  cacAvailable: boolean;
  ltvCacRatio: number | null;
  paybackMonths: number | null;
  thresholds: {
    grossMarginFloorPct: number;
    ltvCacFloor: number;
    paybackCeilingMonths: number;
  };
  note: string;
}

/** GET /api/founder/money/paid-data-readiness (Lena #6). */
interface PaidDataReadiness {
  asOf: string;
  provider: string;
  justified: boolean;
  verdict: string;
  gate: {
    allowed: boolean;
    reason: string;
    trailingMrrDollars: number;
    mrrGateDollars: number;
    commitCeilingCents: number;
    minMonthlyCommitCents: number;
  };
  eval: {
    hasRun: boolean;
    ranAt: string | null;
    decisionFlipCount: number | null;
    decisionFlipRate: number | null;
    parcelsCompared: number | null;
  };
}

/**
 * GET /api/founder/money/envelopes — Phase 1 (Lena).
 * Provisional shape:
 *   { envelopes: [{ id, label, limitUsd, spentUsd, statusTone }] }
 */
interface EnvelopeRow {
  id: "build" | "brand" | "ops";
  /** Server-supplied label — the source of truth for what this envelope covers. */
  label: string;
  /** Server-supplied description, when provided. */
  description?: string | null;
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

/**
 * The runway model caps months-to-zero at this many months (see
 * RUNWAY_CAP_MONTHS in server/services/finance/runwayModel.ts). When a scenario
 * lands exactly on the cap the company is net cash-positive — rendering a
 * precise "120.0 mo" would imply a false precision, so we show a qualitative
 * "10y+ (cash-positive)" instead. Kept in sync with the server constant.
 */
const RUNWAY_CAP_MONTHS = 120;

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

/**
 * Runway-specific month formatter. At the model's cap the company is net
 * cash-positive (runway is effectively unbounded) — show that as a qualitative
 * ceiling rather than a falsely-precise "120.0 mo".
 */
function fmtRunwayMonths(value: number): string {
  if (!Number.isFinite(value)) return "—";
  if (value >= RUNWAY_CAP_MONTHS) return "10y+ (cash-positive)";
  return fmtMonths(value);
}

// ─── Phase 0 banner ──────────────────────────────────────────────────────

/**
 * The CFO's position — a single dated narrative synthesising runway, the
 * paid-data verdict, and the one money decision in front of the founder. Reads
 * the same endpoints the cards below render, so the banner is never out of sync
 * with the numbers. This is the "state a position, not six dashboards" surface.
 */
function CfoPositionBanner({
  summary,
  readiness,
}: {
  summary?: MoneySummary | null;
  readiness?: PaidDataReadiness | null;
}) {
  const base = summary?.scenarios?.base;
  const downside = summary?.scenarios?.downside;
  const trend =
    base?.wowDeltaMonths == null
      ? "stable WoW"
      : base.wowDeltaMonths > 0
        ? `+${base.wowDeltaMonths.toFixed(1)}mo WoW`
        : base.wowDeltaMonths < 0
          ? `${base.wowDeltaMonths.toFixed(1)}mo WoW`
          : "stable WoW";

  const runwayLine =
    base?.monthsToZero != null
      ? `Runway ${fmtRunwayMonths(base.monthsToZero)} base${
          downside?.monthsToZero != null
            ? ` / ${fmtRunwayMonths(downside.monthsToZero)} downside`
            : ""
        }, ${trend}.`
      : "Runway not yet modelable — no cash basis on the ledger.";

  const decisionLine = readiness
    ? readiness.justified
      ? `Decision: ${readiness.verdict}`
      : `Decision pending: ${readiness.verdict}`
    : null;

  return (
    <Card
      className="border-primary/30 bg-primary/5"
      data-testid="money-cfo-position"
    >
      <CardContent className="p-4 md:p-5">
        <div className="flex items-start gap-3">
          <div className="rounded-card bg-primary/10 p-2 shrink-0">
            <Info className="h-5 w-5 text-primary" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold text-foreground">
              Lena&apos;s position
              {summary?.asOf ? (
                <span className="ml-2 font-normal text-muted-foreground">
                  as of {formatDate(summary.asOf)}
                </span>
              ) : null}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground leading-relaxed">
              {runwayLine}
              {decisionLine ? <> {decisionLine}</> : null}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Runway + cash KPIs (three scenarios) ────────────────────────────────

function ScenarioCard({
  label,
  scenario,
  tone,
}: {
  label: string;
  scenario?: RunwayScenario;
  tone: "base" | "downside" | "upside";
}) {
  const border =
    tone === "downside"
      ? "border-acr-warn/40"
      : tone === "upside"
        ? "border-acr-pos/40"
        : "border-border";
  const delta = scenario?.wowDeltaMonths;
  return (
    <Card className={border} data-testid={`money-scenario-${tone}`}>
      <CardContent className="p-4">
        <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">
          {label}
        </div>
        <div className="text-3xl font-semibold tabular-nums text-foreground">
          {scenario?.monthsToZero != null
            ? fmtRunwayMonths(scenario.monthsToZero)
            : "—"}
        </div>
        <p className="text-xs text-muted-foreground mt-2">
          {scenario
            ? `${fmtUsd(scenario.monthlyCostsUsd)}/mo costs · ${fmtUsd(
                scenario.mrrUsd,
              )}/mo MRR`
            : "wiring up"}
          {delta != null && delta !== 0 ? (
            <span
              className={
                delta > 0 ? "text-acr-pos ml-1" : "text-acr-warn ml-1"
              }
            >
              · {delta > 0 ? "+" : ""}
              {delta.toFixed(1)}mo WoW
            </span>
          ) : delta === 0 ? (
            <span className="ml-1">· stable WoW</span>
          ) : null}
        </p>
      </CardContent>
    </Card>
  );
}

function RunwaySection({
  data,
  isLoading,
}: {
  data?: MoneySummary | null;
  isLoading: boolean;
}) {
  return (
    <section aria-busy={isLoading} data-testid="money-runway-section">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-foreground">
          Runway to zero
        </h2>
        <span className="text-[10px] font-medium text-muted-foreground/80 border border-border rounded px-1.5 py-0.5">
          {/* The model only has a real cash basis to stand behind once the
              ledger (or a founder-declared override) reports cash on hand.
              Until then it's "awaiting ledger", not a confident "modeled". */}
          {data && data.cashOnHandUsd > 0 ? "modeled" : "awaiting ledger"}
        </span>
      </div>
      {isLoading ? (
        <div className="grid gap-3 md:gap-4 grid-cols-1 sm:grid-cols-3">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
        </div>
      ) : (
        <>
          <div className="grid gap-3 md:gap-4 grid-cols-1 sm:grid-cols-3">
            <ScenarioCard
              label="Base"
              tone="base"
              scenario={data?.scenarios?.base}
            />
            <ScenarioCard
              label="Downside (flat rev · +20% cost)"
              tone="downside"
              scenario={data?.scenarios?.downside}
            />
            <ScenarioCard
              label="Upside (growth continues)"
              tone="upside"
              scenario={data?.scenarios?.upside}
            />
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            Cash {data ? fmtUsd(data.cashOnHandUsd) : "—"}
            {data?.cashBasis ? ` (${data.cashBasis})` : ""} ·{" "}
            {data?.basis ?? "three-scenario model off the financial ledger"}
          </p>
        </>
      )}
    </section>
  );
}

// ─── Unit economics: gross margin + LTV:CAC (honest) ─────────────────────

function UnitEconomicsSection() {
  const { data, isLoading } = useQuery<UnitEconomics | null>({
    queryKey: ["/api/founder/money/unit-economics"],
    queryFn: async () => {
      const res = await fetch("/api/founder/money/unit-economics", {
        credentials: "include",
      });
      if (!res.ok) return null;
      try {
        return (await res.json()) as UnitEconomics;
      } catch {
        return null;
      }
    },
    staleTime: 5 * 60_000,
    retry: false,
  });

  return (
    <Card aria-busy={isLoading} data-testid="money-unit-economics">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <DollarSign
            className="h-4 w-4 text-muted-foreground"
            aria-hidden="true"
          />
          Unit economics
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0 space-y-3">
        {isLoading ? (
          <Skeleton className="h-20 w-full" />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground">
                  Blended gross margin
                </div>
                <div className="text-2xl font-semibold tabular-nums text-foreground">
                  {data ? `${data.blendedGrossMarginPct.toFixed(1)}%` : "—"}
                </div>
                {/* Only assert the charter floor when the API has actually
                    returned the threshold — never print "(charter)" as fact
                    while loading or on a failed fetch. */}
                {data ? (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    floor {data.thresholds.grossMarginFloorPct}% (charter)
                  </p>
                ) : null}
              </div>
              <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground">
                  LTV : CAC
                </div>
                {/* Drive the ratio off the API contract: render the real ratio
                    only when the server says a CAC numerator exists, else the
                    honest "N/A". No hardcoded verdict. */}
                <div
                  className={`text-2xl font-semibold tabular-nums ${
                    data?.cacAvailable && data.ltvCacRatio != null
                      ? "text-foreground"
                      : "text-muted-foreground"
                  }`}
                >
                  {data?.cacAvailable && data.ltvCacRatio != null
                    ? `${data.ltvCacRatio.toFixed(1)}:1`
                    : "N/A"}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {data?.cacAvailable
                    ? `floor ${data.thresholds.ltvCacFloor}:1 (charter)`
                    : data?.note
                      ? "no CAC numerator yet"
                      : "no CAC data yet"}
                </p>
              </div>
            </div>
            {data && data.cohortContribution.length > 0 ? (
              <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">
                  Cohort contribution (per customer / mo)
                </div>
                <ul className="space-y-1">
                  {data.cohortContribution.map((c) => (
                    <li
                      key={c.cohort}
                      className="flex items-center justify-between text-sm"
                    >
                      <span className="text-foreground">
                        {c.cohort}{" "}
                        <span className="text-muted-foreground">
                          ({c.customers})
                        </span>
                      </span>
                      <span className="tabular-nums font-medium">
                        {fmtUsd(c.contributionPerCustomerUsd)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                {data?.note ??
                  "Cohort contribution appears once paying customers land."}
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Paid-data readiness verdict ─────────────────────────────────────────

function PaidDataReadinessSection({
  data,
  isLoading,
}: {
  data?: PaidDataReadiness | null;
  isLoading: boolean;
}) {
  const border = data?.justified
    ? "border-acr-pos/40"
    : "border-border";
  return (
    <Card
      className={border}
      aria-busy={isLoading}
      data-testid="money-paid-data-readiness"
    >
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <DollarSign
            className="h-4 w-4 text-muted-foreground"
            aria-hidden="true"
          />
          Paid-data readiness
          {data ? (
            <Badge
              variant={data.justified ? "default" : "outline"}
              className="text-xs ml-auto"
            >
              {data.justified ? "Justified" : "Not yet"}
            </Badge>
          ) : null}
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0 space-y-2">
        {isLoading ? (
          <Skeleton className="h-16 w-full" />
        ) : data ? (
          <>
            <p className="text-sm text-foreground leading-relaxed">
              {data.verdict}
            </p>
            <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
              <span>
                MRR {fmtUsd(data.gate.trailingMrrDollars)} / gate{" "}
                {fmtUsd(data.gate.mrrGateDollars)}
              </span>
              <span>
                {data.eval.hasRun
                  ? `${data.eval.decisionFlipCount ?? 0} decision flips`
                  : "no eval run yet"}
              </span>
            </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            Readiness verdict wiring up.
          </p>
        )}
      </CardContent>
    </Card>
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
  // The server-supplied label/description are the source of truth for what a
  // live envelope actually covers (e.g. a $50 AI-only cap is NOT the whole
  // engineering/product/infra budget). Fall back to the template copy only
  // when no live row is present.
  const displayLabel = row?.label ?? template.label;
  const displayDescription = row?.description || template.description;
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
              {displayLabel}
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
                {displayDescription}
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
                    {formatRelative(e.occurredAt)}
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

  // Lifted to the page so the position banner + runway cards read one fetch.
  const summaryQuery = useQuery<MoneySummary | null>({
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

  const readinessQuery = useQuery<PaidDataReadiness | null>({
    queryKey: ["/api/founder/money/paid-data-readiness"],
    queryFn: async () => {
      const res = await fetch("/api/founder/money/paid-data-readiness", {
        credentials: "include",
      });
      if (!res.ok) return null;
      try {
        return (await res.json()) as PaidDataReadiness;
      } catch {
        return null;
      }
    },
    staleTime: 5 * 60_000,
    retry: false,
  });

  return (
    <PageShell maxWidth="5xl" label="Founder money">
      <div className="space-y-4 md:space-y-6">
        <header className="space-y-1">
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-foreground">
            Money
          </h1>
          <p className="text-sm text-muted-foreground">
            Runway, unit economics, the paid-data verdict, and capital events.
          </p>
        </header>

        <CfoPositionBanner
          summary={summaryQuery.data}
          readiness={readinessQuery.data}
        />

        <RunwaySection
          data={summaryQuery.data}
          isLoading={summaryQuery.isLoading}
        />

        <div className="grid gap-3 md:gap-4 grid-cols-1 lg:grid-cols-2">
          <UnitEconomicsSection />
          <PaidDataReadinessSection
            data={readinessQuery.data}
            isLoading={readinessQuery.isLoading}
          />
        </div>

        <EnvelopesSection />

        <RecentEventsSection />

        {/* Door → live deep-data surfaces. This summary screen is the scannable
            top; the real per-line cost ledger and the full unit-economics
            breakdown live behind their own founder routes. */}
        <Card data-testid="money-deeper-links">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Go deeper</CardTitle>
          </CardHeader>
          <CardContent className="pt-0 grid gap-3 sm:grid-cols-2">
            <Button
              asChild
              variant="outline"
              className="h-auto justify-start py-3"
            >
              <Link
                href="/founder/cost"
                aria-label="Open the cost console"
                data-testid="link-money-cost"
              >
                <Gauge
                  className="mr-2 h-4 w-4 text-muted-foreground shrink-0"
                  aria-hidden="true"
                />
                <span className="min-w-0 text-left">
                  <span className="block text-sm font-medium text-foreground">
                    Cost console
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    Per-line burn, infra + AI spend, optimizer.
                  </span>
                </span>
                <ArrowRight
                  className="ml-auto h-4 w-4 text-muted-foreground shrink-0"
                  aria-hidden="true"
                />
              </Link>
            </Button>
            <Button
              asChild
              variant="outline"
              className="h-auto justify-start py-3"
            >
              <Link
                href="/founder/unit-economics"
                aria-label="Open the unit-economics breakdown"
                data-testid="link-money-unit-economics"
              >
                <BarChart3
                  className="mr-2 h-4 w-4 text-muted-foreground shrink-0"
                  aria-hidden="true"
                />
                <span className="min-w-0 text-left">
                  <span className="block text-sm font-medium text-foreground">
                    Unit economics
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    Gross margin, cohort contribution, LTV:CAC.
                  </span>
                </span>
                <ArrowRight
                  className="ml-auto h-4 w-4 text-muted-foreground shrink-0"
                  aria-hidden="true"
                />
              </Link>
            </Button>
          </CardContent>
        </Card>

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
