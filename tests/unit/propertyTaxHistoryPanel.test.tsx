// @vitest-environment jsdom
/**
 * V-Tax-1 T4b — the tax history on a Land property, and the move control.
 *   1. a parcel still held shows the taught lock: what cannot be done and
 *      what clears it, plus what the position has cost (an offer input);
 *   2. a property with no tax history renders nothing;
 *   3. the move asks for acreage only when the server says the list stated none.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { getQueryFn } from "../../client/src/lib/queryClient";
import { PropertyTaxHistoryPanel } from "../../client/src/components/tax/PropertyTaxHistoryPanel";
import { MoveToLandControl } from "../../client/src/components/tax/MoveToLandControl";
import { redemptionClock } from "@shared/tax/clock";

const clock = redemptionClock({ saleType: "redeemable_deed", status: "deed_obtained", saleDate: "2024-06-01", redemptionDeadline: "2025-06-01", deadlineSource: "operator_entered", deadlineBasis: "SYNTHETIC", purchaseAmountCents: 481_250, today: "2026-10-29", procedurePeriod: null, quietTitle: null });
const HISTORY = {
  history: {
    positions: [{ certificateId: "c1", apn: "SYN-1", saleType: "redeemable_deed", saleDate: "2024-06-01", status: "deed_obtained", clock, events: [{ eventType: "subsequent_tax_paid", eventDate: "2025-02-01", source: "SYNTHETIC receipt", recordedAt: "2025-02-02T00:00:00.000Z" }], bids: [{ action: "won", amountCents: 481_250, performedAt: "2024-06-01T15:00:00.000Z", overMaxReason: null }] }],
    moneyIn: { purchaseCents: 481_250, subsequentTaxesCents: 51_000, totalCents: 532_250, basis: "SYNTHETIC basis" },
  },
};

let root: Root;
let host: HTMLDivElement;
let calls: Array<{ url: string; body: any }>;
beforeEach(() => { vi.unstubAllGlobals(); calls = []; });
afterEach(() => { act(() => root.unmount()); host.remove(); });

async function mount(el: React.ReactElement, respond: (url: string, body: any) => Response) {
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ url: String(url), body });
    return respond(String(url), body);
  }));
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0, queryFn: getQueryFn({ on401: "throw" }) }, mutations: { retry: false } } });
  await act(async () => { root.render(React.createElement(QueryClientProvider, { client }, el)); });
  for (let i = 0; i < 6; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}
const json = (status: number, b: unknown) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
const flush = async () => { for (let i = 0; i < 6; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };

describe("property tax history", () => {
  it("a held parcel teaches the lock and shows what the position cost", async () => {
    await mount(React.createElement(PropertyTaxHistoryPanel, { propertyId: 9 }), () => json(200, HISTORY));
    const lock = host.querySelector('[data-testid="property-tax-lock"]')!.textContent!;
    expect(lock).toMatch(/do not improve, market, plat or spend on feasibility/);
    expect(lock).toMatch(/quiet-title petition is not yet filed/);
    expect(lock).toMatch(/AcreOS refuses those steps until then/);
    expect(host.querySelector('[data-testid="property-tax-money-in"]')!.textContent).toMatch(/\$5,322\.50.*an input to your next offer|an input to your next offer.*\$5,322\.50/s);
    expect(host.querySelector('[data-testid="property-tax-position-c1"]')!.textContent).toMatch(/Subsequent tax paid — SYNTHETIC receipt/);
  });

  it("a property with no tax history renders nothing", async () => {
    await mount(React.createElement(PropertyTaxHistoryPanel, { propertyId: 10 }), () => json(200, { history: { positions: [], moneyIn: { purchaseCents: 0, subsequentTaxesCents: 0, totalCents: 0, basis: "" } } }));
    expect(host.textContent).toBe("");
  });
});

describe("move to Land", () => {
  it("asks for acreage only when the server says the list stated none, then sends it with its source", async () => {
    let n = 0;
    await mount(React.createElement(MoveToLandControl, { certificateId: "c1" }), () => {
      n += 1;
      return n === 1
        ? json(422, { error: "unprocessable", message: "the lot's list states no acreage — give the parcel's acreage and where it came from", details: { needsAcreage: true }, statusCode: 422 })
        : json(200, { status: "linked", propertyId: 77, created: true, alreadyLinked: false });
    });
    expect(host.querySelector("#acres-c1")).toBeNull();
    await act(async () => { (host.querySelector('[data-testid="button-move-to-land"]') as HTMLButtonElement).click(); });
    await flush();
    expect(host.querySelector("#acres-c1")).not.toBeNull();
    const set = async (sel: string, v: string) => act(async () => {
      const el = host.querySelector(sel) as HTMLInputElement;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await set("#acres-c1", "10.25");
    await set("#acres-src-c1", "SYNTHETIC recorded plat");
    await act(async () => { (host.querySelector('[data-testid="button-move-to-land"]') as HTMLButtonElement).click(); });
    await flush();
    expect(calls.map((c) => c.body)).toEqual([{}, { sizeAcres: { value: "10.25", source: "SYNTHETIC recorded plat" } }]);
    expect(host.querySelector('[data-testid="move-to-land-linked"]')!.textContent).toMatch(/In Land inventory/);
  });
});
