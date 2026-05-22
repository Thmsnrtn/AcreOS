/**
 * Founder Finance — Now tiles.
 *
 * Embedded into `/founder` (now.tsx) as additional conditional tiles
 * above the existing Now sections. Each tile is gated on a real condition
 * so the Now surface stays within the daily attention budget (≤5 items).
 *
 * Three tiles:
 *   1. Bucket alarm    — opex bucket low or refund reserve thin.
 *   2. Net-negative    — orgs trending net-negative for 14+ days.
 *   3. Scale-up        — pending revenue-trigger items, Approve/Defer.
 *
 * Reuses the decision-queue card pattern from now.tsx so the tiles look
 * native, not bolted on.
 */
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertOctagon,
  TrendingDown,
  Zap,
  ArrowRight,
} from "lucide-react";
import {
  useActiveTriggers,
  useApproveTrigger,
  useBuckets,
  useContributionMargin,
  useMrr,
} from "@/hooks/use-finance";
import { useToast } from "@/hooks/use-toast";

function formatUsd(cents: number): string {
  const dollars = cents / 100;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: dollars >= 100 ? 0 : 2,
  }).format(dollars);
}

export function FounderFinanceNowTiles() {
  const buckets = useBuckets();
  const mrr = useMrr();
  const margin = useContributionMargin();
  const triggers = useActiveTriggers();
  const approve = useApproveTrigger();
  const { toast } = useToast();

  const loading =
    buckets.isLoading || mrr.isLoading || margin.isLoading || triggers.isLoading;

  if (loading) {
    return <Skeleton className="h-20 w-full" aria-label="Loading finance tiles" />;
  }

  // ── Tile 1: Bucket alarm ───────────────────────────────────────────────
  // Show if opex_available_net < 20% of monthly MRR OR refund reserve < 5%
  // of trailing-30d revenue.
  const monthlyMrr = mrr.data?.currentMrr ?? 0;
  const opexNet = buckets.data?.opexAvailableNet ?? 0;
  const refundReserve = buckets.data?.refundReserve ?? 0;
  const opexAlarm = monthlyMrr > 0 && opexNet < monthlyMrr * 0.2;
  const refundAlarm = monthlyMrr > 0 && refundReserve < monthlyMrr * 0.05;
  const showBucketAlarm = opexAlarm || refundAlarm;

  // ── Tile 2: Net-negative orgs ──────────────────────────────────────────
  // We approximate "14 consecutive days net-negative" using the per-org
  // margin over the last 30 days (margin < 0). The endpoint already sorts
  // worst-first.
  const netNegativeOrgs = (margin.data?.perOrg ?? []).filter(
    (o) => o.marginCents < 0,
  );
  const showNetNeg = netNegativeOrgs.length > 0;

  // ── Tile 3: Active scale-up triggers ──────────────────────────────────
  const activeTriggers = triggers.data?.items ?? [];
  const showTriggers = activeTriggers.length > 0;

  if (!showBucketAlarm && !showNetNeg && !showTriggers) {
    // Nothing to show — keep the Now surface terse.
    return null;
  }

  return (
    <section aria-label="Finance" className="space-y-2">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-sm font-semibold tracking-tight">Money</span>
        <Badge
          variant="secondary"
          className="text-xs tabular-nums bg-acr-brand-soft text-acr-brand border-transparent"
        >
          {(showBucketAlarm ? 1 : 0) +
            (showNetNeg ? 1 : 0) +
            activeTriggers.length}
        </Badge>
      </div>
      <ul className="space-y-2" role="list">
        {showBucketAlarm && (
          <li>
            <Card className="rounded-card hover:shadow-md transition-shadow border-acr-warn/30">
              <CardContent className="flex items-start gap-3 p-4">
                <AlertOctagon
                  className="w-4 h-4 text-acr-warn mt-0.5"
                  aria-hidden="true"
                />
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm">Bucket alarm</div>
                  <p className="text-xs text-muted-foreground line-clamp-2">
                    {opexAlarm
                      ? `Opex bucket at ${monthlyMrr > 0 ? Math.round((opexNet / monthlyMrr) * 100) : 0}% of MRR — net ${formatUsd(opexNet)}.`
                      : `Refund reserve thin — ${formatUsd(refundReserve)} (< 5% of MRR).`}
                  </p>
                </div>
                <Button
                  asChild
                  size="sm"
                  variant="outline"
                  className="shrink-0 text-xs"
                >
                  <Link href="/founder/steering#buckets">
                    Open <ArrowRight className="w-3 h-3 ml-1" aria-hidden="true" />
                  </Link>
                </Button>
              </CardContent>
            </Card>
          </li>
        )}

        {showNetNeg && (
          <li>
            <Card className="rounded-card hover:shadow-md transition-shadow border-acr-warn/30">
              <CardContent className="flex items-start gap-3 p-4">
                <TrendingDown
                  className="w-4 h-4 text-acr-warn mt-0.5"
                  aria-hidden="true"
                />
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm">
                    {netNegativeOrgs.length} org
                    {netNegativeOrgs.length === 1 ? "" : "s"} trending net-negative
                  </div>
                  <p className="text-xs text-muted-foreground line-clamp-2">
                    Worst: {netNegativeOrgs[0]?.orgName} ({formatUsd(netNegativeOrgs[0]?.marginCents ?? 0)} margin).
                  </p>
                </div>
                <Button
                  asChild
                  size="sm"
                  variant="outline"
                  className="shrink-0 text-xs"
                >
                  <Link href="/founder/steering#cost-mix?filter=net_negative">
                    Review <ArrowRight className="w-3 h-3 ml-1" aria-hidden="true" />
                  </Link>
                </Button>
              </CardContent>
            </Card>
          </li>
        )}

        {activeTriggers.map((t) => (
          <li key={t.thresholdId}>
            <Card className="rounded-card hover:shadow-md transition-shadow border-acr-brand/30">
              <CardContent className="flex items-start gap-3 p-4">
                <Zap
                  className="w-4 h-4 text-acr-brand mt-0.5"
                  aria-hidden="true"
                />
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm">
                    MRR crossed {formatUsd(t.threshold)} threshold
                  </div>
                  <p className="text-xs text-muted-foreground line-clamp-2">
                    {t.action}
                    {t.costOneTimeCents > 0 && (
                      <> · One-time {formatUsd(t.costOneTimeCents)}</>
                    )}
                    {t.costRecurringCents > 0 && (
                      <> · +{formatUsd(t.costRecurringCents)}/mo</>
                    )}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button
                    size="sm"
                    variant="default"
                    className="text-xs"
                    disabled={approve.isPending}
                    aria-label={`Approve ${t.action}`}
                    onClick={() => {
                      approve.mutate(
                        { thresholdId: t.thresholdId, action: "approve" },
                        {
                          onSuccess: () =>
                            toast({
                              title: "Approved",
                              description: t.action,
                            }),
                          onError: (err) =>
                            toast({
                              title: "Could not approve",
                              description: err instanceof Error ? err.message : String(err),
                              variant: "destructive",
                            }),
                        },
                      );
                    }}
                  >
                    Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-xs"
                    disabled={approve.isPending}
                    aria-label={`Defer ${t.action} for 7 days`}
                    onClick={() => {
                      approve.mutate(
                        { thresholdId: t.thresholdId, action: "defer" },
                        {
                          onSuccess: () =>
                            toast({
                              title: "Deferred 7 days",
                              description: t.action,
                            }),
                          onError: (err) =>
                            toast({
                              title: "Could not defer",
                              description: err instanceof Error ? err.message : String(err),
                              variant: "destructive",
                            }),
                        },
                      );
                    }}
                  >
                    Defer
                  </Button>
                </div>
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>
    </section>
  );
}
