import { useMemo } from "react";
import { Link } from "wouter";
import { motion } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { BookOpen, ArrowDownLeft, ArrowUpRight, ExternalLink } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { QueryErrorState } from "@/components/query-error-state";
import { STALE_TIMES, CACHE_TIMES } from "@/lib/queryClient";
import { staggerContainer, staggerItem } from "@/lib/animations";
import { usd } from "@/lib/format";
import type { Note, Lead, Property, Payment } from "@shared/schema";

type NoteWithDetails = Note & {
  borrower?: Lead;
  property?: Property;
};

/**
 * A single line in the running register. "credit" = money received by the
 * operator (payments in, down payments); "debit" would be money out (draws,
 * expenses). AcreOS's current finance surface only sources cash-in events
 * (payments + note originations), so every honest line here is a credit. We
 * keep the debit column present-but-empty rather than fabricating a draw
 * ledger that the data does not back — see the "not tracked yet" footnote.
 */
interface BookEntry {
  id: string;
  date: Date;
  description: string;
  /** Money in. Null when this row is not a credit. */
  credit: number | null;
  /** Money out. Always null today — no draw/expense source exists. */
  debit: number | null;
  /** Optional cross-link to the originating note. */
  noteId?: number | null;
  /** Optional cross-link to the originating deal (via the note). */
  dealId?: number | null;
  /** Sub-label, e.g. principal/interest split or the borrower name. */
  detail?: string;
}

interface FinanceBookProps {
  /** Notes already enriched with borrower + property on the parent page. */
  notes: NoteWithDetails[];
}

/**
 * Finance "Book" — a read-only, double-entry-style running register of the
 * cash events the Finance surface already knows about. It is NOT a new server
 * endpoint: it composes the existing org-wide payments query with the notes
 * the page already holds. Money figures trace to real records; where a class
 * of entry (operator draws, expenses) has no backing data, we show an honest
 * "not tracked yet" note instead of inventing debits.
 */
export function FinanceBook({ notes }: FinanceBookProps) {
  // Org-wide payments: GET /api/payments with no noteId returns every payment
  // for the org (see server/routes-finance.ts). We can't reuse usePayments here
  // because that hook is `enabled` only when a noteId is supplied — so we read
  // the same endpoint directly under a distinct, stable query key.
  const {
    data: payments,
    isLoading,
    error,
    refetch,
  } = useQuery<Payment[]>({
    queryKey: ["/api/payments", "all"],
    queryFn: async () => {
      const res = await fetch("/api/payments", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch payments");
      return res.json();
    },
    staleTime: STALE_TIMES.short,
    gcTime: CACHE_TIMES.medium,
  });

  const noteById = useMemo(() => {
    const map = new Map<number, NoteWithDetails>();
    for (const n of notes) map.set(n.id, n);
    return map;
  }, [notes]);

  const entries = useMemo<BookEntry[]>(() => {
    const rows: BookEntry[] = [];

    // 1) Down payments received at origination. Honest only when the note
    //    flags the down payment as actually received — an unreceived
    //    downPayment field is a term, not a cash event.
    for (const note of notes) {
      const dp = Number(note.downPayment || 0);
      if (note.downPaymentReceived && dp > 0) {
        const borrowerName = note.borrower
          ? `${note.borrower.firstName} ${note.borrower.lastName}`
          : note.borrowerId
            ? `Borrower #${note.borrowerId}`
            : "borrower";
        rows.push({
          id: `dp-${note.id}`,
          // Down payments don't carry their own timestamp in this data;
          // the note start date is the closest honest anchor.
          date: new Date(note.startDate),
          description: `Down payment — Note #${note.id}`,
          detail: `from ${borrowerName}`,
          credit: dp,
          debit: null,
          noteId: note.id,
          dealId: note.originatingDealId ?? null,
        });
      }
    }

    // 2) Completed payments. Each is a credit; the principal/interest/fee
    //    split is surfaced as the row detail. Pending/failed payments are
    //    excluded so the running balance reflects settled cash only.
    for (const p of payments || []) {
      if (p.status !== "completed") continue;
      const note = p.noteId != null ? noteById.get(p.noteId) : undefined;
      const borrowerName = note?.borrower
        ? `${note.borrower.firstName} ${note.borrower.lastName}`
        : note?.borrowerId
          ? `Borrower #${note.borrowerId}`
          : null;
      const principal = Number(p.principalAmount || 0);
      const interest = Number(p.interestAmount || 0);
      const fee = Number(p.feeAmount || 0) + Number(p.lateFeeAmount || 0);
      const split = [
        principal > 0 ? `${usd(principal)} principal` : null,
        interest > 0 ? `${usd(interest)} interest` : null,
        fee > 0 ? `${usd(fee)} fees` : null,
      ]
        .filter(Boolean)
        .join(" · ");
      rows.push({
        id: `pmt-${p.id}`,
        date: new Date(p.paymentDate),
        description: p.noteId != null ? `Payment — Note #${p.noteId}` : "Payment",
        detail: [borrowerName, split].filter(Boolean).join(" — ") || undefined,
        credit: Number(p.amount || 0),
        debit: null,
        noteId: p.noteId ?? null,
        dealId: note?.originatingDealId ?? null,
      });
    }

    // Chronological order — oldest first so the running balance reads like a
    // real ledger top-to-bottom.
    rows.sort((a, b) => a.date.getTime() - b.date.getTime());
    return rows;
  }, [notes, payments, noteById]);

  // Running balance accumulates credits and subtracts debits (debits are
  // always 0 today, but the arithmetic is correct the moment a draw source
  // lands).
  const withRunningBalance = useMemo(() => {
    let balance = 0;
    return entries.map((e) => {
      balance += (e.credit ?? 0) - (e.debit ?? 0);
      return { ...e, balance };
    });
  }, [entries]);

  const totalCredits = entries.reduce((s, e) => s + (e.credit ?? 0), 0);
  const totalDebits = entries.reduce((s, e) => s + (e.debit ?? 0), 0);
  const netBalance = totalCredits - totalDebits;

  return (
    <Card className="floating-window overflow-hidden">
      <CardHeader className="pb-4">
        <CardTitle className="acr-section-h2 text-section-h2 flex items-center gap-2">
          <BookOpen className="w-5 h-5 text-primary" aria-hidden="true" />
          The Book
        </CardTitle>
        <CardDescription>
          A running register of settled cash events — down payments and
          completed payments, oldest first, with a live balance. Read-only.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        {error ? (
          <div className="p-4">
            <QueryErrorState
              error={error}
              onRetry={() => refetch()}
              title="Failed to load the book"
              compact
            />
          </div>
        ) : isLoading ? (
          <div className="space-y-2 p-4" aria-busy="true" aria-label="Loading the book">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="h-4 w-20" announce={i === 0} announceText="Loading the book" />
                <Skeleton className="h-4 flex-1" announce={false} />
                <Skeleton className="h-4 w-20" announce={false} />
                <Skeleton className="h-4 w-24" announce={false} />
              </div>
            ))}
          </div>
        ) : withRunningBalance.length === 0 ? (
          <EmptyState
            icon={BookOpen}
            headline="No entries in the book yet"
            subtitle="The book fills in as cash moves — record a payment or close a seller-financed deal and the first line posts here automatically."
            cta={{ label: "", _noOp: true }}
            // TODO(cta): the book is a derived read-only view; the actionable
            // CTAs (record payment, create note) live on the Portfolio tab.
            actionIcon={null}
            testId="finance-book-empty"
          />
        ) : (
          <>
            {/* Summary strip — every figure traces to the rows below. */}
            <dl className="grid grid-cols-2 sm:grid-cols-3 gap-px bg-border border-b">
              <div className="bg-card p-4">
                <dt className="text-xs text-muted-foreground">Total credits (in)</dt>
                <dd className="text-lg font-bold font-mono tabular-nums text-acr-pos" data-testid="book-total-credits">
                  {usd(totalCredits)}
                </dd>
              </div>
              <div className="bg-card p-4">
                <dt className="text-xs text-muted-foreground">Total debits (out)</dt>
                <dd className="text-lg font-bold font-mono tabular-nums text-muted-foreground" data-testid="book-total-debits">
                  {usd(totalDebits)}
                </dd>
              </div>
              <div className="bg-card p-4 col-span-2 sm:col-span-1">
                <dt className="text-xs text-muted-foreground">Running balance</dt>
                <dd className="text-lg font-bold font-mono tabular-nums" data-testid="book-net-balance">
                  {usd(netBalance)}
                </dd>
              </div>
            </dl>

            {/* Mobile: stacked register cards. The 5-column ledger is
                unreadable at 375px, so each entry stacks. */}
            <motion.ul
              className="md:hidden divide-y divide-border"
              variants={staggerContainer}
              initial="hidden"
              animate="visible"
              data-testid="list-book-mobile"
            >
              {withRunningBalance.map((e) => (
                <motion.li key={e.id} variants={staggerItem} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        {e.credit != null ? (
                          <ArrowDownLeft className="w-4 h-4 text-acr-pos shrink-0" aria-hidden="true" />
                        ) : (
                          <ArrowUpRight className="w-4 h-4 text-muted-foreground shrink-0" aria-hidden="true" />
                        )}
                        <span className="font-medium truncate">{e.description}</span>
                      </div>
                      {e.detail && (
                        <p className="text-sm text-muted-foreground mt-1 truncate">{e.detail}</p>
                      )}
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-xs text-muted-foreground tabular-nums">
                          {format(e.date, "MMM d, yyyy")}
                        </span>
                        <CrossLinks noteId={e.noteId} dealId={e.dealId} />
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      {e.credit != null && (
                        <div className="font-mono font-semibold tabular-nums text-acr-pos">
                          +{usd(e.credit)}
                        </div>
                      )}
                      {e.debit != null && (
                        <div className="font-mono font-semibold tabular-nums text-acr-neg">
                          &minus;{usd(e.debit)}
                        </div>
                      )}
                      <div className="font-mono text-xs text-muted-foreground tabular-nums mt-0.5">
                        {usd(e.balance)}
                      </div>
                    </div>
                  </div>
                </motion.li>
              ))}
            </motion.ul>

            {/* Desktop: full ledger table. */}
            <div className="hidden md:block overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/30">
                    <TableHead className="min-w-[100px]">Date</TableHead>
                    <TableHead className="min-w-[220px]">Description</TableHead>
                    <TableHead className="text-right min-w-[90px]">Debit</TableHead>
                    <TableHead className="text-right min-w-[90px]">Credit</TableHead>
                    <TableHead className="text-right min-w-[100px]">Balance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {withRunningBalance.map((e) => (
                    <TableRow key={e.id} data-testid={`row-book-${e.id}`}>
                      <TableCell className="tabular-nums text-muted-foreground">
                        {format(e.date, "MMM d, yyyy")}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {e.credit != null ? (
                            <ArrowDownLeft className="w-4 h-4 text-acr-pos shrink-0" aria-hidden="true" />
                          ) : (
                            <ArrowUpRight className="w-4 h-4 text-muted-foreground shrink-0" aria-hidden="true" />
                          )}
                          <span className="font-medium">{e.description}</span>
                          <CrossLinks noteId={e.noteId} dealId={e.dealId} />
                        </div>
                        {e.detail && (
                          <p className="text-xs text-muted-foreground mt-0.5 ml-6">{e.detail}</p>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums text-muted-foreground">
                        {e.debit != null ? usd(e.debit) : "—"}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums text-acr-pos">
                        {e.credit != null ? usd(e.credit) : "—"}
                      </TableCell>
                      <TableCell className="text-right font-mono font-medium tabular-nums">
                        {usd(e.balance)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* Honesty footnote — the book is cash-in only today. We say so
                rather than implying the debit column is structurally empty
                because the operator has had zero outflows. */}
            <p className="px-4 py-3 text-xs text-muted-foreground border-t">
              Draws, servicing costs, and other outflows aren&apos;t tracked as
              ledger debits yet — this book records settled cash received. The
              debit column is reserved for when that data lands.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Renders a cross-link chip for an entry: when the note was carried from a
 * closed deal, "from Deal #Y" links across the customer doors. Omits
 * gracefully when the relationship field is absent.
 */
function CrossLinks({ noteId, dealId }: { noteId?: number | null; dealId?: number | null }) {
  void noteId; // reserved — note-level cross-link surfaces on the Portfolio tab
  if (dealId == null) return null;
  return (
    <Link href={`/deals/${dealId}`}>
      <Badge
        variant="outline"
        className="gap-1 cursor-pointer hover-elevate text-[11px] font-normal"
        data-testid={`chip-deal-${dealId}`}
      >
        <ExternalLink className="w-3 h-3" aria-hidden="true" />
        from Deal #{dealId}
      </Badge>
    </Link>
  );
}
