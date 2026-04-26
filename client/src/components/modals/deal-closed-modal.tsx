/**
 * Deal Closed Celebration modal.
 *
 * Per HANDOFF §4: "window.__acr.openClosed(deal)" → "useModals().openDealClosed(deal)".
 * The product earns the moment — when a deal closes, this is the
 * pause-and-mark-it-down beat. No CTA pressure; copy + a quiet
 * close-out checklist.
 *
 * Voice matches the prototype's letter-tone: short, founder-y, not
 * gamified-startup celebratory.
 */
import { useEffect, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useModals } from "@/stores/modal-store";
import { Link } from "wouter";
import { Sparkles, ClipboardList, ArrowRight } from "lucide-react";

export function DealClosedModal() {
  const open = useModals((s) => s.dealClosed.open);
  const deal = useModals((s) => s.dealClosed.deal);
  const close = useModals((s) => s.closeDealClosed);
  const fired = useRef(false);

  // Optional sound trigger (respects user preference + prefers-reduced-motion).
  // The actual sound hook lives in @/hooks/use-sound; if it isn't loaded
  // we no-op silently.
  useEffect(() => {
    if (open && !fired.current) {
      fired.current = true;
      try {
        // Best-effort dispatch — sound provider listens, off by default.
        window.dispatchEvent(new CustomEvent("acreos:sound", { detail: { kind: "deal-closed" } }));
      } catch {
        /* noop */
      }
    }
    if (!open) fired.current = false;
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && close()}>
      <DialogContent className="sm:max-w-md" data-testid="deal-closed-modal">
        <DialogHeader>
          <div
            className="w-14 h-14 rounded-2xl mx-auto mb-2 flex items-center justify-center"
            style={{ background: "var(--acr-brand)", color: "var(--acr-brand-ink)" }}
            aria-hidden="true"
          >
            <Sparkles className="w-7 h-7" />
          </div>
          <DialogTitle
            className="text-center"
            style={{
              fontFamily: "Fraunces, 'Times New Roman', serif",
              fontWeight: 400,
              fontSize: "28px",
              lineHeight: 1.1,
              fontStyle: "italic",
              color: "var(--acr-ink)",
            }}
          >
            One down.
          </DialogTitle>
          <DialogDescription className="text-center">
            {deal?.parcel ? (
              <>
                {deal.parcel} closed. Sophie has the paper from here — receipts,
                schedule, the next due date.
              </>
            ) : (
              <>
                Closed. Sophie has the paper from here — receipts, schedule,
                the next due date.
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="pt-4 space-y-2 text-sm text-muted-foreground">
          <p className="flex items-center gap-2">
            <span
              className="w-1.5 h-1.5 rounded-full"
              style={{ background: "var(--acr-pos)" }}
              aria-hidden="true"
            />
            Title transferred — recorded in audit log
          </p>
          <p className="flex items-center gap-2">
            <span
              className="w-1.5 h-1.5 rounded-full"
              style={{ background: "var(--acr-pos)" }}
              aria-hidden="true"
            />
            Funds released to seller
          </p>
          <p className="flex items-center gap-2">
            <span
              className="w-1.5 h-1.5 rounded-full"
              style={{ background: "var(--acr-pos)" }}
              aria-hidden="true"
            />
            Sophie picked up note servicing (if seller-financed)
          </p>
        </div>

        <div className="flex items-center justify-between gap-2 pt-4 border-t mt-4">
          <Button variant="ghost" asChild>
            <Link href="/finance" onClick={close} data-testid="button-deal-closed-finance">
              <ClipboardList className="w-4 h-4 mr-2" aria-hidden="true" />
              Open ledger
            </Link>
          </Button>
          <Button onClick={close} data-testid="button-deal-closed-done">
            Back to work
            <ArrowRight className="w-4 h-4 ml-2" aria-hidden="true" />
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
