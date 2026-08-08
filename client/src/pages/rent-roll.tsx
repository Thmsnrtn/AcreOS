/**
 * /rent-roll — org-wide rent ledger (BH-3).
 *
 * Imelda §3 portfolio: "Aging buckets are right shape, wrong source. Wire
 * them to rent-roll late-pay data and they're useful."
 *
 * ── Wave D client surface (2026-07-30) ──────────────────────────────────
 * The page used to be aging buckets and a read-only late-fee rule table. Four
 * things an operator cannot run a rental book without are now on it:
 *
 *   1. PAYMENT ALLOCATION, EXPLAINED. `POST /api/leases/:id/payments` credits
 *      the single OLDEST open charge. So a tenant two months behind who pays
 *      both months got one month marked paid and the other still showing a
 *      full balance. This page allocates the payment with the shared rule
 *      (`@shared/rental/paymentAllocation`: oldest charge first, rent before
 *      late fees, remainder held as an explicit credit), shows the operator
 *      the split to the cent BEFORE anything is written, and then records ONE
 *      ledger line per charge so each month's balance is exactly right and the
 *      ledger can answer "why is this month's balance what it is".
 *   2. THE SECURITY-DEPOSIT STATUTORY CLOCK, from
 *      `@shared/regulatory/depositReturnRules`. A jurisdiction with no encoded
 *      deadline renders the registry's own unknown-reason sentence — never a
 *      guessed 30 days. Deposit mishandling is the most common landlord/tenant
 *      claim and the sanction is usually forfeiture of the right to withhold
 *      anything, so an invented date is the worst possible lie here.
 *   3. A LATE-FEE PROPOSAL, NOT A CHARGE (`@shared/rental/lateFeeProposal`).
 *      The statutory cap, grace period and citation are computed and shown;
 *      the operator must confirm the exact proposed figure before anything is
 *      posted. Nothing auto-charges a tenant, ever.
 *   4. Every figure is integer cents formatted by `centsExact` — no
 *      float-rounded money on a surface that is read out in court.
 *
 * MONEY POSTURE (founder ruling #15 — be the rail, not the provider): this is
 * a LEDGER. AcreOS does not collect rent, does not hold deposits, and touches
 * no payment processor here. Every action reads "record what you received" and
 * every refund or fee is moved by the landlord on their own rails. Do not add
 * a tenant payment button to this page.
 */

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Wallet, AlertTriangle, FileText, ShieldAlert, Clock, ScrollText } from "lucide-react";

import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState } from "@/components/empty-state";
import { QueryErrorState } from "@/components/query-error-state";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useOrganization } from "@/hooks/use-organization";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { staggerContainer, staggerItem } from "@/lib/animations";
import { Verbs } from "@/lib/labels";

import {
  allocatePayment,
  splitChargeOutstanding,
  type ChargeAllocation,
  type OpenChargeForAllocation,
} from "@shared/rental/paymentAllocation";
import { parseLateFeeRuleRow, proposeLateFee, type LateFeeProposal } from "@shared/rental/lateFeeProposal";
import {
  computeDepositDeadline,
  depositDeadlineCountdown,
  type DepositDeadlineResult,
} from "@shared/regulatory/depositReturnRules";

// ---------------------------------------------------------------------------
// Wire types
// ---------------------------------------------------------------------------

interface AgingResponse {
  asOf: string;
  totalsByBucket: Record<string, { count: number; totalCents: number }>;
  charges: Array<{
    id: string;
    lease_id: string;
    charged_for_month: string;
    due_date: string;
    amount_cents: number;
    balance_cents: number;
    late_fee_cents: number;
    legal_posture: string;
    days_overdue: number;
  }>;
}

interface LateFeeRuleRow {
  state: string;
  capPctSmallProperty: string | null;
  capPctLargeProperty: string | null;
  capFlatCents: number | null;
  graceDays: number;
  initialFeeCents: number | null;
  perDayCents: number | null;
  citation: string | null;
  summary: string | null;
}

interface Lease {
  id: string;
  propertyId: number;
  unitLabel: string | null;
  status: string;
  startDate: string;
  endDate: string | null;
  monthlyRentCents: number;
  rentDueDayOfMonth: number;
  securityDepositCents: number;
  isSection8: boolean;
  state: string;
}

interface LedgerCharge {
  id: string;
  leaseId: string;
  chargedForMonth: string;
  dueDate: string;
  amountCents: number;
  lateFeeCents: number;
  paidCents: number;
  balanceCents: number;
  legalPosture: string;
  payments: Array<{
    id: string;
    amountCents: number;
    receivedAt: string;
    method: string | null;
    payorType: string;
    isPartial: boolean;
    notes: string | null;
  }>;
}

interface LedgerResponse {
  lease: Lease;
  charges: LedgerCharge[];
  unappliedPayments: Array<{
    id: string;
    amountCents: number;
    receivedAt: string;
    payorType: string;
    notes: string | null;
  }>;
  totals: {
    totalDueCents: number;
    totalPaidCents: number;
    totalBalanceCents: number;
    totalLateFeesCents: number;
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Integer cents → "$1,234.56", formatted from the integer so no cent is ever
 * lost to a float. Every money figure on this page goes through this.
 */
function centsExact(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "—";
  const sign = cents < 0 ? "−" : "";
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100).toLocaleString("en-US");
  return `${sign}$${whole}.${String(abs % 100).padStart(2, "0")}`;
}

function csrfHeaders(): Record<string, string> {
  const csrfToken = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/)?.[1] || "";
  return {
    "Content-Type": "application/json",
    "x-csrf-token": decodeURIComponent(csrfToken),
  };
}

async function apiPost<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers: csrfHeaders(),
    body: JSON.stringify(body),
  });
  const parsed = await res.json().catch(() => null);
  if (!res.ok) {
    const msg =
      (parsed && typeof parsed.message === "string" && parsed.message) ||
      (parsed && typeof parsed.error === "string" && parsed.error) ||
      `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return parsed as T;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function postureTone(p: string): "default" | "secondary" | "outline" | "destructive" {
  if (p === "eviction_filed") return "destructive";
  if (p === "notice_served") return "destructive";
  if (p === "late") return "default";
  return "outline";
}

/** The charge shape the shared allocator needs. */
function toAllocationCharge(c: LedgerCharge): OpenChargeForAllocation {
  return {
    id: c.id,
    chargedForMonth: String(c.chargedForMonth).slice(0, 10),
    dueDate: String(c.dueDate).slice(0, 10),
    amountCents: c.amountCents,
    lateFeeCents: c.lateFeeCents,
    paidCents: c.paidCents,
    balanceCents: c.balanceCents,
  };
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function RentRollPage() {
  useDocumentTitle("Rent roll — AcreOS");
  const [selectedLeaseId, setSelectedLeaseId] = useState<string | null>(null);
  const [feeChargeId, setFeeChargeId] = useState<string | null>(null);

  // Commercial orgs run the SAME rent ledger, but the state statutory late-fee
  // surface is residential-only: a commercial late fee is contractual (set by
  // the lease), not statutory. Showing residential caps + citations as the
  // binding rule for a commercial lease is wrong-domain data presented as real,
  // so the whole late-fee surface (the rules table, the per-charge actions, and
  // the proposal dialog) is hidden for commercial and replaced with an honest
  // note. The backend refuses the residential late-fee endpoints for these orgs
  // too (server/routes-rent-ledger.ts). (Wave 2 pass B.)
  const { data: org } = useOrganization();
  // businessType is stored on onboardingData (same read the sidebar uses), not a
  // top-level org column.
  const isCommercial = (org?.onboardingData as { businessType?: string } | null)?.businessType === "commercial";

  const aging = useQuery<AgingResponse>({
    queryKey: ["/api/rent/aging"],
    queryFn: async () => {
      const res = await fetch("/api/rent/aging", { credentials: "include" });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      return res.json();
    },
  });

  const leasesQuery = useQuery<{ leases: Lease[] }>({
    queryKey: ["/api/leases"],
    queryFn: async () => {
      const res = await fetch("/api/leases", { credentials: "include" });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      return res.json();
    },
  });

  const rules = useQuery<{ rules: LateFeeRuleRow[] }>({
    queryKey: ["/api/late-fee-rules"],
    // Not fetched for commercial orgs — the endpoint refuses them (409), and the
    // residential statute table is not shown to them at all.
    enabled: !isCommercial,
    queryFn: async () => {
      const res = await fetch("/api/late-fee-rules", { credentials: "include" });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      return res.json();
    },
  });

  const leases = leasesQuery.data?.leases ?? [];
  const leaseById = useMemo(() => new Map(leases.map((l) => [l.id, l])), [leases]);
  const ruleByState = useMemo(
    () => new Map((rules.data?.rules ?? []).map((r) => [r.state.toUpperCase(), r])),
    [rules.data],
  );

  const charges = aging.data?.charges ?? [];
  const feeCharge = charges.find((c) => c.id === feeChargeId) ?? null;

  return (
    <PageShell label="Rent roll">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <Wallet className="w-6 h-6 text-primary" aria-hidden="true" />
          Rent roll
        </h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-3xl">
          Aging across every lease, the ledger behind each balance, and the statutory clocks that
          run against you. Late fees are <strong>proposed</strong> from the state rule and charged
          only when you confirm the figure.
        </p>
        <p className="text-xs text-muted-foreground mt-2 max-w-3xl">
          AcreOS does not collect rent and never holds a tenant deposit — you receive money on your
          own rails and record it here. Nothing on this page moves funds.
        </p>
      </div>

      {aging.isLoading ? (
        <div className="space-y-3 mb-6">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-20" />
            ))}
          </div>
          <Skeleton className="h-40" />
        </div>
      ) : aging.isError ? (
        <QueryErrorState
          error={aging.error instanceof Error ? aging.error : null}
          onRetry={() => aging.refetch()}
          isRetrying={aging.isRefetching}
          compact
          title="Couldn't load aging buckets"
          description="We hit a snag loading your rent aging data. Your data is safe — try again."
          testId="rent-roll-query-error"
          className="mb-6"
        />
      ) : aging.data ? (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
            {(["current", "d1_30", "d31_60", "d61_90", "d90_plus"] as const).map((k) => {
              const tot = aging.data!.totalsByBucket[k] ?? { count: 0, totalCents: 0 };
              const labels: Record<string, string> = {
                current: "Current",
                d1_30: "1-30 days",
                d31_60: "31-60 days",
                d61_90: "61-90 days",
                d90_plus: "90+ days",
              };
              const tones: Record<string, string> = {
                current: "",
                d1_30: "text-acr-warning",
                d31_60: "text-acr-warning",
                d61_90: "text-acr-neg",
                d90_plus: "text-acr-neg",
              };
              return (
                <Card key={k} className="p-3">
                  <div className="text-xs text-muted-foreground">{labels[k]}</div>
                  <div className={`text-xl font-semibold tabular-nums ${tones[k]}`}>
                    {centsExact(tot.totalCents)}
                  </div>
                  <div className="text-xs text-muted-foreground">{tot.count} charges</div>
                </Card>
              );
            })}
          </div>

          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-acr-warning" aria-hidden="true" /> Open balances
              </CardTitle>
              <CardDescription>
                Sorted by due date, oldest first. Open a ledger to see how each payment was applied.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {charges.length === 0 ? (
                <div className="p-4">
                  <EmptyState
                    icon={Wallet}
                    headline="No open balances"
                    subtitle="Every recorded charge is paid in full. Open a lease ledger to record a payment you received, or to check a deposit clock."
                    tone="celebratory"
                    framed
                    cta={{
                      label: leases.length > 0 ? "Open a lease ledger" : "Set up a lease",
                      onClick:
                        leases.length > 0
                          ? () => setSelectedLeaseId(leases[0].id)
                          : () => {
                              window.location.assign("/leases");
                            },
                      "data-testid": "rent-roll-empty-cta",
                    }}
                    testId="rent-roll-empty"
                  />
                </div>
              ) : (
                <>
                  {/* Mobile: stacked charge cards — the aging table
                      side-scrolls at phone widths. md+ renders the table below. */}
                  <motion.ul
                    variants={staggerContainer}
                    initial="hidden"
                    animate="visible"
                    className="md:hidden divide-y divide-border/40"
                    data-testid="list-rent-aging-mobile"
                  >
                    {charges.map((c) => (
                      <motion.li
                        key={c.id}
                        variants={staggerItem}
                        className="px-4 py-3"
                        data-testid={`card-rent-charge-${c.id}`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="font-mono text-xs">{c.lease_id.slice(0, 8)}…</div>
                            <div className="text-xs text-muted-foreground mt-0.5">
                              {String(c.charged_for_month).slice(0, 10)} · due{" "}
                              {String(c.due_date).slice(0, 10)}
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            <div className="font-mono font-semibold tabular-nums">
                              {centsExact(c.balance_cents)}
                            </div>
                            {c.late_fee_cents > 0 && (
                              <div className="text-xs text-muted-foreground tabular-nums">
                                +{centsExact(c.late_fee_cents)} late fee
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center justify-between gap-3 mt-2">
                          <Badge variant={postureTone(c.legal_posture)} className="text-xs">
                            {c.legal_posture.replace(/_/g, " ")}
                          </Badge>
                          <span
                            className={`text-xs tabular-nums ${
                              c.days_overdue > 0 ? "text-acr-warning" : "text-muted-foreground"
                            }`}
                          >
                            {c.days_overdue > 0 ? `${c.days_overdue} days late` : "current"}
                          </span>
                        </div>
                        <div className="flex gap-2 mt-2">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs"
                            onClick={() => setSelectedLeaseId(c.lease_id)}
                          >
                            Open ledger
                          </Button>
                          {!isCommercial && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs"
                              onClick={() => setFeeChargeId(c.id)}
                            >
                              Late fee…
                            </Button>
                          )}
                        </div>
                      </motion.li>
                    ))}
                  </motion.ul>

                  {/* Desktop: full table. Hidden on mobile. */}
                  <div className="hidden md:block overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-xs text-muted-foreground border-b border-border bg-muted/30">
                          <th className="px-3 py-2 text-left font-medium">Lease</th>
                          <th className="px-3 py-2 text-left font-medium">Month</th>
                          <th className="px-3 py-2 text-left font-medium">Due</th>
                          <th className="px-3 py-2 text-right font-medium">Days late</th>
                          <th className="px-3 py-2 text-right font-medium">Balance</th>
                          <th className="px-3 py-2 text-right font-medium">Late fee</th>
                          <th className="px-3 py-2 text-left font-medium">Posture</th>
                          <th className="px-3 py-2 text-right font-medium">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {charges.map((c) => (
                          <tr key={c.id} className="border-b border-border/40">
                            <td className="px-3 py-2 font-mono text-xs">{c.lease_id.slice(0, 8)}…</td>
                            <td className="px-3 py-2">{String(c.charged_for_month).slice(0, 10)}</td>
                            <td className="px-3 py-2">{String(c.due_date).slice(0, 10)}</td>
                            <td
                              className={`px-3 py-2 text-right tabular-nums ${
                                c.days_overdue > 0 ? "text-acr-warning" : ""
                              }`}
                            >
                              {c.days_overdue}
                            </td>
                            <td className="px-3 py-2 text-right font-mono tabular-nums">
                              {centsExact(c.balance_cents)}
                            </td>
                            <td className="px-3 py-2 text-right font-mono tabular-nums text-muted-foreground">
                              {c.late_fee_cents > 0 ? centsExact(c.late_fee_cents) : "—"}
                            </td>
                            <td className="px-3 py-2">
                              <Badge variant={postureTone(c.legal_posture)} className="text-xs">
                                {c.legal_posture.replace(/_/g, " ")}
                              </Badge>
                            </td>
                            <td className="px-3 py-2 text-right whitespace-nowrap">
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 text-xs"
                                onClick={() => setSelectedLeaseId(c.lease_id)}
                                data-testid={`button-open-ledger-${c.id}`}
                              >
                                Open ledger
                              </Button>
                              {!isCommercial && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 text-xs"
                                  onClick={() => setFeeChargeId(c.id)}
                                  data-testid={`button-propose-fee-${c.id}`}
                                >
                                  Late fee…
                                </Button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </>
      ) : null}

      {/* Lease ledger — allocation, explained, and the record-payment path. */}
      <LeaseLedgerSection
        leases={leases}
        isLoading={leasesQuery.isLoading}
        selectedLeaseId={selectedLeaseId}
        onSelectLease={setSelectedLeaseId}
      />

      {/* Security-deposit statutory clock. */}
      <DepositClockSection leases={leases} isLoading={leasesQuery.isLoading} />

      {/* Late-fee rule reference — residential ONLY. Commercial late fees are
          contractual (set by the lease), not statutory, so the residential
          statute table is replaced with an honest note rather than shown as if
          it bound a commercial lease. */}
      {isCommercial ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <FileText className="w-4 h-4" aria-hidden="true" /> Late fees
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground max-w-3xl" data-testid="commercial-late-fee-note">
              Commercial late fees are set by the lease, not by state statute — the residential
              statutory late-fee rules do not apply to a commercial tenancy. Enter a late fee as a
              manual charge at the figure your lease specifies. AcreOS will not propose one from a
              residential statute here.
            </p>
          </CardContent>
        </Card>
      ) : (
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <FileText className="w-4 h-4" aria-hidden="true" /> State late-fee rules
          </CardTitle>
          <CardDescription>
            The rules AcreOS proposes fees from. Preliminary — not attorney-reviewed. Confirm the cap
            and grace period with counsel for the jurisdiction before charging a tenant.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {rules.isLoading ? (
            <Skeleton className="h-20 m-4" />
          ) : rules.isError ? (
            <div className="p-4">
              <QueryErrorState
                error={rules.error instanceof Error ? rules.error : null}
                onRetry={() => rules.refetch()}
                isRetrying={rules.isRefetching}
                compact
                title="Couldn't load the late-fee rules"
                description="Without the rule table AcreOS proposes no fee at all — it will not guess a cap."
                testId="late-fee-rules-query-error"
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-muted-foreground border-b border-border bg-muted/30">
                    <th className="px-3 py-2 text-left font-medium">State</th>
                    <th className="px-3 py-2 text-right font-medium">Cap (small)</th>
                    <th className="px-3 py-2 text-right font-medium">Cap (4+ unit)</th>
                    <th className="px-3 py-2 text-right font-medium">Flat cap</th>
                    <th className="px-3 py-2 text-right font-medium">Grace</th>
                    <th className="px-3 py-2 text-left font-medium">Citation</th>
                  </tr>
                </thead>
                <tbody>
                  {(rules.data?.rules ?? []).map((r) => (
                    <tr key={r.state} className="border-b border-border/40">
                      <td className="px-3 py-2 font-medium">{r.state}</td>
                      <td className="px-3 py-2 text-right">
                        {r.capPctSmallProperty
                          ? `${(parseFloat(r.capPctSmallProperty) * 100).toFixed(0)}%`
                          : "Not encoded"}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {r.capPctLargeProperty
                          ? `${(parseFloat(r.capPctLargeProperty) * 100).toFixed(0)}%`
                          : "Not encoded"}
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums">
                        {r.capFlatCents === null ? "—" : centsExact(r.capFlatCents)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.graceDays}d</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{r.citation ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
      )}

      {/* Residential-only. Never mounted for a commercial org: its late-fee
          actions are hidden and feeChargeId can never be set there. */}
      {!isCommercial && feeCharge && (
        <LateFeeProposalDialog
          open={feeChargeId !== null}
          onOpenChange={(v) => setFeeChargeId(v ? feeChargeId : null)}
          charge={feeCharge}
          lease={leaseById.get(feeCharge.lease_id) ?? null}
          rule={
            leaseById.get(feeCharge.lease_id)
              ? ruleByState.get(leaseById.get(feeCharge.lease_id)!.state.toUpperCase()) ?? null
              : null
          }
        />
      )}
    </PageShell>
  );
}

// ---------------------------------------------------------------------------
// Lease ledger — the allocation surface
// ---------------------------------------------------------------------------

function LeaseLedgerSection({
  leases,
  isLoading,
  selectedLeaseId,
  onSelectLease,
}: {
  leases: Lease[];
  isLoading: boolean;
  selectedLeaseId: string | null;
  onSelectLease: (id: string | null) => void;
}) {
  const ledger = useQuery<LedgerResponse>({
    queryKey: ["/api/leases", selectedLeaseId, "ledger"],
    enabled: selectedLeaseId !== null,
    queryFn: async () => {
      const res = await fetch(`/api/leases/${selectedLeaseId}/ledger`, { credentials: "include" });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      return res.json();
    },
  });

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <ScrollText className="w-4 h-4 text-primary" aria-hidden="true" /> Lease ledger
        </CardTitle>
        <CardDescription>
          Charges, payments, and exactly how each payment was applied — oldest charge first, rent
          before late fees.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1 max-w-md">
          <Label htmlFor="ledger-lease" className="text-xs">
            Lease
          </Label>
          {isLoading ? (
            <Skeleton className="h-9" />
          ) : (
            <Select
              value={selectedLeaseId ?? "none"}
              onValueChange={(v) => onSelectLease(v === "none" ? null : v)}
            >
              <SelectTrigger id="ledger-lease" className="h-9" data-testid="select-ledger-lease">
                <SelectValue placeholder="Choose a lease" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No lease selected</SelectItem>
                {leases.map((l) => (
                  <SelectItem key={l.id} value={l.id}>
                    {l.id.slice(0, 8)}… · {l.state} · {centsExact(l.monthlyRentCents)}/mo ·{" "}
                    {l.status}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        {selectedLeaseId === null ? (
          <p className="text-sm text-muted-foreground">
            Pick a lease to see its ledger and record a payment you received.
          </p>
        ) : ledger.isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-24" />
            <Skeleton className="h-32" />
          </div>
        ) : ledger.isError ? (
          <QueryErrorState
            error={ledger.error instanceof Error ? ledger.error : null}
            onRetry={() => ledger.refetch()}
            isRetrying={ledger.isRefetching}
            compact
            title="Couldn't load this ledger"
            description="Nothing has changed on the ledger — try again."
            testId="ledger-query-error"
          />
        ) : ledger.data ? (
          <LedgerBody ledger={ledger.data} />
        ) : null}
      </CardContent>
    </Card>
  );
}

function LedgerBody({ ledger }: { ledger: LedgerResponse }) {
  const charges = ledger.charges;
  const openCharges = charges.filter((c) => c.balanceCents > 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="p-3">
          <div className="text-xs text-muted-foreground">Charged</div>
          <div className="font-mono tabular-nums">{centsExact(ledger.totals.totalDueCents)}</div>
        </Card>
        <Card className="p-3">
          <div className="text-xs text-muted-foreground">Received</div>
          <div className="font-mono tabular-nums">{centsExact(ledger.totals.totalPaidCents)}</div>
        </Card>
        <Card className="p-3">
          <div className="text-xs text-muted-foreground">Outstanding</div>
          <div className="font-mono tabular-nums font-semibold">
            {centsExact(ledger.totals.totalBalanceCents)}
          </div>
        </Card>
        <Card className="p-3">
          <div className="text-xs text-muted-foreground">Late fees charged</div>
          <div className="font-mono tabular-nums">{centsExact(ledger.totals.totalLateFeesCents)}</div>
        </Card>
      </div>

      {/* Per-charge detail: the rent/fee split is DERIVED from paidCents under
          the same rent-first rule the allocator uses, so the two can never
          disagree about what a balance is made of. */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-muted-foreground border-b border-border bg-muted/30">
              <th className="px-3 py-2 text-left font-medium">Month</th>
              <th className="px-3 py-2 text-left font-medium">Due</th>
              <th className="px-3 py-2 text-right font-medium">Rent</th>
              <th className="px-3 py-2 text-right font-medium">Late fees</th>
              <th className="px-3 py-2 text-right font-medium">Received</th>
              <th className="px-3 py-2 text-right font-medium">Rent left</th>
              <th className="px-3 py-2 text-right font-medium">Fees left</th>
              <th className="px-3 py-2 text-right font-medium">Balance</th>
            </tr>
          </thead>
          <tbody>
            {charges.map((c) => {
              const split = splitChargeOutstanding(toAllocationCharge(c));
              return (
                <tr
                  key={c.id}
                  className="border-b border-border/40"
                  data-testid={`ledger-charge-${c.id}`}
                >
                  <td className="px-3 py-2">{String(c.chargedForMonth).slice(0, 7)}</td>
                  <td className="px-3 py-2">{String(c.dueDate).slice(0, 10)}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">
                    {centsExact(c.amountCents)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">
                    {c.lateFeeCents > 0 ? centsExact(c.lateFeeCents) : "—"}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">
                    {centsExact(c.paidCents)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">
                    {centsExact(split.rentOutstandingCents)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">
                    {centsExact(split.lateFeeOutstandingCents)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums font-semibold">
                    {centsExact(c.balanceCents)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Recorded payments, per charge — the persisted allocation lines. */}
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
          Payments received
        </h3>
        {charges.every((c) => c.payments.length === 0) && ledger.unappliedPayments.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No payments recorded on this lease yet.
          </p>
        ) : (
          <motion.ul
            variants={staggerContainer}
            initial="hidden"
            animate="visible"
            className="space-y-1.5"
            data-testid="list-ledger-payments"
          >
            {charges.flatMap((c) =>
              c.payments.map((p) => (
                <motion.li
                  key={p.id}
                  variants={staggerItem}
                  className="text-xs flex items-start justify-between gap-3 border-b border-border/40 pb-1.5"
                  data-testid={`payment-line-${p.id}`}
                >
                  <span className="text-muted-foreground">
                    {String(p.receivedAt).slice(0, 10)} ·{" "}
                    <span className="text-foreground font-mono">{centsExact(p.amountCents)}</span>{" "}
                    applied to {String(c.chargedForMonth).slice(0, 7)}
                    {p.payorType === "hap" ? " (housing authority)" : ""}
                    {p.isPartial ? " · partial" : ""}
                  </span>
                  <span className="text-muted-foreground shrink-0">
                    {String(c.chargedForMonth).slice(0, 7)} balance now{" "}
                    <span className="font-mono">{centsExact(c.balanceCents)}</span>
                  </span>
                </motion.li>
              )),
            )}
            {ledger.unappliedPayments.map((p) => (
              <motion.li
                key={p.id}
                variants={staggerItem}
                className="text-xs text-acr-warning border-b border-border/40 pb-1.5"
                data-testid={`payment-unapplied-${p.id}`}
              >
                {String(p.receivedAt).slice(0, 10)} ·{" "}
                <span className="font-mono">{centsExact(p.amountCents)}</span> received with no open
                charge to apply it to — held as an unapplied credit.
              </motion.li>
            ))}
          </motion.ul>
        )}
      </div>

      <Separator />

      <RecordPaymentForm
        leaseId={ledger.lease.id}
        openCharges={openCharges}
        monthlyRentCents={ledger.lease.monthlyRentCents}
      />
    </div>
  );
}

/**
 * Record a payment the landlord ALREADY received, allocated across every open
 * charge before anything is written.
 *
 * Why one POST per allocation line: `POST /api/leases/:id/payments` applies a
 * payment to the single oldest open charge. Posting the allocated amount for
 * each charge in oldest-first order lands exactly the split shown below, so
 * every month's balance is right and each ledger line explains itself. A
 * single lump POST would credit month one and leave month two showing a full
 * balance while the totals said the money arrived.
 */
function RecordPaymentForm({
  leaseId,
  openCharges,
  monthlyRentCents,
}: {
  leaseId: string;
  openCharges: LedgerCharge[];
  monthlyRentCents: number;
}) {
  const { toast } = useToast();
  const [amount, setAmount] = useState("");
  const [receivedAt, setReceivedAt] = useState(todayIso());
  const [method, setMethod] = useState("");
  const [payorType, setPayorType] = useState<"tenant" | "hap">("tenant");
  const [acceptPartial, setAcceptPartial] = useState(false);
  const [postedLines, setPostedLines] = useState<number | null>(null);

  const amountCents = useMemo(() => {
    const t = amount.trim();
    if (t === "") return null;
    if (!/^\d+(\.\d{0,2})?$/.test(t.replace(/[$,\s]/g, ""))) return null;
    const [whole, frac = ""] = t.replace(/[$,\s]/g, "").split(".");
    const cents = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
    return Number.isSafeInteger(cents) ? cents : null;
  }, [amount]);

  const allocation = useMemo(() => {
    if (amountCents === null || amountCents <= 0) return null;
    return allocatePayment(amountCents, openCharges.map(toAllocationCharge));
  }, [amountCents, openCharges]);

  const chargeById = useMemo(() => new Map(openCharges.map((c) => [c.id, c])), [openCharges]);

  /** Any line that leaves its charge short, on a charge under notice. */
  const partialUnderNotice = (allocation?.allocations ?? []).some(
    (a) =>
      a.balanceAfterCents > 0 && chargeById.get(a.chargeId)?.legalPosture === "notice_served",
  );

  const record = useMutation({
    mutationFn: async () => {
      if (allocation === null || amountCents === null) {
        throw new Error("Enter the amount received, in dollars and cents.");
      }
      if (partialUnderNotice && !acceptPartial) {
        throw new Error(
          "This payment leaves a charge under a notice to vacate short. Confirm you accept a partial payment first — in several states accepting it voids the notice.",
        );
      }
      const total = allocation.allocations.length + (allocation.unappliedCents > 0 ? 1 : 0);
      let done = 0;
      for (const line of allocation.allocations) {
        await apiPost(`/api/leases/${leaseId}/payments`, {
          amountCents: line.appliedCents,
          receivedAt,
          method: method.trim() || undefined,
          payorType,
          acceptedDespitePartial: acceptPartial,
          notes: allocationNote(line, allocation.allocations.length, amountCents),
        });
        done += 1;
      }
      if (allocation.unappliedCents > 0) {
        await apiPost(`/api/leases/${leaseId}/payments`, {
          amountCents: allocation.unappliedCents,
          receivedAt,
          method: method.trim() || undefined,
          payorType,
          acceptedDespitePartial: acceptPartial,
          notes: `Unapplied credit: no open charge left to apply this to (part of ${centsExact(amountCents)} received ${receivedAt}).`,
        });
        done += 1;
      }
      return { done, total };
    },
    onSuccess: (res) => {
      setPostedLines(res.done);
      setAmount("");
      setAcceptPartial(false);
      queryClient.invalidateQueries({ queryKey: ["/api/leases", leaseId, "ledger"] });
      queryClient.invalidateQueries({ queryKey: ["/api/rent/aging"] });
      toast({
        title: `Payment recorded across ${res.done} ledger line${res.done === 1 ? "" : "s"}`,
      });
    },
    onError: (err: any) => {
      // A mid-sequence failure leaves earlier lines posted. Refresh so the
      // ledger shows exactly what landed rather than what we intended.
      queryClient.invalidateQueries({ queryKey: ["/api/leases", leaseId, "ledger"] });
      queryClient.invalidateQueries({ queryKey: ["/api/rent/aging"] });
      toast({
        title: "Couldn't record the whole payment",
        description: `${err.message} The ledger above now shows exactly which lines were recorded.`,
        variant: "destructive",
      });
    },
  });

  return (
    <div className="space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Record a payment you received
      </h3>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="space-y-1">
          <Label htmlFor="pay-amount" className="text-xs">
            Amount received ($)
          </Label>
          <Input
            id="pay-amount"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder={(monthlyRentCents / 100).toFixed(2)}
            className="h-8"
            data-testid="input-payment-amount"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="pay-date" className="text-xs">
            Received on
          </Label>
          <Input
            id="pay-date"
            type="date"
            value={receivedAt}
            onChange={(e) => setReceivedAt(e.target.value)}
            className="h-8"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="pay-method" className="text-xs">
            Method (optional)
          </Label>
          <Input
            id="pay-method"
            value={method}
            onChange={(e) => setMethod(e.target.value)}
            placeholder="check, ACH, cash"
            className="h-8"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="pay-payor" className="text-xs">
            Paid by
          </Label>
          <Select value={payorType} onValueChange={(v) => setPayorType(v as "tenant" | "hap")}>
            <SelectTrigger id="pay-payor" className="h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="tenant">Tenant</SelectItem>
              <SelectItem value="hap">Housing authority (HAP)</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {amount.trim() !== "" && amountCents === null && (
        <p className="text-xs text-acr-neg" role="alert">
          Enter the amount as dollars and cents, e.g. 1400 or 1400.50. AcreOS will not round a
          payment.
        </p>
      )}

      {allocation && (
        <div
          className="rounded-md border border-border p-3 space-y-2"
          data-testid="allocation-preview"
        >
          <h4 className="text-xs font-semibold">
            How {centsExact(amountCents)} will be applied
          </h4>
          {allocation.allocations.length === 0 ? (
            <p className="text-xs text-acr-warning">
              There is no open charge to apply this to. It will be recorded as an unapplied credit of{" "}
              {centsExact(allocation.unappliedCents)}.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-muted-foreground border-b border-border">
                    <th className="px-2 py-1 text-left font-medium">#</th>
                    <th className="px-2 py-1 text-left font-medium">Month</th>
                    <th className="px-2 py-1 text-right font-medium">To rent</th>
                    <th className="px-2 py-1 text-right font-medium">To late fees</th>
                    <th className="px-2 py-1 text-right font-medium">Applied</th>
                    <th className="px-2 py-1 text-right font-medium">Balance before</th>
                    <th className="px-2 py-1 text-right font-medium">Balance after</th>
                  </tr>
                </thead>
                <tbody>
                  {allocation.allocations.map((a) => (
                    <tr
                      key={a.chargeId}
                      className="border-b border-border/40"
                      data-testid={`allocation-line-${a.sequence}`}
                    >
                      <td className="px-2 py-1 tabular-nums">{a.sequence}</td>
                      <td className="px-2 py-1">{a.chargedForMonth.slice(0, 7)}</td>
                      <td className="px-2 py-1 text-right font-mono tabular-nums">
                        {centsExact(a.appliedToRentCents)}
                      </td>
                      <td className="px-2 py-1 text-right font-mono tabular-nums">
                        {a.appliedToLateFeeCents > 0 ? centsExact(a.appliedToLateFeeCents) : "—"}
                      </td>
                      <td className="px-2 py-1 text-right font-mono tabular-nums font-semibold">
                        {centsExact(a.appliedCents)}
                      </td>
                      <td className="px-2 py-1 text-right font-mono tabular-nums text-muted-foreground">
                        {centsExact(a.balanceBeforeCents)}
                      </td>
                      <td className="px-2 py-1 text-right font-mono tabular-nums">
                        {centsExact(a.balanceAfterCents)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-xs text-muted-foreground" data-testid="allocation-explanation">
            {allocation.explanation}
          </p>
          <p className="text-micro text-muted-foreground">
            Recorded as one ledger line per charge (oldest first, rent before late fees) so each
            month's balance is exact. Rule: {allocation.orderRule.replace(/_/g, " ")}.
          </p>
        </div>
      )}

      {partialUnderNotice && (
        <label className="flex items-start gap-2 text-xs cursor-pointer">
          <Checkbox
            checked={acceptPartial}
            onCheckedChange={(v) => setAcceptPartial(v === true)}
            aria-label="Accept a partial payment on a charge under notice to vacate"
            data-testid="checkbox-accept-partial"
          />
          <span className="text-acr-warning">
            This leaves a charge under a notice to vacate short. In several states (Texas among
            them) accepting partial rent after serving notice can VOID the notice and force you to
            start over. Confirm you are accepting it anyway.
          </span>
        </label>
      )}

      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          Records money you already received. AcreOS does not collect it.
        </p>
        <Button
          size="sm"
          onClick={() => record.mutate()}
          disabled={record.isPending || allocation === null}
          data-testid="button-record-payment"
        >
          {record.isPending ? "Recording…" : "Record payment"}
        </Button>
      </div>
      {postedLines !== null && !record.isPending && (
        <p className="text-xs text-acr-pos" role="status">
          Recorded {postedLines} ledger line{postedLines === 1 ? "" : "s"}.
        </p>
      )}
    </div>
  );
}

function allocationNote(line: ChargeAllocation, lineCount: number, paymentCents: number): string {
  const feeBit =
    line.appliedToLateFeeCents > 0 ? ` + ${centsExact(line.appliedToLateFeeCents)} late fee` : "";
  return (
    `Allocation ${line.sequence} of ${lineCount} from a ${centsExact(paymentCents)} payment: ` +
    `${centsExact(line.appliedToRentCents)} rent${feeBit} against ${line.chargedForMonth.slice(0, 7)}, ` +
    `leaving ${centsExact(line.balanceAfterCents)}. Oldest charge first, rent before late fees.`
  );
}

// ---------------------------------------------------------------------------
// Security-deposit statutory clock
// ---------------------------------------------------------------------------

/**
 * The deposit clock, for leases that have ended.
 *
 * `security_deposits.statutoryDeadline` has never been populated by any route,
 * so the deadline is computed here from the registry
 * (`@shared/regulatory/depositReturnRules`) with the lease's own end date as
 * the move-out trigger, and the basis is stated on screen. Two things are
 * deliberate:
 *
 *   - A jurisdiction with no encoded deadline renders the registry's
 *     unknown-reason sentence verbatim. There is no 30-day fallback.
 *   - Where a statute runs a different window depending on whether anything is
 *     withheld (FL, MT, IL), AcreOS does not know yet whether this operator is
 *     withholding, so the EARLIER of the two branches is shown as binding.
 *     Being early is never the violation.
 */
function DepositClockSection({ leases, isLoading }: { leases: Lease[]; isLoading: boolean }) {
  const ended = useMemo(
    () =>
      leases
        .filter((l) => l.status === "ended" || l.status === "terminated")
        .sort((a, b) => String(b.endDate ?? "").localeCompare(String(a.endDate ?? ""))),
    [leases],
  );

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Clock className="w-4 h-4 text-primary" aria-hidden="true" /> Security-deposit clock
        </CardTitle>
        <CardDescription>
          Ended leases and the statutory window to deliver the itemized statement. Preliminary — not
          attorney-reviewed. AcreOS never holds a deposit; you refund it on your own rails.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-24" />
        ) : ended.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No ended or terminated leases. The clock starts at move-out, so nothing is running.
          </p>
        ) : (
          <motion.ul
            variants={staggerContainer}
            initial="hidden"
            animate="visible"
            className="space-y-3"
            data-testid="list-deposit-clocks"
          >
            {ended.map((l) => (
              <motion.li key={l.id} variants={staggerItem}>
                <DepositClockRow lease={l} />
              </motion.li>
            ))}
          </motion.ul>
        )}
      </CardContent>
    </Card>
  );
}

function DepositClockRow({ lease }: { lease: Lease }) {
  const moveOutDate = lease.endDate ? String(lease.endDate).slice(0, 10) : null;

  // Both statutory branches. We do not know whether this operator is
  // withholding anything (no deposit-disposition read exists yet), so where
  // the branches differ the EARLIER date binds.
  const withDeductions = computeDepositDeadline({
    moveOutDate,
    state: lease.state,
    hasDeductions: true,
  });
  const withoutDeductions = computeDepositDeadline({
    moveOutDate,
    state: lease.state,
    hasDeductions: false,
  });

  const binding: DepositDeadlineResult =
    withDeductions.known && withoutDeductions.known
      ? (withDeductions.deadlineDate ?? "") <= (withoutDeductions.deadlineDate ?? "")
        ? withDeductions
        : withoutDeductions
      : withDeductions;

  const branchesDiffer =
    withDeductions.known &&
    withoutDeductions.known &&
    withDeductions.deadlineDate !== withoutDeductions.deadlineDate;

  const countdown = depositDeadlineCountdown(binding.deadlineDate);

  return (
    <div
      className="rounded-md border border-border p-3 space-y-2"
      data-testid={`deposit-clock-${lease.id}`}
    >
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="text-xs">
          <div className="font-mono">{lease.id.slice(0, 8)}…</div>
          <div className="text-muted-foreground mt-0.5">
            {lease.state}
            {lease.unitLabel ? ` · unit ${lease.unitLabel}` : ""} · {lease.status} · deposit held{" "}
            <span className="font-mono">{centsExact(lease.securityDepositCents)}</span>
          </div>
        </div>
        <div className="text-right">
          {binding.known ? (
            <>
              <div
                className={`text-sm font-semibold tabular-nums ${
                  countdown.overdue
                    ? "text-acr-neg"
                    : countdown.urgent
                      ? "text-acr-warning"
                      : "text-foreground"
                }`}
                data-testid={`deposit-deadline-${lease.id}`}
              >
                {binding.deadlineDate}
              </div>
              <div className="text-xs text-muted-foreground">
                {countdown.daysRemaining === null
                  ? ""
                  : countdown.overdue
                    ? `${Math.abs(countdown.daysRemaining)} days OVERDUE`
                    : `${countdown.daysRemaining} days left`}
              </div>
            </>
          ) : (
            <div className="text-sm font-semibold text-acr-warning" data-testid={`deposit-unknown-${lease.id}`}>
              Unknown
            </div>
          )}
        </div>
      </div>

      {binding.known ? (
        <div className="text-xs text-muted-foreground space-y-1">
          <p>
            <span className="text-foreground font-medium">Basis: </span>
            move-out {moveOutDate} + {binding.deadlineDays}{" "}
            {binding.businessDays ? "business" : "calendar"} days
            {binding.citation ? ` (${binding.citation})` : ""}. Move-out is taken from the lease's
            recorded end date — if you handed over possession on a different day, that date governs.
            <strong className="text-acr-warning"> Preliminary, not attorney-reviewed.</strong>
          </p>
          {branchesDiffer && (
            <p>
              {lease.state} runs a different window depending on whether you withhold anything (
              {withDeductions.deadlineDays}d with deductions ·{" "}
              {withoutDeductions.deadlineDays}d without). AcreOS does not know which applies here, so
              the <strong>earlier</strong> date is shown — being early is never the violation.
            </p>
          )}
          {binding.itemizedStatementRequired && (
            <p className="flex items-start gap-1.5">
              <ShieldAlert className="w-3.5 h-3.5 text-acr-warning shrink-0 mt-0.5" aria-hidden="true" />
              <span>
                A <strong>written, itemized statement</strong> of every deduction must reach the
                tenant by this date, with any refund. Missing it typically forfeits the right to
                withhold anything and adds statutory damages.
              </span>
            </p>
          )}
          {binding.note && <p className="italic">{binding.note}</p>}
          <p>
            Disposition letter: prepare and send it yourself for now — AcreOS does not generate this
            letter yet, and will not imply one was sent. Itemize each deduction with a description
            and an amount; a line with no description is what the itemization requirement exists to
            prevent.
          </p>
        </div>
      ) : (
        <p className="text-xs text-acr-warning" data-testid={`deposit-unknown-reason-${lease.id}`}>
          {binding.unknownReason}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Late-fee proposal
// ---------------------------------------------------------------------------

/**
 * Propose a late fee; charge nothing without an explicit confirmation of the
 * exact figure. `confirmedCents` must equal the proposed figure, so an operator
 * can never confirm an amount they were not shown.
 */
function LateFeeProposalDialog({
  open,
  onOpenChange,
  charge,
  lease,
  rule,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  charge: AgingResponse["charges"][number];
  lease: Lease | null;
  rule: LateFeeRuleRow | null;
}) {
  const { toast } = useToast();
  const [confirmed, setConfirmed] = useState(false);
  const [applied, setApplied] = useState<{ feeCents: number; explanation: string } | null>(null);

  const proposal: LateFeeProposal | null = useMemo(() => {
    if (!lease) return null;
    return proposeLateFee({
      rule: rule ? parseLateFeeRuleRow(rule) : null,
      monthlyRentCents: lease.monthlyRentCents,
      daysLate: charge.days_overdue,
      // A FLOOR on the property's unit count. The client holds no unit count,
      // so the floor is 1: the proposal then computes BOTH statutory branches
      // and takes the lower fee, which cannot overcharge under either reality.
      knownUnitCountFloor: 1,
      state: lease.state,
    });
  }, [lease, rule, charge.days_overdue]);

  const apply = useMutation({
    mutationFn: async () => {
      if (!proposal || proposal.status !== "proposed" || proposal.proposedFeeCents <= 0) {
        throw new Error("There is no chargeable fee to confirm.");
      }
      if (!confirmed) {
        throw new Error(`Confirm the ${centsExact(proposal.proposedFeeCents)} fee first.`);
      }
      return apiPost<{ feeCents: number; explanation: string; daysLate: number }>(
        `/api/rent-charges/${charge.id}/apply-late-fee`,
        {},
      );
    },
    onSuccess: (res) => {
      setApplied({ feeCents: res.feeCents, explanation: res.explanation });
      queryClient.invalidateQueries({ queryKey: ["/api/rent/aging"] });
      queryClient.invalidateQueries({ queryKey: ["/api/leases", charge.lease_id, "ledger"] });
      toast({ title: `Late fee of ${centsExact(res.feeCents)} charged to the ledger` });
    },
    onError: (err: any) =>
      toast({ title: "Couldn't charge the fee", description: err.message, variant: "destructive" }),
  });

  const mismatch =
    applied !== null && proposal !== null && applied.feeCents !== proposal.proposedFeeCents;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Late fee — proposal</DialogTitle>
          <DialogDescription>
            {String(charge.charged_for_month).slice(0, 7)} · due{" "}
            {String(charge.due_date).slice(0, 10)} · {charge.days_overdue} days late. A proposal is
            not a charge; nothing is posted until you confirm the exact figure.
          </DialogDescription>
        </DialogHeader>

        {!lease ? (
          <p className="text-sm text-acr-warning">
            AcreOS cannot propose a fee for this charge: its lease is not loaded, so the monthly rent
            and the jurisdiction are unknown. It will not guess either.
          </p>
        ) : applied ? (
          <div className="space-y-2" data-testid="late-fee-applied">
            <p className="text-sm font-semibold">
              {centsExact(applied.feeCents)} charged to the {String(charge.charged_for_month).slice(0, 7)}{" "}
              charge.
            </p>
            <p className="text-xs text-muted-foreground">{applied.explanation}</p>
            {mismatch && (
              <p className="text-xs text-acr-warning">
                Note: the ledger recorded {centsExact(applied.feeCents)}, not the{" "}
                {centsExact(proposal!.proposedFeeCents)} proposed here. The ledger figure is the one
                that was charged — check the rule and the property's unit count before you invoice
                the tenant.
              </p>
            )}
            <DialogFooter>
              <Button size="sm" onClick={() => onOpenChange(false)}>
                Done
              </Button>
            </DialogFooter>
          </div>
        ) : proposal === null ? (
          <Skeleton className="h-20" />
        ) : (
          <div className="space-y-3">
            <div className="rounded-md border border-border p-3 space-y-1">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-xs text-muted-foreground">Proposed fee</span>
                <span
                  className="text-xl font-semibold font-mono tabular-nums"
                  data-testid="text-proposed-fee"
                >
                  {centsExact(proposal.proposedFeeCents)}
                </span>
              </div>
              <div className="text-xs text-muted-foreground">
                Status: {proposal.status.replace(/_/g, " ")} · {lease.state} ·{" "}
                {proposal.graceDays === null
                  ? "grace period not encoded"
                  : `${proposal.graceDays}-day grace`}
                {proposal.capCents !== null && <> · statutory cap {centsExact(proposal.capCents)}</>}
              </div>
            </div>

            <p className="text-xs text-muted-foreground" data-testid="text-fee-explanation">
              {proposal.explanation}
            </p>
            {proposal.citation && (
              <p className="text-xs text-muted-foreground">Rule: {proposal.citation}</p>
            )}
            <p className="text-xs text-acr-warning">
              Preliminary — not attorney-reviewed. Confirm the cap and grace period for{" "}
              {lease.state} before charging a tenant.
            </p>

            {proposal.status === "proposed" && proposal.proposedFeeCents > 0 ? (
              <>
                <label className="flex items-start gap-2 text-xs cursor-pointer">
                  <Checkbox
                    checked={confirmed}
                    onCheckedChange={(v) => setConfirmed(v === true)}
                    aria-label={`Confirm charging ${centsExact(proposal.proposedFeeCents)} to this tenant's ledger`}
                    data-testid="checkbox-confirm-fee"
                  />
                  <span>
                    I confirm charging <strong>{centsExact(proposal.proposedFeeCents)}</strong> to
                    this tenant's ledger.
                  </span>
                </label>
                <DialogFooter>
                  <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
                    {Verbs.CANCEL}
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => apply.mutate()}
                    disabled={!confirmed || apply.isPending}
                    data-testid="button-charge-fee"
                  >
                    {apply.isPending
                      ? "Charging…"
                      : `Charge ${centsExact(proposal.proposedFeeCents)}`}
                  </Button>
                </DialogFooter>
              </>
            ) : (
              <DialogFooter>
                <Button size="sm" variant="outline" onClick={() => onOpenChange(false)}>
                  Close — no fee proposed
                </Button>
              </DialogFooter>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
