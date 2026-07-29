import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { QueryErrorState } from "@/components/query-error-state";
import { usePersona, useTerm } from "@/hooks/use-persona";
import { usd } from "@/lib/format";
import { staggerContainer, staggerItem } from "@/lib/animations";
import { SmallMultipleTwelveMonth, type MonthBreakdown } from "./SmallMultipleTwelveMonth";
import {
  computeOriginatorMetrics,
  computeServicerMetrics,
  computeInvestorMetrics,
} from "./personaFinanceMetrics";
import { OriginationVolumeStrip } from "./OriginationVolumeStrip";
import type { Note } from "@shared/schema";
import {
  TrendingUp,
  AlertTriangle,
  CalendarClock,
  Clock,
  Handshake,
  Hammer,
  Landmark,
  Lock,
  Wallet,
  Layers,
} from "lucide-react";

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
 * Shape of GET /api/tax-certificates/dashboard/summary
 * (server/routes-tax-certificates.ts) — the same real org-scoped aggregate
 * the /redemption-clock header and the Today tax widget read.
 */
interface TaxCertificateSummary {
  asOf: string;
  activeCount: number;
  overdueCount: number;
  within30Count: number;
  within90Count: number;
  totalCapitalCents: number;
}

/**
 * Shape of GET /api/lots/economics-summary (server/routes-lot-basis.ts) —
 * org-scoped roll-up of subdivision_plans + lot_basis_allocations.
 */
interface LotEconomicsSummary {
  plansCount: number;
  lotsAllocated: number;
  lotsSold: number;
  basisAllocatedCents: number;
  realizedSaleProceedsCents: number;
  realizedCogsCents: number;
}

interface PersonaFinanceHeroProps {
  /**
   * The note rows the Finance page already loaded (full `notes.$inferSelect`).
   * Passed in so the note-persona heroes can derive origination / servicing /
   * portfolio economics client-side from real columns — no extra request.
   */
  notes?: Note[];
}

/**
 * PersonaFinanceHero — the persona-shaped top-of-Finance tile.
 *
 * The Finance door reframes per investor persona instead of relabeling one
 * generic P&L. Dispatch table:
 *
 *   note_originator → Origination economics (capital deployed, weighted-avg
 *     rate/term, notes written, 12-month origination-volume strip). The lender
 *     building paper. Spread-vs-cost-of-funds is an honest "not tracked" tile.
 *   note_servicer  → Servicing economics (monthly fee income, escrow under
 *     management, serviced-book UPB, payments processed, delinquency). A SERVICE
 *     business — they do not own the notes. No portfolio framing.
 *   note_investor  → Portfolio economics (UPB, performing vs delinquent, book
 *     yield, forward monthly inflow, 12-month principal/interest/late small
 *     multiple). IRR is an honest "not tracked" tile (needs cost basis).
 *   wholesaler     → Assignment fees hero.
 *   tax_delinquent → Certificates book hero (wave V2, ruling #11): deployed
 *     capital, active/overdue counts, deadline buckets — the real org-scoped
 *     /api/tax-certificates/dashboard/summary aggregate. That endpoint is
 *     ownerOrAdmin-gated, so members get an honest access note, never zeros.
 *   subdivider     → Lot economics hero (wave V2, ruling #11): plans on file,
 *     lots allocated/sold, basis allocated vs recorded sale proceeds from
 *     /api/lots/economics-summary (subdivision_plans + lot_basis_allocations).
 *   fix_flipper / landlord → Project P&L hero.
 *   land_investor / unknown → null (existing land hero stays).
 *
 * Each figure traces to a real stored column or shows an honest empty state —
 * never a fabricated number (money-surface honesty contract).
 */
export function PersonaFinanceHero({ notes }: PersonaFinanceHeroProps) {
  const persona = usePersona();
  const propertyPluralLabel = useTerm("entity.property.plural");

  const isOriginator = persona === "note_originator";
  const isServicer = persona === "note_servicer";
  const isInvestor = persona === "note_investor";
  const isNoteBook = isOriginator || isServicer || isInvestor;
  const isWholesaler = persona === "wholesaler";
  const isTaxDelinquent = persona === "tax_delinquent";
  const isSubdivider = persona === "subdivider";
  const isProjects =
    persona === "fix_flipper" ||
    persona === "landlord";

  const { data: summary } = useQuery<PortfolioSummary>({
    queryKey: ["/api/finance/portfolio-summary"],
    enabled: isNoteBook || isWholesaler || isProjects,
  });

  // Wave-V2 heroes read their own endpoints (not portfolio-summary), so they
  // dispatch before the summary gate below.
  if (isTaxDelinquent) return <CertificatesBookHero />;
  if (isSubdivider) return <SubdividerLotEconomicsHero />;

  if (!isNoteBook && !isWholesaler && !isProjects) return null;
  if (!summary) {
    return (
      <Card className="mb-6 glass-panel">
        <CardContent className="p-6">
          <div className="space-y-4" aria-busy="true" aria-label="Loading finance summary">
            <div className="flex items-center justify-between">
              <div className="space-y-2">
                <Skeleton className="h-3 w-24" announce announceText="Loading your finance summary" />
                <Skeleton className="h-4 w-56" announce={false} />
              </div>
              <Skeleton className="h-5 w-5 rounded" announce={false} />
            </div>
            <div className="grid grid-cols-3 gap-4">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="space-y-2">
                  <Skeleton className="h-3 w-20" announce={false} />
                  <Skeleton className="h-7 w-24" announce={false} />
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  const safeNotes = notes ?? [];
  const delinquentCount = summary.delinquentCount ?? 0;

  if (isOriginator) {
    return <OriginatorHero notes={safeNotes} />;
  }
  if (isServicer) {
    // Real trailing-12-month collected total from the per-month payment breakdown
    // the summary endpoint already returns (sum of completed-payment dollars).
    const collectedTrailing12 = (summary.monthlyBreakdownByType ?? []).reduce(
      (s, mo) => s + (mo.total || 0),
      0,
    );
    return (
      <ServicerHero
        notes={safeNotes}
        collectedTrailing12={collectedTrailing12}
        delinquencyRate={summary.delinquencyRate ?? null}
      />
    );
  }
  if (isInvestor) {
    return (
      <InvestorHero
        notes={safeNotes}
        summary={summary}
        delinquentCount={delinquentCount}
      />
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

  // Projects persona — flipper / landlord. (Subdivider graduated to its own
  // lot-economics hero above in wave V2.)
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

// ── Shared sub-pieces ────────────────────────────────────────────────────

/** A "not tracked yet" tile for figures AcreOS doesn't yet store. Honest empty. */
function NotTrackedStat({ label, why, testId }: { label: string; why: string; testId?: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-base font-medium text-muted-foreground" data-testid={testId}>
        Not tracked yet
      </p>
      <p className="text-[11px] text-muted-foreground/80 mt-0.5">{why}</p>
    </div>
  );
}

function HeroFrame({
  eyebrow,
  blurb,
  icon: Icon,
  children,
}: {
  eyebrow: string;
  blurb: string;
  icon: typeof Landmark;
  children: ReactNode;
}) {
  return (
    <Card className="mb-6 glass-panel">
      <CardContent className="p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">{eyebrow}</p>
            <p className="text-sm text-muted-foreground">{blurb}</p>
          </div>
          <Icon className="w-5 h-5 text-acr-brand" aria-hidden="true" />
        </div>
        {children}
      </CardContent>
    </Card>
  );
}

/**
 * Loading skeleton for the self-fetching wave-V2 heroes (certificates book,
 * lot economics). Mirrors the note-book skeleton shape above: eyebrow +
 * blurb + icon row, then a stat-tile grid.
 */
function HeroLoadingSkeleton({ label }: { label: string }) {
  return (
    <Card className="mb-6 glass-panel">
      <CardContent className="p-6">
        <div className="space-y-4" aria-busy="true" aria-label={label}>
          <div className="flex items-center justify-between">
            <div className="space-y-2">
              <Skeleton className="h-3 w-24" announce announceText={label} />
              <Skeleton className="h-4 w-56" announce={false} />
            </div>
            <Skeleton className="h-5 w-5 rounded" announce={false} />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="h-3 w-20" announce={false} />
                <Skeleton className="h-7 w-24" announce={false} />
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ── note_originator ──────────────────────────────────────────────────────
function OriginatorHero({ notes }: { notes: Note[] }) {
  const m = computeOriginatorMetrics(notes);
  return (
    <HeroFrame
      eyebrow="Origination"
      blurb="Capital deployed into paper, the blended terms you're writing, and your volume over twelve months."
      icon={Landmark}
    >
      <motion.div
        className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4"
        variants={staggerContainer}
        initial="hidden"
        animate="visible"
      >
        <motion.div variants={staggerItem}>
          <p className="text-xs text-muted-foreground">Capital deployed</p>
          <p className="text-2xl font-bold font-mono tabular-nums" data-testid="text-orig-capital">
            {usd(m.capitalDeployed, { noCents: true })}
          </p>
        </motion.div>
        <motion.div variants={staggerItem}>
          <p className="text-xs text-muted-foreground">Notes written</p>
          <p className="text-2xl font-bold tabular-nums" data-testid="text-orig-count">
            {m.notesOriginated}
          </p>
        </motion.div>
        <motion.div variants={staggerItem}>
          <p className="text-xs text-muted-foreground">Wtd-avg rate</p>
          <p className="text-2xl font-bold tabular-nums" data-testid="text-orig-rate">
            {m.wtdAvgRate != null ? `${m.wtdAvgRate.toFixed(2)}%` : "—"}
          </p>
        </motion.div>
        <motion.div variants={staggerItem}>
          <p className="text-xs text-muted-foreground">Wtd-avg term</p>
          <p className="text-2xl font-bold tabular-nums" data-testid="text-orig-term">
            {m.wtdAvgTermMonths != null ? `${Math.round(m.wtdAvgTermMonths)} mo` : "—"}
          </p>
        </motion.div>
      </motion.div>

      {/* Spread vs cost of funds — honest "not tracked" tile. */}
      <div className="mb-4 rounded-card bg-muted/30 p-3">
        <NotTrackedStat
          label="Spread vs cost of funds"
          why="AcreOS doesn't store your cost of capital yet — add it to see origination spread."
          testId="text-orig-spread"
        />
      </div>

      {m.hasOriginationDates ? (
        <OriginationVolumeStrip data={m.volumeByMonth} />
      ) : (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" />
          No origination dates on file yet — write or import notes to chart monthly volume.
        </div>
      )}
    </HeroFrame>
  );
}

// ── note_servicer ────────────────────────────────────────────────────────
function ServicerHero({
  notes,
  collectedTrailing12,
  delinquencyRate,
}: {
  notes: Note[];
  collectedTrailing12: number;
  delinquencyRate: number | null;
}) {
  const m = computeServicerMetrics(notes, collectedTrailing12, delinquencyRate);
  return (
    <HeroFrame
      eyebrow="Servicing book"
      blurb="A service business: fee income, escrow you hold, the book you service, and how it's paying."
      icon={Wallet}
    >
      <motion.div
        className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4"
        variants={staggerContainer}
        initial="hidden"
        animate="visible"
      >
        <motion.div variants={staggerItem}>
          <p className="text-xs text-muted-foreground">Fee income / mo</p>
          {m.hasFeeSchedule ? (
            <p className="text-2xl font-bold font-mono tabular-nums text-acr-pos" data-testid="text-svc-fee-income">
              {usd(m.monthlyFeeIncome, { noCents: true })}
            </p>
          ) : (
            <p className="text-base font-medium text-muted-foreground" data-testid="text-svc-fee-income">
              Not tracked yet
            </p>
          )}
          {!m.hasFeeSchedule && (
            <p className="text-[11px] text-muted-foreground/80 mt-0.5">
              Set a servicing fee on your notes to see recurring income.
            </p>
          )}
        </motion.div>
        <motion.div variants={staggerItem}>
          <p className="text-xs text-muted-foreground">Escrow under mgmt</p>
          <p className="text-2xl font-bold font-mono tabular-nums" data-testid="text-svc-escrow">
            {usd(m.escrowUnderManagement, { noCents: true })}
          </p>
          <p className="text-[11px] text-muted-foreground/80 mt-0.5 tabular-nums">
            {m.escrowAccounts} {m.escrowAccounts === 1 ? "account" : "accounts"}
          </p>
        </motion.div>
        <motion.div variants={staggerItem}>
          <p className="text-xs text-muted-foreground">Serviced book</p>
          <p className="text-2xl font-bold font-mono tabular-nums" data-testid="text-svc-book">
            {usd(m.servicedUpb, { noCents: true })}
          </p>
          <p className="text-[11px] text-muted-foreground/80 mt-0.5 tabular-nums">
            {m.servicedBookCount} {m.servicedBookCount === 1 ? "note" : "notes"}
          </p>
        </motion.div>
        <motion.div variants={staggerItem}>
          <p className="text-xs text-muted-foreground">Delinquency</p>
          {m.delinquencyRate != null ? (
            <p
              className={`text-2xl font-bold tabular-nums ${m.delinquencyRate > 0 ? "text-acr-neg" : "text-acr-pos"}`}
              data-testid="text-svc-delinquency"
            >
              {m.delinquencyRate.toFixed(1)}%
            </p>
          ) : (
            <p className="text-base font-medium text-muted-foreground" data-testid="text-svc-delinquency">
              No active book
            </p>
          )}
        </motion.div>
      </motion.div>

      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Layers className="w-3.5 h-3.5" aria-hidden="true" />
        <span className="tabular-nums">{usd(m.collectedTrailing12, { noCents: true })}</span>
        {" "}collected through the book over the last twelve months.
      </div>
    </HeroFrame>
  );
}

// ── note_investor ────────────────────────────────────────────────────────
function InvestorHero({
  notes,
  summary,
  delinquentCount,
}: {
  notes: Note[];
  summary: PortfolioSummary;
  delinquentCount: number;
}) {
  const m = computeInvestorMetrics(notes, delinquentCount);
  const breakdown = summary.monthlyBreakdownByType || [];
  // Flat per-month delinquency strip at the current rate — we don't keep a
  // month-by-month delinquency history, so the strip indicates "where it
  // stands today" alongside the bars rather than implying a trend we can't back.
  const rate = summary.delinquencyRate ?? 0;
  const flatStrip = breakdown.length > 0 ? breakdown.map(() => rate) : undefined;
  return (
    <HeroFrame
      eyebrow="Note portfolio"
      blurb="The paper you hold: outstanding principal, how it's performing, and what it pays you each month."
      icon={TrendingUp}
    >
      <motion.div
        className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4"
        variants={staggerContainer}
        initial="hidden"
        animate="visible"
      >
        <motion.div variants={staggerItem}>
          <p className="text-xs text-muted-foreground">Outstanding principal</p>
          <p className="text-2xl font-bold font-mono tabular-nums" data-testid="text-inv-upb">
            {usd(m.principalOutstanding, { noCents: true })}
          </p>
        </motion.div>
        <motion.div variants={staggerItem}>
          <p className="text-xs text-muted-foreground">Performing</p>
          <p className="text-2xl font-bold tabular-nums" data-testid="text-inv-performing">
            <span className={m.delinquentCount > 0 ? "text-acr-pos" : ""}>{m.performingCount}</span>
            <span className="text-sm font-normal text-muted-foreground ml-1">/ {m.activeCount}</span>
          </p>
          {m.delinquentCount > 0 && (
            <p className="text-[11px] text-acr-neg mt-0.5 tabular-nums">
              {m.delinquentCount} delinquent
            </p>
          )}
        </motion.div>
        <motion.div variants={staggerItem}>
          <p className="text-xs text-muted-foreground">Book yield</p>
          <p className="text-2xl font-bold tabular-nums" data-testid="text-inv-yield">
            {m.bookYield != null ? `${m.bookYield.toFixed(2)}%` : "—"}
          </p>
          <p className="text-[11px] text-muted-foreground/80 mt-0.5">Coupon, UPB-weighted</p>
        </motion.div>
        <motion.div variants={staggerItem}>
          <p className="text-xs text-muted-foreground">Forecast inflow / mo</p>
          <p className="text-2xl font-bold font-mono tabular-nums text-acr-pos" data-testid="text-inv-inflow">
            {usd(m.forecastMonthlyInflow, { noCents: true })}
          </p>
        </motion.div>
      </motion.div>

      {/* IRR — honest "not tracked" tile (needs each note's acquisition cost basis). */}
      <div className="mb-4 rounded-card bg-muted/30 p-3">
        <NotTrackedStat
          label="IRR / yield-to-cost"
          why="Needs what you paid for each note — record acquisition cost to compute true IRR."
          testId="text-inv-irr"
        />
      </div>

      {breakdown.length > 0 ? (
        <SmallMultipleTwelveMonth data={breakdown} delinquencyRate={flatStrip} />
      ) : (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" />
          No payments collected yet — once cash starts flowing you'll see twelve months of principal, interest, and late fees here.
        </div>
      )}
    </HeroFrame>
  );
}

// ── tax_delinquent (wave V2, ruling #11) ─────────────────────────────────
function CertificatesBookHero() {
  const { data, isLoading, error, refetch, isRefetching } = useQuery<TaxCertificateSummary>({
    queryKey: ["/api/tax-certificates/dashboard/summary"],
  });

  if (isLoading) {
    return <HeroLoadingSkeleton label="Loading certificates book" />;
  }

  // The endpoint is ownerOrAdmin-gated (routes-tax-certificates.ts). A member
  // hitting 403 gets an honest suppressed state — never zeros presented as
  // the org's book (money-surface honesty contract).
  const errMessage = error instanceof Error ? error.message : "";
  if (error && (errMessage.includes("403") || errMessage.toLowerCase().includes("forbidden"))) {
    return (
      <HeroFrame
        eyebrow="Certificates book"
        blurb="Deployed capital and redemption exposure across your certificate book."
        icon={Clock}
      >
        <div className="flex items-center gap-2 text-sm text-muted-foreground" data-testid="text-certs-restricted">
          <Lock className="w-4 h-4" aria-hidden="true" />
          Certificate economics is visible to org owners and admins only — ask your org owner if you need access.
        </div>
      </HeroFrame>
    );
  }

  if (error || !data) {
    return (
      <div className="mb-6">
        <QueryErrorState
          compact
          error={error instanceof Error ? error : null}
          onRetry={() => refetch()}
          isRetrying={isRefetching}
          title="Couldn't load your certificates book"
          testId="certs-hero-error"
        />
      </div>
    );
  }

  if (data.activeCount === 0) {
    return (
      <div className="mb-6">
        <EmptyState
          icon={Clock}
          headline="No active certificates"
          subtitle="Track the tax certificates or deeds you hold and this hero shows deployed capital, what's overdue, and the redemption deadlines coming due."
          cta={{ label: "Open redemption clock", href: "/redemption-clock", "data-testid": "certs-hero-empty-clock" }}
          secondaryCta={{ label: "Auction worksheet", href: "/auction-worksheet", "data-testid": "certs-hero-empty-auction" }}
          actionIcon={null}
          framed
          testId="certs-hero-empty"
        />
      </div>
    );
  }

  return (
    <HeroFrame
      eyebrow="Certificates book"
      blurb="Capital deployed into certificates, what's overdue, and the redemption deadlines coming at you."
      icon={Clock}
    >
      <motion.div
        className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4"
        variants={staggerContainer}
        initial="hidden"
        animate="visible"
      >
        <motion.div variants={staggerItem}>
          <p className="text-xs text-muted-foreground">Capital deployed</p>
          <p className="text-2xl font-bold font-mono tabular-nums" data-testid="text-certs-capital">
            {usd(data.totalCapitalCents / 100, { noCents: true })}
          </p>
          <p className="text-[11px] text-muted-foreground/80 mt-0.5">Active certificates at purchase</p>
        </motion.div>
        <motion.div variants={staggerItem}>
          <p className="text-xs text-muted-foreground">Active certificates</p>
          <p className="text-2xl font-bold tabular-nums" data-testid="text-certs-active">
            {data.activeCount}
          </p>
        </motion.div>
        <motion.div variants={staggerItem}>
          <p className="text-xs text-muted-foreground">Overdue</p>
          <p
            className={`text-2xl font-bold tabular-nums ${data.overdueCount > 0 ? "text-acr-neg" : "text-acr-pos"}`}
            data-testid="text-certs-overdue"
          >
            {data.overdueCount}
          </p>
          <p className="text-[11px] text-muted-foreground/80 mt-0.5">
            {data.overdueCount > 0 ? "past redemption deadline" : "none past deadline"}
          </p>
        </motion.div>
        <motion.div variants={staggerItem}>
          <p className="text-xs text-muted-foreground">Due in 30 days</p>
          <p
            className={`text-2xl font-bold tabular-nums ${data.within30Count > 0 ? "text-acr-warn" : ""}`}
            data-testid="text-certs-due30"
          >
            {data.within30Count}
          </p>
          <p className="text-[11px] text-muted-foreground/80 mt-0.5">redemption deadlines</p>
        </motion.div>
      </motion.div>

      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <CalendarClock className="w-3.5 h-3.5" aria-hidden="true" />
        <span className="tabular-nums">{data.within90Count}</span>
        {data.within90Count === 1 ? " redemption deadline lands" : " redemption deadlines land"} inside the next ninety days.
      </div>
    </HeroFrame>
  );
}

// ── subdivider (wave V2, ruling #11) ─────────────────────────────────────
function SubdividerLotEconomicsHero() {
  const { data, isLoading, error, refetch, isRefetching } = useQuery<LotEconomicsSummary>({
    queryKey: ["/api/lots/economics-summary"],
  });

  if (isLoading) {
    return <HeroLoadingSkeleton label="Loading lot economics" />;
  }

  if (error || !data) {
    return (
      <div className="mb-6">
        <QueryErrorState
          compact
          error={error instanceof Error ? error : null}
          onRetry={() => refetch()}
          isRetrying={isRefetching}
          title="Couldn't load your lot economics"
          testId="lots-hero-error"
        />
      </div>
    );
  }

  if (data.plansCount === 0 && data.lotsAllocated === 0) {
    return (
      <div className="mb-6">
        <EmptyState
          icon={Layers}
          headline="No subdivision plans yet"
          subtitle="Sketch lot lines on a parent parcel's Subdivision tab and allocate its basis across child lots — plans, basis, and recorded closings roll up here."
          cta={{ label: "Open your parcels", href: "/properties", "data-testid": "lots-hero-empty-parcels" }}
          secondaryCta={{ label: "Lot pricing rules", href: "/lot-pricing", "data-testid": "lots-hero-empty-pricing" }}
          actionIcon={null}
          framed
          testId="lots-hero-empty"
        />
      </div>
    );
  }

  const realizedMarginCents = data.realizedSaleProceedsCents - data.realizedCogsCents;
  return (
    <HeroFrame
      eyebrow="Lot economics"
      blurb="Plans on file, parent basis spread across child lots, and what recorded closings brought back."
      icon={Layers}
    >
      <motion.div
        className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4"
        variants={staggerContainer}
        initial="hidden"
        animate="visible"
      >
        <motion.div variants={staggerItem}>
          <p className="text-xs text-muted-foreground">Subdivision plans</p>
          <p className="text-2xl font-bold tabular-nums" data-testid="text-lots-plans">
            {data.plansCount}
          </p>
        </motion.div>
        <motion.div variants={staggerItem}>
          <p className="text-xs text-muted-foreground">Lots allocated</p>
          <p className="text-2xl font-bold tabular-nums" data-testid="text-lots-allocated">
            {data.lotsAllocated}
          </p>
          <p className="text-[11px] text-muted-foreground/80 mt-0.5 tabular-nums">
            {data.lotsSold} sold
          </p>
        </motion.div>
        <motion.div variants={staggerItem}>
          <p className="text-xs text-muted-foreground">Basis allocated</p>
          {data.lotsAllocated > 0 ? (
            <p className="text-2xl font-bold font-mono tabular-nums" data-testid="text-lots-basis">
              {usd(data.basisAllocatedCents / 100, { noCents: true })}
            </p>
          ) : (
            <p className="text-base font-medium text-muted-foreground" data-testid="text-lots-basis">
              Not allocated yet
            </p>
          )}
          {data.lotsAllocated === 0 && (
            <p className="text-[11px] text-muted-foreground/80 mt-0.5">
              Allocate the parent's basis across child lots to see it here.
            </p>
          )}
        </motion.div>
        <motion.div variants={staggerItem}>
          <p className="text-xs text-muted-foreground">Sale proceeds</p>
          {data.lotsSold > 0 ? (
            <p className="text-2xl font-bold font-mono tabular-nums text-acr-pos" data-testid="text-lots-proceeds">
              {usd(data.realizedSaleProceedsCents / 100, { noCents: true })}
            </p>
          ) : (
            <p className="text-base font-medium text-muted-foreground" data-testid="text-lots-proceeds">
              No closings yet
            </p>
          )}
          {data.lotsSold === 0 && (
            <p className="text-[11px] text-muted-foreground/80 mt-0.5">
              Record a lot sale (COGS) to see proceeds against basis.
            </p>
          )}
        </motion.div>
      </motion.div>

      {data.lotsSold > 0 ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Layers className="w-3.5 h-3.5" aria-hidden="true" />
          <span className={`tabular-nums ${realizedMarginCents < 0 ? "text-acr-neg" : "text-acr-pos"}`}>
            {usd(realizedMarginCents / 100, { noCents: true })}
          </span>
          {" "}realized over allocated basis across {data.lotsSold} closed {data.lotsSold === 1 ? "lot" : "lots"}.
        </div>
      ) : (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" />
          No lot sales recorded yet — realized margin shows once the first closing is recorded.
        </div>
      )}
    </HeroFrame>
  );
}
