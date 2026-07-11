// @vitest-environment jsdom
/**
 * W6.1 — AssignmentPanel gating + flow-state rendering.
 *
 * The panel is the first client surface on the contract-assignments
 * backend; these tests pin the parts that would silently break the
 * wholesale promise:
 *
 *   1. persona gate: hidden for a non-wholesaler org with no records,
 *      visible for wholesalers, and visible for ANY org when assignment
 *      records exist (data never hidden by a persona toggle);
 *   2. the empty state renders the create form (buyer + fee + date);
 *   3. an active draft renders the fee in dollars + the generate action;
 *   4. a signed assignment reads as executed revenue.
 *
 * Mounted via react-dom/client + QueryClientProvider with a global fetch
 * mock (repo pattern — see statementsPanel.test.tsx; no @testing-library).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { AssignmentPanel } from "../../client/src/components/deals/AssignmentPanel";

const state = {
  businessType: "residential_wholesaler" as string | null,
  assignments: [] as any[],
};

function fetchMock(url: string): Promise<Response> {
  const json = (body: unknown) =>
    Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } }));
  if (url.includes("/api/organization")) {
    return json({ id: 1, name: "Test Org", settings: { businessType: state.businessType } });
  }
  if (url.includes("/assignments")) return json(state.assignments);
  if (url.includes("/api/generated-documents/")) return json({ id: 9, status: "draft" });
  return json([]);
}

function wrap(node: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return React.createElement(QueryClientProvider, { client }, node);
}

async function flush() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
  });
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  state.businessType = "residential_wholesaler";
  state.assignments = [];
  vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => fetchMock(String(input))));
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function mount(dealId = 5) {
  await act(async () => {
    root.render(wrap(React.createElement(AssignmentPanel, { dealId, propertyId: 3 })));
  });
  await flush();
}

describe("AssignmentPanel — persona gate", () => {
  it("renders for a wholesaler org with no records (the create form)", async () => {
    await mount();
    expect(container.querySelector('[data-testid="assignment-panel"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="input-assignment-buyer"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="input-assignment-fee"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="button-create-assignment"]')).not.toBeNull();
  });

  it("is HIDDEN for a non-wholesaler org with no assignment records", async () => {
    state.businessType = "land_flipper";
    await mount();
    expect(container.querySelector('[data-testid="assignment-panel"]')).toBeNull();
  });

  it("stays VISIBLE for a non-wholesaler org when records exist — data is never persona-hidden", async () => {
    state.businessType = "land_flipper";
    state.assignments = [
      { id: 1, dealId: 5, endBuyerName: "Cash Buyer LLC", assignmentFeeCents: 750000, status: "draft", generatedDocumentId: null },
    ];
    await mount();
    expect(container.querySelector('[data-testid="assignment-panel"]')).not.toBeNull();
  });
});

describe("AssignmentPanel — flow states", () => {
  it("an active draft shows the REAL fee in dollars and the generate action", async () => {
    state.assignments = [
      { id: 1, dealId: 5, endBuyerName: "Cash Buyer LLC", assignmentFeeCents: 750000, status: "draft", generatedDocumentId: null },
    ];
    await mount();
    expect(container.textContent).toContain("$7,500 fee");
    expect(container.textContent).toContain("Cash Buyer LLC");
    expect(container.querySelector('[data-testid="button-generate-assignment-doc"]')).not.toBeNull();
    // A draft can still be cancelled.
    expect(container.querySelector('[data-testid="button-cancel-assignment"]')).not.toBeNull();
  });

  it("a signed assignment reads as executed revenue — no further actions", async () => {
    state.assignments = [
      { id: 1, dealId: 5, endBuyerName: "Cash Buyer LLC", assignmentFeeCents: 750000, status: "signed", generatedDocumentId: 9 },
    ];
    await mount();
    expect(container.textContent).toContain("Fully executed");
    expect(container.querySelector('[data-testid="button-generate-assignment-doc"]')).toBeNull();
    expect(container.querySelector('[data-testid="button-cancel-assignment"]')).toBeNull();
  });

  it("cancelled records don't count as the active assignment — the create form returns", async () => {
    state.assignments = [
      { id: 1, dealId: 5, endBuyerName: "Ghosted LLC", assignmentFeeCents: 100000, status: "cancelled", generatedDocumentId: null },
    ];
    await mount();
    // Panel visible (records exist) but the flow restarts.
    expect(container.querySelector('[data-testid="assignment-panel"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="button-create-assignment"]')).not.toBeNull();
  });
});
