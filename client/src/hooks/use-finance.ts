/**
 * Founder Finance — React Query hooks backing the financial sections of
 * `/founder` (Now) tiles + `/founder/steering` financial sections.
 *
 * Backed by `server/routes-finance-ledger.ts` at `/api/founder/finance/*`.
 *
 * No new top-level founder route exists — these hooks fold the financial
 * surface into the canonical 4 founder pages per the founder-side
 * integration map.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

export interface BucketsResponse {
  taxReserve: number;
  refundReserve: number;
  profitReserve: number;
  ownerDraw: number;
  opexAvailable: number;
  opexSpent: number;
  opexAvailableNet: number;
  asOf: string;
}

export interface MrrResponse {
  currentMrr: number;
  mrrTrend: Array<{ date: string; mrr: number }>;
  byTier: { starter: number; pro: number; scale: number };
}

export interface ContributionMarginRow {
  orgId: number;
  orgName: string;
  tier: string;
  mrrCents: number;
  variableCostCents: number;
  marginCents: number;
  marginPct: number;
}

export interface ContributionMarginResponse {
  thisMonthCents: number;
  lastMonthCents: number;
  marginPctThisMonth: number;
  marginPctLastMonth: number;
  perOrg: ContributionMarginRow[];
}

export type CostMixCategory =
  | "postcard"
  | "sms"
  | "email"
  | "ai_tokens"
  | "skip_trace"
  | "stripe_fee"
  | "voice"
  | "listings";

export interface CostMixResponse {
  days: number;
  byCategory: Record<
    CostMixCategory,
    { cents: number; providers: Record<string, number> }
  >;
}

export interface ScaleUpHistoryRow {
  id: number;
  action: string;
  targetType: string | null;
  targetId: string | null;
  before: unknown;
  after: unknown;
  note: string | null;
  createdAt: string;
}

export interface ScaleUpHistoryResponse {
  decisions: ScaleUpHistoryRow[];
}

export interface ActiveTriggerItem {
  thresholdId: string;
  threshold: number;
  action: string;
  costOneTimeCents: number;
  costRecurringCents: number;
  status: "pending" | "approved" | "deferred";
  crossedAt: string;
}

export interface ActiveTriggersResponse {
  items: ActiveTriggerItem[];
  trailing30dMrrCents: number;
}

export function useBuckets() {
  return useQuery<BucketsResponse>({
    queryKey: ["/api/founder/finance/buckets"],
    refetchInterval: 5 * 60_000,
    staleTime: 60_000,
  });
}

export function useMrr() {
  return useQuery<MrrResponse>({
    queryKey: ["/api/founder/finance/mrr"],
    refetchInterval: 5 * 60_000,
    staleTime: 60_000,
  });
}

export function useContributionMargin() {
  return useQuery<ContributionMarginResponse>({
    queryKey: ["/api/founder/finance/contribution-margin"],
    refetchInterval: 5 * 60_000,
    staleTime: 60_000,
  });
}

export function useCostMix(days: number = 30) {
  return useQuery<CostMixResponse>({
    queryKey: ["/api/founder/finance/cost-mix", days],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/founder/finance/cost-mix?days=${days}`);
      return res.json();
    },
    staleTime: 60_000,
  });
}

export function useScaleUpHistory() {
  return useQuery<ScaleUpHistoryResponse>({
    queryKey: ["/api/founder/finance/scale-up-history"],
    staleTime: 60_000,
  });
}

export function useActiveTriggers() {
  return useQuery<ActiveTriggersResponse>({
    queryKey: ["/api/founder/finance/triggers/active"],
    refetchInterval: 5 * 60_000,
    staleTime: 60_000,
  });
}

export function useApproveTrigger() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { thresholdId: string; action: "approve" | "defer"; note?: string }) => {
      const res = await apiRequest(
        "POST",
        `/api/founder/finance/triggers/${encodeURIComponent(vars.thresholdId)}/approve`,
        { action: vars.action, note: vars.note },
        { idempotent: true },
      );
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/founder/finance/triggers/active"] });
      qc.invalidateQueries({ queryKey: ["/api/founder/finance/scale-up-history"] });
    },
  });
}

export interface RecoveryTransferArgs {
  fromBucket:
    | "tax_reserve"
    | "refund_reserve"
    | "profit_reserve"
    | "owner_draw"
    | "opex_available";
  toBucket:
    | "tax_reserve"
    | "refund_reserve"
    | "profit_reserve"
    | "owner_draw"
    | "opex_available";
  amountCents: number;
  note?: string;
}

export function useRecoveryTransfer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: RecoveryTransferArgs) => {
      const res = await apiRequest(
        "POST",
        "/api/founder/finance/recovery-transfer",
        args,
        { idempotent: true },
      );
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/founder/finance/buckets"] });
    },
  });
}
