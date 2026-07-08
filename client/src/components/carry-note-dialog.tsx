/**
 * CarryNoteDialog — the "Close & Carry" bridge UI.
 *
 * Welds the Deals door to the Finance door: when a seller-finance deal closes,
 * one click pre-fills a serviced note (sale price, down, rate, term, first
 * payment) from the deal — no re-keying — and POSTs to
 * /api/notes/from-deal/:dealId, then routes to the new note.
 *
 * The one-confirm screen is fully editable; everything is seeded from the deal
 * so the operator usually just reviews and confirms. shadcn/ui + accessible
 * (labelled inputs, focus states) + mobile/desktop via ResponsiveModal.
 */
import React, { useMemo, useState } from "react";
import {
  ResponsiveModal,
  ResponsiveModalContent,
  ResponsiveModalHeader,
  ResponsiveModalTitle,
  ResponsiveModalDescription,
  ResponsiveModalFooter,
} from "@/components/ui/responsive-modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Banknote, Loader2, ArrowRight } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Deal } from "@shared/schema";
import { Verbs } from "@/lib/labels";

interface CarryNoteDialogProps {
  deal: Pick<
    Deal,
    "id" | "acceptedAmount" | "offerAmount" | "closingDate" | "analysisResults"
  >;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Add one calendar month, clamping the day for short months. */
function oneMonthAfter(iso: string): string {
  const base = new Date(iso);
  if (Number.isNaN(base.getTime())) return "";
  const d = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 1));
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(base.getUTCDate(), lastDay));
  return d.toISOString().slice(0, 10);
}

export function CarryNoteDialog({ deal, open, onOpenChange }: CarryNoteDialogProps) {
  const { toast } = useToast();
  const [, navigate] = useLocation();

  // Seed defaults from the deal — the heart of "no re-keying".
  const seeded = useMemo(() => {
    const salePrice =
      deal.acceptedAmount != null && deal.acceptedAmount !== ""
        ? Number(deal.acceptedAmount)
        : deal.offerAmount != null && deal.offerAmount !== ""
          ? Number(deal.offerAmount)
          : 0;
    const analysis = deal.analysisResults ?? undefined;
    const downPayment = analysis?.downPayment ?? 0;
    const interestRate = analysis?.interestRate ?? 0;
    const termMonths = analysis?.holdingPeriodMonths ?? 120;
    const closing = deal.closingDate
      ? new Date(deal.closingDate).toISOString().slice(0, 10)
      : new Date().toISOString().slice(0, 10);
    return {
      salePrice: String(salePrice),
      downPayment: String(downPayment),
      interestRate: String(interestRate),
      termMonths: String(termMonths),
      firstPaymentDate: oneMonthAfter(closing),
    };
  }, [deal]);

  const [salePrice, setSalePrice] = useState(seeded.salePrice);
  const [downPayment, setDownPayment] = useState(seeded.downPayment);
  const [interestRate, setInterestRate] = useState(seeded.interestRate);
  const [termMonths, setTermMonths] = useState(seeded.termMonths);
  const [firstPaymentDate, setFirstPaymentDate] = useState(seeded.firstPaymentDate);

  // Re-seed when the dialog (re)opens for a different deal.
  React.useEffect(() => {
    if (open) {
      setSalePrice(seeded.salePrice);
      setDownPayment(seeded.downPayment);
      setInterestRate(seeded.interestRate);
      setTermMonths(seeded.termMonths);
      setFirstPaymentDate(seeded.firstPaymentDate);
    }
  }, [open, seeded]);

  const financedPrincipal = Math.max(0, Number(salePrice || 0) - Number(downPayment || 0));

  const carryMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/notes/from-deal/${deal.id}`, {
        salePrice: Number(salePrice || 0),
        downPayment: Number(downPayment || 0),
        interestRate: Number(interestRate || 0),
        termMonths: Number(termMonths || 0),
        firstPaymentDate: firstPaymentDate || undefined,
      });
      return (await res.json()) as { note: { id: number }; alreadyCarried?: boolean };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/notes"] });
      toast({
        title: data.alreadyCarried ? "This deal is already carried" : "Note originated",
        description: data.alreadyCarried
          ? "Opening the note that was already carried from this deal."
          : "The serviced note was created from this deal. Complete origination next.",
      });
      onOpenChange(false);
      // Route to the Finance door, where the carried note now lives in the
      // book. (/notes/:id renders the acquired-notes vertical, a different
      // shape — the seller-finance servicing book is the Finance door.)
      navigate("/finance");
    },
    onError: (error: any) => {
      toast({
        title: "Couldn't carry this note",
        description: `${error?.message ?? "Unknown error"} — the deal is unchanged.`,
        variant: "destructive",
      });
    },
  });

  return (
    <ResponsiveModal open={open} onOpenChange={onOpenChange}>
      <ResponsiveModalContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <ResponsiveModalHeader>
          <ResponsiveModalTitle className="flex items-center gap-2">
            <Banknote className="w-5 h-5 text-acr-pos" aria-hidden="true" />
            Carry this note
          </ResponsiveModalTitle>
          <ResponsiveModalDescription>
            Originate the serviced note from this closed deal. Everything is pre-filled — review and confirm.
          </ResponsiveModalDescription>
        </ResponsiveModalHeader>

        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="carry-sale-price">Sale price</Label>
              <Input
                id="carry-sale-price"
                inputMode="decimal"
                value={salePrice}
                onChange={(e) => setSalePrice(e.target.value)}
                data-testid="input-carry-sale-price"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="carry-down-payment">Down payment</Label>
              <Input
                id="carry-down-payment"
                inputMode="decimal"
                value={downPayment}
                onChange={(e) => setDownPayment(e.target.value)}
                data-testid="input-carry-down-payment"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="carry-interest-rate">Interest rate (%)</Label>
              <Input
                id="carry-interest-rate"
                inputMode="decimal"
                value={interestRate}
                onChange={(e) => setInterestRate(e.target.value)}
                data-testid="input-carry-interest-rate"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="carry-term-months">Term (months)</Label>
              <Input
                id="carry-term-months"
                inputMode="numeric"
                value={termMonths}
                onChange={(e) => setTermMonths(e.target.value)}
                data-testid="input-carry-term-months"
              />
            </div>
            <div className="space-y-1.5 col-span-2">
              <Label htmlFor="carry-first-payment">First payment date</Label>
              <Input
                id="carry-first-payment"
                type="date"
                value={firstPaymentDate}
                onChange={(e) => setFirstPaymentDate(e.target.value)}
                data-testid="input-carry-first-payment"
              />
            </div>
          </div>

          <div className="rounded-card bg-muted/50 p-3 text-sm flex items-center justify-between">
            <span className="text-muted-foreground">Financed principal</span>
            <span className="font-mono tabular-nums font-medium" data-testid="text-carry-financed">
              ${financedPrincipal.toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </span>
          </div>

          <p className="text-xs text-muted-foreground">
            The note starts as <strong>pending</strong>. You'll set the buyer and complete
            Reg-Z origination on the note. The deal's documents stay linked as the
            note's origination record.
          </p>
        </div>

        <ResponsiveModalFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="min-h-[44px]"
            data-testid="button-carry-cancel"
          >
            {Verbs.CANCEL}
          </Button>
          <Button
            onClick={() => carryMutation.mutate()}
            disabled={carryMutation.isPending}
            className="min-h-[44px] gap-2"
            data-testid="button-carry-confirm"
          >
            {carryMutation.isPending ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> Carrying…
              </>
            ) : (
              <>
                Carry note <ArrowRight className="w-4 h-4" aria-hidden="true" />
              </>
            )}
          </Button>
        </ResponsiveModalFooter>
      </ResponsiveModalContent>
    </ResponsiveModal>
  );
}
