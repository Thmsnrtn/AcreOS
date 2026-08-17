import { motion } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import { okOrThrow, listFrom } from "@/lib/fetch-honesty";
import { QueryErrorState } from "@/components/query-error-state";
import { staggerContainer, fadeInUp } from "@/lib/animations";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { usePersona } from "@/hooks/use-persona";
import { usd } from "@/lib/format";
import type { Note } from "@shared/schema";
import {
  DollarSign,
  Clock,
  TrendingUp,
  Zap,
  Users,
  Filter,
  Hammer,
  BarChart3,
  Percent,
  Building,
  Droplets,
  CalendarClock,
  Wallet,
  ArrowUpRight,
  Home,
  Landmark,
  Layers,
  ClipboardList,
  AlertTriangle,
  FileSignature,
  ClipboardCheck,
  Search,
  ShieldCheck,
  Banknote,
} from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────

export interface TypeSpecificWidgetsProps {
  businessType: string;
  organizationId: number;
}

type BusinessCategory = "land" | "wholesaler" | "flipper" | "buy_and_hold" | "commercial" | "subdivider" | "tax_delinquent";

// NOTE (wave V2, founder ruling #11): this file used to open with five
// hardcoded *-mock constants ("to be wired to API later"). Two of them were
// still reachable in render paths (the land-category fall-through and the
// commercial category) — fabricated numbers in a confident UI. All five are
// deleted; every widget set below reads a real org-scoped endpoint and
// renders an honest empty/suppressed state instead. The
// tests/unit/noMockWidgets.test.ts ratchet keeps it that way.

// ── Helpers ────────────────────────────────────────────────────────────

function resolveCategory(businessType: string): BusinessCategory {
  switch (businessType) {
    case "land_flipper":
    case "note_investor":
    case "hybrid":
      return "land";
    case "residential_wholesaler":
      return "wholesaler";
    case "subdivider":
      return "subdivider";
    case "fix_and_flip":
      return "flipper";
    case "buy_and_hold":
    // V1 (founder ruling #11): the landlord family — short_term_rental /
    // multifamily / mobile_home all derive the landlord persona
    // (persona-mapping.ts) and run the same leases/rent-roll/maintenance
    // domain, so they share BuyAndHoldWidgets (real /api/landlord/dashboard
    // data) instead of falling through to the land mock. Family-specific
    // widgets (STR occupancy/ADR, MF unit turns, MHP lot rents) are a later
    // deepening — the shared landlord widgets are honest, same domain.
    case "short_term_rental":
    case "multifamily":
    case "mobile_home":
      return "buy_and_hold";
    case "commercial":
      return "commercial";
    // V1: tax_lien_deed previously fell through to the "land" default and
    // rendered LAND_MOCK's fabricated pipeline numbers despite having a
    // full nav module. It now gets its own real-data category.
    case "tax_lien_deed":
      return "tax_delinquent";
    default:
      return "land";
  }
}

function BudgetBar({ label, spent, budget }: { label: string; spent: number; budget: number }) {
  const pct = Math.min(Math.round((spent / budget) * 100), 100);
  const isOver80 = pct >= 80;

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium truncate">{label}</span>
        <span className="text-muted-foreground">
          ${spent.toLocaleString()} / ${budget.toLocaleString()}
        </span>
      </div>
      <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${
            isOver80 ? "bg-acr-warn" : "bg-primary"
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function FunnelBar({ stage, count, maxCount }: { stage: string; count: number; maxCount: number }) {
  const pct = maxCount > 0 ? Math.max(Math.round((count / maxCount) * 100), 4) : 4;

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium">{stage}</span>
        <span className="text-muted-foreground">{count}</span>
      </div>
      <div className="w-full bg-muted rounded-full h-4 overflow-hidden">
        <div
          className="h-full rounded-full bg-primary/80 transition-all duration-500 flex items-center px-2"
          style={{ width: `${pct}%` }}
        >
          {pct >= 20 && (
            <span className="text-micro font-semibold text-primary-foreground">{pct}%</span>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Widget Sets ────────────────────────────────────────────────────────
//
// The land category renders LandSourcingWidgets (below) — real
// /api/properties + /api/leads data with an honest EmptyState. The mock
// "LandWidgets" (fabricated pipeline value / days-to-close / profit
// sparkline) that used to live here was deleted in wave V2, ruling #11.

interface WholesalerDashboard {
  hasData: boolean;
  assignmentFeesCents: number;
  avgAssignmentFeeCents: number;
  speedToCloseDays: number | null;
  buyerListHealth: { total: number; active: number; stale: number };
  dealFunnel: Array<{ stage: string; count: number }>;
}

function WholesalerWidgets() {
  // W-5: Real data replacing the WHOLESALER_MOCK constant. Trey's
  // "If I see those exact numbers and I have zero deals, I lose
  // trust in everything around it" — the API returns hasData=false
  // for empty orgs and we suppress the widget block entirely.
  const { data: live, isLoading } = useQuery<WholesalerDashboard>({
    queryKey: ["/api/wholesaler/dashboard"],
    queryFn: async () => {
      const res = await fetch("/api/wholesaler/dashboard", { credentials: "include" });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      return res.json();
    },
  });

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-32" />)}
      </div>
    );
  }

  if (!live || !live.hasData) {
    // Hide the widget when we have nothing real to show — Trey's
    // explicit ask. The dashboard already renders other tiles; this
    // section just disappears until the org has at least one deal.
    return null;
  }

  // Render shape kept compatible with the prior MOCK so the templates
  // below need no changes.
  const data = {
    assignmentFees: live.assignmentFeesCents / 100,
    avgAssignmentFee: live.avgAssignmentFeeCents / 100,
    speedToClose: live.speedToCloseDays ?? 0,
    buyerListHealth: live.buyerListHealth,
    dealFunnel: live.dealFunnel,
  };
  const maxFunnel = data?.dealFunnel?.length ? Math.max(...data.dealFunnel.map((d) => d.count), 1) : 1;
  const healthPct = data.buyerListHealth.total > 0
    ? Math.round((data.buyerListHealth.active / data.buyerListHealth.total) * 100)
    : 0;

  return (
    <motion.div
      variants={staggerContainer}
      initial="hidden"
      animate="visible"
      className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4"
    >
      <motion.div variants={fadeInUp}>
        <Card className="floating-window h-full">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <DollarSign className="w-4 h-4 text-acr-pos" />
              Assignment Fees
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">${data.assignmentFees.toLocaleString()}</p>
            <p className="text-xs text-muted-foreground mt-1">
              ${data.avgAssignmentFee.toLocaleString()} avg per deal
            </p>
          </CardContent>
        </Card>
      </motion.div>

      <motion.div variants={fadeInUp}>
        <Card className="floating-window h-full">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Zap className="w-4 h-4 text-acr-warn" />
              Speed to Close
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">
              {live.speedToCloseDays === null ? "—" : data.speedToClose}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {live.speedToCloseDays === null ? "no closed deals yet" : "days from offer to close"}
            </p>
          </CardContent>
        </Card>
      </motion.div>

      <motion.div variants={fadeInUp}>
        <Card className="floating-window h-full">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Users className="w-4 h-4 text-acr-accent" />
              Buyer List Health
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-3">
              <p className="text-2xl font-bold">{healthPct}%</p>
              <Badge
                variant="outline"
                className={`text-xs ${
                  healthPct >= 75
                    ? "border-acr-pos-soft text-acr-pos dark:border-acr-pos-soft dark:text-acr-pos"
                    : "border-acr-warn-soft text-acr-warn dark:border-acr-warn-soft dark:text-acr-warn"
                }`}
              >
                {data.buyerListHealth.active} active
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {data.buyerListHealth.stale} stale of {data.buyerListHealth.total} total
            </p>
          </CardContent>
        </Card>
      </motion.div>

      <motion.div variants={fadeInUp}>
        <Card className="floating-window h-full">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Filter className="w-4 h-4 text-primary" />
              Deal Funnel
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.dealFunnel.map((step) => (
              <FunnelBar
                key={step.stage}
                stage={step.stage}
                count={step.count}
                maxCount={maxFunnel}
              />
            ))}
          </CardContent>
        </Card>
      </motion.div>
    </motion.div>
  );
}

interface FlipperDashboard {
  hasData: boolean;
  activeRehabs?: Array<{
    id: string;
    name: string;
    status: string;
    budgetCents: number;
    spentCents: number;
    spentPct: number;
    arvCents: number | null;
  }>;
  totals?: {
    totalBudgetCents: number;
    totalSpentCents: number;
    spentPct: number;
  };
  stalledDraws?: number;
  necEligible?: number;
}

function FlipperWidgets() {
  // FF-8 — replaces FLIPPER_MOCK with real org-scoped data. Devon §1:
  // "The dashboard widget for my persona shows 'Active Rehabs' with three
  // properties and a BudgetBar — and when I open the file, it's pulling
  // from FLIPPER_MOCK. Hardcoded mock data."
  const { data: live, isLoading } = useQuery<FlipperDashboard>({
    queryKey: ["/api/flipper/dashboard"],
    queryFn: async () => {
      const res = await fetch("/api/flipper/dashboard", { credentials: "include" });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      return res.json();
    },
  });

  if (isLoading) return <Skeleton className="h-32" />;
  if (!live?.hasData) return null;  // suppress widget when empty (Trey's W-5 lesson)

  const totalArvCents = live.activeRehabs?.reduce((s, r) => s + (r.arvCents ?? 0), 0) ?? 0;

  return (
    <motion.div
      variants={staggerContainer}
      initial="hidden"
      animate="visible"
      className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4"
    >
      <motion.div variants={fadeInUp} className="md:col-span-2">
        <Card className="floating-window h-full">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Hammer className="w-4 h-4 text-acr-warn" />
              Active rehabs
              <Badge variant="outline" className="ml-auto text-xs">
                {live.activeRehabs?.length ?? 0} projects
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {(live.activeRehabs ?? []).map((rehab) => {
              const spentDollars = rehab.spentCents / 100;
              const budgetDollars = rehab.budgetCents / 100;
              return (
                <div key={rehab.id}>
                  <p className="text-xs font-medium mb-1">{rehab.name} <span className="text-muted-foreground">· {rehab.status.replace(/_/g, " ")}</span></p>
                  <BudgetBar label={`$${spentDollars.toLocaleString()} / $${budgetDollars.toLocaleString()}`} spent={spentDollars} budget={budgetDollars} />
                </div>
              );
            })}
          </CardContent>
        </Card>
      </motion.div>

      <motion.div variants={fadeInUp}>
        <Card className="floating-window h-full">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <BarChart3 className="w-4 h-4 text-acr-pos" />
              Total ARV
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{totalArvCents > 0 ? `$${(totalArvCents / 100_000).toFixed(0)}K` : "—"}</p>
            <p className="text-xs text-muted-foreground mt-1">
              {live.totals ? `${live.totals.spentPct}% of budget spent` : ""}
            </p>
          </CardContent>
        </Card>
      </motion.div>

      <motion.div variants={fadeInUp}>
        <Card className="floating-window h-full">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <ArrowUpRight className="w-4 h-4 text-primary" />
              Tax & draws
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm">
              <span className="text-2xl font-bold">{live.necEligible ?? 0}</span>
              <span className="text-xs text-muted-foreground ml-2">1099-NEC eligible</span>
            </p>
            <p className="text-xs text-acr-warn mt-1">
              {live.stalledDraws ? `${live.stalledDraws} stalled draws` : "draws on track"}
            </p>
          </CardContent>
        </Card>
      </motion.div>
    </motion.div>
  );
}

interface LandlordDashboard {
  hasData: boolean;
  activeLeases?: number;
  rent?: {
    mtdCollectedCents: number;
    mtdBilledCents: number;
    mtdCollectedPct: number;
    lateCount: number;
  };
  maintenanceOpenCount?: number;
  expiringNext30Count?: number;
}

function fmtUsdK(cents: number): string {
  if (cents === 0) return "$0";
  if (cents >= 100_000_00) return `$${(cents / 100_000).toFixed(0)}K`;
  return `$${(cents / 100).toLocaleString()}`;
}

function BuyAndHoldWidgets() {
  // BH-8 — replaces BUY_AND_HOLD_MOCK with real data. Imelda §3 today:
  // "rent-roll snapshot (collected this month / outstanding / late), a
  // maintenance queue count, a lease expirations next-30-days widget,
  // and a vacancy count."
  const { data: live, isLoading } = useQuery<LandlordDashboard>({
    queryKey: ["/api/landlord/dashboard"],
    queryFn: async () => {
      const res = await fetch("/api/landlord/dashboard", { credentials: "include" });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      return res.json();
    },
  });

  if (isLoading) return <Skeleton className="h-32" />;
  if (!live?.hasData) return null;  // Trey's W-5 lesson: hide widget when empty

  const collectedPct = live.rent?.mtdCollectedPct ?? 0;
  return (
    <motion.div
      variants={staggerContainer}
      initial="hidden"
      animate="visible"
      className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4"
    >
      <motion.div variants={fadeInUp}>
        <Card className="floating-window h-full">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Wallet className="w-4 h-4 text-acr-pos" />
              Rent MTD
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{fmtUsdK(live.rent?.mtdCollectedCents ?? 0)}</p>
            <p className="text-xs text-muted-foreground mt-1">
              {collectedPct}% of {fmtUsdK(live.rent?.mtdBilledCents ?? 0)} billed
            </p>
          </CardContent>
        </Card>
      </motion.div>

      <motion.div variants={fadeInUp}>
        <Card className="floating-window h-full">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Droplets className="w-4 h-4 text-acr-warn" />
              Late
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{live.rent?.lateCount ?? 0}</p>
            <p className="text-xs text-muted-foreground mt-1">unpaid past due date</p>
          </CardContent>
        </Card>
      </motion.div>

      <motion.div variants={fadeInUp}>
        <Card className="floating-window h-full">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Percent className="w-4 h-4 text-primary" />
              Maintenance
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{live.maintenanceOpenCount ?? 0}</p>
            <p className="text-xs text-muted-foreground mt-1">tickets open</p>
          </CardContent>
        </Card>
      </motion.div>

      <motion.div variants={fadeInUp}>
        <Card className="floating-window h-full">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <CalendarClock className="w-4 h-4 text-acr-warn" />
              Expirations 30d
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{live.expiringNext30Count ?? 0}</p>
            <p className="text-xs text-muted-foreground mt-1">{live.activeLeases ?? 0} active leases</p>
          </CardContent>
        </Card>
      </motion.div>
    </motion.div>
  );
}

// NOTE (wave V2, founder ruling #11): the commercial category used to render
// a CommercialWidgets set built entirely from a hardcoded mock — fabricated
// NOI, cap rate, sq-ft occupancy, and a lease-expiration chart. No real
// source for NOI/cap-rate/sq-ft exists in the schema today, so those tiles
// are gone rather than faked. Commercial landlording runs the same
// org-scoped rent/lease/maintenance domain (rental_leases, rent_charges,
// maintenance_tickets), so the category now renders BuyAndHoldWidgets —
// real /api/landlord/dashboard data, suppressed (hasData=false) until the
// org actually tracks a lease.

// ── Subdivider widgets (SD-9) ──────────────────────────────────────────

interface SubdividerDashboard {
  hasData: boolean;
  parentCount?: number;
  totalChildLots?: number;
  soldChildLots?: number;
  totalParentBasisCents?: number;
  totalSoldProceedsCents?: number;
  recoveredPct?: number;
  stalledGates?: number;
}

function fmtUsdCentsCompact(cents: number | undefined): string {
  if (cents === undefined) return "—";
  if (cents >= 1_000_000_00) return `$${(cents / 100_000_000).toFixed(1)}M`;
  if (cents >= 1_000_00) return `$${(cents / 100_000).toFixed(0)}K`;
  return `$${(cents / 100).toLocaleString()}`;
}

function SubdividerWidgets() {
  const { data: live, isLoading } = useQuery<SubdividerDashboard>({
    queryKey: ["/api/subdivider/dashboard"],
    queryFn: async () => {
      const res = await fetch("/api/subdivider/dashboard", { credentials: "include" });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      return res.json();
    },
  });

  if (isLoading) return <Skeleton className="h-32" />;
  if (!live?.hasData) return null;  // Trey's lesson: hide widget when empty.

  return (
    <motion.div
      variants={staggerContainer}
      initial="hidden"
      animate="visible"
      className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4"
    >
      <motion.div variants={fadeInUp}>
        <Card className="floating-window h-full">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Layers className="w-4 h-4 text-primary" />
              Subdivisions
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{live.parentCount}</p>
            <p className="text-xs text-muted-foreground mt-1">
              {live.totalChildLots} child lots tracked
            </p>
          </CardContent>
        </Card>
      </motion.div>

      <motion.div variants={fadeInUp}>
        <Card className="floating-window h-full">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <DollarSign className="w-4 h-4 text-acr-pos" />
              Basis recovered
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{live.recoveredPct ?? 0}%</p>
            <p className="text-xs text-muted-foreground mt-1">
              {fmtUsdCentsCompact(live.totalSoldProceedsCents)} of {fmtUsdCentsCompact(live.totalParentBasisCents)}
            </p>
          </CardContent>
        </Card>
      </motion.div>

      <motion.div variants={fadeInUp}>
        <Card className="floating-window h-full">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <TrendingUp className="w-4 h-4 text-acr-accent" />
              Lots sold
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{live.soldChildLots} <span className="text-sm font-normal text-muted-foreground">/ {live.totalChildLots}</span></p>
            <p className="text-xs text-muted-foreground mt-1">across all subdivisions</p>
          </CardContent>
        </Card>
      </motion.div>

      <motion.div variants={fadeInUp}>
        <Card className="floating-window h-full">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <ClipboardList className="w-4 h-4 text-acr-warn" />
              Stalled gates
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold flex items-center gap-2">
              {live.stalledGates ?? 0}
              {live.stalledGates && live.stalledGates > 0 ? (
                <AlertTriangle className="w-4 h-4 text-acr-warn" />
              ) : null}
            </p>
            <p className="text-xs text-muted-foreground mt-1">past expected return date</p>
          </CardContent>
        </Card>
      </motion.div>
    </motion.div>
  );
}

// ── Tax-delinquent widgets (V1, founder ruling #11) ────────────────────

interface TaxCertificateSummary {
  asOf: string;
  activeCount: number;
  overdueCount: number;
  within30Count: number;
  within90Count: number;
  totalCapitalCents: number;
}

function TaxDelinquentWidgets() {
  // V1 — tax_lien_deed used to fall through resolveCategory to "land" and
  // render LAND_MOCK's fabricated pipeline numbers. This widget reads the
  // SAME real org-scoped aggregate the /redemption-clock page header uses
  // (GET /api/tax-certificates/dashboard/summary — status counts + deadline
  // buckets + deployed capital, routes-tax-certificates.ts). The endpoint is
  // ownerOrAdmin-gated, so on any non-OK response (403 for members, etc.) we
  // suppress the block entirely rather than invent numbers (Trey's W-5
  // lesson: never show data the org doesn't actually have).
  const { data: live, isLoading } = useQuery<TaxCertificateSummary>({
    queryKey: ["/api/tax-certificates/dashboard/summary"],
    queryFn: async () => {
      const res = await fetch("/api/tax-certificates/dashboard/summary", { credentials: "include" });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      return res.json();
    },
  });

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28" />)}
      </div>
    );
  }

  if (!live) return null; // fetch failed — never fabricate

  if (live.activeCount === 0) {
    return (
      <EmptyState
        icon={Clock}
        headline="Track your first certificate"
        subtitle="Add the tax certificates or deeds you hold and the redemption clock sorts them by days to deadline — overdue and 30-day buckets surface here."
        cta={{ label: "Open redemption clock", href: "/redemption-clock", "data-testid": "tax-widget-clock" }}
        secondaryCta={{ label: "Auction worksheet", href: "/auction-worksheet", "data-testid": "tax-widget-auction" }}
        actionIcon={Clock}
      />
    );
  }

  return (
    <motion.div
      variants={staggerContainer}
      initial="hidden"
      animate="visible"
      className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4"
    >
      <PersonaStat
        icon={Clock}
        iconClass="text-primary"
        label="Active certificates"
        value={String(live.activeCount)}
        sub={`${fmtUsdK(live.totalCapitalCents)} capital deployed`}
      />
      <PersonaStat
        icon={AlertTriangle}
        iconClass={live.overdueCount > 0 ? "text-acr-warn" : "text-acr-pos"}
        label="Overdue"
        value={String(live.overdueCount)}
        sub={live.overdueCount > 0 ? "past redemption deadline" : "none past deadline"}
      />
      <PersonaStat
        icon={CalendarClock}
        iconClass="text-acr-warn"
        label="Due in 30 days"
        value={String(live.within30Count)}
        sub="redemption deadlines"
      />
      <PersonaStat
        icon={CalendarClock}
        iconClass="text-acr-accent"
        label="Due in 90 days"
        value={String(live.within90Count)}
        sub="redemption deadlines"
      />
    </motion.div>
  );
}

// ── Persona widget sets (the four investor personas) ───────────────────
//
// These widgets are keyed on `users.persona`, NOT businessType — the two
// underserved note roles (originator, servicer) are personas derived from
// the "note_investor" businessType and have no businessType of their own.
// Each persona gets a genuinely distinct widget built from REAL data
// (/api/notes, /api/leads, /api/properties) with honest-empty when the
// org has nothing yet. No persona shares another's mock. None of these
// fabricate a number — empty means empty, with a purposeful CTA.

type PersonaWidgetKind = "land" | "note_invest" | "note_originate" | "note_service";

const PERSONA_WIDGET_LABELS: Record<PersonaWidgetKind, { title: string; icon: React.ReactNode }> = {
  land: { title: "Sourcing", icon: <Search className="w-4 h-4" /> },
  note_invest: { title: "Portfolio yield", icon: <TrendingUp className="w-4 h-4" /> },
  note_originate: { title: "Origination", icon: <FileSignature className="w-4 h-4" /> },
  note_service: { title: "Servicing", icon: <ClipboardCheck className="w-4 h-4" /> },
};

function useNotes() {
  return useQuery<Note[]>({
    queryKey: ["/api/notes"],
    queryFn: async () => {
      const res = await okOrThrow(await fetch("/api/notes", { credentials: "include" }));
      return listFrom<Note>(await res.json());
    },
  });
}

interface LeadLite { id: number; type?: string | null; status?: string | null }
interface PropertyLite { id: number; status?: string | null; latitude?: unknown; longitude?: unknown }

/** Sourcing widget (land_investor) — the job is finding parcels + owners. */
function LandSourcingWidgets() {
  const {
    data: properties = [],
    isLoading: pLoading,
    isError: pError,
    error: pErr,
    refetch: pRefetch,
  } = useQuery<PropertyLite[]>({
    queryKey: ["/api/properties"],
    queryFn: async () => {
      const res = await okOrThrow(
        await fetch("/api/properties?page=1&pageSize=100", { credentials: "include" }),
      );
      return listFrom<PropertyLite>(await res.json());
    },
  });
  const {
    data: leads = [],
    isLoading: lLoading,
    isError: lError,
    error: lErr,
    refetch: lRefetch,
  } = useQuery<LeadLite[]>({
    queryKey: ["/api/leads"],
    queryFn: async () => {
      const res = await okOrThrow(await fetch("/api/leads", { credentials: "include" }));
      return listFrom<LeadLite>(await res.json());
    },
  });

  if (pLoading || lLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-28" />)}
      </div>
    );
  }

  // BEFORE the empty state, and that order is the whole point of this unit.
  // Both queries used to swallow failure into `[]`, so an API blip fell through
  // to the EmptyState below and showed a customer with two hundred parcels the
  // NEW-USER onboarding panel — "Add your first parcels" — on their own
  // dashboard. "You have none" and "we could not look" are different sentences.
  if (pError || lError) {
    const err = (pErr ?? lErr) as Error | null;
    return (
      <QueryErrorState
        error={err instanceof Error ? err : new Error(String(err))}
        onRetry={() => {
          void pRefetch();
          void lRefetch();
        }}
        title="Couldn't load your sourcing pipeline"
        description="Your parcels and owner targets could not be read. This is not the same as having none."
        testId="land-widget-error"
      />
    );
  }

  const mapped = properties.filter((p) => p.latitude && p.longitude).length;
  const prospects = properties.filter((p) =>
    ["prospect", "due_diligence", "offer_sent", "under_contract"].includes(p.status || ""),
  ).length;
  const ownerTargets = leads.filter((l) => l.type === "seller" || !l.type).length;

  if (properties.length === 0 && ownerTargets === 0) {
    return (
      <EmptyState
        icon={Search}
        headline="Start sourcing parcels"
        subtitle="Find raw land by county, pull the owner of record, and comp it. Add your first parcels or owner targets to light up this panel."
        cta={{ label: "Find parcels", href: "/properties", "data-testid": "land-widget-find" }}
        secondaryCta={{ label: "Owner targets", href: "/leads?type=seller", "data-testid": "land-widget-owners" }}
        actionIcon={Search}
      />
    );
  }

  return (
    <motion.div
      variants={staggerContainer}
      initial="hidden"
      animate="visible"
      className="grid grid-cols-1 md:grid-cols-3 gap-4"
    >
      <PersonaStat icon={Search} iconClass="text-primary" label="Parcels mapped" value={String(mapped)} sub={`${properties.length} total in pipeline`} />
      <PersonaStat icon={Filter} iconClass="text-acr-warn" label="In acquisition" value={String(prospects)} sub="prospect → under contract" />
      <PersonaStat icon={Users} iconClass="text-acr-accent" label="Owner targets" value={String(ownerTargets)} sub="sellers to mail or door-knock" />
    </motion.div>
  );
}

/** Portfolio-yield widget (note_investor) — the job is yield on owned paper. */
function NoteInvestorWidgets() {
  const { data: notes = [], isLoading, isError, error, refetch } = useNotes();
  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-28" />)}
      </div>
    );
  }

  // An error branch BEFORE the empty state. `useNotes` used to swallow failure
  // into `[]`, so an outage fell through to the panel below and told someone
  // with a full book to start from nothing.
  if (isError) {
    return (
      <QueryErrorState
        error={error instanceof Error ? error : new Error(String(error))}
        onRetry={() => void refetch()}
        title="Couldn't load your notes"
        description="Your note book could not be read. This is not the same as holding no notes."
        testId="note-invest-error"
      />
    );
  }


  const active = notes.filter((n) => n.status === "active");
  if (active.length === 0) {
    return (
      <EmptyState
        icon={TrendingUp}
        headline="Import your note portfolio"
        subtitle="Your job is yield, not geography. Import the notes you've acquired — payer, balance, rate, and payment — and AcreOS tracks the book and its yield."
        cta={{ label: "Import notes", href: "/notes?action=new", "data-testid": "note-invest-import" }}
        secondaryCta={{ label: "Open the book", href: "/finance", "data-testid": "note-invest-book" }}
        actionIcon={TrendingUp}
      />
    );
  }

  const outstanding = active.reduce((s, n) => s + Number(n.currentBalance || 0), 0);
  const monthlyIncome = active.reduce((s, n) => s + Number(n.monthlyPayment || 0), 0);
  // Balance-weighted average rate — only from notes that carry a rate + balance.
  let w = 0, acc = 0;
  active.forEach((n) => {
    const bal = Number(n.currentBalance || 0);
    const rate = Number(n.interestRate || 0);
    if (bal > 0 && rate > 0) { w += bal; acc += bal * rate; }
  });
  const wtdRate = w > 0 ? acc / w : null;

  return (
    <motion.div
      variants={staggerContainer}
      initial="hidden"
      animate="visible"
      className="grid grid-cols-1 md:grid-cols-3 gap-4"
    >
      <PersonaStat icon={Wallet} iconClass="text-acr-pos" label="Outstanding" value={usd(outstanding, { noCents: true })} sub={`${active.length} active note${active.length === 1 ? "" : "s"}`} mono />
      <PersonaStat icon={Banknote} iconClass="text-acr-accent" label="Monthly income" value={usd(monthlyIncome, { noCents: true })} sub="scheduled P&I this cycle" mono />
      <PersonaStat
        icon={Percent}
        iconClass="text-primary"
        label="Weighted yield"
        value={wtdRate !== null ? `${wtdRate.toFixed(2)}%` : "—"}
        sub={wtdRate !== null ? "balance-weighted across book" : "rate not set on notes yet"}
        mono={wtdRate !== null}
      />
    </motion.div>
  );
}

/** Origination widget (note_originator) — the job is CREATING paper. */
function NoteOriginatorWidgets() {
  const { data: notes = [], isLoading, isError, error, refetch } = useNotes();
  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-28" />)}
      </div>
    );
  }

  // An error branch BEFORE the empty state. `useNotes` used to swallow failure
  // into `[]`, so an outage fell through to the panel below and told someone
  // with a full book to start from nothing.
  if (isError) {
    return (
      <QueryErrorState
        error={error instanceof Error ? error : new Error(String(error))}
        onRetry={() => void refetch()}
        title="Couldn't load your notes"
        description="Your note book could not be read. This is not the same as having originated no notes."
        testId="note-orig-error"
      />
    );
  }


  const active = notes.filter((n) => n.status === "active");
  if (active.length === 0) {
    return (
      <EmptyState
        icon={FileSignature}
        headline="Originate your first note"
        subtitle="Your job is creating paper, not buying it. Set your default rate and term, then turn a deal into a seller-financed note. The pipeline lives on Deals."
        cta={{ label: "Start an origination", href: "/deals?action=new", "data-testid": "note-orig-start" }}
        secondaryCta={{ label: "Set terms", href: "/settings?tab=tax-compliance", "data-testid": "note-orig-terms" }}
        actionIcon={FileSignature}
      />
    );
  }

  const financed = active.reduce((s, n) => s + Number(n.originalPrincipal || n.currentBalance || 0), 0);
  // Average originated term + rate — only across notes that carry the field.
  const termNotes = active.filter((n) => Number(n.termMonths || 0) > 0);
  const avgTerm = termNotes.length > 0
    ? Math.round(termNotes.reduce((s, n) => s + Number(n.termMonths || 0), 0) / termNotes.length)
    : null;
  const rateNotes = active.filter((n) => Number(n.interestRate || 0) > 0);
  const avgRate = rateNotes.length > 0
    ? rateNotes.reduce((s, n) => s + Number(n.interestRate || 0), 0) / rateNotes.length
    : null;

  return (
    <motion.div
      variants={staggerContainer}
      initial="hidden"
      animate="visible"
      className="grid grid-cols-1 md:grid-cols-3 gap-4"
    >
      <PersonaStat icon={FileSignature} iconClass="text-primary" label="Notes originated" value={String(active.length)} sub={`${usd(financed, { noCents: true })} financed`} />
      <PersonaStat
        icon={Percent}
        iconClass="text-acr-pos"
        label="Avg note rate"
        value={avgRate !== null ? `${avgRate.toFixed(2)}%` : "—"}
        sub={avgRate !== null ? "across originations" : "rate not set yet"}
        mono={avgRate !== null}
      />
      <PersonaStat
        icon={CalendarClock}
        iconClass="text-acr-accent"
        label="Avg term"
        value={avgTerm !== null ? `${avgTerm} mo` : "—"}
        sub={avgTerm !== null ? "originated note length" : "term not set yet"}
      />
    </motion.div>
  );
}

/** Servicing widget (note_servicer) — the job is servicing notes for others. */
function NoteServicerWidgets() {
  const { data: notes = [], isLoading } = useNotes();
  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28" />)}
      </div>
    );
  }

  const active = notes.filter((n) => n.status === "active");
  if (active.length === 0) {
    return (
      <EmptyState
        icon={ClipboardCheck}
        headline="Import the book you service"
        subtitle="You service notes for others. Import the serviced book, then set your servicing fee and escrow handling. Delinquency and escrow health surface here."
        cta={{ label: "Import serviced book", href: "/notes?action=new", "data-testid": "note-serv-import" }}
        secondaryCta={{ label: "Fee & escrow setup", href: "/settings?tab=tax-compliance", "data-testid": "note-serv-config" }}
        actionIcon={ClipboardCheck}
      />
    );
  }

  // Delinquent = anything not "current" on the delinquency ladder, OR a note
  // whose nextPaymentDate is already in the past. Real fields only.
  const now = Date.now();
  const delinquent = active.filter((n) => {
    if (n.delinquencyStatus && n.delinquencyStatus !== "current") return true;
    if (n.nextPaymentDate) {
      const days = Math.floor((now - new Date(n.nextPaymentDate as any).getTime()) / 86_400_000);
      return days > 0;
    }
    return false;
  }).length;
  const monthlyFees = active.reduce((s, n) => s + Number(n.serviceFee || 0), 0);
  const escrowed = active.filter((n) => n.taxEscrowEnabled).length;

  return (
    <motion.div
      variants={staggerContainer}
      initial="hidden"
      animate="visible"
      className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4"
    >
      <PersonaStat icon={ClipboardCheck} iconClass="text-primary" label="Serviced book" value={String(active.length)} sub="active notes serviced" />
      <PersonaStat
        icon={AlertTriangle}
        iconClass={delinquent > 0 ? "text-acr-warn" : "text-acr-pos"}
        label="Delinquent"
        value={String(delinquent)}
        sub={delinquent > 0 ? "past due — needs outreach" : "all current"}
      />
      <PersonaStat icon={DollarSign} iconClass="text-acr-pos" label="Servicing fees" value={usd(monthlyFees, { noCents: true })} sub="monthly fee income" mono />
      <PersonaStat icon={ShieldCheck} iconClass="text-acr-accent" label="Tax escrow" value={`${escrowed}/${active.length}`} sub="notes with escrow on" />
    </motion.div>
  );
}

/** Shared stat tile used by the persona widget sets. */
function PersonaStat({
  icon: Icon,
  iconClass,
  label,
  value,
  sub,
  mono,
}: {
  icon: React.ElementType;
  iconClass: string;
  label: string;
  value: string;
  sub: string;
  mono?: boolean;
}) {
  return (
    <motion.div variants={fadeInUp}>
      <Card className="floating-window h-full">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <Icon className={`w-4 h-4 ${iconClass}`} aria-hidden="true" />
            {label}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className={`text-2xl font-bold ${mono ? "font-mono tabular-nums" : ""}`}>{value}</p>
          <p className="text-xs text-muted-foreground mt-1">{sub}</p>
        </CardContent>
      </Card>
    </motion.div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────

export function TypeSpecificWidgets({ businessType, organizationId }: TypeSpecificWidgetsProps) {
  // Persona takes precedence over businessType for the four investor
  // personas — the note roles have no businessType of their own, and the
  // land sourcing widget is real-data, not the legacy LAND_MOCK. Everything
  // else (wholesaler / flipper / landlord / commercial / subdivider) still
  // resolves by businessType below.
  const persona = usePersona();
  const personaKind: PersonaWidgetKind | null =
    persona === "land_investor" ? "land"
    : persona === "note_investor" ? "note_invest"
    : persona === "note_originator" ? "note_originate"
    : persona === "note_servicer" ? "note_service"
    : null;

  if (personaKind) {
    const { title, icon } = PERSONA_WIDGET_LABELS[personaKind];
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">{icon}</span>
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            {title} Metrics
          </h3>
        </div>
        {personaKind === "land" && <LandSourcingWidgets />}
        {personaKind === "note_invest" && <NoteInvestorWidgets />}
        {personaKind === "note_originate" && <NoteOriginatorWidgets />}
        {personaKind === "note_service" && <NoteServicerWidgets />}
      </div>
    );
  }

  const category = resolveCategory(businessType);

  const labels: Record<BusinessCategory, { title: string; icon: React.ReactNode }> = {
    land: { title: "Land & Notes", icon: <Home className="w-4 h-4" /> },
    wholesaler: { title: "Wholesale", icon: <Zap className="w-4 h-4" /> },
    flipper: { title: "Fix & Flip", icon: <Hammer className="w-4 h-4" /> },
    buy_and_hold: { title: "Buy & Hold", icon: <Building className="w-4 h-4" /> },
    commercial: { title: "Commercial", icon: <Landmark className="w-4 h-4" /> },
    subdivider: { title: "Subdivision", icon: <Building className="w-4 h-4" /> },
    tax_delinquent: { title: "Tax-Delinquent", icon: <Clock className="w-4 h-4" /> },
  };

  const { title, icon } = labels[category];

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground">{icon}</span>
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          {title} Metrics
        </h3>
      </div>

      {/* land: real sourcing data (/api/properties + /api/leads) with an
          honest EmptyState — the fabricated LandWidgets mock is gone. */}
      {category === "land" && <LandSourcingWidgets />}
      {category === "wholesaler" && <WholesalerWidgets />}
      {category === "flipper" && <FlipperWidgets />}
      {category === "buy_and_hold" && <BuyAndHoldWidgets />}
      {/* commercial: same real rent/lease/maintenance domain as buy_and_hold
          (/api/landlord/dashboard, hasData-suppressed) — see note above
          SubdividerWidgets for why the mock NOI/cap-rate tiles are gone. */}
      {category === "commercial" && <BuyAndHoldWidgets />}
      {category === "subdivider" && <SubdividerWidgets />}
      {category === "tax_delinquent" && <TaxDelinquentWidgets />}
    </div>
  );
}
