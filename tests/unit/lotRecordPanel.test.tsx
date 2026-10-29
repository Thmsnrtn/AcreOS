// @vitest-environment jsdom
/**
 * V-Tax-1 T4 — the lot's tax record panel.
 *   1. disagreements come first, every value with its source, the book marked;
 *   2. a value missing on a list that had the column reads "blank on the list
 *      — asked, nothing stated", distinct from "never stated by any source";
 *   3. a lien never searched reads "never searched", not clean;
 *   4. another sale's list of the same parcel is named.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { getQueryFn } from "../../client/src/lib/queryClient";
import { LotRecordPanel } from "../../client/src/components/tax/LotRecordPanel";
import { recordedField, type ObservationView } from "@shared/provenance/fieldRecord";
import { triageLot } from "@shared/tax/triage";

const ob = (value: unknown, source: string, fileName: string | undefined, kind: "value" | "searched_none" = "value"): ObservationView => ({
  value: kind === "value" ? value : null, kind, source, sourceRef: { fileName, column: "Min Bid" }, asOf: "2026-09-01", confidence: "medium", basis: "SYNTHETIC", decayClass: "months", observedAt: "2026-09-02T00:00:00.000Z",
});
const RECORD = {
  record: {
    listingId: 3,
    apn: "SYN-3",
    county: "Synth",
    state: "TX",
    fields: [
      recordedField("totalTaxOwed", "Amount owed", 481_250, [ob(481_250, "tax_list", "synthetic.csv"), ob(512_000, "operator_correction", undefined)]),
      recordedField("minimumBid", "Minimum bid", null, [ob(null, "tax_list", "synthetic.csv", "searched_none")]),
      recordedField("assessedValue", "Assessed value", null, []),
    ],
    facts: triageLot({ parcel: { status: "not_searched", reason: "no APN" }, listMarketValueCents: null, amountOwedCents: 481_250, redemptionPeriod: null }).facts,
    otherListings: [{ listingId: 9, saleDate: "2025-11-04", status: "available" }],
  },
};

let root: Root;
let host: HTMLDivElement;
beforeEach(() => vi.unstubAllGlobals());
afterEach(() => { act(() => root.unmount()); host.remove(); });

describe("lot record panel", () => {
  it("disagreement first, absences told apart, unknown lien never clean", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(RECORD), { status: 200, headers: { "Content-Type": "application/json" } })));
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0, queryFn: getQueryFn({ on401: "throw" }) } } });
    await act(async () => { root.render(React.createElement(QueryClientProvider, { client }, React.createElement(LotRecordPanel, { listingId: 3 }))); });
    for (let i = 0; i < 6; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });

    const panel = host.querySelector('[data-testid="lot-record-3"]')!;
    const dis = host.querySelector('[data-testid="lot-record-disagreements"]')!;
    expect(panel.firstElementChild).toBe(dis); // first on the page
    expect(dis.textContent).toMatch(/Sources disagree on 1 fact/);
    const owed = host.querySelector('[data-testid="lot-disagreement-totalTaxOwed"]')!.textContent!;
    expect(owed).toMatch(/\$4,812\.50/);
    expect(owed).toMatch(/\$5,120\.00/);
    expect(owed).toMatch(/on the book/);
    expect(host.querySelector('[data-testid="lot-record-minimumBid"]')!.textContent).toMatch(/blank on the list \(column “Min Bid”\) — asked, nothing stated/);
    expect(host.querySelector('[data-testid="lot-record-assessedValue"]')!.textContent).toMatch(/never stated by any source/);
    expect(host.querySelector('[data-testid="lot-fact-seniorLiens"]')!.textContent).toMatch(/never searched.*no lien search has been performed/);
    expect(host.querySelector('[data-testid="lot-other-listings-3"]')!.textContent).toMatch(/also on 1 other sale list/);
  });
});
