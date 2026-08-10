/**
 * O6 (P5 §5.3) — "the infra curve, watched."
 *
 * Cost per unit of work over the real snapshot history, rendered inside the
 * /founder/admin/costs instrument hub (Unit economics tab). Founder-instrument
 * depth — deliberately NOT a top-level founder route.
 *
 * The whole point of this panel is the refusal at the top of it. Two points do
 * not make a curve, and a line drawn through two points flatters the data in
 * exactly the direction a founder wants to be flattered. So the server decides
 * whether a curve may be drawn at all (`sufficient`, with the minimum in
 * `minPointsRequired`), and when it says no this panel prints the reason
 * instead of a chart. There is no client-side override.
 *
 * Three further honesty rules this panel carries:
 *
 *   • OVERLAPPING WINDOWS. Each snapshot is a trailing-N-day rollup, so
 *     consecutive days share most of their inputs. The server says so in
 *     `reason`; the panel repeats it verbatim rather than implying daily
 *     resolution it does not have.
 *   • DECLARED ≠ MEASURED. Fly/Postgres/Clerk/Sentry are constants declared in
 *     code, not vendor invoices. They render under a "declared" heading.
 *   • NAMED BLIND SPOTS. Real cost lines nothing meters (storage, egress,
 *     map-tile serving, canary compute) are listed from `notMeasured`, so the
 *     measured total is never mistaken for the whole bill.
 */
import { Activity, HelpCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryErrorState } from "@/components/query-error-state";
import { EmptyState } from "@/components/empty-state";
import { usd } from "@/lib/format";
import {
  useUnitEconomicsReceipt,
  type InfraCurvePayload,
  type InfraCurvePoint,
} from "@/components/founder/UnitEconomicsReceipt";

/** How many recent snapshot days the readable table lists. Display only. */
const TABLE_ROWS = 14;

// ── The sparkline ───────────────────────────────────────────────────────────

interface Segment {
  d: string;
}

/**
 * Build polyline segments for the drawable points, SPLITTING on days where
 * cost-per-unit is undefined (no billed work). A gap is drawn as a gap — the
 * line is never bridged across a day we cannot compute.
 */
function buildSegments(points: InfraCurvePoint[]): { segments: Segment[]; min: number; max: number } {
  const values = points.map((p) => p.costPerUnitUsd);
  const present = values.filter((v): v is number => v !== null);
  const min = Math.min(...present);
  const max = Math.max(...present);
  const span = max - min || 1;
  const stepX = points.length > 1 ? 100 / (points.length - 1) : 0;

  const segments: Segment[] = [];
  let current: string[] = [];
  points.forEach((p, i) => {
    if (p.costPerUnitUsd === null) {
      if (current.length > 1) segments.push({ d: `M ${current.join(" L ")}` });
      current = [];
      return;
    }
    const x = i * stepX;
    // Invert: SVG y grows downward, and 4/26 keeps the stroke off the edges.
    const y = 26 - ((p.costPerUnitUsd - min) / span) * 22;
    current.push(`${x.toFixed(2)} ${y.toFixed(2)}`);
  });
  if (current.length > 1) segments.push({ d: `M ${current.join(" L ")}` });
  return { segments, min, max };
}

function CurveChart({ curve }: { curve: InfraCurvePayload }) {
  const { segments, min, max } = buildSegments(curve.points);
  const first = curve.points[0];
  const last = curve.points[curve.points.length - 1];
  return (
    <div data-testid="infra-curve-chart">
      <svg
        viewBox="0 0 100 30"
        preserveAspectRatio="none"
        className="h-24 w-full text-primary"
        role="img"
        aria-label={`Cost per unit of work from ${first.date} to ${last.date}, ranging ${usd(min)} to ${usd(max)} per billed event`}
      >
        {segments.map((s, i) => (
          <path
            key={i}
            d={s.d}
            fill="none"
            stroke="currentColor"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}
      </svg>
      <div className="mt-1 flex justify-between text-[11px] tabular-nums text-muted-foreground">
        <span>{first.date}</span>
        <span>
          {usd(min)} – {usd(max)} per billed event
        </span>
        <span>{last.date}</span>
      </div>
    </div>
  );
}

// ── The panel ───────────────────────────────────────────────────────────────

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-base font-semibold tabular-nums">{value}</p>
      {sub ? <p className="mt-0.5 text-[11px] text-muted-foreground">{sub}</p> : null}
    </div>
  );
}

export function InfraCurvePanel() {
  const { data, isLoading, isError, error, refetch } = useUnitEconomicsReceipt();

  if (isLoading) {
    return (
      <Card data-testid="infra-curve-loading">
        <CardHeader className="pb-2">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-4 w-72" />
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-24 w-full" />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (isError) {
    return (
      <QueryErrorState
        error={error as Error}
        onRetry={() => refetch()}
        title="Couldn't read the infra curve"
      />
    );
  }
  if (!data) return null;

  const curve = data.curve;
  const latest = curve.latest;
  const fixed = curve.declaredFixedInputsUsdMonthly;
  const recent = curve.points.slice(-TABLE_ROWS).reverse();

  return (
    <Card data-testid="infra-curve-panel">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Activity className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          The infra curve
        </CardTitle>
        <CardDescription data-testid="infra-curve-reason">{curve.reason}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {curve.sufficient ? (
          <CurveChart curve={curve} />
        ) : (
          /* The refusal. Not a chart, not a placeholder line — the reason,
             plus the one action that actually produces more history. */
          <EmptyState
            icon={HelpCircle}
            headline="Not enough history to draw a curve"
            subtitle={curve.reason}
            tips={[
              `A curve needs at least ${curve.minPointsRequired} snapshot days with billed work.`,
              `Snapshot days recorded so far: ${curve.points.length}.`,
            ]}
            cta={{
              label: "See what's been billed",
              href: "/founder/admin/costs?tab=ai-spend",
              "data-testid": "infra-curve-empty-cta",
            }}
            framed
            testId="infra-curve-insufficient"
          />
        )}

        {/* The latest measured point, whether or not a curve may be drawn. A
            single real day is honest; it just isn't a trend. */}
        {latest ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="infra-curve-latest">
            <Stat
              label="Cost per unit of work"
              value={latest.costPerUnitUsd === null ? "—" : usd(latest.costPerUnitUsd)}
              sub={
                latest.costPerUnitUsd === null
                  ? "no billed work that day — undefined, not $0"
                  : `${latest.unitsOfWork} billed events on ${latest.date}`
              }
            />
            <Stat
              label="Variable cost per customer"
              value={latest.variableCostPerOrgUsd === null ? "—" : usd(latest.variableCostPerOrgUsd)}
              sub={
                latest.variableCostPerOrgUsd === null
                  ? "no customers with a snapshot that day"
                  : `across ${latest.orgCount} customers`
              }
            />
            <Stat
              label="Measured variable cost"
              value={usd(latest.variableCostUsd)}
              sub={`trailing ${latest.windowDays} days, from the ledger`}
            />
            <Stat
              label="Allocated fixed share"
              value={usd(latest.allocatedFixedShareUsd)}
              sub="an allocation, not a measurement"
            />
          </div>
        ) : (
          <p className="text-sm text-muted-foreground" data-testid="infra-curve-no-latest">
            No snapshot day has been recorded yet, so there is nothing to measure — not even a single point.
          </p>
        )}

        {/* DECLARED inputs — constants in code, named as such. */}
        <div>
          <p className="text-xs font-medium text-foreground">
            Declared monthly fixed inputs — {usd(fixed.total)}
          </p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground" data-testid="infra-curve-declared">
            Fly {usd(fixed.fly)} · Postgres {usd(fixed.postgres)} · Clerk {usd(fixed.clerk)} · Sentry{" "}
            {usd(fixed.sentry)}. These are constants declared in code, not vendor invoices — they are what the
            allocation divides, and they will not move when a real bill does.
          </p>
        </div>

        {/* Named blind spots. */}
        <div>
          <p className="text-xs font-medium text-foreground">What this curve cannot see</p>
          <ul role="list" className="mt-1 space-y-0.5" data-testid="infra-curve-not-measured">
            {curve.notMeasured.map((line) => (
              <li key={line} className="text-[11px] leading-relaxed text-muted-foreground">
                {line}
              </li>
            ))}
          </ul>
        </div>

        {/* The readable table — the chart is a picture of this, not a source. */}
        {recent.length > 0 && (
          <div className="overflow-x-auto">
            <p className="mb-1 text-xs text-muted-foreground">
              The most recent {recent.length} of {curve.points.length} snapshot days
            </p>
            <table className="w-full text-left text-xs" data-testid="infra-curve-table">
              <thead className="text-muted-foreground">
                <tr>
                  <th scope="col" className="py-1 pr-3 font-medium">Date</th>
                  <th scope="col" className="py-1 pr-3 font-medium">Customers</th>
                  <th scope="col" className="py-1 pr-3 font-medium">Billed events</th>
                  <th scope="col" className="py-1 pr-3 font-medium">Variable cost</th>
                  <th scope="col" className="py-1 font-medium">Per unit</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((p) => (
                  <tr key={p.date} className="border-t border-border">
                    <td className="py-1 pr-3 tabular-nums">{p.date}</td>
                    <td className="py-1 pr-3 tabular-nums">{p.orgCount}</td>
                    <td className="py-1 pr-3 tabular-nums">{p.unitsOfWork}</td>
                    <td className="py-1 pr-3 tabular-nums">{usd(p.variableCostUsd)}</td>
                    <td className="py-1 tabular-nums">
                      {p.costPerUnitUsd === null ? (
                        <span className="text-muted-foreground">undefined — no billed work</span>
                      ) : (
                        usd(p.costPerUnitUsd)
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
