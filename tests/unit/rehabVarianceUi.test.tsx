// @vitest-environment jsdom
/**
 * The rehab page and bids section render the variance as the package specifies
 * (fix-and-flip package, Leg 2, §4.1–4.5; nano bar).
 *   - three distinct names (Estimate / Committed / Actual), and a line nothing is
 *     committed on reads "not committed", never $0;
 *   - after planning, estimates render read-only and the lock's reason is shown;
 *   - flags list the facts the server computed;
 *   - bids show the project's estimate per category and an arithmetic delta,
 *     and an accepted bid offers the explicit "Apply as committed" act.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("wouter", () => ({
  useRoute: () => [true, { id: "r1" }],
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => React.createElement("a", { href }, children),
}));
vi.mock("../../client/src/components/page-shell", () => ({ PageShell: ({ children }: { children: React.ReactNode }) => React.createElement("main", null, children) }));
vi.mock("../../client/src/hooks/use-document-title", () => ({ useDocumentTitle: () => undefined }));
vi.mock("../../client/src/components/rehabs/draws-section", () => ({ DrawsSection: () => null }));
vi.mock("../../client/src/components/parcels/arv-calculator", () => ({ ArvCalculator: () => null }));
vi.mock("../../client/src/components/rehabs/rehab-photo-gallery", () => ({ RehabPhotoGallery: () => null }));
vi.mock("../../client/src/components/rehabs/bids-section", async (orig) => orig());

const h = vi.hoisted(() => ({ locked: true }));

const LINES = [
  { id: "k", sequence: 0, category: "kitchen", scope: "Kitchen", budgetCents: 1_500_000, committedCents: 1_650_000, spentCents: 1_824_000 },
  { id: "f", sequence: 1, category: "flooring", scope: "Floors", budgetCents: 600_000, committedCents: 0, spentCents: 200_000 },
];

function detail() {
  return {
    rehab: { id: "r1", propertyId: 1, name: "1 Elm", status: h.locked ? "demo" : "planning", startedAt: null, plannedListingDate: null, purchasePriceCents: null, purchaseClosingCents: null, budgetTotalCents: null, spentTotalCents: 2_024_000, holdingCostMonthlyCents: null, arvCents: null, targetMarginCents: null, notes: null },
    items: LINES,
    variance: {
      lines: [
        { id: "k", estimateCents: 1_500_000, committedCents: 1_650_000, actualCents: 1_824_000, actualVsEstimateCents: 324_000, actualVsCommittedCents: 174_000 },
        { id: "f", estimateCents: 600_000, committedCents: null, actualCents: 200_000, actualVsEstimateCents: -400_000, actualVsCommittedCents: null },
      ],
      project: { estimateCents: 2_100_000, committedCents: 1_650_000, committedLineCount: 1, uncommittedLineCount: 1, actualCents: 2_024_000, actualVsEstimateCents: -76_000, actualVsCommittedCents: 174_000 },
      flags: [{ kind: "line_actual_over_estimate", fact: "Kitchen: spent $18,240 vs $15,000 estimate" }],
    },
    estimateLock: h.locked ? { locked: true, message: "This project has left planning, so its line estimates are locked — … change order …" } : { locked: false },
    totals: { budgetCents: 2_100_000, committedCents: 1_650_000, spentCents: 2_024_000, varianceCents: -76_000, byCategory: {}, daysOnSite: null, accruedHoldingCents: null },
  };
}
const BIDS = {
  bids: [
    { id: "b1", contractorId: "c1", contractorName: "GC One", totalCents: 2_430_000, submittedAt: null, validUntil: null, categoryBreakdown: { kitchen: 1_650_000, flooring: 780_000 }, isAccepted: true, rejectedAt: null,
      vsEstimate: [{ category: "flooring", bidCents: 780_000, estimateCents: 600_000, deltaCents: 180_000, deltaPct: 30 }, { category: "kitchen", bidCents: 1_650_000, estimateCents: 1_500_000, deltaCents: 150_000, deltaPct: 10 }] },
    { id: "b2", contractorId: "c2", contractorName: "GC Two", totalCents: 930_000, submittedAt: null, validUntil: null, categoryBreakdown: { kitchen: 930_000 }, isAccepted: false, rejectedAt: "2026-11-01",
      vsEstimate: [{ category: "kitchen", bidCents: 930_000, estimateCents: 1_500_000, deltaCents: -570_000, deltaPct: -38 }] },
  ],
  categories: ["flooring", "kitchen"],
  matrix: [
    { category: "flooring", cells: [{ bidId: "b1", contractorName: "GC One", cents: 780_000 }, { bidId: "b2", contractorName: "GC Two", cents: null }], minCents: 780_000, maxCents: 780_000, spreadCents: 0 },
    { category: "kitchen", cells: [{ bidId: "b1", contractorName: "GC One", cents: 1_650_000 }, { bidId: "b2", contractorName: "GC Two", cents: 930_000 }], minCents: 930_000, maxCents: 1_650_000, spreadCents: 720_000 },
  ],
};

let container: HTMLDivElement;
let root: Root;
const q = (id: string) => container.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const realFetch = globalThis.fetch;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  globalThis.fetch = vi.fn(async (url: any) => {
    const u = String(url);
    const body = u.endsWith("/bids") ? BIDS : u.includes("/api/contractors") ? { contractors: [] } : u.includes("scope-templates") ? { templates: [] } : detail();
    return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  globalThis.fetch = realFetch;
});

async function renderPage() {
  const { default: Page } = await import("../../client/src/pages/rehab-detail");
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, queryFn: async ({ queryKey }) => (await fetch(String(queryKey.join("/").replace("//", "/")))).json() } } });
  await act(async () => {
    root.render(React.createElement(QueryClientProvider, { client }, React.createElement(Page)));
  });
  for (let i = 0; i < 4; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
  }
}

describe("rehab page — three-way variance", () => {
  it("names the three figures, and an uncommitted line reads 'not committed', never $0", async () => {
    h.locked = true;
    await renderPage();
    const headers = Array.from(container.querySelectorAll("th")).map((t) => t.textContent);
    for (const name of ["Estimate", "Committed", "Actual", "Actual vs estimate", "Actual vs committed"]) expect(headers).toContain(name);
    expect(q("vs-committed-f")?.textContent).toBe("not committed");
    expect(q("vs-committed-k")?.textContent).toMatch(/1,740/);
    const committedInput = container.querySelector('input[aria-label="Committed for Floors"]') as HTMLInputElement;
    expect(committedInput.value).toBe("");
    expect(committedInput.placeholder).toBe("not committed");
  });

  it("after planning, estimates are read-only and the lock's reason is shown", async () => {
    h.locked = true;
    await renderPage();
    expect(q("rehab-estimate-locked")?.textContent).toMatch(/change order/);
    expect(container.querySelector('input[aria-label="Estimate for Kitchen"]')).toBeNull();
    expect(q("estimate-locked-k")).not.toBeNull();
  });

  it("in planning, estimates are editable and no lock is shown", async () => {
    h.locked = false;
    await renderPage();
    expect(q("rehab-estimate-locked")).toBeNull();
    expect(container.querySelector('input[aria-label="Estimate for Kitchen"]')).not.toBeNull();
  });

  it("flags list the server's facts", async () => {
    h.locked = true;
    await renderPage();
    expect(q("rehab-variance-flags")?.textContent).toMatch(/Kitchen: spent \$18,240 vs \$15,000 estimate/);
  });

  it("bids show the estimate per category, an arithmetic delta, and the explicit apply act", async () => {
    h.locked = true;
    await renderPage();
    expect(q("bid-estimate-kitchen")?.textContent).toMatch(/15,000/);
    expect(q("bid-delta-b2-kitchen")?.textContent).toBe("−38% vs your estimate — check it covers the same scope");
    expect(q("bid-delta-b1-kitchen")?.textContent).toBe("+10% vs your estimate");
    expect(q("bid-apply-to-lines")?.textContent).toMatch(/GC One's accepted bid/);
    expect(q("button-apply-bid-to-lines")).not.toBeNull();
  });
});
