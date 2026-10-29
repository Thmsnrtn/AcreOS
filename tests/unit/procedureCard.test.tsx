// @vitest-environment jsdom
/**
 * V-Tax-1 T2a — the county procedure card.
 *   1. a locked county says "bidding locked" with every reason;
 *   2. a stale source raises the stale-law banner naming the field;
 *   3. every field shows its source, as-of and verification; county practice
 *      is labelled "county practice, not state permission"; a flat penalty
 *      reads as one-time, never per year.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { getQueryFn } from "../../client/src/lib/queryClient";
import { ProcedureCard } from "../../client/src/components/tax/ProcedureCard";

const fld = (value: unknown, asOf: string, basis = "state_law") => ({ value, source: "SYNTHETIC Code §33.54", asOf, basis, verification: "checked_against_statute" });
const BODY = {
  current: {
    version: 3,
    fields: {
      instrument: fld("redeemable_deed", "2026-06-01"),
      bidMethod: fld("rotational", "2026-06-01", "county_practice"),
      returnModel: fld({ kind: "flat_penalty", penaltyBps: 2500 }, "2026-06-01"),
      redemptionPeriodMonths: fld(6, "2024-01-01"),
    },
    countyVerification: null,
  },
  history: [{ id: "a", version: 3, verified: false }],
  standing: {
    biddable: false,
    lockReasons: [
      { code: "stale_field", field: "redemptionPeriodMonths", message: "Redemption period: the source is as of 2024-01-01, more than 12 months ago. Re-verify it." },
      { code: "not_verified", message: "The county-verification task has not been completed for this version." },
    ],
    staleLawBanner: true,
    staleFields: ["redemptionPeriodMonths"],
    countyPracticeFields: ["bidMethod"],
  },
};

let root: Root;
let host: HTMLDivElement;
beforeEach(() => vi.unstubAllGlobals());
afterEach(() => { act(() => root.unmount()); host.remove(); });

describe("procedure card", () => {
  it("locks, banners, and shows every field's provenance", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(BODY), { status: 200, headers: { "Content-Type": "application/json" } })));
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0, queryFn: getQueryFn({ on401: "throw" }) } } });
    await act(async () => { root.render(React.createElement(QueryClientProvider, { client }, React.createElement(ProcedureCard, { state: "TX", county: "Travis" }))); });
    for (let i = 0; i < 6; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });

    expect(host.querySelector('[data-testid="procedure-bidding-locked"]')).not.toBeNull();
    const reasons = host.querySelector('[data-testid="procedure-lock-reasons"]')!.textContent!;
    expect(reasons).toMatch(/more than 12 months ago/);
    expect(reasons).toMatch(/county-verification task has not been completed/);
    expect(host.querySelector('[data-testid="procedure-stale-law"]')!.textContent).toMatch(/Stale law: Redemption period/);
    expect(host.querySelector('[data-testid="procedure-field-bidMethod"]')!.textContent).toMatch(/county practice, not state permission/);
    const ret = host.querySelector('[data-testid="procedure-field-returnModel"]')!.textContent!;
    expect(ret).toMatch(/25\.00% flat penalty — one-time, not an annual rate/);
    expect(ret).not.toMatch(/per year/);
    expect(host.querySelector('[data-testid="procedure-field-instrument"]')!.textContent).toMatch(/source: SYNTHETIC Code §33\.54, as of 2026-06-01 · checked against statute/);
    expect(host.querySelector('[data-testid="procedure-field-noticeRequirements"]')!.textContent).toMatch(/not recorded/);
  });
});
