// @vitest-environment jsdom
/**
 * Buy-and-hold intake → pipeline wiring (claude-package buy-and-hold 2026-11,
 * Leg 2 / §8.2). Navigation only, and pinned as such:
 *
 *   8. Deep link — /rentals/underwrite?propertyId=<id> opens the REAL desk page
 *      with that property preselected; a junk id preselects nothing.
 *   9. Handoff shape — a recorded `acquire` offers unit setup for the SAME
 *      property; `offer` and `pass` offer no pipeline step. Following the link
 *      writes nothing: the only non-GET requests in the whole flow are the
 *      preview and the decision itself, and the units surface it opens only
 *      READS that property's units.
 *  10. Vertical gating — the sidebar child and the property-page entry are
 *      gated to buy_and_hold; the route stays org-scoped regardless (the
 *      real-database test proves the 404).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import fs from "node:fs";
import path from "node:path";
import { stripComments } from "../helpers/stripComments";

const h = vi.hoisted(() => ({ search: "", comboboxValues: [] as Array<number | null> }));

vi.mock("wouter", () => ({
  useSearch: () => h.search,
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) =>
    React.createElement("a", { href, ...rest }, children),
}));
vi.mock("../../client/src/components/page-shell", () => ({
  PageShell: ({ children }: { children: React.ReactNode }) => React.createElement("main", null, children),
}));
vi.mock("../../client/src/hooks/use-document-title", () => ({ useDocumentTitle: () => undefined }));
vi.mock("../../client/src/components/property-combobox", () => ({
  PropertyCombobox: (p: { value: number | null; onChange: (id: number) => void; "data-testid"?: string }) => {
    h.comboboxValues.push(p.value);
    return React.createElement(
      "button",
      { type: "button", "data-testid": p["data-testid"], "data-value": String(p.value), onClick: () => p.onChange(p.value ?? 7) },
      "pick",
    );
  },
}));

const requests: Array<{ method: string; url: string }> = [];
vi.mock("../../client/src/lib/queryClient", () => ({
  apiRequest: vi.fn(async (method: string, url: string, body: any) => {
    requests.push({ method, url });
    const json =
      url === "/api/scenarios/preview"
        ? { engineId: "rental_acquisition", engineVersion: "v", metrics: [{ id: "cash_on_cash", value: 0.08, unit: "ratio" }], assumptions: [], inputs: body.inputs }
        : { decisionId: 901, scenarioId: 501 };
    return new Response(JSON.stringify(json), { status: 200, headers: { "Content-Type": "application/json" } });
  }),
}));

import UnderwriteRentalPage from "../../client/src/pages/rentals/underwrite-rental";
import { RENTAL_ACQUISITION_FIELDS } from "../../shared/economics/fields/rentalAcquisition";

let container: HTMLDivElement;
let root: Root;
const q = (id: string) => container.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;

async function render(el: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(React.createElement(QueryClientProvider, { client }, el));
  });
}
async function settle() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 450));
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
}
function setValue(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value")!.set!;
  act(() => {
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** Fill every REQUIRED field with an operator's own number, then record `kind`. */
async function recordCall(kind: "acquire" | "offer" | "pass") {
  for (const f of RENTAL_ACQUISITION_FIELDS) {
    if (f.optional) continue;
    setValue(q(`underwrite-rental-field-${f.key}`) as HTMLInputElement, "10");
  }
  await settle();
  act(() => q(`underwrite-rental-kind-${kind}`)!.click());
  setValue(q("underwrite-rental-rationale") as HTMLTextAreaElement, "Cash flow clears our floor.");
  act(() => q("underwrite-rental-review-in-14")!.click());
  const record = q("underwrite-rental-record") as HTMLButtonElement;
  expect(record.disabled, "the desk should be recordable once every answer is given").toBe(false);
  await act(async () => {
    record.click();
    await new Promise((r) => setTimeout(r, 20));
  });
  expect(q("underwrite-rental-recorded"), "the decision was not recorded").not.toBeNull();
}

const fetchCalls: Array<{ url: string; method: string }> = [];
const realFetch = globalThis.fetch;
beforeEach(() => {
  fetchCalls.length = 0;
  globalThis.fetch = vi.fn(async (url: any, init?: RequestInit) => {
    fetchCalls.push({ url: String(url), method: (init?.method ?? "GET").toUpperCase() });
    // An empty org: every list the rentals pages read comes back empty.
    return new Response(JSON.stringify({ leases: [], units: [], count: 0 }), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  requests.length = 0;
  h.comboboxValues.length = 0;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  globalThis.fetch = realFetch;
});

describe("8. the deep link opens the desk with the property preselected", () => {
  it("?propertyId=7 preselects property 7", async () => {
    h.search = "propertyId=7";
    await render(React.createElement(UnderwriteRentalPage));
    expect(q("underwrite-rental-workbench")).not.toBeNull();
    expect(q("underwrite-rental-property")?.getAttribute("data-value")).toBe("7");
  });

  it.each(["", "propertyId=abc", "propertyId=-3", "propertyId=1.5"])("%s preselects nothing", async (s) => {
    h.search = s;
    await render(React.createElement(UnderwriteRentalPage));
    expect(q("underwrite-rental-property")?.getAttribute("data-value")).toBe("null");
  });
});

describe("9. the acquire handoff is a link a human follows — for the same property, and nothing else", () => {
  it("acquire: the recorded state links to unit setup for property 7", async () => {
    h.search = "propertyId=7";
    await render(React.createElement(UnderwriteRentalPage));
    await recordCall("acquire");
    const link = q("underwrite-rental-next-step-units") as HTMLAnchorElement | null;
    expect(link, "acquire must offer the pipeline step").not.toBeNull();
    expect(link!.getAttribute("href")).toBe("/leases?tab=units&propertyId=7");
    // The copy states the boundary: nothing created, nothing copied.
    expect(q("underwrite-rental-next-step")?.textContent).toMatch(/Nothing has been created there yet/);
    expect(q("underwrite-rental-next-step")?.textContent).toMatch(/nothing from these numbers is copied/);

    // The whole flow made exactly two writes, both through apiRequest: the
    // preview (computes, persists nothing) and the decision. Nothing went
    // around it with a raw fetch, and the handoff is a plain href — no handler.
    const writes = requests.filter((r) => r.method !== "GET").map((r) => r.url);
    expect(new Set(writes)).toEqual(new Set(["/api/scenarios/preview", "/api/buy-and-hold/underwrite"]));
    expect(writes.filter((u) => u === "/api/buy-and-hold/underwrite")).toHaveLength(1);
    expect(fetchCalls).toEqual([]);

    // Follow it, as a person would: still no write of any kind.
    await act(async () => {
      link!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(requests.filter((r) => r.method !== "GET").length).toBe(writes.length);
    expect(fetchCalls.filter((c) => c.method !== "GET")).toEqual([]);
  });

  it.each(["offer", "pass"] as const)("%s: no pipeline step is offered", async (kind) => {
    h.search = "propertyId=7";
    await render(React.createElement(UnderwriteRentalPage));
    await recordCall(kind);
    expect(q("underwrite-rental-next-step")).toBeNull();
    expect(container.querySelector('a[href^="/leases"]')).toBeNull();
  });
});

describe("9. the units surface the link opens only READS the carried property", () => {
  it("UnitsPanel preselects the deep-linked property and issues only a GET for its units", async () => {
    const calls: Array<{ url: string; method: string }> = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (url: any, init?: RequestInit) => {
      calls.push({ url: String(url), method: (init?.method ?? "GET").toUpperCase() });
      return new Response(JSON.stringify({ units: [], count: 0 }), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as typeof fetch;
    try {
      vi.resetModules();
      const { UnitsPanel } = await import("../../client/src/components/rentals/units-panel");
      await render(React.createElement(UnitsPanel, { initialPropertyId: 7 }));
      await settle();
      expect(calls.some((c) => c.url === "/api/rentals/properties/7/units")).toBe(true);
      expect(calls.filter((c) => c.method !== "GET")).toEqual([]);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

describe("9. /leases carries the deep-linked property into the Units tab", () => {
  it.each([
    ["tab=units&propertyId=7", 7],
    ["tab=units", null],
    ["tab=units&propertyId=abc", null],
  ])("%s → UnitsPanel initialPropertyId %s", async (search, expected) => {
    vi.resetModules();
    const seen: Array<number | null | undefined> = [];
    vi.doMock("../../client/src/components/rentals/units-panel", () => ({
      UnitsPanel: (p: { initialPropertyId?: number | null }) => {
        seen.push(p.initialPropertyId);
        return React.createElement("div", { "data-testid": "units-panel-stub" });
      },
    }));
    h.search = search;
    const { default: LeasesPage } = await import("../../client/src/pages/leases");
    await render(React.createElement(LeasesPage));
    await settle();
    expect(q("units-panel-stub"), "the Units tab did not open from ?tab=units").not.toBeNull();
    expect(seen.at(-1)).toBe(expected);
    vi.doUnmock("../../client/src/components/rentals/units-panel");
  });
});

describe("10. vertical gating", () => {
  const ROOT = path.resolve(__dirname, "../..");
  const read = (p: string) => stripComments(fs.readFileSync(path.join(ROOT, p), "utf8"));

  it("the sidebar child sits inside the Rentals module and is gated to buy_and_hold alone", () => {
    const sidebar = read("client/src/components/layout-sidebar.tsx");
    const start = sidebar.indexOf('id: "landlord"');
    const end = sidebar.indexOf('id: "flipper"', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const rentals = sidebar.slice(start, end);
    const child = rentals.split("\n").find((l) => l.includes('href: "/rentals/underwrite"'));
    expect(child, "the desk is not a child of the Rentals module").toBeDefined();
    expect(child).toMatch(/businessTypeOnly:\s*\["buy_and_hold"\]\s*}/);
    // Nowhere else in the nav: one child, no new door.
    expect(sidebar.split('href: "/rentals/underwrite"').length - 1).toBe(1);
  });

  it("the property page offers the desk only to a buy_and_hold org", () => {
    const page = read("client/src/pages/parcel-detail.tsx");
    const at = page.indexOf("/rentals/underwrite?propertyId=");
    expect(at).toBeGreaterThan(-1);
    // The nearest condition guarding it is the buy_and_hold check.
    const guard = page.lastIndexOf("businessType ===", at);
    expect(guard).toBeGreaterThan(-1);
    expect(page.slice(guard, at)).toMatch(/^businessType === "buy_and_hold" \? \(/);
    expect(page.split("/rentals/underwrite").length - 1).toBe(1);
  });
});
