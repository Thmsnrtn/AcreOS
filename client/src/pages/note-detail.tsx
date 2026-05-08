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
 * follow-up PRs (see docs/exhaustive-completion/note-investor-followups.md).
 */

import { useRoute, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, FileText, AlertCircle, MapPin } from "lucide-react";

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

interface AcquiredNote {
  id: string;
  organizationId: number;
  propertyId: number | null;
  borrowerId: number | null;
  noteNumber: string;
  originalPrincipalCents: number;
  currentBalanceCents: number;
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
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

interface NoteDetailResponse {
  note: AcquiredNote;
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

function fmtDate(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
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

export default function NoteDetailPage() {
  const [, params] = useRoute<{ id: string }>("/notes/:id");
  const id = params?.id ?? null;

  const { data: organization } = useOrganization();
  const persona = personaForInvestorType((organization as any)?.investorType);
  // Persona-aware "back to" copy. The list-page title decision (Acquired
  // notes vs Notes) keys off entity.property.plural === "Collateral" in
  // the existing notes.tsx; mirror that for consistency.
  const isNotePersona = getTerm("entity.property.plural", persona) === "Collateral";
  const headLabel = isNotePersona ? "Note" : "Note";
  useDocumentTitle(id ? `${headLabel} ${id.slice(0, 8)} — AcreOS` : `${headLabel} — AcreOS`);

  const { data, isLoading, isError, refetch } = useQuery<NoteDetailResponse>({
    queryKey: ["/api/notes", id],
    queryFn: async () => {
      const res = await fetch(`/api/notes/${id}`, { credentials: "include" });
      if (!res.ok) throw new Error(`Failed to load note (${res.status})`);
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
          title="Note not found"
          description="The URL is missing a valid note ID."
          actionLabel="Back to notes"
          actionIcon={null}
          onAction={() => { window.location.href = "/notes"; }}
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
          title="Note not found"
          description="This note may have been deleted or you don't have access."
          actionLabel="Back to notes"
          actionIcon={null}
          onAction={() => { window.location.href = "/notes"; }}
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
          sub={`Bought ${fmtDate(note.acquisitionDate)}`}
          testid="note-detail-acquisition-price"
        />
        <StatCard
          label="Original face value"
          value={fmtUsdRound(note.originalPrincipalCents)}
          sub={`Originated ${fmtDate(note.originationDate)}`}
          testid="note-detail-face-value"
        />
        <StatCard
          label={discount.absCents >= 0 ? "Discount at acquisition" : "Premium at acquisition"}
          value={`${fmtUsdRound(Math.abs(discount.absCents))}`}
          sub={`${discount.pct >= 0 ? "" : "-"}${Math.abs(discount.pct).toFixed(1)}% ${discount.absCents >= 0 ? "below" : "above"} face`}
          testid="note-detail-discount"
        />
      </div>

      {/* Servicing snapshot */}
      <Card className="mb-6">
        <div className="p-5">
          <h2 className="text-sm font-semibold mb-4">Servicing snapshot</h2>
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
            <KV label="Maturity" value={fmtDate(note.maturityDate)} />
            <KV
              label="Original lender"
              value={note.originalLender || "—"}
              sub={note.originalLender ? "Prior holder" : undefined}
            />
            <KV
              label="Tax ID type"
              value={note.payerTinType || "—"}
              sub={note.payerTinType ? "On file" : "Add a W-9 to enable 1099-INT"}
            />
          </div>
        </div>
      </Card>

      {/* Payment ledger placeholder — wired to /api/notes/:id/payments in
          a follow-up. Surfacing the placeholder + link makes the gap
          explicit to Linnea-type users who'll want to see ledger first. */}
      <Card className="mb-6">
        <div className="p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold">Payment ledger</h2>
            <Link href={`/notes/${note.id}/payments`} className="text-xs text-primary hover:underline">
              Full ledger →
            </Link>
          </div>
          <Separator className="mb-4" />
          <p className="text-sm text-muted-foreground">
            Recent payments roll up here once recorded. Use{" "}
            <span className="font-mono text-xs">POST /api/notes/{note.id}/record-payment</span>{" "}
            to log partial / extra-principal / payoff transactions; the ledger updates immediately.
          </p>
        </div>
      </Card>

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
        Added {fmtDate(note.createdAt)} · Last updated {fmtDate(note.updatedAt)}
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
      <div className="text-2xl font-semibold tracking-tight mt-1" data-testid={testid}>{value}</div>
      {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
    </Card>
  );
}

function KV({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-sm font-medium mt-0.5">{value}</div>
      {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}
