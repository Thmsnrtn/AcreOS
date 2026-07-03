/**
 * /notes — Note Investor vertical primary list (Phase 5 §5).
 *
 * Lists acquired notes for the org with status pills, a status filter, and
 * per-row payer / balance / next payment / status. Foundation surface —
 * the BPO + tape diligence + Sophie agent expansion ride a follow-up PR
 * (see docs/exhaustive-completion/note-investor-followups.md).
 *
 * Loading state uses Skeleton matching the table shape (per UI patterns
 * in CLAUDE.md). Empty state uses the canonical EmptyState with a
 * purposeful CTA. Errors use QueryErrorState — but since one isn't
 * exported here yet, we render an inline message that follows the same
 * tone.
 */

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import { FileText, Filter, Upload } from "lucide-react";
import { PageShell } from "@/components/page-shell";
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
import { NotesImportDialog } from "@/components/notes-import-dialog";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useOrganization } from "@/hooks/use-organization";
import { getTerm, personaForInvestorType } from "@/lib/personaVocabulary";
import { Verbs } from "@/lib/labels";

// Shape returned by GET /api/notes (mirrors acquiredNotes minus the encrypted TIN).
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
}

interface NotesListResponse {
  notes: AcquiredNoteRow[];
  limit: number;
  offset: number;
  count: number;
}

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

function nextPaymentLabel(note: AcquiredNoteRow): string {
  // Next due date = today's month (or next month if we're past the
  // due-day) on note.paymentDueDay, clamped to the month's last day.
  const now = new Date();
  const day = note.paymentDueDay;
  const candidate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const lastDay = new Date(
    Date.UTC(candidate.getUTCFullYear(), candidate.getUTCMonth() + 1, 0),
  ).getUTCDate();
  candidate.setUTCDate(Math.min(day, lastDay));
  if (candidate.getTime() < now.getTime()) {
    candidate.setUTCMonth(candidate.getUTCMonth() + 1);
    const lastDayNext = new Date(
      Date.UTC(candidate.getUTCFullYear(), candidate.getUTCMonth() + 1, 0),
    ).getUTCDate();
    candidate.setUTCDate(Math.min(day, lastDayNext));
  }
  return candidate.toISOString().slice(0, 10);
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

  const { data, isLoading, isError, refetch } = useQuery<NotesListResponse>({
    queryKey: ["/api/notes", statusFilter],
    queryFn: async () => {
      const res = await fetch(`/api/notes?${queryParams.toString()}`, {
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
            Mortgage notes and seller-financed paper you've acquired. Track
            performing / late / default status and record payments.
          </p>
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
                <Skeleton className="h-5 w-20 ml-auto" />
              </div>
            ))}
          </div>
        </Card>
      ) : isError ? (
        <Card className="p-8 text-center">
          <p className="text-sm text-muted-foreground mb-4">
            Couldn't load notes. Please try again.
          </p>
          <Button variant="outline" onClick={() => refetch()} data-testid="notes-retry-button">
            {Verbs.RETRY}
          </Button>
        </Card>
      ) : notes.length === 0 ? (
        <EmptyState
          icon={FileText}
          headline="No notes serviced yet"
          subtitle="Originate or import a note — Pax handles the periodic statements, dunning on day 11, and the 1099-NEC at year-end."
          cta={{
            label: "Import notes",
            onClick: () => setIsImportOpen(true),
            "data-testid": "notes-import",
          }}
          actionIcon={Upload}
          tips={[
            "Import an existing portfolio via CSV — Pax column-maps it to acquired_notes inside 90 seconds.",
            "Pax feeds each payment into the annual 1099-INT batch the moment it posts.",
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
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {note.status === "paid_off" || note.status === "sold"
                        ? "—"
                        : nextPaymentLabel(note)}
                    </span>
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
                  <th className="text-left px-4 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {notes.map((note) => (
                  <tr
                    key={note.id}
                    className="border-t border-border hover:bg-muted/30 transition-colors cursor-pointer"
                    onClick={() => navigate(`/notes/${note.id}`)}
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
                    <td className="px-4 py-3 tabular-nums text-muted-foreground">
                      {note.status === "paid_off" || note.status === "sold"
                        ? "—"
                        : nextPaymentLabel(note)}
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
