/**
 * T-12 WORKSPACE — the trailing-twelve underwriting grid (Wave 3, stage 5).
 * Rendered as the "T-12" tab of `/leases` (see client/src/pages/leases.tsx).
 *
 * WHERE THIS LIVES, AND WHY THERE
 * ───────────────────────────────
 * A TAB on `/leases`, behind the Rentals module — the same host as the Units and
 * Expenses tabs. It adds no route and no nav entry: the customer nav is exactly
 * five doors and "no new top-level nav entries EVER" is a standing founder
 * hard-stop, so a new surface hangs off an existing page. `/leases` is the right
 * host — it is the rentals surface an operator is already on when they think
 * about a building's money, and the T-12 reads the same income (rent received)
 * and expense (property_expenses) axes the Expenses tab records into.
 *
 * WHAT IT IS
 * ──────────
 * The document a multifamily operator underwrites off: twelve months of income,
 * operating expense (per Schedule-E category), and NOI for one building, cash
 * basis. It is the check on a seller's pro-forma — what the building actually
 * collected and spent, not what a projection claims.
 *
 * REFUSE, DON'T FABRICATE
 * ───────────────────────
 * The grid is ALWAYS exactly twelve months, zero-filled by the server. A month
 * with no rent and no spend renders as $0 — VISIBLY, in its own column — never
 * omitted and never back-filled from an average. NOI is income minus OPERATING
 * expense only; mortgage interest and depreciation are stored for Schedule E but
 * the server keeps them out of this grid, so a levered and an unlevered owner of
 * the same building read the same NOI. Nothing here is estimated: every cell is a
 * recorded fact or an honest zero.
 */

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarRange, Building2 } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { EmptyState } from "@/components/empty-state";
import { QueryErrorState } from "@/components/query-error-state";
import { fetchJsonArray } from "@/lib/queryClient";

import {
  PROPERTY_EXPENSE_CATEGORIES,
  PROPERTY_EXPENSE_CATEGORY_LABELS,
  isOperatingCategory,
  type PropertyExpenseCategory,
} from "@shared/rental/propertyExpense";

// ---------------------------------------------------------------------------
// Wire types — mirror the server's T12Response (routes-investor-analytics.ts).
// ---------------------------------------------------------------------------

interface T12MonthRow {
  month: string; // YYYY-MM
  incomeCents: number;
  operatingExpenseCents: number;
  byCategoryCents: Partial<Record<PropertyExpenseCategory, number>>;
  noiCents: number;
}

interface T12Totals {
  incomeCents: number;
  operatingExpenseCents: number;
  byCategoryCents: Partial<Record<PropertyExpenseCategory, number>>;
  noiCents: number;
}

interface T12Response {
  propertyId: number;
  windowStartMonth: string;
  basis: "cash";
  months: T12MonthRow[];
  totals: T12Totals;
}

interface PropertySummary {
  id: number;
  address: string | null;
  city: string | null;
  state: string | null;
  apn: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Integer cents → "$1,234" (whole dollars — a 12-column grid stays legible). A
 *  zero is "$0", VISIBLY, never a dash: an empty month is a real zero, not unknown. */
function fmtUsd0(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD", maximumFractionDigits: 0,
  }).format(cents / 100);
}

function propertyName(p: PropertySummary): string {
  const line = [p.address, p.city, p.state].filter(Boolean).join(", ");
  return line !== "" ? `#${p.id} · ${line}` : `#${p.id} · APN ${p.apn ?? "—"}`;
}

/** "2026-03" → "Mar '26" for a compact column header. */
function monthLabel(yyyymm: string): string {
  const [y, m] = yyyymm.split("-");
  const idx = Number(m) - 1;
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const name = idx >= 0 && idx < 12 ? names[idx] : yyyymm;
  return `${name} '${y.slice(2)}`;
}

// ---------------------------------------------------------------------------
// Workspace
// ---------------------------------------------------------------------------

export function T12Workspace() {
  const [propertyId, setPropertyId] = useState<string>("");

  const propsQuery = useQuery<PropertySummary[]>({
    queryKey: ["/api/properties", "t12-workspace"],
    queryFn: () => fetchJsonArray<PropertySummary>("/api/properties?pageSize=200"),
  });

  const propertyIdNum = Number.parseInt(propertyId, 10);
  const hasProperty = Number.isFinite(propertyIdNum) && propertyIdNum > 0;

  const t12Query = useQuery<T12Response>({
    queryKey: ["/api/properties", propertyIdNum, "t12"],
    enabled: hasProperty,
    queryFn: async () => {
      const res = await fetch(`/api/properties/${propertyIdNum}/t12`, { credentials: "include" });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      return res.json();
    },
  });

  const data = t12Query.data;

  // Operating categories that actually appear across the window, in Schedule-E
  // order. Only operating categories reach the grid (the server excludes the two
  // non-operating lines), so this is exactly the set of expense rows to render.
  const activeCategories = useMemo<PropertyExpenseCategory[]>(() => {
    if (!data) return [];
    return PROPERTY_EXPENSE_CATEGORIES.filter(
      (c) => isOperatingCategory(c) && (data.totals.byCategoryCents[c] ?? 0) !== 0,
    );
  }, [data]);

  return (
    <div className="space-y-6" data-testid="t12-workspace">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <CalendarRange className="w-4 h-4 text-primary" aria-hidden="true" />
            T-12 (trailing twelve months)
          </CardTitle>
          <CardDescription>
            What this building actually collected and spent, month by month, for the last twelve
            months — the cash-basis check on a seller's pro-forma. Income is rent received; net
            operating income is income minus operating expenses (mortgage interest and depreciation
            are kept out of it). A month with nothing recorded shows $0, never a guessed or averaged
            number.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
            <div>
              <Label htmlFor="t12-property" className="text-xs">Property</Label>
              {propsQuery.isLoading ? (
                <Skeleton className="h-9 mt-1" />
              ) : (
                <Select value={propertyId} onValueChange={setPropertyId}>
                  <SelectTrigger id="t12-property" className="h-9 mt-1" aria-label="Choose a property">
                    <SelectValue placeholder="Choose a property…" />
                  </SelectTrigger>
                  <SelectContent>
                    {(propsQuery.data ?? []).map((p) => (
                      <SelectItem key={p.id} value={String(p.id)}>{propertyName(p)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          </div>

          {!hasProperty ? (
            <EmptyState
              icon={Building2}
              headline="Pick a property"
              subtitle="The T-12 is built per building. Choose one to see its trailing-twelve income, operating expenses and NOI."
              framed
              cta={{ label: "", _noOp: true }}
              testId="t12-no-property"
            />
          ) : t12Query.isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-9" />
              <Skeleton className="h-9" />
              <Skeleton className="h-9" />
              <Skeleton className="h-9" />
            </div>
          ) : t12Query.isError ? (
            <QueryErrorState
              error={t12Query.error instanceof Error ? t12Query.error : null}
              onRetry={() => t12Query.refetch()}
              isRetrying={t12Query.isRefetching}
              compact
              title="Couldn't load this property's T-12"
              description="We hit a snag reading the trailing-twelve grid. Your data is safe — try again."
              testId="t12-query-error"
            />
          ) : data ? (
            <>
              <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
                <span><strong className="text-foreground tabular-nums">{fmtUsd0(data.totals.incomeCents)}</strong> income (12 mo)</span>
                <span><strong className="text-foreground tabular-nums">{fmtUsd0(data.totals.operatingExpenseCents)}</strong> operating expense</span>
                <span><strong className="text-foreground tabular-nums">{fmtUsd0(data.totals.noiCents)}</strong> NOI</span>
              </div>

              {/* The wide grid scrolls INSIDE this container — twelve month columns
                  plus a total must never scroll the page horizontally. */}
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <caption className="sr-only">
                    Trailing-twelve-month income, operating expenses by category, and net operating
                    income for this property, cash basis.
                  </caption>
                  <thead>
                    <tr className="text-xs text-muted-foreground border-b border-border bg-muted/30">
                      <th scope="col" className="px-3 py-2 text-left font-medium sticky left-0 bg-muted/30 z-docked">
                        Line item
                      </th>
                      {data.months.map((m) => (
                        <th key={m.month} scope="col" className="px-3 py-2 text-right font-medium tabular-nums whitespace-nowrap">
                          {monthLabel(m.month)}
                        </th>
                      ))}
                      <th scope="col" className="px-3 py-2 text-right font-semibold tabular-nums whitespace-nowrap">
                        Total
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {/* Income — rent received, cash basis. */}
                    <tr className="border-b border-border/40" data-testid="t12-row-income">
                      <th scope="row" className="px-3 py-2 text-left font-medium sticky left-0 bg-background z-docked">
                        Income (rent received)
                      </th>
                      {data.months.map((m) => (
                        <td key={m.month} className="px-3 py-2 text-right tabular-nums">{fmtUsd0(m.incomeCents)}</td>
                      ))}
                      <td className="px-3 py-2 text-right tabular-nums font-semibold">{fmtUsd0(data.totals.incomeCents)}</td>
                    </tr>

                    {/* One row per operating Schedule-E category present in the window. */}
                    {activeCategories.map((cat) => (
                      <tr key={cat} className="border-b border-border/30" data-testid={`t12-row-category-${cat}`}>
                        <th scope="row" className="px-3 py-2 text-left font-normal text-muted-foreground sticky left-0 bg-background z-docked">
                          {PROPERTY_EXPENSE_CATEGORY_LABELS[cat]}
                        </th>
                        {data.months.map((m) => (
                          <td key={m.month} className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                            {fmtUsd0(m.byCategoryCents[cat] ?? 0)}
                          </td>
                        ))}
                        <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                          {fmtUsd0(data.totals.byCategoryCents[cat] ?? 0)}
                        </td>
                      </tr>
                    ))}

                    {/* Operating expense total (the sum of the category rows above). */}
                    <tr className="border-b border-border/40" data-testid="t12-row-opex">
                      <th scope="row" className="px-3 py-2 text-left font-medium sticky left-0 bg-background z-docked">
                        Operating expenses
                      </th>
                      {data.months.map((m) => (
                        <td key={m.month} className="px-3 py-2 text-right tabular-nums">{fmtUsd0(m.operatingExpenseCents)}</td>
                      ))}
                      <td className="px-3 py-2 text-right tabular-nums font-semibold">{fmtUsd0(data.totals.operatingExpenseCents)}</td>
                    </tr>

                    {/* NOI = income − operating expense, per month. */}
                    <tr className="border-t-2 border-border" data-testid="t12-row-noi">
                      <th scope="row" className="px-3 py-2 text-left font-semibold sticky left-0 bg-background z-docked">
                        NOI
                      </th>
                      {data.months.map((m) => (
                        <td key={m.month} className="px-3 py-2 text-right tabular-nums font-medium">{fmtUsd0(m.noiCents)}</td>
                      ))}
                      <td className="px-3 py-2 text-right tabular-nums font-semibold">{fmtUsd0(data.totals.noiCents)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <p className="text-micro text-muted-foreground">
                Cash basis: income is rent received in the month, not rent charged, so a late payment
                counts when it arrives. A $0 in any month means nothing was recorded that month — it
                is a real zero, never an estimate. Record operating costs on the Expenses tab to fill
                the expense rows; mortgage interest and depreciation are stored there but kept out of
                NOI.
              </p>
            </>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
