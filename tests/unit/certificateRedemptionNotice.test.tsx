// @vitest-environment jsdom
/**
 * T-DEF-3 — the redemption-notice control on the position record panel.
 *   1. each known 422 reason code renders its own plain-language sentence,
 *      and a refusal never reads as a send;
 *   2. an unknown refusal falls back to the server's message, and a 500
 *      renders as a generic failure — never a fabricated success;
 *   3. a provider receipt renders the provider id and the sent state the
 *      provider reported (test mode rendered, not posted; an idempotent
 *      replay sent no second copy);
 *   4. the download lane's outcome is labelled a draft;
 *   5. a rail-sent notice in the position record shows it was sent through
 *      AcreOS with its provider id; an operator-recorded one does not.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { getQueryFn } from "../../client/src/lib/queryClient";
import { CertificateLedgerPanel } from "../../client/src/components/tax/CertificateLedgerPanel";
import {
  REDEMPTION_NOTICE_DRAFT_TEXT,
  REDEMPTION_NOTICE_FAILURE_TEXT,
  redemptionNoticeReceiptText,
  redemptionNoticeRefusalText,
} from "../../client/src/components/tax/redemptionNoticeCopy";
import type { CertificateLedger } from "@shared/tax/ledger";

let root: Root | null = null;
let host: HTMLDivElement | null = null;
beforeEach(() => vi.unstubAllGlobals());
afterEach(() => { if (root) act(() => root!.unmount()); host?.remove(); root = null; host = null; });

const baseLedger: CertificateLedger = {
  lienAmount: { amountCents: 600000, basis: "what you paid at the sale, as recorded on the certificate" },
  rate: { text: "20% under the encoded rule" },
  redemptionDeadline: { date: "2027-01-15", basis: "computed by AcreOS from its encoded GA rule" },
  subsequentTaxes: { payments: [], totalCents: 0, reimbursement: { status: "not_stated", why: "the county procedure does not state it" } },
  interest: { status: "not_computed", why: "not computed in this fixture" },
  notices: [],
  foreclosureFilingDeadline: { status: "not_stated", why: "no foreclosure-filing deadline is stated" },
};

type PostHandler = (body: unknown) => Response;
let postHandler: PostHandler;
let postBodies: unknown[] = [];

async function mount(ledger: CertificateLedger) {
  postBodies = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (String(url).endsWith("/ledger")) return new Response(JSON.stringify({ ledger }), { status: 200, headers: { "Content-Type": "application/json" } });
    if (String(url).endsWith("/redemption-notice")) {
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      postBodies.push(body);
      return postHandler(body);
    }
    return new Response("{}", { status: 404, headers: { "Content-Type": "application/json" } });
  }));
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0, queryFn: getQueryFn({ on401: "throw" }) } } });
  await act(async () => { root.render(React.createElement(QueryClientProvider, { client }, React.createElement(CertificateLedgerPanel, { certificateId: "c1" }))); });
  await settle();
}
async function settle() { for (let i = 0; i < 8; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); }
const outcome = () => host!.querySelector('[data-testid="notice-outcome"]')?.textContent ?? null;
async function clickSend() {
  const btn = host!.querySelector('[data-testid="button-send-notice"]') as HTMLButtonElement;
  expect(btn).toBeTruthy();
  await act(async () => { btn.click(); });
  await settle();
}
function setField(testid: string, value: string) {
  const el = host!.querySelector(`[data-testid="${testid}"]`) as HTMLInputElement | HTMLSelectElement;
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
  el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
}

const refusal = (reason: string, message = "server message") =>
  new Response(JSON.stringify({ error: "UNPROCESSABLE", message, details: { reason }, statusCode: 422 }), { status: 422, headers: { "Content-Type": "application/json" } });

describe("refusal copy mapping (pure)", () => {
  it("maps every known reason code to its own sentence", () => {
    expect(redemptionNoticeRefusalText("notice_requirements_not_recorded")).toMatch(/no notice requirements are recorded for this county/);
    expect(redemptionNoticeRefusalText("notice_requirements_stale")).toMatch(/more than 12 months old/);
    expect(redemptionNoticeRefusalText("amount_not_determinable")).toMatch(/redemption amount cannot be determined/);
    expect(redemptionNoticeRefusalText("not_redeemable")).toMatch(/no longer redeemable/);
    expect(redemptionNoticeRefusalText("recipient_incomplete")).toMatch(/cannot be mailed/);
    for (const code of ["notice_requirements_not_recorded", "notice_requirements_stale", "amount_not_determinable", "not_redeemable", "recipient_incomplete"]) {
      expect(redemptionNoticeRefusalText(code)).toMatch(/^Not sent —/);
    }
  });
  it("unknown codes fall back honestly, never to a success", () => {
    expect(redemptionNoticeRefusalText("some_new_code", "the county has not verified this")).toBe("Not sent — the county has not verified this");
    expect(redemptionNoticeRefusalText(undefined)).toMatch(/^Not sent —/);
    expect(redemptionNoticeRefusalText(null, null)).toMatch(/^Not sent —/);
  });
  it("receipt text reports the provider state truthfully", () => {
    expect(redemptionNoticeReceiptText({ lane: "certified_mail", providerId: "ltr_1", testMode: false, alreadySent: false, expectedDeliveryDate: null })).toBe("Sent — accepted by the mail provider. Provider id: ltr_1.");
    expect(redemptionNoticeReceiptText({ lane: "mail", providerId: "ltr_2", testMode: true, alreadySent: false, expectedDeliveryDate: null })).toMatch(/test mode — rendered, not printed or posted/);
    expect(redemptionNoticeReceiptText({ lane: "mail", providerId: "ltr_3", testMode: false, alreadySent: true, expectedDeliveryDate: null })).toMatch(/no second copy was sent/);
    expect(redemptionNoticeReceiptText({ lane: "mail", providerId: null, testMode: false, alreadySent: false, expectedDeliveryDate: null })).toMatch(/did not return an id/);
  });
});

describe("redemption notice control", () => {
  it.each([
    ["notice_requirements_not_recorded", /no notice requirements are recorded/],
    ["notice_requirements_stale", /more than 12 months old/],
    ["amount_not_determinable", /amount cannot be determined/],
    ["not_redeemable", /no longer redeemable/],
    ["recipient_incomplete", /cannot be mailed/],
  ])("renders the %s refusal and sends nothing", async (reason, pattern) => {
    postHandler = () => refusal(reason);
    await mount(baseLedger);
    await clickSend();
    expect(outcome()).toMatch(pattern);
    expect(outcome()).not.toMatch(/^Sent —/);
    expect(postBodies).toEqual([{ delivery: "certified_mail" }]);
  });

  it("a 500 renders as a generic failure, never a success", async () => {
    postHandler = () => new Response(JSON.stringify({ error: "INTERNAL_ERROR", message: "Something broke on our end", statusCode: 500 }), { status: 500, headers: { "Content-Type": "application/json" } });
    await mount(baseLedger);
    await clickSend();
    expect(outcome()).toBe(REDEMPTION_NOTICE_FAILURE_TEXT);
  });

  it("a delivery-lane refusal (400) shows the operator-facing message", async () => {
    postHandler = () => new Response(JSON.stringify({ error: "BAD_REQUEST", message: "AcreOS mail needs your own return address. Add one in Mail Settings and verify it before mailing from the rail.", statusCode: 400 }), { status: 400, headers: { "Content-Type": "application/json" } });
    await mount(baseLedger);
    await clickSend();
    expect(outcome()).toMatch(/^Not sent — AcreOS mail needs your own return address/);
  });

  it("a provider receipt displays the provider id and the sent state", async () => {
    postHandler = () => new Response(JSON.stringify({
      delivery: { lane: "certified_mail", providerId: "ltr_abc123", testMode: false, alreadySent: false, expectedDeliveryDate: "2026-11-25" },
      notice: { redemptionDeadline: "2027-01-15", deadlineBasis: "computed", amountCents: 720000 },
    }), { status: 200, headers: { "Content-Type": "application/json" } });
    await mount(baseLedger);
    await clickSend();
    expect(outcome()).toMatch(/Sent — accepted by the mail provider\. Provider id: ltr_abc123\./);
    expect(outcome()).toMatch(/Expected delivery:/);
  });

  it("the operator amount and its source are sent as a pair", async () => {
    postHandler = () => refusal("amount_not_determinable");
    await mount(baseLedger);
    await act(async () => { setField("notice-amount", "7200"); setField("notice-amount-source", "county payoff quote, 2026-11-01"); });
    await clickSend();
    expect(postBodies).toEqual([{ delivery: "certified_mail", redemptionAmountCents: 720000, redemptionAmountSource: "county payoff quote, 2026-11-01" }]);
  });

  it("the download lane is labelled a draft, never a send", async () => {
    (URL as unknown as { createObjectURL: unknown }).createObjectURL = vi.fn(() => "blob:draft");
    (URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = vi.fn();
    postHandler = () => new Response("%PDF-fake", { status: 200, headers: { "Content-Type": "application/pdf" } });
    await mount(baseLedger);
    await act(async () => { setField("notice-delivery", "download"); });
    await clickSend();
    expect(outcome()).toBe(REDEMPTION_NOTICE_DRAFT_TEXT);
    expect(outcome()).toMatch(/draft, not a sent notice/);
    expect(postBodies).toEqual([{ delivery: "download" }]);
  });

  it("rail-sent notices show the rail and the provider id; operator-recorded ones do not", async () => {
    postHandler = () => refusal("not_redeemable");
    const ledger: CertificateLedger = {
      ...baseLedger,
      notices: [
        { sentOn: "2026-11-10", method: "certified mail via AcreOS", note: null, source: "county procedure v1", viaRail: true, providerId: "ltr_xyz789" },
        { sentOn: "2026-10-01", method: "Certified mail", note: null, source: "post office receipt", viaRail: false, providerId: null },
      ],
    };
    await mount(ledger);
    const notices = host!.querySelector('[data-testid="ledger-notices"]')!.textContent!;
    expect(notices).toMatch(/sent through AcreOS · provider id ltr_xyz789/);
    expect(notices.match(/sent through AcreOS/g)).toHaveLength(1);
  });
});
