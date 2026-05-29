import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { usePersona, useTerm } from "@/hooks/use-persona";
import { usd } from "@/lib/format";
import { SmallMultipleTwelveMonth, type MonthBreakdown } from "./SmallMultipleTwelveMonth";
import { TrendingUp, AlertTriangle, Handshake, Hammer } from "lucide-react";

interface PortfolioSummary {
  totalNotes: number;
  activeNotes: number;
  totalPortfolioValue: number;
  totalMonthlyPayment: number;
  monthlyCashFlow: { month: string; amount: number }[];
  monthlyBreakdownByType?: MonthBreakdown[];
  delinquentCount?: number;
  delinquencyRate?: number;
  netInflowMtd?: number;
  assignmentFees?: {
    mtdCollected: number;
    pendingCount: number;
    pendingValue: number;
    avgPerClose: number;
    closedCount: number;
  };
  projects?: {
    netMtd: number;
    grossMarginPct: number;
    top: Array<{ id: number; label: string; net: number; status: string }>;
  };
}

/**
 * PersonaFinanceHero — the persona-shaped top-of-Finance tile.
 *
 * Persona dispatch table:
 *   note_investor / note_servicer / note_originator → Note book hero
 *     (outstanding principal, delinquent count, net MTD inflow, +
 *     12-month small-multiple of principal / interest / late fees).
 *   wholesaler → Assignment fees hero (MTD collected, pending close,
 *     average fee per close). No small multiple — small N over months
 *     looks like noise for wholesalers.
 *   fix_flipper / subdivider / landlord → Project P&L hero (net MTD,
 *     gross margin, top-3 active projects by net dollars).
 *   land_investor and unknown → null (existing hero stays put).
 *
 * The component owns the /api/finance/portfolio-summary query so the
 * page-level cash-flow chart can keep using its own copy of the same
 * key (TanStack Query dedupes the request).
 */
export function PersonaFinanceHero() {
  const persona = usePersona();
  const propertyPluralLabel = useTerm("entity.property.plural");

  // We render no hero for the default land_investor persona — the
  // existing finance page already lays out a cash-flow chart and four
  // stat tiles tuned for that audience.
  const isNoteBook =
    persona === "note_investor" ||
    persona === "note_servicer" ||
    persona === "note_originator";
  const isWholesaler = persona === "wholesaler";
  const isProjects =
    persona === "fix_flipper" ||
    persona === "subdivider" ||
    persona === "landlord";

  const { data: summary } = useQuery<PortfolioSummary>({
    queryKey: ["/api/finance/portfolio-summary"],
    enabled: isNoteBook || isWholesaler || isProjects,
  });

  if (!isNoteBook && !isWholesaler && !isProjects) return null;
  if (!summary) {
    return (
      <Card className="mb-6 glass-panel">
        <CardContent className="p-6">
          <div className="h-32 animate-pulse bg-muted/30 rounded" aria-label="Loading finance summary" />
        </CardContent>
      </Card>
    );
  }

  if (isNoteBook) {
    const outstanding = summary.totalPortfolioValue || 0;
    const delinquent = summary.delinquentCount ?? 0;
    const netInflow = summary.netInflowMtd ?? 0;
    const breakdown = summary.monthlyBreakdownByType || [];
    // Synthesize a per-month delinquency rate for the bottom strip. We
    // don't have month-by-month history of delinquency yet — fall back
    // to a flat line at the current rate so the strip still indicates
    // "how bad is it today" visually next to the bars.
    const rate = summary.delinquencyRate ?? 0;
    const flatStrip = breakdown.length > 0 ? breakdown.map(() => rate) : undefined;
    return (
      <Card className="mb-6 glass-panel">
        <CardContent className="p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Note book</p>
              <p className="text-sm text-muted-foreground">Twelve months of paper — principal in, interest in, late fees in.</p>
            </div>
            <TrendingUp className="w-5 h-5 text-acr-brand" aria-hidden="true" />
          </div>
          <div className="grid grid-cols-3 gap-4 mb-4">
            <div>
              <p className="text-xs text-muted-foreground">Outstanding principal</p>
              <p className="text-2xl font-bold font-mono tabular-nums" data-testid="text-note-book-outstanding">
                {usd(outstanding, { noCents: true })}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Delinquent</p>
              <p className={`text-2xl font-bold tabular-nums ${delinquent > 0 ? "text-acr-neg" : "text-acr-pos"}`} data-testid="text-note-book-delinquent">
                {delinquent}
                <span className="text-sm font-normal text-muted-foreground ml-1">
                  / {summary.activeNotes ?? 0}
                </span>
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Net inflow (MTD)</p>
              <p className="text-2xl font-bold font-mono tabular-nums text-acr-pos" data-testid="text-note-book-net-mtd">
                {usd(netInflow, { noCents: true })}
              </p>
            </div>
          </div>
          {breakdown.length > 0 && (
            <SmallMultipleTwelveMonth data={breakdown} delinquencyRate={flatStrip} />
          )}
        </CardContent>
      </Card>
    );
  }

  if (isWholesaler) {
    const fees = summary.assignmentFees || {
      mtdCollected: 0,
      pendingCount: 0,
      pendingValue: 0,
      avgPerClose: 0,
      closedCount: 0,
    };
    return (
      <Card className="mb-6 glass-panel">
        <CardContent className="p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Assignment fees</p>
              <p className="text-sm text-muted-foreground">This month's take, what's pending, and what a close averages.</p>
            </div>
            <Handshake className="w-5 h-5 text-acr-brand" aria-hidden="true" />
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <p className="text-xs text-muted-foreground">Collected MTD</p>
              <p className="text-2xl font-bold font-mono tabular-nums text-acr-pos" data-testid="text-assignment-mtd">
                {usd(fees.mtdCollected, { noCents: true })}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Pending close</p>
              <p className="text-2xl font-bold font-mono tabular-nums" data-testid="text-assignment-pending">
                {usd(fees.pendingValue, { noCents: true })}
                <span className="text-sm font-normal text-muted-foreground ml-1">
                  ({fees.pendingCount})
                </span>
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Avg fee / close</p>
              <p className="text-2xl font-bold font-mono tabular-nums" data-testid="text-assignment-avg">
                {usd(fees.avgPerClose, { noCents: true })}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Projects persona — flipper / subdivider / landlord.
  const projects = summary.projects || { netMtd: 0, grossMarginPct: 0, top: [] };
  return (
    <Card className="mb-6 glass-panel">
      <CardContent className="p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Project P&L</p>
            <p className="text-sm text-muted-foreground">Net this month, blended margin, and your top {propertyPluralLabel.toLowerCase()}.</p>
          </div>
          <Hammer className="w-5 h-5 text-acr-brand" aria-hidden="true" />
        </div>
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <p className="text-xs text-muted-foreground">Net (MTD)</p>
            <p className={`text-2xl font-bold font-mono tabular-nums ${projects.netMtd < 0 ? "text-acr-neg" : "text-acr-pos"}`} data-testid="text-projects-net-mtd">
              {usd(projects.netMtd, { noCents: true })}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Gross margin</p>
            <p className="text-2xl font-bold tabular-nums" data-testid="text-projects-margin">
              {projects.grossMarginPct.toFixed(1)}%
            </p>
          </div>
        </div>
        {projects.top.length > 0 ? (
          <ul className="space-y-2" data-testid="list-top-projects">
            {projects.top.map((p) => (
              <li key={p.id} className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2">
                  <span className="capitalize text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                    {p.status.replace(/_/g, " ")}
                  </span>
                  <span className="truncate">{p.label}</span>
                </span>
                <span className={`font-mono tabular-nums ${p.net < 0 ? "text-acr-neg" : "text-acr-pos"}`}>
                  {usd(p.net, { noCents: true })}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" />
            No {propertyPluralLabel.toLowerCase()} with cost data yet — add purchase prices to see net P&L.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
