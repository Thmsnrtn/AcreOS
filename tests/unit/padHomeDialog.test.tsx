// @vitest-environment jsdom
/**
 * W2-MHP (2026-11-06) — a pad's "Home & meters" dialog is the client caller of
 * three mobile-home endpoints that shipped in Wave 5 with none:
 *   PATCH /api/rentals/units/:id/mobile-home, GET + POST /api/rentals/units/:id/meter-reads.
 *
 * Mounted through the REAL UnitsPanel (react-dom/client + a fetch stub — the
 * repo pattern, no @testing-library), so what is proven is the path a customer
 * takes — Units tab → pad row → dialog → the real routes — not merely that a
 * component exists. If the row action, the mount or the paths go, this goes red,
 * which is the whole point: "no client caller" cannot silently come back.
 *
 *   1. a pad row shows its recorded POH/TOH, and only pads offer the dialog;
 *   2. the dialog reads the pad's real meter-reads path: loading, empty, error, data;
 *   3. saving the home record PATCHes /mobile-home, a blank going out as null;
 *   4. recording a read POSTs /meter-reads, only once utility, date and reading are given.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("../../client/src/components/property-combobox", () => ({
  PropertyCombobox: () => React.createElement("span", null, "property"),
}));

import { getQueryFn } from "../../client/src/lib/queryClient";
import { UnitsPanel } from "../../client/src/components/rentals/units-panel";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PAD = {
  id: "pad-1", label: "Lot 7", kind: "pad", status: "active",
  bedrooms: null, bathrooms: null, squareFeet: null, marketRentCents: null, notes: null,
  leaseCount: 1, activeLeaseCount: 1,
  homeOwnership: "tenant_owned", chattelTitleType: null, chattelVin: null, chattelTitleStatus: null, chattelTitleNotes: null,
};
const APARTMENT = { ...PAD, id: "unit-2", label: "3B", kind: "unit", homeOwnership: null };
const READS_URL = "/api/rentals/units/pad-1/meter-reads";
const HOME_URL = "/api/rentals/units/pad-1/mobile-home";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

let calls: Array<{ method: string; url: string; body: unknown }>;
let readsReply: () => Promise<Response>;
let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  calls = [];
  readsReply = async () => json({ reads: [], count: 0 });
  vi.stubGlobal("fetch", vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (url === "/api/rentals/properties/7/units") return json({ units: [PAD, APARTMENT], count: 2 });
    if (url === READS_URL && method === "GET") return readsReply();
    if (url === READS_URL && method === "POST") return json({ meterRead: { id: "r9" } });
    if (url === HOME_URL && method === "PATCH") return json({ unit: PAD, record: "This records what you asserted." });
    return json({});
  }));
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const settle = async () => {
  for (let i = 0; i < 8; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
};
const $ = (id: string) => document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;

async function mountAndOpen() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0, queryFn: getQueryFn({ on401: "throw" }) } } });
  await act(async () => {
    root.render(React.createElement(QueryClientProvider, { client }, React.createElement(UnitsPanel, { initialPropertyId: 7 })));
  });
  await settle();
  await act(async () => { $("button-pad-home-pad-1")!.click(); });
  await settle();
  expect($("pad-home-dialog"), "the pad's Home & meters action did not open the dialog").not.toBeNull();
}

function type(el: Element, value: string) {
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype
    : el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  act(() => {
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
  });
}
const field = (id: string) => document.getElementById(id)!;

describe("1. the Units tab offers the home side on pads only", () => {
  it("shows a pad's recorded ownership and a Home & meters action; an apartment gets neither", async () => {
    await mountAndOpen();
    expect($("row-unit-pad-1")!.textContent).toContain("Pad · TOH");
    expect($("button-pad-home-unit-2")).toBeNull();
    expect($("row-unit-unit-2")!.textContent).not.toMatch(/POH|TOH/);
    expect(
      $("button-pad-home-pad-1")!.getAttribute("aria-label"),
      "the accessible name must contain the visible text",
    ).toBe("Home & meters for pad Lot 7");
  });
});

describe("2. the dialog reads the pad's real meter-reads path", () => {
  it("GETs exactly /api/rentals/units/:id/meter-reads", async () => {
    await mountAndOpen();
    expect(calls.some((c) => c.method === "GET" && c.url === READS_URL)).toBe(true);
  });

  it("loading: skeleton rows while the reads are in flight", async () => {
    readsReply = () => new Promise<Response>(() => {});
    await mountAndOpen();
    expect($("meter-reads-loading")).not.toBeNull();
    expect($("meter-reads-empty")).toBeNull();
  });

  it("empty: says none are recorded — never an invented read", async () => {
    await mountAndOpen();
    expect($("meter-reads-empty")!.textContent).toMatch(/No meter reads recorded/);
    expect($("meter-reads-table")).toBeNull();
  });

  it("error: a retryable error state, not an empty one", async () => {
    readsReply = async () => json({ error: "INTERNAL", message: "boom", statusCode: 500 }, 500);
    await mountAndOpen();
    expect($("meter-reads-error")).not.toBeNull();
    expect($("meter-reads-empty")).toBeNull();
  });

  it("data: each read exactly as recorded — date, utility, face value, notes", async () => {
    readsReply = async () => json({
      reads: [{ id: "r1", utilityKind: "water", readOn: "2026-10-31", reading: "1234.50", notes: null }],
      count: 1,
    });
    await mountAndOpen();
    const row = $("meter-read-r1")!.textContent!;
    expect(row).toContain("2026-10-31");
    expect(row).toContain("Water");
    expect(row).toContain("1234.50");
  });
});

describe("3. saving the home record", () => {
  it("PATCHes /mobile-home with the operator's answers; a blank goes out as null", async () => {
    await mountAndOpen();
    expect((field("pad-owner") as HTMLSelectElement).value, "prefilled from the pad row").toBe("tenant_owned");
    type(field("pad-owner"), "park_owned");
    type(field("pad-vin"), "  SYNTH-VIN-1 ");
    await act(async () => { $("pad-home-save")!.click(); });
    await settle();
    const patch = calls.find((c) => c.method === "PATCH");
    expect(patch?.url).toBe(HOME_URL);
    expect(patch?.body).toEqual({
      homeOwnership: "park_owned",
      chattelTitleType: null,
      chattelVin: "SYNTH-VIN-1",
      chattelTitleStatus: null,
      chattelTitleNotes: null,
    });
  });
});

describe("4. recording a meter read", () => {
  it("is refused until utility, date and reading are all given, then POSTs the real path", async () => {
    await mountAndOpen();
    const submit = $("meter-read-submit") as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    type(field("read-on"), "2026-10-31");
    type(field("read-value"), "1234.5");
    expect(submit.disabled, "no utility chosen — must not record").toBe(true);
    type(field("read-utility"), "water");
    expect(submit.disabled).toBe(false);
    await act(async () => { submit.click(); });
    await settle();
    const post = calls.find((c) => c.method === "POST");
    expect(post?.url).toBe(READS_URL);
    expect(post?.body).toEqual({ utilityKind: "water", readOn: "2026-10-31", reading: 1234.5, notes: null });
  });
});
