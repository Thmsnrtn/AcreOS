/**
 * Recorded payoff quotes — the Finance-door affordance that issues the
 * payoff-quote PDF.
 *
 * Lives on /notes/:id, which sits BEHIND the Finance door (Finance → Notes →
 * a note). No new nav entry: the five customer doors are unchanged.
 *
 * WHY THIS SITS NEXT TO THE CALCULATOR AND IS NOT THE CALCULATOR
 * -------------------------------------------------------------
 * `NotePayoffCalculator` answers "what's my payoff if I close Friday?" — it
 * recomputes on every date change and records nothing. That is the right tool
 * for a phone call and the wrong tool for a closing: a figure a closer wires
 * against has to still exist, unchanged, after the loan takes another payment.
 *
 * So this card does two distinct things and keeps them visibly distinct:
 *   * ISSUE — POST /api/notes/:id/payoff/quotes, which computes through the
 *     one payoff engine and FREEZES the result (inputs and output) into
 *     `note_payoff_quotes`.
 *   * RENDER — GET /api/note-payoff-quotes/:quoteId/pdf, which reproduces a
 *     frozen row as a PDF and never recomputes anything.
 *
 * The download therefore always matches the row that was issued, even after
 * the loan moves. The copy says so, because an operator who believes the PDF
 * refreshes will hand a stale figure to a title company and think it is live.
 */

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { FileText, Download, Plus, AlertCircle, Loader2 } from "lucide-react";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/empty-state";
import { QueryErrorState } from "@/components/query-error-state";
import { RequiredDisclaimer } from "@/components/required-disclaimer";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { formatDateTime } from "@/lib/format";
import { Verbs } from "@/lib/labels";

/** The frozen row, exactly as `note_payoff_quotes` stores it. */
interface PayoffQuoteRow {
  id: string;
  noteSystem: string;
  noteRef: string;
  noteNumber: string | null;
  payerName: string | null;
  quotedByUserId: string | null;
  channel: string;
  quotedAt: string;
  payoffDate: string;
  goodThroughDate: string;
  principalBalanceCents: number;
  annualRateBpsHundredths: number;
  accrualStartDate: string;
  daysAccrued: number;
  dayCountConvention: string;
  perDiemInterestCents: number;
  accruedInterestCents: number;
  unappliedCreditCents: number;
  lateFeesOutstandingCents: number;
  payoffFeeCents: number;
  totalPayoffCents: number;
  engineVersion: string;
  notes: string | null;
}

function fmtUsd(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

/** `YYYY-MM-DD` → "Aug 14, 2026" without a timezone-shifting Date round-trip. */
function fmtIsoDate(iso: string): string {
  const [y, m, d] = (iso ?? "").split("-");
  if (!y || !m || !d) return iso ?? "—";
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[Number(m) - 1] ?? m} ${Number(d)}, ${y}`;
}

function csrf(): string {
  const raw = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/)?.[1] || "";
  return decodeURIComponent(raw);
}

export function NotePayoffQuotesCard({ noteId }: { noteId: string }) {
  const { toast } = useToast();
  const [issueOpen, setIssueOpen] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery<{
    quotes: PayoffQuoteRow[];
  }>({
    queryKey: ["/api/notes", noteId, "payoff", "quotes"],
    queryFn: async () => {
      const res = await fetch(`/api/notes/${noteId}/payoff/quotes`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`${res.status}: Couldn't load recorded payoff quotes`);
      return res.json();
    },
  });

  const quotes = data?.quotes ?? [];

  /**
   * Fetch the artifact as a blob rather than navigating to the URL: the route
   * refuses (400) when a stored row is missing a figure a payoff statement must
   * state, and a plain link would drop the operator on a raw JSON error page
   * instead of telling them the quote is unusable.
   */
  async function downloadPdf(quote: PayoffQuoteRow) {
    setDownloading(quote.id);
    try {
      const res = await fetch(`/api/note-payoff-quotes/${quote.id}/pdf`, {
        credentials: "include",
      });
      if (!res.ok) {
        let message = `Couldn't produce the payoff statement (${res.status}).`;
        try {
          const body = await res.json();
          if (body?.message) message = body.message;
        } catch {
          /* non-JSON error body — keep the status message */
        }
        toast({ title: "No statement produced", description: message, variant: "destructive" });
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `payoff-quote-${quote.id}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast({
        title: "Download failed",
        description: err instanceof Error ? err.message : "Try again.",
        variant: "destructive",
      });
    } finally {
      setDownloading(null);
    }
  }

  return (
    <Card className="mb-6">
      <div className="p-5">
        <div className="flex items-center justify-between mb-3 gap-3">
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-primary" aria-hidden="true" />
            <h2 className="text-sm font-semibold">Payoff statements</h2>
          </div>
          <Button
            size="sm"
            onClick={() => setIssueOpen(true)}
            data-testid="issue-payoff-quote-button"
          >
            <Plus className="w-3.5 h-3.5 mr-1" aria-hidden="true" />
            Issue quote
          </Button>
        </div>
        <Separator className="mb-3" />

        {isLoading ? (
          <div className="space-y-2" data-testid="payoff-quotes-loading">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : isError ? (
          <QueryErrorState
            error={error instanceof Error ? error : null}
            onRetry={() => void refetch()}
            isRetrying={isFetching}
            compact
            title="Couldn't load recorded quotes"
            testId="payoff-quotes-error"
          />
        ) : quotes.length === 0 ? (
          <EmptyState
            icon={FileText}
            headline="No payoff statement issued yet"
            subtitle="A quote freezes the figure and its inputs, so the number on the PDF stays the number you quoted even after this loan takes another payment."
            cta={{
              label: "Issue quote",
              onClick: () => setIssueOpen(true),
              "data-testid": "issue-payoff-quote-empty-cta",
            }}
            testId="payoff-quotes-empty"
          />
        ) : (
          <ul className="space-y-2" data-testid="payoff-quotes-list">
            {quotes.map((q) => (
              <li
                key={q.id}
                className="flex items-start justify-between gap-3 rounded-md border border-border px-3 py-2"
                data-testid={`payoff-quote-${q.id}`}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold">{fmtUsd(q.totalPayoffCents)}</span>
                    <span className="text-xs text-muted-foreground">
                      good through {fmtIsoDate(q.goodThroughDate)}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {fmtUsd(q.perDiemInterestCents)}/day thereafter · {q.daysAccrued}{" "}
                    {q.daysAccrued === 1 ? "day" : "days"} accrued from{" "}
                    {fmtIsoDate(q.accrualStartDate)} · {q.dayCountConvention}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5 font-mono truncate">
                    {q.id}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    Issued {formatDateTime(q.quotedAt)} · {q.engineVersion}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void downloadPdf(q)}
                  disabled={downloading === q.id}
                  aria-label={`Download payoff statement PDF for quote ${q.id}`}
                  data-testid={`download-payoff-quote-${q.id}`}
                >
                  {downloading === q.id ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                  ) : (
                    <Download className="w-3.5 h-3.5" aria-hidden="true" />
                  )}
                  <span className="ml-1">PDF</span>
                </Button>
              </li>
            ))}
          </ul>
        )}

        <p className="text-xs text-muted-foreground mt-4 flex items-start gap-1.5">
          <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden="true" />
          <span>
            The PDF reproduces the quote as it was recorded — it does not recompute.
            Payments or rate changes made after a quote was issued do not alter its
            statement; issue a new quote to reflect them.
          </span>
        </p>

        <RequiredDisclaimer type="worksheet" className="mt-3" />
      </div>

      <IssuePayoffQuoteDialog open={issueOpen} onOpenChange={setIssueOpen} noteId={noteId} />
    </Card>
  );
}

function IssuePayoffQuoteDialog({
  open,
  onOpenChange,
  noteId,
}: {
  open: boolean;
  onOpenChange: (b: boolean) => void;
  noteId: string;
}) {
  const { toast } = useToast();
  const [payoffDate, setPayoffDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [payoffFee, setPayoffFee] = useState("");
  const [notes, setNotes] = useState("");

  const issueMutation = useMutation({
    mutationFn: async () => {
      // The fee is org policy, never assumed: an empty box means "no fee was
      // charged", which is a decision the operator makes, not a default the
      // client invents. Blank sends nothing and the server records 0.
      const trimmedFee = payoffFee.trim();
      const feeCents =
        trimmedFee === "" ? undefined : Math.round(Number(trimmedFee) * 100);
      if (feeCents !== undefined && (!Number.isFinite(feeCents) || feeCents < 0)) {
        throw new Error("Payoff fee must be a non-negative dollar amount");
      }
      const res = await fetch(`/api/notes/${noteId}/payoff/quotes`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", "x-csrf-token": csrf() },
        body: JSON.stringify({
          payoffDate,
          ...(feeCents !== undefined ? { payoffFeeCents: feeCents } : {}),
          ...(notes.trim() ? { notes: notes.trim() } : {}),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.message ?? `Couldn't issue the quote (${res.status})`);
      }
      return res.json();
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["/api/notes", noteId, "payoff", "quotes"] });
      toast({
        title: "Payoff quote recorded",
        description: "The figure and its inputs are frozen. Download the statement to send it on.",
      });
      setPayoffFee("");
      setNotes("");
      onOpenChange(false);
    },
    onError: (err: Error) => {
      toast({ title: "Quote not issued", description: err.message, variant: "destructive" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Issue a payoff quote</DialogTitle>
          <DialogDescription>
            Computes the payoff from the live ledger and records it permanently. The
            recorded figure is what the PDF will state, whatever happens to the loan
            afterwards.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="issue-payoff-date">Payoff date (funds good through)</Label>
            <Input
              id="issue-payoff-date"
              type="date"
              value={payoffDate}
              onChange={(e) => setPayoffDate(e.target.value)}
              data-testid="issue-payoff-date"
            />
            <p className="text-xs text-muted-foreground">
              Interest accrues through this date. Past it, the quote costs its per-diem
              per additional day.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="issue-payoff-fee">Payoff / processing fee (optional)</Label>
            <Input
              id="issue-payoff-fee"
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              placeholder="0.00"
              value={payoffFee}
              onChange={(e) => setPayoffFee(e.target.value)}
              data-testid="issue-payoff-fee"
            />
            <p className="text-xs text-muted-foreground">
              Leave blank if your note charges none — nothing is assumed.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="issue-payoff-notes">Notes (optional)</Label>
            <Textarea
              id="issue-payoff-notes"
              rows={2}
              placeholder="Who requested it and why — rides on the statement."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              data-testid="issue-payoff-notes"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} type="button">
            {Verbs.CANCEL}
          </Button>
          <Button
            onClick={() => issueMutation.mutate()}
            disabled={issueMutation.isPending || !payoffDate}
            data-testid="confirm-issue-payoff-quote"
          >
            {issueMutation.isPending ? (
              <>
                <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" aria-hidden="true" />
                Recording…
              </>
            ) : (
              "Issue quote"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
