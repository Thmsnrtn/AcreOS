/**
 * Zustand modal store.
 *
 * Replaces the prototype's `window.__acr.openLost(deal)` / `openClosed(deal)` /
 * `openQuickOffer()` global pattern (HANDOFF.md §4 — globals architecture).
 *
 * Usage:
 *   const openLost = useModals((s) => s.openLostReason);
 *   const lostState = useModals((s) => s.lostReason);
 *
 * Add new modals here as the build encounters them; keep the open/close
 * action-name pattern (openX / closeX) and a per-modal `{ open, payload }`
 * shape so consuming components can read `.open` and `.deal` (or other
 * payload field) cleanly.
 */
import { create } from "zustand";
import type { Deal } from "@shared/schema";

interface LostReasonModal {
  open: boolean;
  deal: Deal | null;
}

interface DealClosedModal {
  open: boolean;
  deal: Deal | null;
}

interface QuickOfferModal {
  open: boolean;
  parcelId?: string;
}

interface ModalsState {
  lostReason: LostReasonModal;
  dealClosed: DealClosedModal;
  quickOffer: QuickOfferModal;
}

interface ModalsActions {
  openLostReason: (deal: Deal) => void;
  closeLostReason: () => void;
  openDealClosed: (deal: Deal) => void;
  closeDealClosed: () => void;
  openQuickOffer: (parcelId?: string) => void;
  closeQuickOffer: () => void;
}

export const useModals = create<ModalsState & ModalsActions>()((set) => ({
  lostReason: { open: false, deal: null },
  dealClosed: { open: false, deal: null },
  quickOffer: { open: false },

  openLostReason: (deal) => set({ lostReason: { open: true, deal } }),
  closeLostReason: () => set({ lostReason: { open: false, deal: null } }),

  openDealClosed: (deal) => set({ dealClosed: { open: true, deal } }),
  closeDealClosed: () => set({ dealClosed: { open: false, deal: null } }),

  openQuickOffer: (parcelId) => set({ quickOffer: { open: true, parcelId } }),
  closeQuickOffer: () => set({ quickOffer: { open: false } }),
}));
