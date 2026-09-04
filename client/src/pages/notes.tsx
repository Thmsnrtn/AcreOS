/**
 * /notes — Note Investor vertical primary list (Phase 5 §5).
 *
 * Lists acquired notes for the org with status pills, a status filter, and
 * per-row payer / balance / next payment / aging / status. Foundation
 * surface — the BPO + tape diligence + Sophie agent expansion ride a
 * follow-up PR (see docs/archive/exhaustive-completion/note-investor-followups.md).
 *
 * WHERE THE DUE DATE COMES FROM
 * -----------------------------
 * The server. This page used to derive "Next payment" in the browser from
 * `paymentDueDay` + `new Date()`, rolling any date already past forward to
 * the following month — so a note six periods delinquent rendered the exact
 * same friendly upcoming date as a perfectly current one. That derivation is
 * gone, and it is deliberately NOT kept as a fallback: a fallback here would
 * re-introduce the fabrication. When the server cannot state a due date it
 * sends null, and null renders as an explained blank (see `nullDueCopy`).
 *
 * Loading state uses Skeleton matching the table shape (per UI patterns
 * in CLAUDE.md). Empty state uses the canonical EmptyState with a
 * purposeful CTA. Errors use QueryErrorState with retry.
 */

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import { FileText, Filter, HelpCircle, Upload } from "lucide-react";
import { PageShell } from "@/components/page-shell";
import { delinquencyIsDeterminable } from "@shared/notes/delinquency";
import { RequiredDisclaimer } from "@/components/required-disclaimer";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusBadge, type StatusKind } from "@/components/StatusBadge";
import { EmptyState } from "@/components/empty-state";
import { QueryErrorState } from "@/components/query-error-state";
import { NotesImportDialog } from "@/components/notes-import-dialog";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useOrganization } from "@/hooks/use-organization";
import { getTerm, personaForInvestorType } from "@/lib/personaVocabulary";
import { formatDate } from "@/lib/format";

/**
 * Delinquency bands. Mirrors `NoteDelinquencyStatus` in
 * server/services/notes/acquiredNoteSchedule.ts (which in turn mirrors
 * financeAgent's bands so the acquired book and the originated book describe
 * one borrower reality with one vocabulary).
 */
type NoteDelinquencyStatus =
  | "current"
  | "early_delinquent"
  | "delinquent"
  | "seriously_delinquent"
  | "default_candidate";

/** Reason codes emitted when the server declines to state a due date. */
type NextDueReason =
  | "history_predates_acquisition"
  | "paid_through_maturity"
  | "incoherent_facts";

// Shape returned by GET /api/notes/acquired (mirrors acquiredNotes minus the
// encrypted TIN, plus the server-derived aging fields).
//
// NOTE ON THE PATH: `/api/notes` is the *seller-finance* book — a bare array
// of decimal-dollar rows served by routes-finance.ts. The acquired book lives
// at `/api/notes/acquired` (server/routes-notes.ts:916) and is the only one
// that carries integer cents and these aging columns.
interface AcquiredNoteRow {
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
  originalLender: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;

  // ── Server-derived aging (migration 0218 + services/notes/acquiredNoteSchedule) ──
  /**
   * 'YYYY-MM-DD'. SERVER TRUTH. May be in the PAST — that is the signal, not
   * an error, and it is never rolled forward to look friendlier.
   */
  nextPaymentDate: string | null;
  /** 'YYYY-MM-DD' — the last period FULLY satisfied (not "date of last payment"). */
  paidThroughDate: string | null;
  /**
   * Counted from the DUE DATE (grace governs late FEES, not delinquency).
   * 0 means "not past due" ONLY when `nextPaymentDate` is non-null — for a note
   * with no derivable due date the server writes a neutral 0 it does not mean
   * as a finding. Always pair this with `delinquencyIsDeterminable` before
   * showing a band. */
  daysDelinquent: number;
  delinquencyStatus: NoteDelinquencyStatus;
  /**
   * Why there is no next payment date. Optional: the column-backed fields
   * above always ship, this one is derived per-response. When it is absent we
   * say so generically rather than guessing which fact is missing.
   */
  nextPaymentDateReason?: NextDueReason | string | null;
  /**
   * ADVISORY ONLY — whether a late fee WOULD be assessable under the note's
   * own terms. AcreOS assesses, invoices and collects nothing (founder ruling
   * #15, "be the rail, not the provider"). Surfaced on the note detail page,
   * where there is room to say that plainly.
   */
  lateFeeAdvisory?: { assessable: boolean; reason: string } | null;
}

interface NotesListResponse {
  notes: AcquiredNoteRow[];
  limit: number;
  offset: number;
  count: number;
}

/**
 * Status filter. `late` and `default` are now genuinely maintained on the row
 * (nothing used to set them, which is why lateness was invisible), so both
 * stay selectable and the filter round-trips to the server as `?status=`.
 */
const STATUS_FILTER_OPTIONS = [
  { value: "all", label: "All statuses" },
  { value: "performing", label: "Performing" },
  { value: "late", label: "Late" },
  { value: "default", label: "Default" },
  { value: "paid_off", label: "Paid off" },
  { value: "sold", label: "Sold" },
] as const;

// Map our note status to StatusBadge kinds. The badge accepts arbitrary
// strings, but mapping into the canonical kinds gives us the correct
// tone (green/amber/red/etc) without hardcoding colors.
function statusKindFor(status: AcquiredNoteRow["status"]): StatusKind {
  switch (status) {
    case "performing":
      return "active";
    case "late":
      return "warning";
    case "default":
      return "error";
    case "paid_off":
      return "success";
    case "sold":
      return "inactive";
    default:
      return "pending";
  }
}

function statusLabel(status: AcquiredNoteRow["status"]): string {
  switch (status) {
    case "performing":
      return "Performing";
    case "late":
      return "Late";
    case "default":
      return "Default";
    case "paid_off":
      return "Paid off";
    case "sold":
      return "Sold";
    default:
      return status;
  }
}

// Notes list shows current balance to the cent. Rounding off the cents
// breaks borrower-statement reconciliation — Linnea: "if my number doesn't
// match their bank's number to the penny they call me."
function fmtUsd(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

/**
 * One short human sentence for a null `nextPaymentDate`.
 *
 * A dash on its own reads as a rendering bug and gets worked around; an
 * explained blank tells the operator which fact to go find. We never
 * substitute a computed date here — that is the whole point of the change.
 */
export function nullDueCopy(reason: string | null | undefined): string {
  switch (reason) {
    case "history_predates_acquisition":
      return "No schedule on file — this note was acquired after origination and no payment history was imported.";
    case "paid_through_maturity":
      return "Paid through maturity — nothing further is due on the monthly schedule.";
    case "incoherent_facts":
      return "The note's recorded dates don't line up, so no due date can be stated. Check origination, maturity and due day.";
    default:
      return "No next payment date could be derived from this note's recorded facts.";
  }
}

/**
 * Severity encoded in FORM as well as number, so aging reads at a glance
 * without decoding a digit: the band's own word, a widening border and a
 * heavier weight escalate alongside the semantic acr-* tone. All colors are
 * design tokens — the `lint:page-hex` gate forbids raw values here.
 */
const DELINQUENCY_CHIP: Record<
  NoteDelinquencyStatus,
  { label: string; tone: string }
> = {
  current: {
    label: "Current",
    tone: "bg-muted text-muted-foreground border-transparent",
  },
  early_delinquent: {
    label: "Early",
    tone: "bg-acr-warn-soft text-acr-warn-soft-ink border-acr-warn/20",
  },
  delinquent: {
    label: "Delinquent",
    tone: "bg-acr-warn-soft text-acr-warn-soft-ink border-acr-warn/50 font-semibold",
  },
  seriously_delinquent: {
    label: "Serious",
    tone: "bg-acr-neg-soft text-acr-neg-soft-ink border-acr-neg/30 font-semibold",
  },
  default_candidate: {
    label: "Default risk",
    tone: "bg-acr-neg-soft text-acr-neg-soft-ink border-acr-neg/60 font-bold",
  },
};

const FALLBACK_CHIP = {
  label: "Unknown",
  tone: "bg-muted text-muted-foreground border-transparent",
};

function chipFor(status: NoteDelinquencyStatus | string) {
  return DELINQUENCY_CHIP[status as NoteDelinquencyStatus] ?? FALLBACK_CHIP;
}

/**
 * True when the note's aging can be determined at all — i.e. there is a due date
 * to measure from. Re-exported so this page stays the import site other note
 * surfaces already use.
 *
 * IT USED TO BE RESTATED HERE, under a comment saying "the client cannot import
 * server code". True of `server/`, and it skipped `shared/` — which is
 * browser-safe by construction and which this page already imports from. While
 * the restatement stood it DRIFTED: the copy tested the string's SHAPE where the
 * server parsed the date and round-tripped it, so `"2026-02-30"` read as
 * determinable here and refused there. Latent (the column is a Postgres `date`),
 * and fixed by having one owner rather than two agreeing copies.
 *
 * This is NOT the same question as `daysDelinquent === 0`. The server writes a
 * NEUTRAL 0 / "current" for a note whose due date it could not derive, because
 * the band union has no "unknown" member and the columns are NOT NULL. Keying
 * the chip off the number therefore printed a reassuring "Current" in one
 * column beside "Next payment not on file — no schedule on file…" in the next.
 * The date is the only honest discriminator.
 */
export { delinquencyIsDeterminable };

/** The action that turns an undeterminable note into a readable one. */
export const AGING_UNKNOWN_ACTION =
  "Set this note's paid-through or first-payment date to give the schedule an anchor.";

/**
 * The neutral chip for a note with no due date, worded by REASON.
 *
 * A note paid through maturity has no due date either, but it is not a mystery
 * — telling that operator to "go find the paid-through date" would send them
 * after a fact they already supplied. So the two blanks get two labels.
 */
export function agingUnknownChipCopy(reason: string | null | undefined): {
  label: string;
  title: string;
} {
  if (reason === "paid_through_maturity") {
    return {
      label: "Schedule complete",
      title:
        "Paid through maturity — no monthly payment remains, so there is no aging to measure. Any remaining balance is a payoff figure, not a past-due one.",
    };
  }
  return {
    label: "Aging unknown",
    title: `We can't tell how far behind this note is — it has no due date on file. ${AGING_UNKNOWN_ACTION}`,
  };
}

/**
 * Days-late chip. `daysDelinquent` counts from the DUE DATE — grace is a term
 * of the note about FEES, not a redefinition of delinquency — so 0 means "not
 * past due", and an UNKNOWN note is a third state that must not borrow the
 * word "Current" from it.
 */
function DelinquencyChip({
  status,
  days,
  nextPaymentDate,
  nextPaymentDateReason,
  testId,
}: {
  status: NoteDelinquencyStatus | string;
  days: number;
  /** Null/absent ⇒ the server could not derive a due date; aging is unknown. */
  nextPaymentDate: string | null | undefined;
  nextPaymentDateReason?: NextDueReason | string | null;
  testId?: string;
}) {
  const chip = chipFor(status);

  // UNKNOWN — visibly neutral. Not "Current" (a claim we cannot support), not a
  // severity tone (we are not asserting lateness either), and not a bare dash
  // (which reads as a rendering bug and gets worked around). The dashed border
  // is the form-level tell that this cell is awaiting a fact, not reporting one.
  if (!delinquencyIsDeterminable(nextPaymentDate)) {
    const unknown = agingUnknownChipCopy(nextPaymentDateReason);
    return (
      <span
        className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-border bg-muted/40 px-2 py-0.5 text-xs text-muted-foreground"
        data-testid={testId}
        title={unknown.title}
      >
        <HelpCircle className="h-3 w-3 shrink-0" aria-hidden="true" />
        <span>{unknown.label}</span>
      </span>
    );
  }

  if (!(days > 0)) {
    return (
      <span className="text-xs text-muted-foreground" data-testid={testId}>
        Current
      </span>
    );
  }
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs tabular-nums ${chip.tone}`}
      data-testid={testId}
      title={`${days} day${days === 1 ? "" : "s"} past due, counted from the due date`}
    >
      <span>{days}d</span>
      <span aria-hidden="true">·</span>
      <span>{chip.label}</span>
    </span>
  );
}

/**
 * The "Next payment" cell. Renders the server's date verbatim — including
 * dates in the past, which is exactly the signal the old browser-side
 * derivation erased — or an explained blank.
 */
function NextPaymentCell({ note }: { note: AcquiredNoteRow }) {
  if (!note.nextPaymentDate) {
    return (
      <div className="max-w-[22rem]">
        <div className="text-muted-foreground">Not on file</div>
        <div className="text-xs text-muted-foreground/80 whitespace-normal">
          {nullDueCopy(note.nextPaymentDateReason)}
        </div>
        {/* The blank is explained AND actionable — the operator is told which
            fact to supply, not just that one is missing. */}
        {note.nextPaymentDateReason !== "paid_through_maturity" && (
          <div className="text-xs text-muted-foreground/80 whitespace-normal mt-0.5">
            {AGING_UNKNOWN_ACTION}
          </div>
        )}
      </div>
    );
  }
  const late = note.daysDelinquent > 0;
  return (
    <div>
      <div className={late ? "text-acr-neg font-medium" : "text-foreground"}>
        {formatDate(note.nextPaymentDate)}
      </div>
      {note.paidThroughDate && (
        <div className="text-xs text-muted-foreground">
          Paid through {formatDate(note.paidThroughDate)}
        </div>
      )}
    </div>
  );
}

export default function NotesPage() {
  useDocumentTitle("Notes — AcreOS");
  const [, navigate] = useLocation();
  const { data: organization } = useOrganization();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  // /notes?action=new opens the import dialog (the realistic add-path for
  // bringing notes into the system — manual entry would require a full
  // origination form not yet built). Reading the action= query honors the
  // app-wide convention used by /leads, /properties, /deals.
  const searchString = useSearch();
  const actionFromUrl = new URLSearchParams(searchString).get("action");
  const [isImportOpen, setIsImportOpen] = useState(actionFromUrl === "new");
  // Strip the action param after opening so back-nav doesn't re-trigger.
  useEffect(() => {
    if (actionFromUrl === "new") {
      const params = new URLSearchParams(searchString);
      params.delete("action");
      const next = params.toString();
      const url = next ? `/notes?${next}` : "/notes";
      window.history.replaceState(null, "", url);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Resolve persona for vocabulary lookups. When investorType is 'notes'
  // or 'both' the registry returns note-investor copy; otherwise it falls
  // through to land-investor.
  const persona = personaForInvestorType((organization as any)?.investorType);

  const queryParams = new URLSearchParams();
  queryParams.set("limit", "100");
  if (statusFilter !== "all") queryParams.set("status", statusFilter);

  // Keyed under the "/api/notes" prefix so the existing
  // invalidateQueries({ queryKey: ["/api/notes"] }) calls in the import
  // dialog and the record-payment modal still refresh this list.
  const { data, isLoading, isError, error, refetch } = useQuery<NotesListResponse>({
    queryKey: ["/api/notes", "acquired", statusFilter],
    queryFn: async () => {
      const res = await fetch(`/api/notes/acquired?${queryParams.toString()}`, {
        credentials: "include",
      });
      if (!res.ok) {
        throw new Error(`Failed to load notes (${res.status})`);
      }
      return res.json();
    },
  });

  const notes = data?.notes ?? [];

  return (
    <PageShell isLoading={false} label="Acquired notes">
      <NotesImportDialog open={isImportOpen} onOpenChange={setIsImportOpen} />
      <div className="flex items-start justify-between mb-6 gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight" data-testid="notes-page-title">
            {getTerm("entity.property.plural", persona) === "Collateral"
              ? "Acquired notes"
              : "Notes"}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Mortgage notes and seller-financed paper you've acquired. Next
            payment dates and days-late come from the server's schedule — a
            date already in the past stays in the past.
          </p>
          {/* Standing disclaimer — servicing figures are an informational worksheet */}
          <RequiredDisclaimer type="worksheet" className="mt-3" />
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger
              className="w-44"
              aria-label="Filter notes by status"
              data-testid="notes-status-filter"
            >
              <Filter className="w-4 h-4 mr-2" aria-hidden="true" />
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              {STATUS_FILTER_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            onClick={() => navigate("/notes/pipeline")}
            data-testid="notes-pipeline-button"
          >
            Pipeline
          </Button>
          <Button
            variant="outline"
            onClick={() => navigate("/notes/tax-readiness")}
            data-testid="notes-tax-readiness-button"
          >
            Tax readiness
          </Button>
          <Button
            onClick={() => setIsImportOpen(true)}
            data-testid="notes-add-button"
          >
            <Upload className="w-4 h-4 mr-1" aria-hidden="true" />
            Import notes
          </Button>
        </div>
      </div>

      {isLoading ? (
        <Card className="overflow-hidden">
          <div className="p-4 space-y-3" aria-busy="true" aria-label="Loading notes">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4">
                <Skeleton className="h-5 w-40" />
                <Skeleton className="h-5 w-24" />
                <Skeleton className="h-5 w-28" />
                {/* Next payment renders on two lines (date + paid-through /
                    reason), so the placeholder is shaped that way too. */}
                <div className="space-y-1">
                  <Skeleton className="h-3.5 w-28" />
                  <Skeleton className="h-2.5 w-36" />
                </div>
                <Skeleton className="h-5 w-24" />
                <Skeleton className="h-5 w-20 ml-auto" />
              </div>
            ))}
          </div>
        </Card>
      ) : isError ? (
        <QueryErrorState
          error={error instanceof Error ? error : null}
          onRetry={() => refetch()}
          description="We couldn't load your acquired notes."
          testId="notes-retry-button"
        />
      ) : notes.length === 0 ? (
        <EmptyState
          icon={FileText}
          headline="No notes serviced yet"
          subtitle="Originate or import a note — AcreOS keeps the amortization schedule and the year-end 1099-INT totals, and Pax prepares each borrower payment reminder for your tap."
          cta={{
            label: "Import notes",
            onClick: () => setIsImportOpen(true),
            "data-testid": "notes-import",
          }}
          actionIcon={Upload}
          tips={[
            "Import an existing portfolio by CSV — your column headers are matched automatically, and you review the mapping before anything is saved.",
            "Every payment you post rolls into that year's interest totals — generate the 1099-INTs from Tax readiness when it's time.",
          ]}
          testId="notes-empty-state"
        />
      ) : (
        <Card className="overflow-hidden">
          {/* Mobile: stacked note cards — the 5-column table side-scrolls at
              phone widths. md+ renders the full table below. */}
          <ul className="md:hidden divide-y divide-border" data-testid="list-notes-mobile">
            {notes.map((note) => (
              <li key={note.id}>
                <button
                  type="button"
                  onClick={() => navigate(`/notes/${note.id}`)}
                  className="w-full text-left px-4 py-3 hover-elevate active:bg-muted/30"
                  data-testid={`notes-card-${note.id}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium truncate">{note.payerName}</div>
                      <div className="text-xs text-muted-foreground truncate">
                        {note.noteNumber}
                        {note.payerAddress?.city && note.payerAddress?.state
                          ? ` · ${note.payerAddress.city}, ${note.payerAddress.state}`
                          : ""}
                      </div>
                    </div>
                    <div className="font-mono font-medium tabular-nums shrink-0">
                      {fmtUsd(note.currentBalanceCents)}
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-3 mt-2">
                    <StatusBadge
                      status={statusKindFor(note.status)}
                      label={statusLabel(note.status)}
                      size="sm"
                    />
                    <DelinquencyChip
                      status={note.delinquencyStatus}
                      days={note.daysDelinquent}
                      nextPaymentDate={note.nextPaymentDate}
                      nextPaymentDateReason={note.nextPaymentDateReason}
                      testId={`notes-aging-mobile-${note.id}`}
                    />
                  </div>
                  <div className="mt-2 text-xs">
                    {note.nextPaymentDate ? (
                      <span
                        className={`tabular-nums ${note.daysDelinquent > 0 ? "text-acr-neg font-medium" : "text-muted-foreground"}`}
                      >
                        Next payment {formatDate(note.nextPaymentDate)}
                        {note.paidThroughDate
                          ? ` · paid through ${formatDate(note.paidThroughDate)}`
                          : ""}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">
                        Next payment not on file — {nullDueCopy(note.nextPaymentDateReason)}
                        {note.nextPaymentDateReason !== "paid_through_maturity"
                          ? ` ${AGING_UNKNOWN_ACTION}`
                          : ""}
                      </span>
                    )}
                  </div>
                </button>
              </li>
            ))}
          </ul>

          {/* Desktop: full table. Hidden on mobile. */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-muted-foreground text-xs uppercase tracking-wide">
                <tr>
                  <th className="text-left px-4 py-3 font-medium">Note #</th>
                  <th className="text-left px-4 py-3 font-medium">Payer</th>
                  <th className="text-right px-4 py-3 font-medium">Balance</th>
                  <th className="text-left px-4 py-3 font-medium">Next payment</th>
                  <th className="text-left px-4 py-3 font-medium">Days late</th>
                  <th className="text-left px-4 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {notes.map((note) => (
                  <tr
                    key={note.id}
                    className="border-t border-border hover:bg-muted/30 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                    tabIndex={0}
                    role="link"
                    aria-label={`Open note ${note.noteNumber} for ${note.payerName}`}
                    onClick={() => navigate(`/notes/${note.id}`)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        navigate(`/notes/${note.id}`);
                      }
                    }}
                    data-testid={`notes-row-${note.id}`}
                  >
                    <td className="px-4 py-3 font-medium">{note.noteNumber}</td>
                    <td className="px-4 py-3">
                      <div className="font-medium">{note.payerName}</div>
                      {note.payerAddress?.city && note.payerAddress?.state && (
                        <div className="text-xs text-muted-foreground">
                          {note.payerAddress.city}, {note.payerAddress.state}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {fmtUsd(note.currentBalanceCents)}
                    </td>
                    <td className="px-4 py-3 tabular-nums">
                      <NextPaymentCell note={note} />
                    </td>
                    <td className="px-4 py-3">
                      <DelinquencyChip
                        status={note.delinquencyStatus}
                        days={note.daysDelinquent}
                        nextPaymentDate={note.nextPaymentDate}
                        nextPaymentDateReason={note.nextPaymentDateReason}
                        testId={`notes-aging-${note.id}`}
                      />
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge
                        status={statusKindFor(note.status)}
                        label={statusLabel(note.status)}
                        size="sm"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </PageShell>
  );
}
