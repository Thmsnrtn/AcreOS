// @vitest-environment jsdom
/**
 * V-Tax-1 T3a — bid discipline in the client. SYNTHETIC.
 *
 * Courthouse Mode used to POST to /api/auction-listings/:id/log-bid, a route
 * that never existed, toast "Action queued — we'll sync" on every failure and
 * advance anyway: nothing tapped there was ever recorded. Now:
 *   1. a win asks for what was paid, flags it over the max BEFORE it is sent,
 *      and will not send it without a reason; it POSTs to the real bid log;
 *   2. a refusal is "Not recorded" and the card does NOT advance;
 *   3. a service-worker-queued action (202 { queued }) advances;
 *   4. Skip writes nothing; a discarded lot is not offered at all;
 *   5. the queueable pattern in sw.js matches exactly the URL posted here, and
 *      every prefix it queues is a mounted route.
 * And the rights-stack editor previews with the same derivation the server
 * records with: a gap lists what is missing and cannot be recorded.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CourthouseMode } from "../../client/src/components/mobile/CourthouseMode";
import { RightsStackEditor } from "../../client/src/components/tax/BidDiscipline";
import type { MaxBidRecord, RightsStackInput } from "@shared/tax/maxBid";
import { deriveMaxBid } from "@shared/tax/maxBid";

const golden = JSON.parse(readFileSync(path.join(__dirname, "../../shared/tax/golden/max-bid-golden.json"), "utf8")) as { cases: Array<{ input: RightsStackInput }> };
const STACK = golden.cases[0].input;
const derived = deriveMaxBid(STACK);
if (derived.status !== "derived") throw new Error("golden case A must derive");
const BASIS: MaxBidRecord = { input: STACK, maxBidCents: derived.maxBidCents, leavesNothing: false, lines: derived.lines, recordedAt: "2026-10-29T00:00:00.000Z", recordedByUserId: "u" };

const L = (id: number, extra: Record<string, unknown> = {}) => ({ id, apn: `SYN-${id}`, county: "Synth", state: "GA", status: "available", maxBidCents: BASIS.maxBidCents, maxBidBasis: BASIS, ...extra });

let root: Root;
let host: HTMLDivElement;
let calls: Array<{ url: string; method: string; body: any }>;
beforeEach(() => { vi.unstubAllGlobals(); calls = []; });
afterEach(() => { act(() => root.unmount()); host.remove(); });

function stubFetch(respond: (url: string, body: any) => Response) {
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ url: String(url), method: init?.method ?? "GET", body });
    return respond(String(url), body);
  }));
}
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

async function mount(el: React.ReactElement) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  await act(async () => { root.render(React.createElement(QueryClientProvider, { client }, el)); });
}
const flush = async () => { for (let i = 0; i < 8; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
const click = async (testid: string) => { await act(async () => { (host.querySelector(`[data-testid="${testid}"]`) as HTMLElement).click(); }); await flush(); };
async function type(sel: string, value: string) {
  const el = host.querySelector(sel) as HTMLInputElement | HTMLTextAreaElement;
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
// Which lot the card is on, by the progress counter (`n / total`): the card
// itself sits under AnimatePresence, whose exit never completes in jsdom.
const at = () => host.querySelector(".tabular-nums.text-muted-foreground")?.textContent;
const bidLogPosts = () => calls.filter((c) => c.method === "POST" && /\/bid-log$/.test(c.url));

describe("courthouse mode", () => {
  it("a win over the max is flagged before it is sent, needs a reason, and posts to the real bid log", async () => {
    stubFetch(() => json(201, { entry: {}, certificate: { status: "created" } }));
    await mount(React.createElement(CourthouseMode, { listings: [L(1), L(2)] }));
    expect(at()).toBe("1 / 2");
    expect(host.textContent).toMatch(/derived from your rights stack/);

    await click("courthouse-action-won");
    await type("#courthouse-paid", String(BASIS.maxBidCents / 100 + 100));
    expect(host.querySelector('[data-testid="flag-over-max-1"]')!.textContent).toMatch(/\$100\.00 over your max/);
    expect((host.querySelector('[data-testid="courthouse-confirm-won"]') as HTMLButtonElement).disabled).toBe(true);
    expect(bidLogPosts()).toEqual([]);

    await type("#over-max-reason-1", "SYNTHETIC: adjoins my parcel");
    await click("courthouse-confirm-won");
    expect(bidLogPosts()).toEqual([
      { url: "/api/tax-researcher/listings/1/bid-log", method: "POST", body: { action: "won", amountCents: BASIS.maxBidCents + 10_000, overMaxReason: "SYNTHETIC: adjoins my parcel" } },
    ]);
    expect(calls.some((c) => c.url.includes("/api/auction-listings"))).toBe(false);
    expect(at()).toBe("2 / 2");
  });

  it("a refusal is not recorded and the card does not advance", async () => {
    stubFetch(() => json(422, { error: "unprocessable", message: "Bidding is locked for Synth County, GA: No procedure has been recorded.", statusCode: 422 }));
    await mount(React.createElement(CourthouseMode, { listings: [L(1), L(2)] }));
    await click("courthouse-action-outbid");
    expect(bidLogPosts().map((c) => c.body)).toEqual([{ action: "outbid" }]);
    expect(at()).toBe("1 / 2");
    expect(document.body.textContent).not.toMatch(/Action queued|we'll sync this bid/);
  });

  it("an action the service worker queued (202) advances", async () => {
    stubFetch(() => json(202, { offline: true, queued: true, message: "Saved offline — will sync when online" }));
    await mount(React.createElement(CourthouseMode, { listings: [L(1), L(2)] }));
    await click("courthouse-action-pass");
    expect(bidLogPosts().map((c) => c.body)).toEqual([{ action: "passed" }]);
    expect(at()).toBe("2 / 2");
  });

  it("skip writes nothing; a discarded lot is not offered", async () => {
    stubFetch(() => json(201, {}));
    const discard = { reason: "landlocked", note: null, discardedAt: "x", discardedByUserId: null, priorStatus: "available", reopened: null };
    await mount(React.createElement(CourthouseMode, { listings: [L(1), L(2, { discard }), L(3)] }));
    await click("courthouse-action-skip");
    expect(calls).toEqual([]);
    expect(at()).toBe("2 / 2"); // two lots offered: the discarded one is not
    expect(host.textContent).not.toContain("SYN-2");
  });
});

describe("the service worker queues exactly the courthouse bid log", () => {
  const sw = readFileSync(path.join(__dirname, "../../client/public/sw.js"), "utf8");
  const routes = eval(`(${sw.match(/const OFFLINE_QUEUEABLE_ROUTES = (\[[\s\S]*?\]);/)![1]})`) as string[];
  const patterns = eval(`(${sw.match(/const OFFLINE_QUEUEABLE_PATTERNS = (\[[\s\S]*?\]);/)![1]})`) as RegExp[];
  const queueable = (p: string) => routes.some((r) => p.startsWith(r)) || patterns.some((re) => re.test(p));

  it("queues the bid-log POST, and nothing else under the listing routes", () => {
    expect(patterns.length).toBeGreaterThan(0);
    expect(queueable("/api/tax-researcher/listings/42/bid-log")).toBe(true);
    for (const p of ["/api/tax-researcher/listings/42", "/api/tax-researcher/listings/42/max-bid", "/api/tax-researcher/listings/42/discard", "/api/auction-listings/42/log-bid"]) {
      expect(queueable(p), p).toBe(false);
    }
  });

  it("every queued prefix is served by a mounted route (a dead prefix queues requests nothing will ever answer)", () => {
    const manifest = readFileSync(path.join(__dirname, "../../server/routeManifest.ts"), "utf8");
    const mounts = [...manifest.matchAll(/mountPath:\s*"([^"]+)"/g)].map((m) => m[1]);
    expect(mounts.length).toBeGreaterThan(50);
    const routesSrc = readFileSync(path.join(__dirname, "../../server/routes.ts"), "utf8");
    for (const r of routes) {
      const mounted = mounts.some((m) => r.startsWith(m)) || routesSrc.includes(`"${r}`) || routesSrc.includes(`'${r}`);
      expect(mounted, `${r} is queued for offline replay but no mounted route serves it`).toBe(true);
    }
  });
});

describe("rights-stack editor", () => {
  it("previews the recorded stack with the shared derivation and can record it", async () => {
    stubFetch(() => json(200, {}));
    await mount(React.createElement(RightsStackEditor, { listing: { id: 7, apn: "SYN-7", marketValue: null, maxBidCents: BASIS.maxBidCents, maxBidBasis: BASIS }, onDone: () => undefined }));
    const screen = host.querySelector('[data-testid="stack-screen-7"]')!.textContent!;
    expect(screen).toMatch(/Max bid \$20,600\.00/);
    expect(screen).toMatch(/A screen: .*not an appraisal/);
    expect((host.querySelector('[data-testid="button-record-max-7"]') as HTMLButtonElement).disabled).toBe(false);
  });

  it("with gaps, lists what is missing and cannot record", async () => {
    stubFetch(() => json(200, {}));
    await mount(React.createElement(RightsStackEditor, { listing: { id: 8, apn: "SYN-8", marketValue: null, maxBidCents: null, maxBidBasis: null }, onDone: () => undefined }));
    const screen = host.querySelector('[data-testid="stack-screen-8"]')!.textContent!;
    expect(screen).toMatch(/No max bid yet\. Missing:/);
    for (const label of ["What the lot is worth", "Liens your search says survive the sale", "Other taxes you would have to pay", "Costs to clear title and hold", "Your required return"]) {
      expect(screen).toContain(label);
    }
    expect((host.querySelector('[data-testid="button-record-max-8"]') as HTMLButtonElement).disabled).toBe(true);
  });
});
