/**
 * /notes/:id — Acquired note detail surface (Phase 5 §5).
 *
 * Renders payer, balance, acquisition price + date, interest, term, status,
 * original lender, and computed amortization snapshot. Surfaces the
 * acquisition-vs-face-value distinction explicitly — that's the IRS basis
 * line per the Linnea persona walkthrough.
 *
 * Payment ledger + amortization-schedule rendering use the existing
 * /api/notes/:id/payments and /api/notes/:id/amortization endpoints.
 * Loss-mit case files, BPO order, and Pax default-risk score ride
 * follow-up PRs (see docs/archive/exhaustive-completion/note-investor-followups.md).
 */

import { useState } from "react";
import { useRoute, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, FileText, AlertCircle, MapPin, Plus, CheckCircle2, ChevronDown, ChevronUp } from "lucide-react";

import { PageShell } from "@/components/page-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { StatusBadge, type StatusKind } from "@/components/StatusBadge";
import { EmptyState } from "@/components/empty-state";
import { QueryErrorState } from "@/components/query-error-state";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useOrganization } from "@/hooks/use-organization";
import { getTerm, personaForInvestorType } from "@/lib/personaVocabulary";
import { NoteRecordPaymentModal } from "@/components/note-record-payment-modal";
import { NotePayoffCalculator } from "@/components/note-payoff-calculator";
import { NoteYieldPanel } from "@/components/note-yield-panel";
import { NoteBasisSchedule } from "@/components/note-basis-schedule";
import { NoteTinEditor } from "@/components/note-tin-editor";
import { NoteAssignmentsCard } from "@/components/note-assignments-card";
import { NoteSplitsCard } from "@/components/note-splits-card";
import { NoteComplianceCard } from "@/components/note-compliance-card";
import { NoteLossMitCard } from "@/components/note-loss-mit-card";
import { formatDate, formatDateTime } from "@/lib/format";

export interface AcquiredNote {
  id: string;
  organizationId: number;
  propertyId: number | null;
  borrowerId: number | null;
  noteNumber: string;
  originalPrincipalCents: number;
  currentBalanceCents: number;
  unappliedBalanceCents: number;
  interestRateBps: number;
  termMonths: number;
  paymentAmountCents: number;
  paymentDueDay: number;
  originationDate: string;
  maturityDate: string;
  acquisitionDate: string;
  acquisitionPriceCents: number;
  status: "performing" | "late" | "default" | "paid_off" | "sold";
  payerName: string;
  payerAddress?: { line1?: string; city?: string; state?: string; zip?: string } | null;
  payerTinType: string | null;
  originalLender: string | null;
  assignmentDocS3Key: string | null;
  // Compliance (PR-11)
  insuranceStatus: "verified" | "expiring_soon" | "lapsed" | "force_placed";
  insuranceCarrier: string | null;
  insurancePolicyNumber: string | null;
  insuranceExpiresAt: string | null;
  insuranceAnnualPremiumCents: number | null;
  taxEscrowEnabled: boolean;
  taxEscrowBalanceCents: number;
  taxDisbursementDueDate: string | null;
  taxDisbursementAmountCents: number | null;
  taxAuthorityName: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

interface NoteDetailResponse {
  note: AcquiredNote;
}

export type NotePaymentType =
  | "regular"
  | "partial"
  | "extra_principal"
  | "payoff"
  | "nsf_reversal"
  | "unapplied_apply";

export interface NotePayment {
  id: string;
  noteId: string;
  paymentDate: string;
  principalCents: number;
  interestCents: number;
  escrowCents: number;
  lateFeeCents: number;
  unappliedCents: number;
  paymentType: NotePaymentType;
  originalPaymentId: string | null;
  paymentMethod: "ach" | "check" | "wire" | "cash" | "other";
  referenceNumber: string | null;
  notes: string | null;
  createdAt: string;
}

interface PaymentsResponse {
  payments: NotePayment[];
}

function fmtUsd(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

function fmtUsdRound(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(Math.round(cents / 100));
}

function fmtPct(bps: number): string {
  return `${(bps / 100).toFixed(3)}%`;
}

function statusKindFor(status: AcquiredNote["status"]): StatusKind {
  switch (status) {
    case "performing": return "active";
    case "late": return "warning";
    case "default": return "error";
    case "paid_off": return "success";
    case "sold": return "inactive";
    default: return "pending";
  }
}

function statusLabelFor(status: AcquiredNote["status"]): string {
  switch (status) {
    case "performing": return "Performing";
    case "late": return "Late";
    case "default": return "Default";
    case "paid_off": return "Paid off";
    case "sold": return "Sold";
    default: return status;
  }
}

// Discount = how much below face the note was bought for. Negative when
// purchased above face (rare on secondary market but possible — premium
// for high-quality re-performing paper).
function computeDiscount(note: AcquiredNote): { absCents: number; pct: number } {
  const abs = note.originalPrincipalCents - note.acquisitionPriceCents;
  const pct = note.originalPrincipalCents > 0
    ? (abs / note.originalPrincipalCents) * 100
    : 0;
  return { absCents: abs, pct };
}

// ---------------------------------------------------------------------------
// Reconciliation card — drift indicator.
//
// Renders the drift between the live ledger and the schedule-derived
// principal. Green check on zero (the clean book; what every note SHOULD
// look like). When non-zero, expands to show the four SUM buckets and
// the live balance so the operator can see exactly where the drift is.
// ---------------------------------------------------------------------------

interface ReconciliationResponse {
  openingPrincipalCents: number;
  sumOfPrincipalPostedCents: number;
  sumOfInterestPostedCents: number;
  sumOfLateFeesPostedCents: number;
  sumOfEscrowPostedCents: number;
  currentPrincipalCents: number;
  scheduleSaysPrincipalCents: number;
  drift: number;
  lastPostingId: string | null;
  asOf: string;
}

function ReconciliationCard({ noteId }: { noteId: string }) {
  const [expanded, setExpanded] = useState(false);
  const { data, isLoading } = useQuery<ReconciliationResponse>({
    queryKey: ["/api/notes", noteId, "reconciliation"],
    queryFn: async () => {
      const res = await fetch(`/api/notes/${noteId}/reconciliation`, { credentials: "include" });
      if (!res.ok) throw new Error(`Failed to load reconciliation (${res.status})`);
      return res.json();
    },
    enabled: !!noteId,
  });

  if (isLoading || !data) {
    return (
      <Card className="mb-6" aria-busy="true" aria-label="Loading reconciliation">
        <div className="p-5">
          <Skeleton className="h-5 w-40 mb-3" />
          <Skeleton className="h-8 w-64" />
        </div>
      </Card>
    );
  }

  const driftIsZero = data.drift === 0;
  // Auto-expand when there's drift — the operator needs the detail at a
  // glance, no second click.
  const shouldShowDetail = expanded || !driftIsZero;

  return (
    <Card className={`mb-6 ${driftIsZero ? "" : "border-acr-warn/40 bg-acr-warn-soft/30"}`}>
      <div className="p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {driftIsZero ? (
              /* --acr-pos = semantic positive / clean state */
              <CheckCircle2 className="w-5 h-5 text-acr-pos" aria-hidden="true" />
            ) : (
              /* --acr-warn = semantic caution / drift state */
              <AlertCircle className="w-5 h-5 text-acr-warn" aria-hidden="true" />
            )}
            <h2 className="text-sm font-semibold">
              {driftIsZero ? "Payments reconciled" : "Payment drift detected"}
            </h2>
            <span
              className="text-xs text-muted-foreground tabular-nums"
              data-testid="reconciliation-drift"
            >
              drift = {fmtUsd(data.drift)}
            </span>
          </div>
          {driftIsZero && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setExpanded((v) => !v)}
              aria-label={expanded ? "Hide reconciliation entries" : "Show reconciliation entries"}
            >
              {expanded ? (
                <>
                  <ChevronUp className="w-3.5 h-3.5 mr-1" aria-hidden="true" />
                  Hide entries
                </>
              ) : (
                <>
                  <ChevronDown className="w-3.5 h-3.5 mr-1" aria-hidden="true" />
                  Show entries
                </>
              )}
            </Button>
          )}
        </div>

        {shouldShowDetail && (
          <>
            <Separator className="my-3" />
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <KV label="Opening principal" value={fmtUsd(data.openingPrincipalCents)} />
              <KV label="Principal posted" value={fmtUsd(data.sumOfPrincipalPostedCents)} />
              <KV label="Interest posted" value={fmtUsd(data.sumOfInterestPostedCents)} />
              <KV label="Late fees posted" value={fmtUsd(data.sumOfLateFeesPostedCents)} />
              <KV label="Escrow posted" value={fmtUsd(data.sumOfEscrowPostedCents)} />
              <KV label="Live balance" value={fmtUsd(data.currentPrincipalCents)} />
              <KV label="Schedule says" value={fmtUsd(data.scheduleSaysPrincipalCents)} />
              <KV
                label="Drift"
                value={fmtUsd(data.drift)}
                sub={driftIsZero ? "Clean — no action needed" : "Investigate before posting more"}
              />
            </div>
            <p className="text-xs text-muted-foreground mt-3">
              As of {formatDateTime(data.asOf)}
              {data.lastPostingId ? ` · last posting ${data.lastPostingId.slice(0, 8)}` : ""}
            </p>
          </>
        )}
      </div>
    </Card>
  );
}

export default function NoteDetailPage() {
  const [, params] = useRoute<{ id: string }>("/notes/:id");
  const id = params?.id ?? null;
  const [recordPaymentOpen, setRecordPaymentOpen] = useState(false);

  const { data: organization } = useOrganization();
  // (organization is loaded for any future persona-keyed copy; the list-page
  // already drives the canonical title swap. Local copy is consistent.)
  void organization;
  void getTerm;
  void personaForInvestorType;
  useDocumentTitle(id ? `Note ${id.slice(0, 8)} — AcreOS` : "Note — AcreOS");

  const { data, isLoading, isError, refetch } = useQuery<NoteDetailResponse>({
    queryKey: ["/api/notes", id],
    queryFn: async () => {
      const res = await fetch(`/api/notes/${id}`, { credentials: "include" });
      if (!res.ok) throw new Error(`Failed to load note (${res.status})`);
      return res.json();
    },
    enabled: !!id,
  });

  const { data: paymentsData } = useQuery<PaymentsResponse>({
    queryKey: ["/api/notes", id, "payments"],
    queryFn: async () => {
      const res = await fetch(`/api/notes/${id}/payments`, { credentials: "include" });
      if (!res.ok) throw new Error(`Failed to load payments (${res.status})`);
      return res.json();
    },
    enabled: !!id,
  });

  if (!id) {
    return (
      <PageShell>
        <BackButton />
        <EmptyState
          icon={FileText}
          headline="Note not found"
          subtitle="The URL is missing a valid note ID."
          cta={{
            label: "Back to notes",
            onClick: () => { window.location.href = "/notes"; },
            "data-testid": "note-detail-back",
          }}
          actionIcon={null}
        />
      </PageShell>
    );
  }

  if (isLoading) {
    return (
      <PageShell>
        <BackButton />
        <div className="space-y-6" aria-busy="true" aria-label="Loading note">
          <Skeleton className="h-10 w-72" />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Skeleton className="h-40" />
            <Skeleton className="h-40" />
          </div>
          <Skeleton className="h-64" />
        </div>
      </PageShell>
    );
  }

  if (isError) {
    return (
      <PageShell>
        <BackButton />
        <QueryErrorState
          error={null}
          onRetry={refetch}
          description="We couldn't load this note."
        />
      </PageShell>
    );
  }

  if (!data?.note) {
    return (
      <PageShell>
        <BackButton />
        <EmptyState
          icon={AlertCircle}
          headline="Note not found"
          subtitle="This note may have been deleted or you don't have access."
          cta={{
            label: "Back to notes",
            onClick: () => { window.location.href = "/notes"; },
            "data-testid": "note-detail-not-found-back",
          }}
          actionIcon={null}
        />
      </PageShell>
    );
  }

  const note = data.note;
  const discount = computeDiscount(note);
  const principalReduced = note.originalPrincipalCents - note.currentBalanceCents;
  const principalReducedPct = note.originalPrincipalCents > 0
    ? (principalReduced / note.originalPrincipalCents) * 100
    : 0;

  return (
    <PageShell>
      <BackButton />

      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3 mb-6">
        <div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
            <span className="font-mono">{note.noteNumber}</span>
            <span>·</span>
            <StatusBadge
              status={statusKindFor(note.status)}
              label={statusLabelFor(note.status)}
              size="sm"
            />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight" data-testid="note-detail-payer">
            {note.payerName}
          </h1>
          {note.payerAddress?.line1 && (
            <div className="flex items-center gap-1 text-sm text-muted-foreground mt-1">
              <MapPin className="w-3.5 h-3.5" aria-hidden="true" />
              <span>
                {note.payerAddress.line1}
                {note.payerAddress.city && `, ${note.payerAddress.city}`}
                {note.payerAddress.state && `, ${note.payerAddress.state}`}
                {note.payerAddress.zip && ` ${note.payerAddress.zip}`}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Top stat cards — the line Linnea's CPA cares about goes first.
          Acquisition price separated from face value is the basis story. */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <StatCard
          label="Acquisition price"
          value={fmtUsdRound(note.acquisitionPriceCents)}
          sub={`Bought ${formatDate(note.acquisitionDate)}`}
          testid="note-detail-acquisition-price"
        />
        <StatCard
          label="Original face value"
          value={fmtUsdRound(note.originalPrincipalCents)}
          sub={`Originated ${formatDate(note.originationDate)}`}
          testid="note-detail-face-value"
        />
        <StatCard
          label={discount.absCents >= 0 ? "Discount at acquisition" : "Premium at acquisition"}
          value={`${fmtUsdRound(Math.abs(discount.absCents))}`}
          sub={`${discount.pct >= 0 ? "" : "-"}${Math.abs(discount.pct).toFixed(1)}% ${discount.absCents >= 0 ? "below" : "above"} face`}
          testid="note-detail-discount"
        />
      </div>

      {/* Yield panel — Linnea's "table stakes." Live IRR / YTM / current
          yield / effective-net computed from the actual ledger. */}
      <NoteYieldPanel noteId={note.id} />

      {/* Servicing snapshot */}
      <Card className="mb-6">
        <div className="p-5">
          <h2 className="text-sm font-semibold mb-1">Servicing snapshot</h2>
          {/* R1b reshape (home-base-reshape.md rule 2): make the posture
              explicit — AcreOS is the intelligent dashboard over the note;
              collection and servicing of record run through the holder's own
              licensed servicer, not AcreOS. */}
          <p className="text-xs text-muted-foreground mb-4">
            A read on your note's status. AcreOS dashboards the note — collection and
            servicing of record run through your own licensed servicer.
          </p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <KV label="Current balance" value={fmtUsd(note.currentBalanceCents)} />
            <KV
              label="Principal reduced"
              value={fmtUsd(principalReduced)}
              sub={`${principalReducedPct.toFixed(1)}% of face`}
            />
            <KV label="Interest rate" value={fmtPct(note.interestRateBps)} />
            <KV
              label="Monthly payment"
              value={fmtUsd(note.paymentAmountCents)}
              sub={`Due day ${note.paymentDueDay}`}
            />
            <KV label="Term" value={`${note.termMonths} months`} />
            <KV label="Maturity" value={formatDate(note.maturityDate)} />
            <KV
              label="Original lender"
              value={note.originalLender || "—"}
              sub={note.originalLender ? "Prior holder" : undefined}
            />
            <div>
              <div className="text-xs text-muted-foreground">Tax ID type</div>
              <div className="text-sm font-medium mt-0.5">{note.payerTinType || "—"}</div>
              <div className="text-xs text-muted-foreground mt-0.5">
                {note.payerTinType ? "On file" : "Add a W-9 to enable 1099-INT"}
              </div>
              <NoteTinEditor noteId={note.id} currentTinType={note.payerTinType as any} />
            </div>
          </div>
        </div>
      </Card>

      {/* Reconciliation — drift between live ledger and schedule-derived
          principal. Green check on zero; auto-expanded with the SUM
          breakdown when non-zero. Single biggest trust upgrade. */}
      <ReconciliationCard noteId={note.id} />

      {/* Unapplied funds banner — Linnea: "If a borrower sends $400 against
          an $812 payment, that money should sit in unapplied until either
          the next deposit makes it whole or it ages past a threshold." */}
      {note.unappliedBalanceCents > 0 && (
        <Card className="mb-6 border-acr-warn/30 bg-acr-warn-soft/30">
          <div className="p-4 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-acr-warn shrink-0 mt-0.5" aria-hidden="true" />
            <div className="flex-1">
              <p className="text-sm font-semibold">
                <span className="tabular-nums">{fmtUsd(note.unappliedBalanceCents)}</span> held in unapplied funds
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Borrower has sent partial payments that haven't been applied to a period.
                Apply via "Record payment" → "Apply held funds" when the borrower tops up
                or you decide to apply per note terms.
              </p>
            </div>
          </div>
        </Card>
      )}

      {/* Payment ledger + payoff side-by-side on wide screens. */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        <Card className="lg:col-span-2">
          <div className="p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold">Payment ledger</h2>
              <Button size="sm" onClick={() => setRecordPaymentOpen(true)} data-testid="record-payment-button">
                <Plus className="w-3.5 h-3.5 mr-1" aria-hidden="true" />
                Record payment
              </Button>
            </div>
            <Separator className="mb-3" />
            <PaymentLedger payments={paymentsData?.payments ?? []} />
          </div>
        </Card>

        <NotePayoffCalculator noteId={note.id} />
      </div>

      {/* Modal */}
      <NoteRecordPaymentModal
        open={recordPaymentOpen}
        onOpenChange={setRecordPaymentOpen}
        note={note}
      />

      {/* Basis schedule — Pub 1212 market-discount accretion. Renders empty
          state for face-value purchases / premium-paid notes. */}
      <NoteBasisSchedule noteId={note.id} />

      {/* Loss-mit case file — auto-prominent when status is late/default. */}
      <NoteLossMitCard noteId={note.id} currentNoteStatus={note.status} />

      {/* Compliance — hazard insurance + property-tax escrow. */}
      <NoteComplianceCard
        noteId={note.id}
        insuranceStatus={note.insuranceStatus}
        insuranceCarrier={note.insuranceCarrier}
        insurancePolicyNumber={note.insurancePolicyNumber}
        insuranceExpiresAt={note.insuranceExpiresAt}
        taxEscrowEnabled={note.taxEscrowEnabled}
        taxEscrowBalanceCents={note.taxEscrowBalanceCents}
        taxDisbursementDueDate={note.taxDisbursementDueDate}
        taxDisbursementAmountCents={note.taxDisbursementAmountCents}
        taxAuthorityName={note.taxAuthorityName}
      />

      {/* Pool / fractional ownership splits. */}
      <NoteSplitsCard noteId={note.id} currentBalanceCents={note.currentBalanceCents} />

      {/* Assignment paperwork — Allonge + Assignment of Mortgage. */}
      <NoteAssignmentsCard noteId={note.id} noteNumber={note.noteNumber} />

      {/* Internal notes */}
      {note.notes && (
        <Card className="mb-6">
          <div className="p-5">
            <h2 className="text-sm font-semibold mb-2">Internal notes</h2>
            <p className="text-sm text-muted-foreground whitespace-pre-wrap">{note.notes}</p>
          </div>
        </Card>
      )}

      {/* Provenance footer */}
      <p className="text-xs text-muted-foreground">
        Added {formatDate(note.createdAt)} · Last updated {formatDate(note.updatedAt)}
        {note.assignmentDocS3Key && (
          <> · Assignment paperwork on file</>
        )}
      </p>
    </PageShell>
  );
}

function BackButton() {
  return (
    <Link href="/notes">
      <Button variant="ghost" size="sm" className="mb-3 -ml-2">
        <ArrowLeft className="w-4 h-4 mr-1.5" aria-hidden="true" />
        Back to notes
      </Button>
    </Link>
  );
}

function StatCard({ label, value, sub, testid }: { label: string; value: string; sub?: string; testid?: string }) {
  return (
    <Card className="p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      {/* Fraunces (display font) for hero metric; tabular-nums for alignment. */}
      <div className="text-2xl font-semibold tracking-tight mt-1 font-mono tabular-nums" data-testid={testid}>{value}</div>
      {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
    </Card>
  );
}

function KV({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-sm font-medium mt-0.5 tabular-nums">{value}</div>
      {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}

const PAYMENT_TYPE_LABEL: Record<NotePaymentType, string> = {
  regular: "Regular",
  partial: "Partial",
  extra_principal: "Extra principal",
  payoff: "Payoff",
  nsf_reversal: "NSF reversal",
  unapplied_apply: "Apply held funds",
};

const PAYMENT_TYPE_TONE: Record<NotePaymentType, string> = {
  regular: "bg-acr-pos/10 text-acr-pos",
  partial: "bg-acr-warn/10 text-acr-warn",
  extra_principal: "bg-acr-brand/10 text-acr-brand",
  payoff: "bg-primary/10 text-primary",
  nsf_reversal: "bg-acr-neg/10 text-acr-neg",
  unapplied_apply: "bg-muted text-muted-foreground",
};

function PaymentLedger({ payments }: { payments: NotePayment[] }) {
  if (payments.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-3">
        No payments recorded yet. Use "Record payment" above to log the first one.
      </p>
    );
  }

  // Footer totals — Linnea explicitly called out "I want a total row I can
  // reconcile against my bank deposits." We sum every bucket so the operator
  // can match against ACH batches without exporting to a spreadsheet.
  const totals = payments.reduce(
    (acc, p) => {
      acc.principal += p.principalCents;
      acc.interest += p.interestCents;
      acc.escrow += p.escrowCents;
      acc.lateFee += p.lateFeeCents;
      acc.unapplied += p.unappliedCents;
      return acc;
    },
    { principal: 0, interest: 0, escrow: 0, lateFee: 0, unapplied: 0 },
  );
  const grandTotal =
    totals.principal + totals.interest + totals.escrow + totals.lateFee + totals.unapplied;

  return (
    <>
      {/* Mobile: stacked ledger cards — the 9-column ledger side-scrolls at
          phone widths. md+ renders the full reconciliation table below. */}
      <div className="md:hidden" data-testid="list-payment-ledger-mobile">
        <ul className="divide-y divide-border/40">
          {payments.map((p) => {
            const total =
              p.principalCents + p.interestCents + p.escrowCents + p.lateFeeCents + p.unappliedCents;
            return (
              <li key={p.id} className="py-3" data-testid={`card-ledger-${p.id}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm whitespace-nowrap">{formatDate(p.paymentDate)}</div>
                    <span className={`inline-block rounded-md px-2 py-0.5 text-xs mt-1 ${PAYMENT_TYPE_TONE[p.paymentType]}`}>
                      {PAYMENT_TYPE_LABEL[p.paymentType]}
                    </span>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="font-mono font-semibold tabular-nums">{fmtCents(total)}</div>
                    <div className="text-xs uppercase text-muted-foreground mt-0.5">{p.paymentMethod}</div>
                  </div>
                </div>
                <dl className="grid grid-cols-2 gap-x-6 gap-y-0.5 mt-2 text-xs">
                  {([
                    ["Principal", p.principalCents],
                    ["Interest", p.interestCents],
                    ["Escrow", p.escrowCents],
                    ["Late fee", p.lateFeeCents],
                    ["Unapplied", p.unappliedCents],
                  ] as const)
                    .filter(([, cents]) => cents !== 0)
                    .map(([label, cents]) => (
                      <div key={label} className="flex items-center justify-between gap-2">
                        <dt className="text-muted-foreground">{label}</dt>
                        <dd className="font-mono tabular-nums">{fmtCents(cents)}</dd>
                      </div>
                    ))}
                </dl>
              </li>
            );
          })}
        </ul>
        {/* Totals — same reconciliation buckets as the desktop tfoot row. */}
        <div
          className="border-t-2 border-border bg-muted/30 rounded-b-md px-3 py-2 text-xs"
          data-testid="payment-ledger-totals-card"
        >
          <div className="flex items-center justify-between gap-2 font-semibold">
            <span>Totals · {payments.length} payment{payments.length === 1 ? "" : "s"}</span>
            <span className="font-mono tabular-nums">{fmtCents(grandTotal)}</span>
          </div>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-0.5 mt-1.5">
            {([
              ["Principal", totals.principal],
              ["Interest", totals.interest],
              ["Escrow", totals.escrow],
              ["Late fee", totals.lateFee],
              ["Unapplied", totals.unapplied],
            ] as const).map(([label, cents]) => (
              <div key={label} className="flex items-center justify-between gap-2">
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="font-mono tabular-nums">{fmtCents(cents)}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>

      {/* Desktop: full 9-column ledger. Hidden on mobile. */}
      <div className="hidden md:block overflow-x-auto -mx-2">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs text-muted-foreground">
            <th className="px-2 py-2 text-left font-medium">Date</th>
            <th className="px-2 py-2 text-left font-medium">Type</th>
            <th className="px-2 py-2 text-right font-medium">Principal</th>
            <th className="px-2 py-2 text-right font-medium">Interest</th>
            <th className="px-2 py-2 text-right font-medium">Escrow</th>
            <th className="px-2 py-2 text-right font-medium">Late fee</th>
            <th className="px-2 py-2 text-right font-medium">Unapplied</th>
            <th className="px-2 py-2 text-right font-medium">Total</th>
            <th className="px-2 py-2 text-right font-medium">Method</th>
          </tr>
        </thead>
        <tbody>
          {payments.map((p) => {
            const total =
              p.principalCents + p.interestCents + p.escrowCents + p.lateFeeCents + p.unappliedCents;
            return (
              <tr key={p.id} className="border-t border-border/40">
                <td className="px-2 py-2 whitespace-nowrap">{formatDate(p.paymentDate)}</td>
                <td className="px-2 py-2">
                  <span className={`inline-block rounded-md px-2 py-0.5 text-xs ${PAYMENT_TYPE_TONE[p.paymentType]}`}>
                    {PAYMENT_TYPE_LABEL[p.paymentType]}
                  </span>
                </td>
                <td className="px-2 py-2 text-right font-mono text-xs tabular-nums">{fmtCents(p.principalCents)}</td>
                <td className="px-2 py-2 text-right font-mono text-xs tabular-nums">{fmtCents(p.interestCents)}</td>
                <td className="px-2 py-2 text-right font-mono text-xs tabular-nums">{fmtCents(p.escrowCents)}</td>
                <td className="px-2 py-2 text-right font-mono text-xs tabular-nums">{fmtCents(p.lateFeeCents)}</td>
                <td className="px-2 py-2 text-right font-mono text-xs tabular-nums">{fmtCents(p.unappliedCents)}</td>
                <td className="px-2 py-2 text-right font-mono text-xs font-semibold tabular-nums">{fmtCents(total)}</td>
                <td className="px-2 py-2 text-right text-xs uppercase">{p.paymentMethod}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr
            className="border-t-2 border-border bg-muted/30 text-xs"
            data-testid="payment-ledger-totals"
          >
            <td className="px-2 py-2 font-semibold" colSpan={2}>
              Totals · {payments.length} payment{payments.length === 1 ? "" : "s"}
            </td>
            <td className="px-2 py-2 text-right font-mono tabular-nums">{fmtCents(totals.principal)}</td>
            <td className="px-2 py-2 text-right font-mono tabular-nums">{fmtCents(totals.interest)}</td>
            <td className="px-2 py-2 text-right font-mono tabular-nums">{fmtCents(totals.escrow)}</td>
            <td className="px-2 py-2 text-right font-mono tabular-nums">{fmtCents(totals.lateFee)}</td>
            <td className="px-2 py-2 text-right font-mono tabular-nums">{fmtCents(totals.unapplied)}</td>
            <td className="px-2 py-2 text-right font-mono font-semibold tabular-nums">{fmtCents(grandTotal)}</td>
            <td className="px-2 py-2" />
          </tr>
        </tfoot>
      </table>
      </div>
    </>
  );
}

// Compact signed-cents formatter for ledger cells. Negative values render
// with a leading minus + parens (accounting style); zero suppressed to
// "—" to keep the ledger eye-readable.
function fmtCents(cents: number): string {
  if (cents === 0) return "—";
  const abs = Math.abs(cents);
  const dollars = (abs / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return cents < 0 ? `($${dollars})` : `$${dollars}`;
}
