// @vitest-environment jsdom
/**
 * V-Tax-1 T3b — the sale calendar panel and the position record panel.
 *   1. with no zone stated, the panel says the zone is not stated and that
 *      AcreOS does not guess it, and shows the date with no time;
 *   2. with a zone, the start reads in the county's zone, with its source;
 *   3. registration shows "bidding gated until complete" with each item's state;
 *   4. the position record shows interest as not computed (with why), the
 *      subsequent taxes with their receipts, and the foreclosure deadline with
 *      its basis — and never says "Ledger" (a founder codename).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { getQueryFn } from "../../client/src/lib/queryClient";
import { AuctionCalendarPanel } from "../../client/src/components/tax/AuctionCalendarPanel";
import { CertificateLedgerPanel } from "../../client/src/components/tax/CertificateLedgerPanel";
import { auctionCalendar, registrationStanding } from "@shared/tax/auctionCalendar";
import { certificateLedger } from "@shared/tax/ledger";
import { readFileSync } from "node:fs";
import path from "node:path";

let root: Root;
let host: HTMLDivElement;
beforeEach(() => vi.unstubAllGlobals());
afterEach(() => { act(() => root.unmount()); host.remove(); });

async function mount(el: React.ReactElement, routes: Record<string, unknown>) {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(JSON.stringify(routes[url]), { status: 200, headers: { "Content-Type": "application/json" } })));
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0, queryFn: getQueryFn({ on401: "throw" }) } } });
  await act(async () => { root.render(React.createElement(QueryClientProvider, { client }, el)); });
  for (let i = 0; i < 6; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}
const text = (id: string) => host.querySelector(`[data-testid="${id}"]`)!.textContent!;
const now = new Date("2026-10-29T12:00:00Z");

describe("sale calendar panel", () => {
  it("no zone: no time, and AcreOS says it does not guess", async () => {
    const body = { calendar: auctionCalendar("2026-12-01", { timeZone: null, startTimeLocal: "10:00", registrationDeadline: null, funds: null }, now), registration: registrationStanding(null) };
    await mount(React.createElement(AuctionCalendarPanel, { auctionId: 5 }), { "/api/tax-researcher/auctions/5/calendar": body });
    expect(text("calendar-zone")).toBe("County time zone not stated — AcreOS does not guess it.");
    expect(text("calendar-start")).toMatch(/the county's time zone is not stated, so no time is shown/);
    expect(text("calendar-start")).not.toMatch(/10:00/);
    expect(text("registration-gate")).toBe("bidding gated until complete");
    expect(text("registration-item-deposit")).toMatch(/whether the county requires it is not stated/);
    expect(text("registration-item-bidder_registration")).toMatch(/not registered yet/);
  });

  it("a stated zone: the start reads in the county's zone, with its source", async () => {
    const body = {
      calendar: auctionCalendar("2026-12-01", { timeZone: { value: "America/Phoenix", source: "SYNTHETIC sale notice", asOf: "2026-10-01" }, startTimeLocal: "10:00", registrationDeadline: null, funds: { depositCents: 50_000, form: "certified funds", source: "SYNTHETIC packet" } }, now),
      registration: registrationStanding(null),
    };
    await mount(React.createElement(AuctionCalendarPanel, { auctionId: 6 }), { "/api/tax-researcher/auctions/6/calendar": body });
    expect(text("calendar-start")).toMatch(/10:00 America\/Phoenix \(in \d+ days\)/);
    expect(text("calendar-zone")).toMatch(/America\/Phoenix — SYNTHETIC sale notice/);
    expect(text("calendar-funds")).toMatch(/deposit \$500\.00 · certified funds .*own rails/);
  });
});

describe("position record panel", () => {
  it("shows what each line rests on, and not computed where nothing is encoded", async () => {
    const golden = JSON.parse(readFileSync(path.join(__dirname, "../../shared/tax/golden/ledger-golden.json"), "utf8"));
    await mount(React.createElement(CertificateLedgerPanel, { certificateId: "c1" }), { "/api/tax-certificates/c1/ledger": { ledger: certificateLedger(golden.input) } });
    expect(text("ledger-interest")).toMatch(/not computed — AcreOS has no encoded redemption rule for OH/);
    expect(text("ledger-subsequent-taxes")).toMatch(/\$1,000\.00/);
    expect(text("ledger-subsequent-taxes")).toMatch(/SYNTHETIC receipt #2026-12/);
    expect(text("ledger-subsequent-taxes")).toMatch(/Reimbursement: SYNTHETIC: subsequent taxes .*county procedure v2/);
    expect(text("ledger-foreclosure")).toMatch(/SYNTHETIC procedure v2/);
    expect(text("ledger-notices")).toMatch(/Certified mail · to the owner of record — SYNTHETIC certified mail receipt 7019/);
    expect(host.textContent).not.toMatch(/\bLedger\b/);
  });
});
