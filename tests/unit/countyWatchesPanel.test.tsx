// @vitest-environment jsdom
/**
 * V-Tax-1 T1 — the county watches panel.
 *   1. a term nobody has stated reads "not stated — unknown", never a default;
 *      a stated one shows its value and source;
 *   2. opening a watch shows each lot's unknowns in the server's order, each
 *      with how to resolve it and the kind of cost;
 *   3. with no watches, a taught empty state with its action.
 * Mounted via react-dom/client with the app's real default query function and
 * a fetch stub (repo pattern — no @testing-library).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { getQueryFn } from "../../client/src/lib/queryClient";
import { CountyWatchesPanel } from "../../client/src/components/tax/CountyWatchesPanel";

const WATCH = { id: "w1", state: "TX", county: "Travis", lotCount: 1, terms: { saleType: { value: "deed", source: "SYNTHETIC county sale notice", asOf: "2026-09-01" } } };
const TRIAGE = {
  basis: "A screen to direct diligence, not a measurement.",
  lots: [{
    listingId: 1, apn: "SYNTH-1", address: null, saleDate: "2026-11-04", delinquentYears: ["2023"],
    facts: [
      { key: "amountOwed", label: "Amount owed", state: { status: "known", value: "$900.00", source: "the tax list" }, resolve: null, weight: 4 },
      { key: "marketValue", label: "Market value", state: { status: "unknown", reason: "neither the list nor a matched parcel states one" }, resolve: { how: "get a valuation", cost: "your_time" }, weight: 5 },
      { key: "seniorLiens", label: "Senior liens", state: { status: "unknown", reason: "no lien search has been performed" }, resolve: { how: "order a title or lien search", cost: "paid_outside" }, weight: 5 },
    ],
    unknownsInOrder: ["marketValue", "seniorLiens"],
  }],
  // V-Tax-1 T3a: lots discarded before bidding leave the order, with their reason.
  discarded: [{ listingId: 2, apn: "SYNTH-2", address: null, discard: { reason: "landlocked", note: "SYNTHETIC: no frontage", discardedAt: "2026-10-29T00:00:00.000Z", discardedByUserId: "u", priorStatus: "available", reopened: null } }],
};

let routes: Record<string, unknown>;
let root: Root;
let host: HTMLDivElement;
async function mount() {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(JSON.stringify(routes[url]), { status: 200, headers: { "Content-Type": "application/json" } })));
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0, queryFn: getQueryFn({ on401: "throw" }) } } });
  await act(async () => { root.render(React.createElement(QueryClientProvider, { client }, React.createElement(CountyWatchesPanel))); });
  await settle();
}
const settle = async () => { for (let i = 0; i < 6; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };

beforeEach(() => vi.unstubAllGlobals());
afterEach(() => { act(() => root.unmount()); host.remove(); });

describe("county watches panel", () => {
  it("unstated terms read as unknown; a stated term shows its source", async () => {
    routes = { "/api/tax-watches": { watches: [WATCH] } };
    await mount();
    const w = host.querySelector('[data-testid="county-watch-TX-Travis"]')!;
    expect(w.querySelector('[data-testid="watch-term-Redemption period"]')!.textContent).toMatch(/not stated — unknown/);
    expect(w.querySelector('[data-testid="watch-term-Sale type"]')!.textContent).toMatch(/deed.*source: SYNTHETIC county sale notice, as of 2026-09-01/);
  });

  it("opening a watch lists each lot's unknowns in order, with how to resolve and the kind of cost", async () => {
    routes = { "/api/tax-watches": { watches: [WATCH] }, "/api/tax-watches/w1/triage": TRIAGE };
    await mount();
    const toggle = host.querySelector<HTMLButtonElement>('button[aria-label="Show triage for Travis County, TX"]')!;
    await act(async () => { toggle.click(); });
    await settle();
    const items = host.querySelectorAll('[data-testid="triage-lot-SYNTH-1"] ol li');
    expect([...items].map((li) => li.getAttribute("data-testid"))).toEqual(["triage-unknown-marketValue", "triage-unknown-seniorLiens"]);
    expect(items[1].textContent).toMatch(/order a title or lien search \(a paid search outside AcreOS; weight 5\/5\)/);
    expect(host.querySelector('[data-testid="triage-lot-SYNTH-1"]')!.textContent).toMatch(/Amount owed: \$900\.00 \(the tax list\)/);
    expect(host.querySelector('[data-testid="triage-lot-SYNTH-2"]')).toBeNull();
    expect(host.querySelector('[data-testid="triage-discarded-SYNTH-2"]')!.textContent).toMatch(/Landlocked \(no legal access\): SYNTHETIC: no frontage/);
  });

  it("with no watches, a taught empty state with its action", async () => {
    routes = { "/api/tax-watches": { watches: [] } };
    await mount();
    expect(host.querySelector('[data-testid="county-watches-empty"]')!.textContent).toMatch(/never assumed/);
    expect(host.querySelector('[data-testid="county-watches-empty-import"]')).not.toBeNull();
  });
});
