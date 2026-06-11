/**
 * /outreach/mail · Mail Credits tab (Pillar 3 Tab 5).
 *
 * Self-service credit top-up + spend history. Shows a fuel-gauge of the
 * monthly credit pool, the burn rate, projected runout, an itemized history
 * of recent debits filterable by category, and 4 one-time recharge packs
 * ($20 / $50 / $100 / $250) that route through Stripe Checkout.
 */

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Coins, ExternalLink, Mail, MessageSquare, Phone, Search, Sparkles, Zap } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { QueryErrorState } from "@/components/query-error-state";
import { staggerContainer, staggerItem } from "@/lib/animations";
import {
  type CreditHistoryItem,
  type CreditSummary,
  useCreditExamples,
  useCreditHistory,
  useCreditSummary,
  useRechargeCredits,
} from "@/hooks/use-outreach-mail";
import { formatDate, formatDateTime } from "@/lib/format";

const PACKS: Array<{ cents: number; label: string; subtitle: string }> = [
  { cents: 2000, label: "$20", subtitle: "~2,000 credits" },
  { cents: 5000, label: "$50", subtitle: "~5,000 credits" },
  { cents: 10000, label: "$100", subtitle: "~10,000 credits" },
  { cents: 25000, label: "$250", subtitle: "~25,000 credits" },
];

const CATEGORY_ICONS: Record<string, typeof Mail> = {
  postcard: Mail,
  email: Mail,
  sms: MessageSquare,
  voice: Phone,
  skip_trace: Search,
  ai_tokens: Sparkles,
};

const CATEGORY_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "all", label: "All categories" },
  { value: "postcard", label: "Postcards" },
  { value: "email", label: "Email" },
  { value: "sms", label: "SMS" },
  { value: "voice", label: "Voice" },
  { value: "skip_trace", label: "Skip trace" },
  { value: "ai_tokens", label: "AI tokens" },
];

function formatUsd(cents: number): string {
  return `$${(cents / 100).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export default function CreditsTab() {
  const summary = useCreditSummary();
  const examples = useCreditExamples();
  const [category, setCategory] = useState<string>("all");
  const history = useCreditHistory({
    days: 30,
    category: category === "all" ? null : category,
  });
  const recharge = useRechargeCredits();
  const { toast } = useToast();

  const handleRecharge = (packCents: number) => {
    recharge.mutate(
      { packCents },
      {
        onSuccess: (data) => {
          if (data.checkoutUrl) {
            window.location.href = data.checkoutUrl;
          } else {
            toast({
              title: "Couldn't start checkout",
              description: "Stripe did not return a checkout URL — please try again.",
              variant: "destructive",
            });
          }
        },
        onError: (err) => {
          toast({
            title: "Recharge failed",
            description: err.message || "Please try again.",
            variant: "destructive",
          });
        },
      },
    );
  };

  return (
    <motion.div
      variants={staggerContainer}
      initial="initial"
      animate="animate"
      className="space-y-6"
      data-testid="credits-tab"
    >
      <motion.div variants={staggerItem}>
        <FuelGaugeCard summary={summary} />
      </motion.div>

      <motion.div variants={staggerItem}>
        <RechargeCards onPick={handleRecharge} pending={recharge.isPending} />
      </motion.div>

      <motion.div variants={staggerItem}>
        <Card>
          <CardHeader className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div>
              <CardTitle>Recent spend</CardTitle>
              <CardDescription>Itemized debits — last 30 days.</CardDescription>
            </div>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger className="w-full md:w-56" data-testid="credits-category-filter">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CATEGORY_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardHeader>
          <CardContent>
            {history.isLoading ? (
              <Skeleton className="h-40 w-full" />
            ) : history.error ? (
              <QueryErrorState
                error={history.error as Error}
                onRetry={() => history.refetch()}
                compact
              />
            ) : history.data && history.data.items.length > 0 ? (
              <HistoryView items={history.data.items} />
            ) : (
              <p
                className="text-sm text-muted-foreground py-6 text-center"
                data-testid="credits-history-empty"
              >
                No metered debits yet for this filter.
              </p>
            )}
          </CardContent>
        </Card>
      </motion.div>

      <motion.div variants={staggerItem}>
        <Card data-testid="credits-cost-reference">
          <CardHeader>
            <CardTitle>What costs what</CardTitle>
            <CardDescription>
              Roughly what your monthly pool buys at each channel.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {examples.isLoading ? (
              <Skeleton className="h-24 w-full" />
            ) : examples.data ? (
              <ul className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {examples.data.examples.map((ex) => (
                  <li
                    key={ex.action}
                    className="rounded-md border p-3 text-center"
                    data-testid={`credit-example-${ex.action}`}
                  >
                    <p className="text-2xl font-mono font-semibold">
                      {ex.quantity.toLocaleString()}
                    </p>
                    <p className="text-xs text-muted-foreground">{ex.label}</p>
                  </li>
                ))}
              </ul>
            ) : null}
          </CardContent>
        </Card>
      </motion.div>
    </motion.div>
  );
}

// ── Fuel gauge ──────────────────────────────────────────────────────────────

function FuelGaugeCard({ summary }: { summary: ReturnType<typeof useCreditSummary> }) {
  if (summary.isLoading) {
    return (
      <Card>
        <CardContent className="p-6">
          <Skeleton className="h-40 w-full" />
        </CardContent>
      </Card>
    );
  }
  if (summary.error) {
    return (
      <QueryErrorState
        error={summary.error as Error}
        onRetry={() => summary.refetch()}
      />
    );
  }
  if (!summary.data) return null;
  return <FuelGauge data={summary.data} />;
}

function FuelGauge({ data }: { data: CreditSummary }) {
  const usedPct = Math.min(
    100,
    data.creditPoolMonthly > 0
      ? (data.creditPoolUsedThisMonth / data.creditPoolMonthly) * 100
      : 0,
  );
  // Color shifts as the gauge fills: green → warn → neg.
  const colorClass = useMemo(() => {
    if (usedPct < 60) return "text-acr-pos";
    if (usedPct < 85) return "text-acr-warn";
    return "text-acr-neg";
  }, [usedPct]);
  const strokeColorClass = useMemo(() => {
    if (usedPct < 60) return "stroke-[hsl(var(--acr-pos,142_71%_45%))]";
    if (usedPct < 85) return "stroke-[hsl(var(--acr-warn,38_92%_50%))]";
    return "stroke-[hsl(var(--acr-neg,0_84%_60%))]";
  }, [usedPct]);

  // Arc: 180° gauge using SVG. Outer radius 80, center at (100, 90).
  const arcLength = Math.PI * 80; // half circle perimeter
  const filled = (arcLength * usedPct) / 100;
  const remaining = arcLength - filled;

  const runoutLabel = data.projectedRunoutDate
    ? formatDate(data.projectedRunoutDate)
    : "won't run out this month";

  return (
    <Card data-testid="credits-fuel-gauge">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Coins className="w-5 h-5" aria-hidden="true" />
          Mail credits
          <Badge variant="outline" className="text-xs uppercase ml-2">
            {data.tier}
          </Badge>
        </CardTitle>
        <CardDescription>Resets at the start of each calendar month.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col md:flex-row items-center gap-6">
          <div className="relative w-[220px] h-[120px] shrink-0">
            <svg
              viewBox="0 0 200 110"
              className="w-full h-full"
              role="img"
              aria-label={`Credit pool ${Math.round(usedPct)}% used`}
            >
              {/* Background arc */}
              <path
                d="M 20 90 A 80 80 0 0 1 180 90"
                fill="none"
                strokeWidth={14}
                strokeLinecap="round"
                className="stroke-muted/40"
              />
              {/* Filled arc */}
              <path
                d="M 20 90 A 80 80 0 0 1 180 90"
                fill="none"
                strokeWidth={14}
                strokeLinecap="round"
                strokeDasharray={`${filled} ${remaining}`}
                className={strokeColorClass}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-end pb-2">
              <p className={`text-3xl font-mono font-semibold ${colorClass}`}>
                {Math.round(usedPct)}%
              </p>
              <p className="text-xs text-muted-foreground">used</p>
            </div>
          </div>
          <div className="flex-1 min-w-0 space-y-2 text-center md:text-left">
            <p className="text-base font-medium">
              <span className="font-mono">
                {data.creditPoolUsedThisMonth.toLocaleString()}
              </span>{" "}
              of{" "}
              <span className="font-mono">{data.creditPoolMonthly.toLocaleString()}</span>{" "}
              credits used
            </p>
            <p className="text-sm text-muted-foreground">
              Burning ~
              <span className="font-mono">
                {data.burnRateCreditsPerDay.toLocaleString()}
              </span>
              /day · projected runout{" "}
              <span className={data.projectedRunoutDate ? "text-acr-warn font-medium" : "text-acr-pos font-medium"}>
                {runoutLabel}
              </span>
            </p>
            <p className="text-xs text-muted-foreground">
              Day {data.daysIntoMonth} of the month ·{" "}
              {data.creditPoolRemainingThisMonth.toLocaleString()} credits remaining
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Recharge cards ──────────────────────────────────────────────────────────

function RechargeCards({
  onPick,
  pending,
}: {
  onPick: (packCents: number) => void;
  pending: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Zap className="w-5 h-5" aria-hidden="true" />
          Recharge
        </CardTitle>
        <CardDescription>One-time credit pack — added on top of your monthly pool.</CardDescription>
      </CardHeader>
      <CardContent>
        <div
          className="grid grid-cols-2 md:grid-cols-4 gap-2"
          data-testid="credits-recharge-cards"
        >
          {PACKS.map((p) => (
            <Button
              key={p.cents}
              type="button"
              variant="outline"
              onClick={() => onPick(p.cents)}
              disabled={pending}
              aria-label={`Buy ${p.label} credit pack`}
              data-testid={`credits-pack-${p.cents}`}
              className="h-auto flex-col items-center justify-center py-4 gap-1"
            >
              <span className="text-xl font-semibold">{p.label}</span>
              <span className="text-xs text-muted-foreground">{p.subtitle}</span>
              <span className="text-xs text-primary inline-flex items-center gap-1">
                Checkout <ExternalLink className="w-3 h-3" aria-hidden="true" />
              </span>
            </Button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground mt-3">
          Packs charge via Stripe Checkout. Credits land on the org pool within a few seconds of
          payment.
        </p>
      </CardContent>
    </Card>
  );
}

// ── History view ────────────────────────────────────────────────────────────

function HistoryView({ items }: { items: CreditHistoryItem[] }) {
  return (
    <>
      {/* Desktop table */}
      <div className="hidden md:block overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Provider</TableHead>
              <TableHead className="text-right">Cost</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((row) => (
              <TableRow key={row.id} data-testid={`credit-row-${row.id}`}>
                <TableCell className="whitespace-nowrap text-xs">
                  {formatDateTime(row.dateIso)}
                </TableCell>
                <TableCell className="text-sm">{row.action}</TableCell>
                <TableCell>
                  <CategoryBadge category={row.category} />
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {row.providerName ?? "—"}
                </TableCell>
                <TableCell className="text-right font-mono text-acr-warn">
                  {formatUsd(row.cents)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Mobile card list */}
      <ul className="md:hidden space-y-2">
        {items.map((row) => (
          <li
            key={row.id}
            className="rounded-md border p-3"
            data-testid={`credit-card-${row.id}`}
          >
            <div className="flex items-center justify-between mb-1">
              <CategoryBadge category={row.category} />
              <span className="font-mono text-acr-warn">{formatUsd(row.cents)}</span>
            </div>
            <p className="text-sm font-medium truncate">{row.action}</p>
            <p className="text-xs text-muted-foreground">
              {formatDateTime(row.dateIso)}
              {row.providerName ? ` · ${row.providerName}` : ""}
            </p>
          </li>
        ))}
      </ul>
    </>
  );
}

function CategoryBadge({ category }: { category: string }) {
  const Icon = CATEGORY_ICONS[category] ?? Coins;
  return (
    <Badge variant="secondary" className="inline-flex items-center gap-1">
      <Icon className="w-3 h-3" aria-hidden="true" />
      <span className="text-xs">{category}</span>
    </Badge>
  );
}
