/**
 * O6 (P5 §5) — the unit-economics RECEIPT in the Letter.
 *
 * "The monthly Letter states per-org margin from ledgers, not estimates."
 *
 * Every figure on this surface is read straight off
 * GET /api/founder/money/unit-economics-receipt, which derives it in
 * server/services/unitEconomics.ts from the persisted snapshots (themselves
 * derived from financial_ledger). This file contains NO arithmetic and NO
 * numeric literals in any rendered value: if the engine cannot source a
 * number, the payload carries `null` plus an `absent` sentence, and that
 * sentence is what renders. A zero is only ever shown when the engine
 * measured a zero — and it is shown with its evidence ("$0 across 0 billed
 * events"), because a $0 cost with no billed events is a weaker claim than a
 * $0 cost with a thousand of them, and a badge may not claim stronger
 * evidence than its derivation supports.
 *
 * Two deliberate distinctions the payload keeps and this surface repeats:
 *
 *   ATTRIBUTABLE cost — the five ledger-sourced COGS columns. Real money we
 *   spent because that customer used the product.
 *
 *   ALLOCATED fixed share — declared monthly constants (Fly/Postgres/Clerk/
 *   Sentry) divided by the paying-customer count. An allocation, not a
 *   measurement. It renders in its own line, labelled, and is NEVER folded
 *   into "what this customer costs us".
 *
 * Auxiliary-signal discipline (the StepAwayLine / GovernanceRulesRow /
 * StaffBlindnessLines pattern): the Letter never blocks on this section —
 * loading renders nothing, and a FAILED read says so in a muted line rather
 * than being pixel-identical to a healthy one.
 */
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, Receipt, TrendingDown, TrendingUp } from "lucide-react";
import { PrefetchLink } from "@/components/prefetch-link";
import { usd } from "@/lib/format";

// ── Response shapes (mirror server/services/unitEconomics.ts) ───────────────

export interface ReceiptFigure {
  value: number | null;
  source: string;
  href: string;
  absent: string | null;
}

export interface ReceiptCustomerRow {
  organizationId: number;
  organizationName: string;
  subscriptionTier: string;
  mrrUsd: number;
  attributableCostUsd: number;
  contributionUsd: number;
  contributionPct: number | null;
  allocatedFixedShareUsd: number;
  billedEvents: number | null;
  costEvidence: "billed" | "no_billed_events" | "unknown";
  consecutiveUnprofitableDays: number;
  windowDays: number | null;
  computedAt: string;
  source: string;
  href: string;
}

export interface ReceiptDirection {
  available: boolean;
  reason: string;
  fromDate: string | null;
  toDate: string | null;
  fromContributionPerCustomerUsd: number | null;
  toContributionPerCustomerUsd: number | null;
  deltaUsd: number | null;
  pointCount: number;
  spanDays: number;
}

export interface UnitEconomicsReceiptPayload {
  asOf: string;
  rollup: {
    customersWithSnapshot: ReceiptFigure;
    payingCustomers: ReceiptFigure;
    billedEvents: ReceiptFigure;
    revenueUsd: ReceiptFigure;
    attributableCostUsd: ReceiptFigure;
    contributionUsd: ReceiptFigure;
    contributionPct: ReceiptFigure;
    allocatedFixedShareUsd: ReceiptFigure;
    grossMarginPct: ReceiptFigure;
  };
  marginFloorPct: number;
  belowFloor: boolean | null;
  customers: ReceiptCustomerRow[];
  coverage: {
    organizationsTotal: number;
    withSnapshot: number;
    withoutSnapshot: number;
    missing: Array<{ organizationId: number; organizationName: string }>;
    line: string;
  };
  freshness: {
    newestComputedAt: string | null;
    oldestComputedAt: string | null;
    ageDays: number | null;
    stale: boolean;
    staleAfterDays: number;
    line: string;
  };
  direction: ReceiptDirection;
}

export interface InfraCurvePoint {
  date: string;
  orgCount: number;
  mrrUsd: number;
  variableCostUsd: number;
  allocatedFixedShareUsd: number;
  totalCogsUsd: number;
  unitsOfWork: number;
  costPerUnitUsd: number | null;
  variableCostPerOrgUsd: number | null;
  windowDays: number;
}

export interface InfraCurvePayload {
  asOf: string;
  sufficient: boolean;
  reason: string;
  minPointsRequired: number;
  points: InfraCurvePoint[];
  latest: InfraCurvePoint | null;
  declaredFixedInputsUsdMonthly: {
    fly: number;
    postgres: number;
    clerk: number;
    sentry: number;
    total: number;
  };
  notMeasured: string[];
  href: string;
}

export interface UnitEconomicsReceiptResponse {
  receipt: UnitEconomicsReceiptPayload;
  curve: InfraCurvePayload;
}

export const UNIT_ECONOMICS_RECEIPT_KEY = ["/api/founder/money/unit-economics-receipt"];

/**
 * The single read behind BOTH O6 surfaces (the Letter section and the
 * /founder/admin/costs infra panel), so the two can never disagree about the
 * same month's numbers.
 */
export function useUnitEconomicsReceipt() {
  return useQuery<UnitEconomicsReceiptResponse>({
    queryKey: UNIT_ECONOMICS_RECEIPT_KEY,
    queryFn: async () => {
      const res = await fetch("/api/founder/money/unit-economics-receipt", {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`unit-economics receipt ${res.status}`);
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });
}

// ── Figure rendering — a value or its honest absence, never a stand-in ──────

/**
 * One figure. When the engine sourced it, the number renders as a LINK to what
 * produced it (the handoff's "every number a link"). When it could not, the
 * engine's own `absent` sentence renders instead — there is no code path here
 * that turns a null into a 0.
 */
function Figure({
  label,
  figure,
  format,
  sub,
  testId,
}: {
  label: string;
  figure: ReceiptFigure;
  format: (n: number) => string;
  /** Optional qualifier under the value (evidence, or a narrower count). */
  sub?: string;
  testId: string;
}) {
  if (figure.value === null) {
    return (
      <div className="min-w-0" data-testid={`${testId}-absent`}>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
          {figure.absent ?? "Not available."}
        </p>
      </div>
    );
  }
  return (
    <div className="min-w-0">
      <p className="text-xs text-muted-foreground">{label}</p>
      <PrefetchLink
        href={figure.href}
        title={figure.source}
        className="mt-0.5 inline-flex items-baseline gap-1 rounded-sm text-base font-semibold tabular-nums underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        data-testid={testId}
      >
        {format(figure.value)}
        <ArrowUpRight className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden="true" />
      </PrefetchLink>
      {sub && (
        <p className="mt-0.5 text-[11px] leading-tight text-muted-foreground" data-testid={`${testId}-sub`}>
          {sub}
        </p>
      )}
    </div>
  );
}

const pct = (n: number) => `${n}%`;

/** What a customer's cost figure is actually evidenced by. */
function evidenceLine(row: ReceiptCustomerRow): string {
  if (row.costEvidence === "unknown") {
    return "no billed-event count on this snapshot — cost strength unknown";
  }
  if (row.costEvidence === "no_billed_events") {
    return "no billed events in the window — nothing was charged to us for this customer";
  }
  const events = row.billedEvents ?? 0;
  return `${events} billed ${events === 1 ? "event" : "events"} on the ledger`;
}

// ── The Letter section ──────────────────────────────────────────────────────

/**
 * The receipt, as the Letter reads it: the platform roll-up, which way it is
 * moving, and the customers at the edges. Deep detail (every org, every cost
 * column, the infra curve) lives one tap away in the costs hub — the Letter
 * stays a letter.
 */
export function UnitEconomicsReceiptSection() {
  const { data, isError } = useUnitEconomicsReceipt();

  if (isError) {
    return (
      <p
        className="rounded-lg border border-border bg-card/60 p-3 text-sm text-muted-foreground"
        data-testid="letter-unit-economics-error"
      >
        Couldn't read the unit-economics receipt just now — that's about this page, not your margins.
      </p>
    );
  }
  if (!data) return null;

  const { receipt } = data;
  const { rollup, direction, coverage } = receipt;

  return (
    <div className="rounded-lg border border-border bg-card p-3" data-testid="letter-unit-economics-receipt">
      <div className="flex items-center gap-2">
        <Receipt className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <p className="text-sm font-medium">What each customer contributes</p>
      </div>

      {/* The roll-up. Contribution = revenue − ATTRIBUTABLE cost; the allocated
          fixed share is shown on its own, labelled, below. */}
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {/* ORGS, qualified by the paying count — computeAllOrgs snapshots
            every org, so free tiers, trials and the demo org are in the first
            number. Labelling that "customers" overstated the roster. */}
        <Figure
          label="Orgs with a snapshot"
          figure={rollup.customersWithSnapshot}
          format={(n) => String(n)}
          sub={
            rollup.payingCustomers.value != null
              ? `${rollup.payingCustomers.value} paying`
              : undefined
          }
          testId="receipt-customer-count"
        />
        <Figure
          label="Revenue (monthly)"
          figure={rollup.revenueUsd}
          format={(n) => usd(n)}
          testId="receipt-revenue"
        />
        {/* $0 across 0 billed events is not the same fact as $0 spent — the
            roll-up carries its evidence, exactly as the per-customer rows do. */}
        <Figure
          label="Attributable cost"
          figure={rollup.attributableCostUsd}
          format={(n) => usd(n)}
          sub={
            rollup.billedEvents.value != null
              ? `across ${rollup.billedEvents.value.toLocaleString()} billed events`
              : "billed-event count unavailable"
          }
          testId="receipt-attributable-cost"
        />
        <Figure
          label="Contribution"
          figure={rollup.contributionUsd}
          format={(n) => usd(n)}
          testId="receipt-contribution"
        />
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Figure
          label="Contribution margin (excl. fixed share)"
          figure={rollup.contributionPct}
          format={pct}
          testId="receipt-contribution-pct"
        />
        <Figure
          label="Gross margin (incl. fixed share)"
          figure={rollup.grossMarginPct}
          format={pct}
          testId="receipt-gross-margin-pct"
        />
        <Figure
          label="Allocated fixed share (not attributable)"
          figure={rollup.allocatedFixedShareUsd}
          format={(n) => usd(n)}
          testId="receipt-allocated-fixed"
        />
      </div>

      {/* The declared floor, judged on GROSS margin — the figure the charter is
          written against. Judging it on contribution (which excludes the
          allocated fixed share, and so always reads higher) would flatter the
          company by exactly the size of the allocation. `belowFloor: null`
          renders nothing: an unmeasurable margin cannot pass or fail a gate. */}
      {/* A pass/fail verdict on STALE arithmetic is a present-tense claim the
          data cannot back, so the floor line is suppressed once the roll-up
          ages past its declared threshold (fleet-9 verifier catch). */}
      {receipt.belowFloor !== null && !receipt.freshness.stale && (
        <p
          className={`mt-3 text-xs leading-relaxed ${
            receipt.belowFloor ? "text-acr-warn" : "text-muted-foreground"
          }`}
          data-testid="receipt-floor-line"
        >
          {receipt.belowFloor
            ? `Gross margin is below the declared ${receipt.marginFloorPct}% floor.`
            : `Gross margin is at or above the declared ${receipt.marginFloorPct}% floor.`}
        </p>
      )}

      {/* How current these figures are — with an AGE, not just a date. */}
      <p
        className={`mt-2 text-xs leading-relaxed ${
          receipt.freshness.stale ? "text-acr-warn" : "text-muted-foreground"
        }`}
        data-testid="receipt-freshness"
      >
        {receipt.freshness.line}
      </p>

      {/* Direction of travel — stated only when the history supports it. */}
      <div className="mt-3 border-t border-border pt-3">
        {direction.available && direction.deltaUsd !== null ? (
          <p className="flex items-start gap-2 text-xs leading-relaxed text-foreground" data-testid="receipt-direction">
            {direction.deltaUsd < 0 ? (
              <TrendingDown className="mt-0.5 h-3.5 w-3.5 shrink-0 text-acr-warn" aria-hidden="true" />
            ) : (
              <TrendingUp className="mt-0.5 h-3.5 w-3.5 shrink-0 text-acr-pos" aria-hidden="true" />
            )}
            <span>
              Contribution per customer moved{" "}
              <span className="font-medium tabular-nums" data-testid="receipt-direction-delta">
                {usd(direction.deltaUsd, { showSign: true })}
              </span>{" "}
              since {direction.fromDate} —{" "}
              <span className="tabular-nums">{usd(direction.fromContributionPerCustomerUsd)}</span> →{" "}
              <span className="tabular-nums">{usd(direction.toContributionPerCustomerUsd)}</span>.{" "}
              {direction.reason}
            </span>
          </p>
        ) : (
          <p className="text-xs leading-relaxed text-muted-foreground" data-testid="receipt-direction-absent">
            No direction of travel yet. {direction.reason}
          </p>
        )}
      </div>

      {/* Who is NOT in these numbers. Orgs without a snapshot are excluded,
          never averaged in as zeros — so the exclusion has to be said. */}
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground" data-testid="receipt-coverage">
        {coverage.line}
      </p>

      {/* The edges of the distribution — the engine sorts margin ASC, so the
          first rows are the customers costing the most relative to what they
          pay. Empty renders nothing: there is no row to show. */}
      {receipt.customers.length > 0 && (
        <ul role="list" className="mt-3 space-y-2 border-t border-border pt-3" data-testid="receipt-customer-rows">
          {receipt.customers.slice(0, 3).map((row) => (
            <li key={row.organizationId} className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <PrefetchLink
                  href={row.href}
                  title={row.source}
                  className="rounded-sm text-xs font-medium underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  data-testid={`receipt-row-${row.organizationId}`}
                >
                  {row.organizationName}
                </PrefetchLink>
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  {usd(row.mrrUsd)} in, {usd(row.attributableCostUsd)} out — {evidenceLine(row)}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p
                  className={`text-xs font-semibold tabular-nums ${
                    row.contributionUsd < 0 ? "text-acr-neg" : "text-foreground"
                  }`}
                  data-testid={`receipt-row-contribution-${row.organizationId}`}
                >
                  {usd(row.contributionUsd, { showSign: true })}
                </p>
                <p className="text-[11px] tabular-nums text-muted-foreground">
                  {row.contributionPct === null ? "no revenue — margin undefined" : `${row.contributionPct}%`}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}

      <PrefetchLink
        href={rollup.contributionUsd.href}
        className="mt-3 inline-flex items-center gap-1 rounded-sm text-xs text-muted-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        data-testid="receipt-open-hub"
      >
        Every customer, every cost column, and the infra curve
        <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
      </PrefetchLink>
    </div>
  );
}
