import { motion } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import { staggerContainer, fadeInUp } from "@/lib/animations";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DollarSign,
  Clock,
  TrendingUp,
  Zap,
  Users,
  Filter,
  Hammer,
  BarChart3,
  Timer,
  Percent,
  Building,
  Droplets,
  CalendarClock,
  Wallet,
  PieChart,
  ArrowUpRight,
  Home,
  Landmark,
  Layers,
  ClipboardList,
  AlertTriangle,
} from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────

export interface TypeSpecificWidgetsProps {
  businessType: string;
  organizationId: number;
}

type BusinessCategory = "land" | "wholesaler" | "flipper" | "buy_and_hold" | "commercial" | "subdivider";

// ── Mock data structures (to be wired to API later) ────────────────────

const LAND_MOCK = {
  pipelineValue: 1_245_000,
  avgDaysToClose: 47,
  profitPerDealSparkline: [8200, 11500, 9800, 14200, 12600, 15800],
  activeDeals: 12,
};

const WHOLESALER_MOCK = {
  assignmentFees: 187_500,
  avgAssignmentFee: 12_500,
  speedToClose: 14,
  buyerListHealth: { total: 248, active: 189, stale: 59 },
  dealFunnel: [
    { stage: "Leads", count: 342 },
    { stage: "Under Contract", count: 28 },
    { stage: "Assigned", count: 14 },
    { stage: "Closed", count: 9 },
  ],
};

const FLIPPER_MOCK = {
  activeRehabs: [
    { address: "123 Oak St", budget: 85000, spent: 52000, label: "Kitchen & Bath" },
    { address: "456 Elm Ave", budget: 120000, spent: 98000, label: "Full Gut Rehab" },
    { address: "789 Pine Rd", budget: 45000, spent: 12000, label: "Cosmetic" },
  ],
  totalARV: 1_820_000,
  avgTimeline: 94,
  roiSparkline: [18, 22, 15, 28, 24, 31],
};

const BUY_AND_HOLD_MOCK = {
  monthlyCashFlow: 14_200,
  vacancyRate: 4.2,
  avgCapRate: 7.8,
  leaseExpirations: [
    { month: "Apr", count: 2 },
    { month: "May", count: 0 },
    { month: "Jun", count: 3 },
    { month: "Jul", count: 1 },
    { month: "Aug", count: 0 },
    { month: "Sep", count: 4 },
  ],
  totalUnits: 36,
};

const COMMERCIAL_MOCK = {
  monthlyNOI: 42_800,
  vacancyRate: 6.1,
  avgCapRate: 6.3,
  leaseExpirations: [
    { month: "Apr", count: 1 },
    { month: "May", count: 0 },
    { month: "Jun", count: 2 },
    { month: "Jul", count: 0 },
    { month: "Aug", count: 1 },
    { month: "Sep", count: 3 },
  ],
  totalSqFt: 128_000,
  occupiedSqFt: 120_000,
};

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
      return "buy_and_hold";
    case "commercial":
      return "commercial";
    default:
      return "land";
  }
}

function MiniSparkline({ data, color = "hsl(var(--primary))" }: { data: number[]; color?: string }) {
  if (!data || data.length < 2) return null;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const h = 32;
  const w = 80;
  const points = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * w;
      const y = h - ((v - min) / range) * h;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <svg width={w} height={h} className="shrink-0">
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
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
            <span className="text-[10px] font-semibold text-primary-foreground">{pct}%</span>
          )}
        </div>
      </div>
    </div>
  );
}

function LeaseExpirationTimeline({ data }: { data: { month: string; count: number }[] }) {
  if (!data || data.length === 0) return null;
  const max = Math.max(...data.map((d) => d.count), 1);

  return (
    <div className="flex items-end gap-2 h-16">
      {data.map((d) => (
        <div key={d.month} className="flex flex-col items-center gap-1 flex-1">
          <div
            className={`w-full rounded-t transition-all duration-500 ${
              d.count > 0 ? "bg-acr-warn dark:bg-acr-warn" : "bg-muted"
            }`}
            style={{ height: `${Math.max((d.count / max) * 48, 4)}px` }}
          />
          <span className="text-[10px] text-muted-foreground">{d.month}</span>
        </div>
      ))}
    </div>
  );
}

// ── Widget Sets ────────────────────────────────────────────────────────

function LandWidgets() {
  const data = LAND_MOCK;

  return (
    <motion.div
      variants={staggerContainer}
      initial="hidden"
      animate="visible"
      className="grid grid-cols-1 md:grid-cols-3 gap-4"
    >
      <motion.div variants={fadeInUp}>
        <Card className="floating-window h-full">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <DollarSign className="w-4 h-4 text-acr-pos" />
              Pipeline Value
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">${data.pipelineValue.toLocaleString()}</p>
            <p className="text-xs text-muted-foreground mt-1">
              {data.activeDeals} active deals
            </p>
          </CardContent>
        </Card>
      </motion.div>

      <motion.div variants={fadeInUp}>
        <Card className="floating-window h-full">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Clock className="w-4 h-4 text-acr-accent" />
              Avg Days to Close
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{data.avgDaysToClose}</p>
            <p className="text-xs text-muted-foreground mt-1">days average</p>
          </CardContent>
        </Card>
      </motion.div>

      <motion.div variants={fadeInUp}>
        <Card className="floating-window h-full">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <TrendingUp className="w-4 h-4 text-primary" />
              Profit Per Deal
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <p className="text-2xl font-bold">
                ${data.profitPerDealSparkline[data.profitPerDealSparkline.length - 1].toLocaleString()}
              </p>
              <MiniSparkline data={data.profitPerDealSparkline} color="hsl(142, 71%, 45%)" />
            </div>
            <p className="text-xs text-muted-foreground mt-1">last 6 deals</p>
          </CardContent>
        </Card>
      </motion.div>
    </motion.div>
  );
}

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

function CommercialWidgets() {
  const data = COMMERCIAL_MOCK;
  const occupancyPct = Math.round((data.occupiedSqFt / data.totalSqFt) * 100);

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
              <PieChart className="w-4 h-4 text-acr-pos" />
              Monthly NOI
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">${data.monthlyNOI.toLocaleString()}</p>
            <p className="text-xs text-muted-foreground mt-1">
              {data.totalSqFt.toLocaleString()} sq ft portfolio
            </p>
          </CardContent>
        </Card>
      </motion.div>

      <motion.div variants={fadeInUp}>
        <Card className="floating-window h-full">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Landmark className="w-4 h-4 text-acr-accent" />
              Occupancy
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <p className="text-2xl font-bold">{occupancyPct}%</p>
              <Badge
                variant="outline"
                className={`text-xs ${
                  occupancyPct >= 90
                    ? "border-acr-pos-soft text-acr-pos dark:border-acr-pos-soft dark:text-acr-pos"
                    : "border-acr-warn-soft text-acr-warn dark:border-acr-warn-soft dark:text-acr-warn"
                }`}
              >
                {data.vacancyRate}% vacant
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {data.occupiedSqFt.toLocaleString()} / {data.totalSqFt.toLocaleString()} sq ft
            </p>
          </CardContent>
        </Card>
      </motion.div>

      <motion.div variants={fadeInUp}>
        <Card className="floating-window h-full">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Percent className="w-4 h-4 text-primary" />
              Avg Cap Rate
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{data.avgCapRate}%</p>
            <p className="text-xs text-muted-foreground mt-1">across portfolio</p>
          </CardContent>
        </Card>
      </motion.div>

      <motion.div variants={fadeInUp}>
        <Card className="floating-window h-full">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <CalendarClock className="w-4 h-4 text-acr-warn" />
              Lease Expirations
            </CardTitle>
          </CardHeader>
          <CardContent>
            <LeaseExpirationTimeline data={data.leaseExpirations} />
            <p className="text-xs text-muted-foreground mt-2">next 6 months</p>
          </CardContent>
        </Card>
      </motion.div>
    </motion.div>
  );
}

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

// ── Main Component ─────────────────────────────────────────────────────

export function TypeSpecificWidgets({ businessType, organizationId }: TypeSpecificWidgetsProps) {
  const category = resolveCategory(businessType);

  const labels: Record<BusinessCategory, { title: string; icon: React.ReactNode }> = {
    land: { title: "Land & Notes", icon: <Home className="w-4 h-4" /> },
    wholesaler: { title: "Wholesale", icon: <Zap className="w-4 h-4" /> },
    flipper: { title: "Fix & Flip", icon: <Hammer className="w-4 h-4" /> },
    buy_and_hold: { title: "Buy & Hold", icon: <Building className="w-4 h-4" /> },
    commercial: { title: "Commercial", icon: <Landmark className="w-4 h-4" /> },
    subdivider: { title: "Subdivision", icon: <Building className="w-4 h-4" /> },
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

      {category === "land" && <LandWidgets />}
      {category === "wholesaler" && <WholesalerWidgets />}
      {category === "flipper" && <FlipperWidgets />}
      {category === "buy_and_hold" && <BuyAndHoldWidgets />}
      {category === "commercial" && <CommercialWidgets />}
      {category === "subdivider" && <SubdividerWidgets />}
    </div>
  );
}
