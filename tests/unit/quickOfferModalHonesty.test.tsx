// @vitest-environment jsdom
/**
 * Quick offer (sidebar + ⌘O) tells the truth about what it does.
 *
 * It used to POST {parcelId, amount} to /api/offers and toast "Offer sent —
 * Pax queued a written offer". The offers table has no parcel/amount column,
 * so the row stored was an EMPTY draft; no screen reads it and nothing queued
 * or sent a letter. The modal is now a launcher into the Blind Offer Wizard
 * and writes nothing.
 *
 * "Writes nothing" is watched at BOTH write paths: the app's `apiRequest` and
 * the global `fetch`/XMLHttpRequest a raw call would use. The persona gate runs
 * through the real resolveHiddenRoutes/isRouteHidden (only the two data hooks
 * feeding it are stubbed), so a notes-only org sees "not available" rather
 * than a launch into the route its nav hides.
 *
 * Rendered through the real modal + zustand store, asserting what a customer
 * sees and what the component does — not that a string exists in source.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";

const { apiRequestSpy, setLocationSpy, toastSpy, persona } = vi.hoisted(() => ({
  apiRequestSpy: vi.fn(async (..._a: unknown[]) => ({ ok: true, json: async () => ({}) })),
  setLocationSpy: vi.fn(),
  toastSpy: vi.fn(),
  persona: { orgInvestorType: "land" as string },
}));
vi.mock("@/lib/queryClient", () => ({ apiRequest: apiRequestSpy }));
vi.mock("wouter", () => ({ useLocation: () => ["/today", setLocationSpy] }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: toastSpy }), toast: toastSpy }));
// Only the data feeding the persona predicate is stubbed; the predicate itself
// (resolveHiddenRoutes + isRouteHidden) is the real one the sidebar uses.
vi.mock("@/hooks/use-organization", () => ({
  useOrganization: () => ({ data: { investorType: persona.orgInvestorType, onboardingData: {} } }),
}));
vi.mock("@/hooks/use-context-profile", () => ({ useContextProfile: () => ({ investorType: "new_investor" }) }));

import { QuickOfferModal, QUICK_OFFER_DESTINATION } from "../../client/src/components/modals/quick-offer-modal";
import { useModals } from "../../client/src/stores/modal-store";

let host: HTMLDivElement;
let root: Root;
let fetchSpy: ReturnType<typeof vi.fn>;
let xhrOpenSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  persona.orgInvestorType = "land";
  fetchSpy = vi.fn(async () => new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", fetchSpy);
  xhrOpenSpy = vi.spyOn(XMLHttpRequest.prototype, "open").mockImplementation(() => {});
  apiRequestSpy.mockClear();
  setLocationSpy.mockClear();
  toastSpy.mockClear();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = "";
  useModals.getState().closeQuickOffer();
  vi.unstubAllGlobals();
  xhrOpenSpy.mockRestore();
});

/** No write of any kind: not through apiRequest, not a raw fetch, not an XHR. */
function expectNoNetworkWrite() {
  expect(apiRequestSpy).not.toHaveBeenCalled();
  expect(fetchSpy, "no raw fetch is issued").not.toHaveBeenCalled();
  expect(xhrOpenSpy, "no XMLHttpRequest is opened").not.toHaveBeenCalled();
}

async function openModal() {
  await act(async () => {
    root.render(<QuickOfferModal />);
  });
  await act(async () => {
    useModals.getState().openQuickOffer();
  });
  const dialog = document.querySelector('[data-testid="quick-offer-modal"]');
  expect(dialog, "the dialog renders when opened").not.toBeNull();
  return dialog as HTMLElement;
}

/** Everything that implies a letter or offer went out, was queued, or was saved. */
const FALSE_OUTCOME_CLAIMS =
  /offer sent|queued|sends the letter|send offer|send the letter|draft (offer )?saved|your draft is saved|pax suggests/i;

describe("Quick offer modal", () => {
  it("claims no send, queue, saved draft or suggestion it cannot deliver", async () => {
    const dialog = await openModal();
    expect(dialog.textContent ?? "").not.toMatch(FALSE_OUTCOME_CLAIMS);
    expect(dialog.textContent ?? "").toMatch(/nothing is sent from here/i);
  });

  it("offers no parcel/amount form whose input would be discarded", async () => {
    const dialog = await openModal();
    expect(dialog.querySelectorAll("input").length).toBe(0);
    expect(dialog.querySelector('[data-testid="button-quick-offer-send"]')).toBeNull();
  });

  it("its action opens the offer wizard, closes the modal, and writes nothing", async () => {
    const dialog = await openModal();
    const go = dialog.querySelector('[data-testid="button-quick-offer-open-wizard"]') as HTMLButtonElement;
    expect(go, "the launch action is present").not.toBeNull();
    await act(async () => {
      go.click();
    });
    expect(setLocationSpy).toHaveBeenCalledWith(QUICK_OFFER_DESTINATION);
    expect(QUICK_OFFER_DESTINATION).toBe("/blind-offer-wizard");
    expect(useModals.getState().quickOffer.open).toBe(false);
    // No offer row is created and no "sent" toast is shown.
    expectNoNetworkWrite();
    expect(toastSpy).not.toHaveBeenCalled();
  });

  it("cancel closes without navigating or writing", async () => {
    const dialog = await openModal();
    const cancel = dialog.querySelector('[data-testid="button-quick-offer-cancel"]') as HTMLButtonElement;
    await act(async () => {
      cancel.click();
    });
    expect(useModals.getState().quickOffer.open).toBe(false);
    expect(setLocationSpy).not.toHaveBeenCalled();
    expectNoNetworkWrite();
  });

  it("a notes-only org, whose nav hides the wizard, is told it is unavailable instead of launched into it", async () => {
    persona.orgInvestorType = "notes";
    const dialog = await openModal();
    expect(dialog.querySelector('[data-testid="button-quick-offer-open-wizard"]')).toBeNull();
    const msg = dialog.querySelector('[data-testid="text-quick-offer-unavailable"]');
    expect(msg?.textContent ?? "").toMatch(/not available for this business type/i);
    expect(dialog.textContent ?? "").not.toMatch(FALSE_OUTCOME_CLAIMS);
    const cancel = dialog.querySelector('[data-testid="button-quick-offer-cancel"]') as HTMLButtonElement;
    await act(async () => {
      cancel.click();
    });
    expect(setLocationSpy).not.toHaveBeenCalled();
    expect(useModals.getState().quickOffer.open).toBe(false);
    expectNoNetworkWrite();
  });

  it("land and mixed orgs still get the launch action (the gate is the nav's, not a blanket hide)", async () => {
    for (const t of ["land", "both"]) {
      persona.orgInvestorType = t;
      const dialog = await openModal();
      expect(dialog.querySelector('[data-testid="button-quick-offer-open-wizard"]'), t).not.toBeNull();
      expect(dialog.querySelector('[data-testid="text-quick-offer-unavailable"]'), t).toBeNull();
      await act(async () => {
        useModals.getState().closeQuickOffer();
      });
    }
  });
});
