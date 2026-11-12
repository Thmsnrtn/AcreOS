// @vitest-environment jsdom
/**
 * W2-COMMERCIAL — the Commercial tab on /leases (client/src/components/rentals/
 * commercial-panel.tsx). Rendered for real against a mocked network, so "no
 * client caller" cannot silently return: every assertion about a path is about a
 * request the rendered panel actually made.
 *
 *   - loading / error / empty states use Skeleton / QueryErrorState / EmptyState;
 *   - with a lease chosen it READS the real endpoints (per-sqft, rent-schedule,
 *     cam-pools, reconciliations) and shows the server's figures, not its own;
 *   - "Reconcile this lease" POSTs to the real generate path with the landlord's
 *     stated total (blank → null, never 0), and a refusal is shown verbatim;
 *   - "Save terms" PATCHes the real commercial-terms path; blank → null;
 *   - the tab exists only for a commercial org.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Radix Select does not open in jsdom — a native <select> with the same contract.
vi.mock("../../client/src/components/ui/select", () => ({
  Select: ({ value, onValueChange, children }: any) =>
    React.createElement("select", { "data-select": "1", value, onChange: (e: any) => onValueChange(e.target.value) },
      React.createElement("option", { value: "" }, "—"), children),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: any) => React.createElement(React.Fragment, null, children),
  SelectItem: ({ value, children }: any) => React.createElement("option", { value }, children),
}));

const h = vi.hoisted(() => ({ businessType: "commercial" as string }));
vi.mock("wouter", () => ({
  useSearch: () => "",
  Link: ({ href, children }: any) => React.createElement("a", { href }, children),
}));
vi.mock("../../client/src/components/page-shell", () => ({
  PageShell: ({ children }: any) => React.createElement("main", null, children),
}));
vi.mock("../../client/src/hooks/use-document-title", () => ({ useDocumentTitle: () => undefined }));
vi.mock("../../client/src/hooks/use-organization", () => ({
  useOrganization: () => ({ data: { onboardingData: { businessType: h.businessType } } }),
}));
for (const p of ["units-panel", "expenses-panel", "t12-workspace", "bookings-panel"]) {
  vi.doMock(`../../client/src/components/rentals/${p}`, () => ({
    UnitsPanel: () => null, ExpensesPanel: () => null, T12Workspace: () => null, BookingsPanel: () => null,
  }));
}

import { getQueryFn } from "../../client/src/lib/queryClient";
import { CommercialPanel } from "../../client/src/components/rentals/commercial-panel";

const LEASE = {
  id: "lease-1", propertyId: 11, unitLabel: "Suite 200", status: "active", monthlyRentCents: 1_000_000,
  rentableSqft: 2_000, leaseType: "nnn", camProRataBps: null, camEstimateMonthlyCents: 150_000, camBaseYearStopCents: null,
};
const POOL = {
  id: "pool-1", poolKind: "cam", periodStart: "2026-01-01", periodEnd: "2026-12-31",
  recoverableCategories: ["repairs"], totalRentableSqft: 10_000, adminFeeBps: null, grossUpPct: null,
};

type Reply = { status: number; body: unknown } | "pending";
let routes: Record<string, Reply>;
const calls: Array<{ method: string; url: string; body: any }> = [];

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

let container: HTMLDivElement;
let root: Root;
const q = (id: string) => container.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;

async function settle() {
  for (let i = 0; i < 4; i++) await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
}
async function render(el: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, queryFn: getQueryFn({ on401: "throw" }) }, mutations: { retry: false } } });
  await act(async () => { root.render(React.createElement(QueryClientProvider, { client }, el)); });
  await settle();
}
function setValue(el: HTMLInputElement | HTMLSelectElement, value: string) {
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  act(() => {
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
  });
}
async function pickLease() {
  setValue(container.querySelector("select") as HTMLSelectElement, LEASE.id);
  await settle();
}

const realFetch = globalThis.fetch;
beforeEach(() => {
  calls.length = 0;
  h.businessType = "commercial";
  routes = {
    "GET /api/leases": { status: 200, body: { leases: [LEASE] } },
    "GET /api/leases/lease-1/per-sqft": { status: 200, body: { perSqft: {
      baseRentPerSqftAnnualCents: 6_180, occupancyCostPerSqftAnnualCents: 7_080, monthlyRentCentsUsed: 1_030_000,
      asOfMonth: "2026-11", unavailable: false, occupancyCostBasis: "base_plus_cam_estimate", rentableSqft: 2_000 } } },
    "GET /api/leases/lease-1/rent-schedule": { status: 200, body: { steps: [{ id: "s1", effectiveMonth: "2026-01-01", stepType: "fixed_pct", amountCents: null, pctBps: 300, cpiIndexBase: null, cpiIndexCurrent: null, floorPctBps: null, ceilingPctBps: null }], count: 1 } },
    "GET /api/properties/11/cam-pools": { status: 200, body: { pools: [POOL], count: 1 } },
    "GET /api/cam-pools/pool-1/reconciliations": { status: 200, body: { reconciliations: [], count: 0 } },
  };
  globalThis.fetch = vi.fn(async (url: any, init?: RequestInit) => {
    const method = (init?.method ?? "GET").toUpperCase();
    const u = String(url);
    calls.push({ method, url: u, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const r = routes[`${method} ${u}`];
    if (r === "pending") return new Promise<Response>(() => {});
    return r ? json(r.status, r.body) : json(404, { error: "NOT_FOUND", message: "unmocked" });
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

describe("states", () => {
  it("loading → skeletons, not a spinner", async () => {
    routes["GET /api/leases"] = "pending";
    await render(React.createElement(CommercialPanel));
    expect(container.querySelector(".animate-pulse, [class*='skeleton']")).not.toBeNull();
    expect(q("commercial-panel")).toBeNull();
  });

  it("error → QueryErrorState with retry", async () => {
    routes["GET /api/leases"] = { status: 500, body: { error: "X", message: "boom" } };
    await render(React.createElement(CommercialPanel));
    expect(q("commercial-leases-error")).not.toBeNull();
  });

  it("no leases → EmptyState", async () => {
    routes["GET /api/leases"] = { status: 200, body: { leases: [] } };
    await render(React.createElement(CommercialPanel));
    expect(q("commercial-no-leases")).not.toBeNull();
  });

  it("no lease chosen → asks for one and reads nothing lease-specific", async () => {
    await render(React.createElement(CommercialPanel));
    expect(q("commercial-no-lease")).not.toBeNull();
    expect(calls.map((c) => c.url)).toEqual(["/api/leases"]);
  });
});

describe("with a lease: the real endpoints, the server's figures", () => {
  it("reads per-sqft, rent-schedule, cam-pools and reconciliations from their real paths", async () => {
    await render(React.createElement(CommercialPanel));
    await pickLease();
    const gets = calls.filter((c) => c.method === "GET").map((c) => c.url);
    for (const p of [
      "/api/leases/lease-1/per-sqft",
      "/api/leases/lease-1/rent-schedule",
      "/api/properties/11/cam-pools",
      "/api/cam-pools/pool-1/reconciliations",
    ]) expect(gets, p).toContain(p);
    // The figures are the server's: $61.80 base, $70.80 occupancy.
    expect(q("commercial-per-sqft")!.textContent).toContain("$61.80");
    expect(q("commercial-per-sqft")!.textContent).toContain("$70.80");
    // The step row shows the rent the canonical escalation engine computes: $10,300.
    expect(q("commercial-steps")!.textContent).toContain("$10,300.00");
  });

  it("Reconcile POSTs to the generate path with the stated total, and shows a refusal verbatim", async () => {
    const refusal = "AcreOS has no record of the CAM estimates billed to this tenant for the period.";
    routes["POST /api/cam-pools/pool-1/reconciliations/generate"] = { status: 400, body: { error: "BAD_REQUEST", message: refusal } };
    await render(React.createElement(CommercialPanel));
    await pickLease();
    await act(async () => { q("commercial-reconcile-pool-1")!.click(); });
    await settle();
    const post = calls.find((c) => c.method === "POST")!;
    expect(post.url).toBe("/api/cam-pools/pool-1/reconciliations/generate");
    // Blank means "not entered" — sent as null, never as 0.
    expect(post.body).toEqual({ leaseId: "lease-1", estimatedBilledCents: null });
    expect(q("commercial-reconcile-refusal")!.textContent).toBe(refusal);

    setValue(container.querySelector("#cp-billed-pool-1") as HTMLInputElement, "250");
    await act(async () => { q("commercial-reconcile-pool-1")!.click(); });
    await settle();
    expect(calls.filter((c) => c.method === "POST").at(-1)!.body.estimatedBilledCents).toBe(25_000);
  });

  it("shows a frozen statement with its provenance", async () => {
    routes["GET /api/cam-pools/pool-1/reconciliations"] = { status: 200, body: { reconciliations: [
      { leaseId: "lease-1", statementMarkdown: "- **Balance due: $50.00**", generatedAt: "2026-11-06T12:00:00Z", generatedBy: "engine" },
    ] } };
    await render(React.createElement(CommercialPanel));
    await pickLease();
    expect(q("commercial-cam-statement")!.textContent).toContain("Balance due: $50.00");
    expect(q("commercial-pool-pool-1")!.textContent).toContain("Computed by AcreOS on 2026-11-06");
  });

  it("Save terms PATCHes the real commercial-terms path; blank is null, money in cents", async () => {
    routes["PATCH /api/leases/lease-1/commercial-terms"] = { status: 200, body: { lease: LEASE } };
    await render(React.createElement(CommercialPanel));
    await pickLease();
    setValue(container.querySelector("#ct-share") as HTMLInputElement, "12.5");
    await act(async () => { q("commercial-terms-save")!.click(); });
    await settle();
    const patch = calls.find((c) => c.method === "PATCH")!;
    expect(patch.url).toBe("/api/leases/lease-1/commercial-terms");
    expect(patch.body).toEqual({
      rentableSqft: 2_000, leaseType: "nnn", camProRataBps: 1_250, camEstimateMonthlyCents: 150_000, camBaseYearStopCents: null,
    });
  });
});

describe("the tab is commercial-only", () => {
  it.each([["commercial", true], ["buy_and_hold", false]])("%s → tab present: %s", async (bt, present) => {
    h.businessType = bt as string;
    const { default: LeasesPage } = await import("../../client/src/pages/leases");
    await render(React.createElement(LeasesPage));
    expect(q("tab-commercial") !== null).toBe(present);
    expect(q("tab-leases")).not.toBeNull();
  });
});
