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

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { FileText, Filter, Plus } from "lucide-react";
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
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useOrganization } from "@/hooks/use-organization";
import { getTerm, personaForInvestorType } from "@/lib/personaVocabulary";

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

function fmtUsd(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(Math.round(cents / 100));
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
            onClick={() => navigate("/notes?action=new")}
            data-testid="notes-add-button"
          >
            <Plus className="w-4 h-4 mr-1" aria-hidden="true" />
            Add note
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
            Retry
          </Button>
        </Card>
      ) : notes.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="No notes yet"
          description="Acquired notes you import or add will appear here. Track payer, balance, status, and next-payment in one place."
          actionLabel="Add a note"
          onAction={() => navigate("/notes?action=new")}
          actionIcon={Plus}
          tips={[
            "Import an existing portfolio via CSV — column-mapped to acquired_notes.",
            "Each payment recorded feeds your annual 1099-INT batch automatically.",
          ]}
          testId="notes-empty-state"
        />
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
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
