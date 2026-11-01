// @vitest-environment jsdom
/**
 * V-Tax-1 T2b — the certificate clock panel.
 *   1. the countdown first, with the rule the deadline rests on and the next
 *      action;
 *   2. a locked redeemable deed is a taught state: what is locked, until
 *      when, and what clears it — with the capital tied up shown;
 *   3. a mismatch with the county procedure is shown, both dates, nothing picked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { getQueryFn } from "../../client/src/lib/queryClient";
import { CertificateClockPanel } from "../../client/src/components/tax/CertificateClockPanel";
import { redemptionClock } from "@shared/tax/clock";

const CLOCK = redemptionClock({
  saleType: "redeemable_deed", status: "active", saleDate: "2026-04-01", redemptionDeadline: "2027-04-01",
  deadlineSource: "computed_preliminary", deadlineBasis: "computed by AcreOS from its encoded GA rule (OCGA §48-4-40) — preliminary, not attorney-reviewed; confirm with the county",
  purchaseAmountCents: 1_250_000, today: "2026-12-31",
  procedurePeriod: { months: 6, source: "SYNTHETIC Code §48-4-40", asOf: "2026-06-01", version: 2 }, quietTitle: null,
});

let root: Root;
let host: HTMLDivElement;
beforeEach(() => vi.unstubAllGlobals());
afterEach(() => { act(() => root.unmount()); host.remove(); });

describe("certificate clock panel", () => {
  it("countdown and cited rule first; the lock is taught with what clears it; a procedure mismatch is shown, not resolved", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(CLOCK), { status: 200, headers: { "Content-Type": "application/json" } })));
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0, queryFn: getQueryFn({ on401: "throw" }) } } });
    await act(async () => { root.render(React.createElement(QueryClientProvider, { client }, React.createElement(CertificateClockPanel, { certificateId: "c1", label: "APN SYNTH-1", onClose: () => undefined }))); });
    for (let i = 0; i < 6; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });

    expect(host.querySelector('[data-testid="clock-countdown"]')!.textContent).toBe("91 days to redemption expiry");
    expect(host.querySelector('[data-testid="clock-rule-cited"]')!.textContent).toMatch(/Rests on: computed by AcreOS .*preliminary, not attorney-reviewed/);
    expect(host.querySelector('[data-testid="clock-next-action"]')!.textContent).toMatch(/Next: Hold\./);
    const lock = host.querySelector('[data-testid="clock-lock"]')!.textContent!;
    expect(lock).toMatch(/Locked: do not improve, do not market/);
    expect(lock).toMatch(/redemption expires 2027-04-01/);
    expect(lock).toMatch(/quiet-title petition is filed/);
    expect(host.querySelector('[data-testid="clock-capital"]')!.textContent).toBe("$12,500.00");
    expect(host.querySelector('[data-testid="clock-marketable"]')!.textContent).toMatch(/no.*still redeemable until 2027-04-01/);
    expect(host.querySelector('[data-testid="clock-procedure-mismatch"]')!.textContent).toMatch(/6-month redemption period .*does not match the deadline on record\. Both are shown/);
  });
});
