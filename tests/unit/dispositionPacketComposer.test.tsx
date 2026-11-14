// @vitest-environment jsdom
/**
 * The disposition packet reaches buyers ONLY through the existing blast lane
 * (Leg 4): the composer's "Fill from disposition packet" drafts the packet into
 * the composer's own subject/body, and the only send is the composer's existing
 * POST /api/properties/:id/blast-buyers. FALSIFYING: on pre-leg code the button
 * does not exist.
 *
 *   - no property id → the button is disabled (nothing to derive from);
 *   - with one, it GETs the packet (no write) and fills subject + body, and
 *     says the price was derived just now;
 *   - a price above the buyer's ceiling is flagged, not hidden;
 *   - a refusal is surfaced and fills nothing;
 *   - drafting issues no POST at all.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("wouter", () => ({
  useRoute: () => [false, null],
  useLocation: () => ["/", () => undefined],
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => React.createElement("a", { href }, children),
}));
vi.mock("../../client/src/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

import { BuyerBlastsPanel } from "../../client/src/pages/buyer-blasts";

let container: HTMLDivElement;
let root: Root;
const calls: Array<{ url: string; method: string }> = [];
let packetResponse: { status: number; body: unknown } = { status: 200, body: {} };
const realFetch = globalThis.fetch;

const q = (id: string) => document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const byId = (id: string) => document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement;
function setValue(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value")!.set!;
  act(() => {
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function settle() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 30));
  });
}
async function openComposer() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(React.createElement(QueryClientProvider, { client }, React.createElement(BuyerBlastsPanel)));
  });
  await settle();
  act(() => q("new-blast-button")!.click());
  await settle();
}

beforeEach(() => {
  calls.length = 0;
  globalThis.fetch = vi.fn(async (url: any, init?: RequestInit) => {
    const u = String(url);
    calls.push({ url: u, method: (init?.method ?? "GET").toUpperCase() });
    if (u.includes("/disposition-packet")) {
      return new Response(JSON.stringify(packetResponse.body), { status: packetResponse.status, headers: { "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({ blasts: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  globalThis.fetch = realFetch;
});

describe("Fill from disposition packet", () => {
  it("is disabled until a property is named", async () => {
    await openComposer();
    expect((q("fill-disposition-packet") as HTMLButtonElement).disabled).toBe(true);
    setValue(byId("bb-property"), "7");
    expect((q("fill-disposition-packet") as HTMLButtonElement).disabled).toBe(false);
  });

  it("drafts the packet into the composer with a GET and nothing else", async () => {
    packetResponse = {
      status: 200,
      body: { subject: "Assignment: 9 Main St — $150,000", html: "<p>Price: <strong>$150,000</strong></p>", price: { buyerPriceCents: 15_000_000, buyerSideMaoCents: 16_600_000, withinBuyerCeiling: true } },
    };
    await openComposer();
    setValue(byId("bb-property"), "7");
    act(() => q("fill-disposition-packet")!.click());
    await settle();
    expect(byId("bb-subject").value).toBe("Assignment: 9 Main St — $150,000");
    expect(byId("bb-body").value).toContain("$150,000");
    expect(q("disposition-packet-note")?.textContent).toMatch(/derived just now/i);
    const packetCalls = calls.filter((c) => c.url.includes("/disposition-packet"));
    expect(packetCalls).toEqual([{ url: "/api/wholesale/properties/7/disposition-packet", method: "GET" }]);
    expect(calls.filter((c) => c.method !== "GET")).toEqual([]);
  });

  it("flags a price above the buyer's ceiling", async () => {
    packetResponse = { status: 200, body: { subject: "s", html: "h", price: { buyerPriceCents: 17_000_000, buyerSideMaoCents: 16_600_000, withinBuyerCeiling: false } } };
    await openComposer();
    setValue(byId("bb-property"), "7");
    act(() => q("fill-disposition-packet")!.click());
    await settle();
    expect(q("disposition-packet-note")?.textContent).toMatch(/above your buyer's ceiling of \$166,000/i);
  });

  it("a refusal fills nothing", async () => {
    packetResponse = { status: 409, body: { message: "No accepted contract price" } };
    await openComposer();
    setValue(byId("bb-property"), "7");
    act(() => q("fill-disposition-packet")!.click());
    await settle();
    expect(byId("bb-subject").value).toBe("");
    expect(q("disposition-packet-note")).toBeNull();
  });
});
