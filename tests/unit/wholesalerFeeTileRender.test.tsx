// @vitest-environment jsdom
/**
 * The Wholesale "Assignment Fees" tile has three honest states and never
 * renders $0 for "none" (founder call B-6: zero and none are different facts).
 *   - source "assignments" → the figure (and avg per signed assignment)
 *   - source "none" / null → "No signed assignments yet — …", NO dollar figure
 *   - a fresh org with closed deals still has data: the funnel renders either way
 * (@testing-library/react is not a dependency; mounted via react-dom/client.)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WholesalerWidgets } from "../../client/src/components/dashboard/type-specific-widgets";

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const base = {
  hasData: true,
  speedToCloseDays: 10,
  buyerListHealth: { total: 0, active: 0, stale: 0 },
  dealFunnel: [{ stage: "Closed", count: 2 }],
};

async function mount(payload: Record<string, unknown>) {
  vi.stubGlobal("fetch", vi.fn(async () =>
    new Response(JSON.stringify({ ...base, ...payload }), { status: 200, headers: { "Content-Type": "application/json" } }),
  ));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(React.createElement(QueryClientProvider, { client: qc }, React.createElement(WholesalerWidgets)));
  });
  for (let i = 0; i < 10; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  return container.textContent ?? "";
}

describe("Assignment Fees tile", () => {
  it("source 'assignments' renders the figure", async () => {
    const text = await mount({
      assignmentFeesCents: 1_500_000, avgAssignmentFeeCents: 750_000,
      assignmentFeeSource: "assignments", signedAssignmentCount: 2,
    });
    expect(text).toContain("$15,000");
    expect(text).toContain("$7,500 avg per signed assignment");
    expect(text).not.toContain("No signed assignments yet");
  });

  it("source 'none' renders the no-signed-assignments copy and no dollar figure", async () => {
    const text = await mount({
      assignmentFeesCents: null, avgAssignmentFeeCents: null,
      assignmentFeeSource: "none", signedAssignmentCount: 0,
    });
    expect(text).toContain("No signed assignments yet — fees appear when an assignment is signed");
    expect(text).not.toMatch(/\$\s?0\b/);
    expect(container.querySelector('[data-testid="assignment-fees-value"]')).toBeNull();
    expect(text).toContain("Deal Funnel"); // hasData is untouched: funnel still shows
  });

  it("a stray figure under source 'none' is not rendered (the source decides, not the number)", async () => {
    const text = await mount({
      assignmentFeesCents: 4_000_000, avgAssignmentFeeCents: 2_000_000,
      assignmentFeeSource: "none", signedAssignmentCount: 0,
    });
    expect(text).toContain("No signed assignments yet");
    expect(text).not.toContain("40,000");
  });
});
