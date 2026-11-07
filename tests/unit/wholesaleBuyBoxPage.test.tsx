// @vitest-environment jsdom
/**
 * The buy-box page (Leg 2). FALSIFYING: absent on pre-leg main.
 *   - Save is disabled until states and a stale window are given, then posts
 *     a NEW version with exactly the criteria typed (no invented fields);
 *   - triage rows show the verdict and every named reason;
 *   - the page sits behind the Wholesale module, routed in App.tsx.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import fs from "node:fs";
import path from "node:path";
import { stripComments } from "../helpers/stripComments";

vi.mock("../../client/src/components/page-shell", () => ({
  PageShell: ({ children }: { children: React.ReactNode }) => React.createElement("main", null, children),
}));
vi.mock("../../client/src/hooks/use-document-title", () => ({ useDocumentTitle: () => undefined }));

const posts: Array<{ url: string; body: any }> = [];
const data: Record<string, unknown> = {};
vi.mock("../../client/src/lib/queryClient", async () => {
  const { QueryClient } = await import("@tanstack/react-query");
  return {
    queryClient: new QueryClient(),
    apiRequest: vi.fn(async (_m: string, url: string, body: any) => {
      posts.push({ url, body });
      return new Response(JSON.stringify({ current: { version: 1 } }), { status: 201 });
    }),
  };
});

import WholesaleBuyBoxPage, { criteriaFromForm } from "../../client/src/pages/wholesale/buy-box";

let container: HTMLDivElement;
let root: Root;
const q = (id: string) => container.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const byId = (id: string) => container.querySelector(`#${id}`) as HTMLInputElement;
function setValue(el: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value")!.set!;
  act(() => {
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function render() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, queryFn: async ({ queryKey }) => data[String(queryKey[0])] } },
  });
  await act(async () => {
    root.render(React.createElement(QueryClientProvider, { client }, React.createElement(WholesaleBuyBoxPage)));
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
}

beforeEach(() => {
  posts.length = 0;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("the buy-box page", () => {
  it("criteriaFromForm sends only what was typed", () => {
    expect(criteriaFromForm({ states: "", counties: "", zips: "", maxPrice: "", minFee: "", staleDays: "30" })).toBeNull();
    expect(criteriaFromForm({ states: "tx, fl", counties: "Harris TX", zips: "", maxPrice: "200,000", minFee: "", staleDays: "45" })).toEqual({
      states: ["TX", "FL"],
      counties: [{ county: "Harris", state: "TX" }],
      maxPurchasePriceCents: 20_000_000,
      staleAfterDays: 45,
    });
  });

  it("save is disabled until the buy box is complete, then posts a new version", async () => {
    data["/api/wholesale/buy-box"] = { current: null, versions: [] };
    await render();
    expect(q("buy-box-current")?.textContent).toMatch(/No buy box saved yet/);
    const save = q("buy-box-save") as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    setValue(byId("bb-states"), "TX");
    expect(save.disabled).toBe(false);
    await act(async () => {
      save.click();
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(posts).toEqual([{ url: "/api/wholesale/buy-box", body: { criteria: { states: ["TX"], staleAfterDays: 30 } } }]);
  });

  it("triage rows show the verdict and every named reason", async () => {
    data["/api/wholesale/buy-box"] = { current: { version: 2, criteria: {}, createdAt: "" }, versions: [{}, {}] };
    data["/api/wholesale/candidates/triage"] = {
      buyBoxVersion: 2,
      capped: false,
      rows: [
        { propertyId: 1, label: "9 Main St", verdict: "fails", score: 0.5, passed: ["In TX."], failures: ["ZIP 75201 is not one of your ZIPs."], unknowns: [] },
        { propertyId: 2, label: "3 Oak St", verdict: "retired", score: null, passed: [], failures: [], unknowns: [], retiredBecause: "No activity since 2026-01-15 — past your 30-day window." },
      ],
    };
    await render();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(q("buy-box-current")?.textContent).toMatch(/Version 2 is current \(2 saved\)/);
    expect(q("triage-1")?.textContent).toMatch(/Doesn't fit \(50%\).*ZIP 75201/);
    expect(q("triage-2")?.textContent).toMatch(/Retired.*No activity since 2026-01-15/);
  });
});

describe("placement", () => {
  const ROOT = path.resolve(__dirname, "../..");
  it("behind the Wholesale module and routed", () => {
    const sidebar = stripComments(fs.readFileSync(path.join(ROOT, "client/src/components/layout-sidebar.tsx"), "utf8"));
    const start = sidebar.indexOf('id: "wholesaler"');
    const module = sidebar.slice(start, sidebar.indexOf("\n  },", start));
    expect(module).toContain('businessTypeOnly: ["residential_wholesaler"]');
    expect(module).toContain('href: "/wholesale/buy-box"');
    const app = stripComments(fs.readFileSync(path.join(ROOT, "client/src/App.tsx"), "utf8"));
    expect(app).toMatch(/<Route path="\/wholesale\/buy-box">\s*\{\(\) => <ProtectedRoute component=\{WholesaleBuyBoxPage\} \/>\}/);
  });
});
