/**
 * Record-payment modal for the acquired-note detail page.
 *
 * Implements the full ledger-discipline matrix from the Linnea persona
 * walkthrough: regular / partial / extra-principal / payoff / NSF-reversal
 * / apply-held-funds. Each type has its own input shape — partial sends
 * everything to unapplied, extra-principal is principal-only, payoff
 * preflights the per-diem calculator, etc.
 *
 * Cents are entered as dollars in the UI (Linnea: "I'm typing payments,
 * not cents") and converted just before POST.
 */

import { useState, useMemo } from "react";
import { useMutation } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { AcquiredNote, NotePaymentType } from "@/pages/note-detail";
import { Verbs } from "@/lib/labels";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  note: AcquiredNote;
}

const TYPE_OPTIONS: Array<{ value: NotePaymentType; label: string; help: string }> = [
  {
    value: "regular",
    label: "Regular payment",
    help: "Standard P&I payment. Splits per amort schedule.",
  },
  {
    value: "partial",
    label: "Partial — held in unapplied",
    help: "Borrower sent less than P&I. Funds sit in unapplied until the next deposit makes them whole.",
  },
  {
    value: "extra_principal",
    label: "Extra principal (curtailment)",
    help: "Earmarked principal-only. Doesn't advance the next payment date.",
  },
  {
    value: "payoff",
    label: "Payoff",
    help: "Final settle. Use the payoff calculator first to compute per-diem accurately.",
  },
  {
    value: "unapplied_apply",
    label: "Apply held funds",
    help: "Consume previously held unapplied funds toward a regular payment.",
  },
  {
    value: "nsf_reversal",
    label: "NSF reversal (bounced payment)",
    help: "Back out a previously recorded payment. Requires the original payment ID.",
  },
];

function dollarsToCents(s: string): number {
  if (!s) return 0;
  const n = parseFloat(s.replace(/[$,\s]/g, ""));
  if (!isFinite(n)) return 0;
  return Math.round(n * 100);
}

export function NoteRecordPaymentModal({ open, onOpenChange, note }: Props) {
  const { toast } = useToast();
  const [paymentType, setPaymentType] = useState<NotePaymentType>("regular");
  const [paymentDate, setPaymentDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [paymentMethod, setPaymentMethod] = useState<"ach" | "check" | "wire" | "cash" | "other">("ach");
  const [referenceNumber, setReferenceNumber] = useState("");
  const [paymentNotes, setPaymentNotes] = useState("");
  const [originalPaymentId, setOriginalPaymentId] = useState("");

  // Per-bucket dollar inputs
  const [principalDollars, setPrincipalDollars] = useState("");
  const [interestDollars, setInterestDollars] = useState("");
  const [escrowDollars, setEscrowDollars] = useState("");
  const [lateFeeDollars, setLateFeeDollars] = useState("");
  const [partialDollars, setPartialDollars] = useState("");
  const [unappliedApplyDollars, setUnappliedApplyDollars] = useState("");

  const reset = () => {
    setPaymentType("regular");
    setPaymentDate(new Date().toISOString().slice(0, 10));
    setPaymentMethod("ach");
    setReferenceNumber("");
    setPaymentNotes("");
    setOriginalPaymentId("");
    setPrincipalDollars("");
    setInterestDollars("");
    setEscrowDollars("");
    setLateFeeDollars("");
    setPartialDollars("");
    setUnappliedApplyDollars("");
  };

  const handleClose = () => {
    reset();
    onOpenChange(false);
  };

  const typeMeta = useMemo(
    () => TYPE_OPTIONS.find((t) => t.value === paymentType)!,
    [paymentType],
  );

  // Derived totals — Linnea's #1 trust ask: "show me what I'm about to
  // commit before I commit it." We compute the gross cash applied, the
  // delta to current balance, and the delta to unapplied so a payment
  // operator can sanity-check before clicking Record.
  const preview = useMemo(() => {
    const principal = dollarsToCents(principalDollars);
    const interest = dollarsToCents(interestDollars);
    const escrow = dollarsToCents(escrowDollars);
    const lateFee = dollarsToCents(lateFeeDollars);
    const partial = dollarsToCents(partialDollars);
    const apply = dollarsToCents(unappliedApplyDollars);

    let principalApplied = 0;
    let unappliedDelta = 0;
    let grossCash = 0;

    if (paymentType === "partial") {
      grossCash = partial;
      unappliedDelta = partial;
    } else if (paymentType === "unapplied_apply") {
      principalApplied = principal;
      unappliedDelta = -apply;
      grossCash = 0;
    } else if (paymentType === "extra_principal") {
      principalApplied = principal;
      grossCash = principal;
    } else if (paymentType === "nsf_reversal") {
      principalApplied = -principal;
      grossCash = -(principal + interest + escrow + lateFee);
    } else {
      // regular | payoff
      principalApplied = principal;
      grossCash = principal + interest + escrow + lateFee;
    }

    const newCurrentBalance = Math.max(
      0,
      (note.currentBalanceCents ?? 0) - principalApplied,
    );
    const newUnappliedBalance = Math.max(
      0,
      (note.unappliedBalanceCents ?? 0) + unappliedDelta,
    );

    // Validation flags — surface to user, not just block the submit.
    const exceedsUnapplied =
      paymentType === "unapplied_apply" &&
      apply > (note.unappliedBalanceCents ?? 0);
    const exceedsBalance =
      principalApplied > (note.currentBalanceCents ?? 0) &&
      paymentType !== "nsf_reversal";
    const payoffMismatch =
      paymentType === "payoff" &&
      principal > 0 &&
      principal !== (note.currentBalanceCents ?? 0);
    const noteAlreadyPaidOff =
      (note.status === "paid_off" || note.status === "sold") &&
      paymentType !== "nsf_reversal";
    const everythingZero =
      grossCash === 0 && unappliedDelta === 0 && principalApplied === 0;

    return {
      principal,
      interest,
      escrow,
      lateFee,
      grossCash,
      principalApplied,
      unappliedDelta,
      newCurrentBalance,
      newUnappliedBalance,
      exceedsUnapplied,
      exceedsBalance,
      payoffMismatch,
      noteAlreadyPaidOff,
      everythingZero,
    };
  }, [
    paymentType,
    principalDollars,
    interestDollars,
    escrowDollars,
    lateFeeDollars,
    partialDollars,
    unappliedApplyDollars,
    note.currentBalanceCents,
    note.unappliedBalanceCents,
    note.status,
  ]);

  const submitMutation = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = {
        paymentDate,
        paymentMethod,
        paymentType,
        referenceNumber: referenceNumber || undefined,
        notes: paymentNotes || undefined,
      };

      if (paymentType === "partial") {
        body.unappliedCents = dollarsToCents(partialDollars);
      } else if (paymentType === "unapplied_apply") {
        body.unappliedCents = -dollarsToCents(unappliedApplyDollars);
        body.principalCents = dollarsToCents(principalDollars);
        body.interestCents = dollarsToCents(interestDollars);
        body.escrowCents = dollarsToCents(escrowDollars);
        body.lateFeeCents = dollarsToCents(lateFeeDollars);
      } else if (paymentType === "extra_principal") {
        body.principalCents = dollarsToCents(principalDollars);
      } else if (paymentType === "nsf_reversal") {
        // NSF reversal: invert the buckets so the user enters positive
        // dollars and we send negatives to restore balance.
        body.principalCents = -dollarsToCents(principalDollars);
        body.interestCents = -dollarsToCents(interestDollars);
        body.escrowCents = -dollarsToCents(escrowDollars);
        body.lateFeeCents = -dollarsToCents(lateFeeDollars);
        body.originalPaymentId = originalPaymentId;
      } else {
        // regular | payoff
        body.principalCents = dollarsToCents(principalDollars);
        body.interestCents = dollarsToCents(interestDollars);
        body.escrowCents = dollarsToCents(escrowDollars);
        body.lateFeeCents = dollarsToCents(lateFeeDollars);
      }

      // Route via apiRequest so we inherit:
      //   - centralized CSRF (csrf_token cookie → x-csrf-token header)
      //   - Idempotency-Key (mandatory here — every ledger write is
      //     irreversible without an explicit NSF reversal, so a
      //     mid-flight network retry must collapse to one effect)
      //   - 401 → Clerk session-touch → retry
      //   - 30s timeout + standardized error envelope parsing
      const res = await apiRequest(
        "POST",
        `/api/notes/${note.id}/payments`,
        body,
        { idempotent: true },
      );
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Payment recorded", description: `${typeMeta.label} logged.` });
      queryClient.invalidateQueries({ queryKey: ["/api/notes", note.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/notes", note.id, "payments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/notes"] });
      handleClose();
    },
    onError: (err: any) => {
      toast({ title: "Couldn't record payment", description: err.message, variant: "destructive" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Record payment</DialogTitle>
          <DialogDescription>
            Logged against note {note.noteNumber} ({note.payerName}).
            Current balance {fmtUsd(note.currentBalanceCents)}.
            {note.unappliedBalanceCents > 0 && (
              <> Unapplied funds on hand: <span className="font-semibold">{fmtUsd(note.unappliedBalanceCents)}</span>.</>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="payment-type">Type</Label>
            <Select value={paymentType} onValueChange={(v) => setPaymentType(v as NotePaymentType)}>
              <SelectTrigger id="payment-type"><SelectValue /></SelectTrigger>
              <SelectContent>
                {TYPE_OPTIONS.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{typeMeta.help}</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="payment-date">Date</Label>
              <Input
                id="payment-date"
                type="date"
                value={paymentDate}
                onChange={(e) => setPaymentDate(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="payment-method">Method</Label>
              <Select value={paymentMethod} onValueChange={(v) => setPaymentMethod(v as typeof paymentMethod)}>
                <SelectTrigger id="payment-method"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ach">ACH</SelectItem>
                  <SelectItem value="check">Check</SelectItem>
                  <SelectItem value="wire">Wire</SelectItem>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {paymentType === "partial" && (
            <div className="space-y-1.5">
              <Label htmlFor="partial">Amount (held in unapplied)</Label>
              <Input
                id="partial"
                inputMode="decimal"
                placeholder="0.00"
                value={partialDollars}
                onChange={(e) => setPartialDollars(e.target.value)}
              />
            </div>
          )}

          {paymentType === "extra_principal" && (
            <div className="space-y-1.5">
              <Label htmlFor="extra-principal">Principal (extra)</Label>
              <Input
                id="extra-principal"
                inputMode="decimal"
                placeholder="0.00"
                value={principalDollars}
                onChange={(e) => setPrincipalDollars(e.target.value)}
              />
            </div>
          )}

          {paymentType === "unapplied_apply" && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="apply-from">Amount to draw from unapplied</Label>
                <Input
                  id="apply-from"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={unappliedApplyDollars}
                  onChange={(e) => setUnappliedApplyDollars(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Available: {fmtUsd(note.unappliedBalanceCents)}
                </p>
              </div>
              <BucketsGrid
                principalDollars={principalDollars} setPrincipalDollars={setPrincipalDollars}
                interestDollars={interestDollars} setInterestDollars={setInterestDollars}
                escrowDollars={escrowDollars} setEscrowDollars={setEscrowDollars}
                lateFeeDollars={lateFeeDollars} setLateFeeDollars={setLateFeeDollars}
              />
            </>
          )}

          {(paymentType === "regular" || paymentType === "payoff" || paymentType === "nsf_reversal") && (
            <BucketsGrid
              principalDollars={principalDollars} setPrincipalDollars={setPrincipalDollars}
              interestDollars={interestDollars} setInterestDollars={setInterestDollars}
              escrowDollars={escrowDollars} setEscrowDollars={setEscrowDollars}
              lateFeeDollars={lateFeeDollars} setLateFeeDollars={setLateFeeDollars}
            />
          )}

          {paymentType === "nsf_reversal" && (
            <div className="space-y-1.5">
              <Label htmlFor="orig-id">Original payment ID</Label>
              <Input
                id="orig-id"
                placeholder="UUID of the bounced payment"
                value={originalPaymentId}
                onChange={(e) => setOriginalPaymentId(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Find it in the ledger; copy the payment row ID.
              </p>
            </div>
          )}

          {/* Trust banner: warn before user commits when something is off.
              Linnea: "if the math doesn't reconcile I want to know before
              I hit the button, not after." Soft warnings (yellow) don't
              block; hard blockers (red) disable submit. */}
          {(preview.exceedsUnapplied ||
            preview.exceedsBalance ||
            preview.payoffMismatch ||
            preview.noteAlreadyPaidOff) && (
            <div
              role="alert"
              data-testid="record-payment-warning"
              className={`rounded-md border p-3 text-sm flex items-start gap-2 ${
                preview.exceedsUnapplied || preview.noteAlreadyPaidOff
                  ? "border-destructive/40 bg-destructive/5 text-foreground"
                  : "border-acr-warning/30 bg-acr-warning/5 text-foreground"
              }`}
            >
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-acr-warning" aria-hidden="true" />
              <div className="space-y-1">
                {preview.noteAlreadyPaidOff && (
                  <p>
                    This note is <strong>{note.status === "sold" ? "sold" : "paid off"}</strong>. Recording
                    a new payment will create an orphan ledger entry and corrupt the
                    1099-INT for the year. Use NSF reversal instead if a prior payment bounced.
                  </p>
                )}
                {preview.exceedsUnapplied && (
                  <p>
                    Draw of {fmtUsd(dollarsToCents(unappliedApplyDollars))} exceeds the{" "}
                    {fmtUsd(note.unappliedBalanceCents)} held in unapplied funds.
                  </p>
                )}
                {preview.exceedsBalance && (
                  <p>
                    Principal of {fmtUsd(preview.principal)} exceeds the current
                    balance of {fmtUsd(note.currentBalanceCents)} — did you mean to
                    record a payoff instead?
                  </p>
                )}
                {preview.payoffMismatch && (
                  <p>
                    Payoff principal of {fmtUsd(preview.principal)} doesn't match
                    the current balance of {fmtUsd(note.currentBalanceCents)}. Use
                    the payoff calculator to compute per-diem first if the difference is
                    intentional; otherwise this will leave a stub balance behind.
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Preview totals — the "before you commit" panel. Visible
              whenever any input has a value so the operator can sanity-check
              the math before the irreversible submit. */}
          {!preview.everythingZero && (
            <div
              className="rounded-md border bg-muted/30 p-3 text-sm space-y-1.5"
              data-testid="record-payment-preview"
              aria-label="Payment preview"
            >
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Gross cash applied</span>
                <span className="font-mono tabular-nums">
                  {fmtUsd(preview.grossCash)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">New current balance</span>
                <span className="font-mono tabular-nums">
                  {fmtUsd(preview.newCurrentBalance)}{" "}
                  <span className="text-xs text-muted-foreground">
                    ({preview.principalApplied >= 0 ? "−" : "+"}
                    {fmtUsd(Math.abs(preview.principalApplied))})
                  </span>
                </span>
              </div>
              {preview.unappliedDelta !== 0 && (
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">New unapplied balance</span>
                  <span className="font-mono tabular-nums">
                    {fmtUsd(preview.newUnappliedBalance)}{" "}
                    <span className="text-xs text-muted-foreground">
                      ({preview.unappliedDelta >= 0 ? "+" : "−"}
                      {fmtUsd(Math.abs(preview.unappliedDelta))})
                    </span>
                  </span>
                </div>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="ref">Reference</Label>
              <Input
                id="ref"
                placeholder="Check #, ACH trace, etc."
                value={referenceNumber}
                onChange={(e) => setReferenceNumber(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pay-notes">Notes</Label>
              <Input
                id="pay-notes"
                placeholder="Optional"
                value={paymentNotes}
                onChange={(e) => setPaymentNotes(e.target.value)}
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>{Verbs.CANCEL}</Button>
          <Button
            onClick={() => submitMutation.mutate()}
            disabled={
              submitMutation.isPending ||
              preview.everythingZero ||
              preview.exceedsUnapplied ||
              preview.noteAlreadyPaidOff
            }
            aria-disabled={
              submitMutation.isPending ||
              preview.everythingZero ||
              preview.exceedsUnapplied ||
              preview.noteAlreadyPaidOff
            }
            data-testid="record-payment-submit"
          >
            {submitMutation.isPending ? "Recording…" : "Record payment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BucketsGrid(props: {
  principalDollars: string; setPrincipalDollars: (s: string) => void;
  interestDollars: string; setInterestDollars: (s: string) => void;
  escrowDollars: string; setEscrowDollars: (s: string) => void;
  lateFeeDollars: string; setLateFeeDollars: (s: string) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="space-y-1.5">
        <Label htmlFor="b-principal">Principal</Label>
        <Input id="b-principal" inputMode="decimal" placeholder="0.00" value={props.principalDollars} onChange={(e) => props.setPrincipalDollars(e.target.value)} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="b-interest">Interest</Label>
        <Input id="b-interest" inputMode="decimal" placeholder="0.00" value={props.interestDollars} onChange={(e) => props.setInterestDollars(e.target.value)} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="b-escrow">Escrow</Label>
        <Input id="b-escrow" inputMode="decimal" placeholder="0.00" value={props.escrowDollars} onChange={(e) => props.setEscrowDollars(e.target.value)} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="b-latefee">Late fee</Label>
        <Input id="b-latefee" inputMode="decimal" placeholder="0.00" value={props.lateFeeDollars} onChange={(e) => props.setLateFeeDollars(e.target.value)} />
      </div>
    </div>
  );
}

function fmtUsd(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(cents / 100);
}
