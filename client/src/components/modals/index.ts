/**
 * Deal-flow modal host. Mount once at app root (next to Toaster).
 *
 * Each modal is a singleton driven by useModals() (Zustand). They
 * render conditionally on .open from the store and remain dormant
 * (zero markup) when closed.
 */
export { QuickOfferModal } from "./quick-offer-modal";
export { LostReasonModal } from "./lost-reason-modal";
export { DealClosedModal } from "./deal-closed-modal";

import { QuickOfferModal } from "./quick-offer-modal";
import { LostReasonModal } from "./lost-reason-modal";
import { DealClosedModal } from "./deal-closed-modal";

export function DealModalsHost() {
  return (
    <>
      <QuickOfferModal />
      <LostReasonModal />
      <DealClosedModal />
    </>
  );
}
