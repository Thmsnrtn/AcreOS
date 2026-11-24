/**
 * Quick Offer modal — ⌘O entry point per HANDOFF demo script step 3.
 *
 * This is a LAUNCHER, and says so. It used to collect a parcel and an amount,
 * POST them to /api/offers, and toast "Offer sent — Pax queued a written
 * offer". None of that was true:
 *   - `offers` has no parcel or amount column, so the insert schema dropped
 *     both and stored an empty draft row (status "draft", every field null);
 *   - nothing reads that row (the Offers page lists /api/offer-letters), so the
 *     customer could not reach it;
 *   - nothing queued or sent a letter — and counterparty mail is the org's own
 *     rail, never something this modal can promise;
 *   - /api/atlas/analyze (the "Suggest" button) has no handler.
 * So the modal no longer writes anything. It opens the Blind Offer Wizard,
 * which is where an offer is actually priced and where its letter is prepared.
 *
 * Opens via useModals().openQuickOffer(). Triggers:
 * - ⌘O keyboard (registered in use-keyboard-shortcuts)
 * - Sidebar header trigger with data-tour="quick-offer"
 *
 * Every entry point opens THIS modal, so the persona gate lives here: when the
 * account's persona hides the wizard from the nav (pure-notes orgs, via
 * sidebar-hidden-routes.ts), the modal says the wizard is not available for
 * this business type instead of launching into a route the nav hides. It asks
 * the same predicate the sidebar asks (useHiddenRoutes + isRouteHidden).
 */
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useLocation } from "wouter";
import { useModals } from "@/stores/modal-store";
import { ArrowRight } from "lucide-react";
import { Verbs } from "@/lib/labels";
import { useHiddenRoutes } from "@/hooks/use-hidden-routes";
import { isRouteHidden } from "@/lib/sidebar-hidden-routes";

/** Where the launcher goes — the one place an offer is really priced. */
export const QUICK_OFFER_DESTINATION = "/blind-offer-wizard";

export function QuickOfferModal() {
  const open = useModals((s) => s.quickOffer.open);
  const close = useModals((s) => s.closeQuickOffer);
  const [, setLocation] = useLocation();
  const wizardHidden = isRouteHidden(QUICK_OFFER_DESTINATION, useHiddenRoutes());

  return (
    <Dialog open={open} onOpenChange={(v) => !v && close()}>
      <DialogContent className="sm:max-w-md" data-testid="quick-offer-modal">
        <DialogHeader>
          <DialogTitle>Quick offer</DialogTitle>
          {wizardHidden ? (
            <DialogDescription data-testid="text-quick-offer-unavailable">
              The offer wizard prices land offers, so it is not available for this business type.
              Nothing is sent from here.
            </DialogDescription>
          ) : (
            <DialogDescription>
              The offer wizard takes the county, comps and seller details, shows the price you can
              defend, and writes the letter for you to copy. Nothing is sent from here.
            </DialogDescription>
          )}
        </DialogHeader>

        <div className="flex items-center justify-end gap-2 pt-4 border-t mt-4">
          <Button variant="ghost" onClick={close} data-testid="button-quick-offer-cancel">
            {Verbs.CANCEL}
          </Button>
          {!wizardHidden && (
            <Button
              onClick={() => {
                close();
                setLocation(QUICK_OFFER_DESTINATION);
              }}
              data-testid="button-quick-offer-open-wizard"
            >
              Open the offer wizard
              <ArrowRight className="w-4 h-4 ml-2" aria-hidden="true" />
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
