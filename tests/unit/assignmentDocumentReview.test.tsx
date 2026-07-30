// @vitest-environment jsdom
/**
 * Wave D2 — the ASSIGNMENT document now runs through the contract chain, with
 * the same review-then-send discipline as the purchase agreement.
 *
 * Before this wave the panel's "Generate assignment contract" button POSTed
 * straight to /api/generated-documents from a template the operator had never
 * seen. That is exactly the shape the `legal_signing` founder hard-stop exists
 * to prevent, so these tests pin the new gate:
 *
 *   1. the button OPENS A REVIEW — it writes nothing;
 *   2. the draft POST fires only after the operator confirms the exact body,
 *      and carries that body's sha256;
 *   3. a state with no reviewed assignment template refuses BY NAME, with no
 *      document offered;
 *   4. no path in the panel reaches the signing rail without its own click.
 *
 * Fixtures come from the real pure assembler
 * (server/services/contracts/contractAssembly.ts) — no DATABASE_URL.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import {
  assembleContract,
  resolveStateContractTemplate,
} from "../../server/services/contracts/contractAssembly";
import { AssignmentPanel } from "../../client/src/components/deals/AssignmentPanel";

const DEAL_ID = 5;
const ASSIGNMENT_ID = 1;

const assembled = assembleContract({
  kind: "assignment_of_contract",
  organizationName: "Trey Wholesale",
  deal: {
    id: DEAL_ID,
    status: "accepted",
    type: "acquisition",
    acceptedAmount: "125000.00",
    closingDate: new Date("2026-09-01T00:00:00.000Z"),
  },
  property: {
    id: 3,
    apn: "17-0999-0042",
    address: "88 Longleaf Rd",
    city: "Marietta",
    state: "GA",
    county: "Cobb",
    zip: "30060",
    sizeAcres: "0.3",
    legalDescription: "Lot 2, Longleaf Estates",
  },
  seller: { legalName: "Homer Vance", email: "homer@example.com" },
  buyer: { legalName: "Trey Wholesale LLC", email: "trey@example.com", address: "1 Main St" },
  assignment: {
    id: ASSIGNMENT_ID,
    endBuyerName: "Cash Buyer LLC",
    assignmentFeeCents: 750_000,
    originalContractDate: new Date("2026-08-01T00:00:00.000Z"),
  },
});
if (!assembled.ok) {
  throw new Error(`fixture setup: GA assignment should assemble — got ${assembled.refusal.code}`);
}
const draft = assembled.draft;

const wyoming = resolveStateContractTemplate("WY", "assignment_of_contract");
if (wyoming.ok) throw new Error("fixture setup: WY must NOT be contract-ready");
const WY_REFUSAL = wyoming.refusal;

const state = {
  refuseWithWyoming: false,
  assignments: [
    {
      id: ASSIGNMENT_ID,
      dealId: DEAL_ID,
      endBuyerName: "Cash Buyer LLC",
      assignmentFeeCents: 750_000,
      status: "draft",
      generatedDocumentId: null,
    },
  ] as Array<Record<string, unknown>>,
};

let calls: Array<{ method: string; url: string; body: unknown }> = [];

function json(body: unknown, status = 200): Promise<Response> {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

function fetchMock(url: string, init?: RequestInit): Promise<Response> {
  const method = (init?.method ?? "GET").toUpperCase();
  const body = init?.body ? JSON.parse(String(init.body)) : null;
  calls.push({ method, url, body });

  if (url.includes("/api/organization")) {
    return json({ id: 1, name: "Trey Wholesale", settings: { businessType: "residential_wholesaler" } });
  }
  if (url.includes("/contract-preview")) {
    if (state.refuseWithWyoming) {
      return json(
        {
          error: "VALIDATION_FAILED",
          message: "Some fields need a fix:",
          details: WY_REFUSAL,
          statusCode: 422,
        },
        422,
      );
    }
    return json({
      kind: draft.kind,
      title: draft.title,
      name: draft.name,
      state: draft.state,
      stateName: draft.stateName,
      content: draft.content,
      contentHash: draft.contentHash,
      variables: draft.variables,
      stateRequirements: draft.stateRequirements,
      signerRoles: draft.signerRoles,
      advisories: draft.advisories,
      disclaimer: draft.disclaimer,
      assignmentId: ASSIGNMENT_ID,
      sent: false,
      hardStop: "legal_signing",
    });
  }
  if (url === `/api/deals/${DEAL_ID}/contract`) {
    return json(
      {
        document: { id: 91, name: draft.name },
        sent: false,
        nextStep: { note: "Nothing has been sent. Sending for signature is a separate action." },
        hardStop: "legal_signing",
      },
      201,
    );
  }
  if (url.includes("/assignments")) return json(state.assignments);
  if (url.includes("/api/generated-documents/")) return json({ id: 91, status: "draft" });
  return json([]);
}

function wrap(node: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return React.createElement(QueryClientProvider, { client }, node);
}

async function flush() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
  });
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  calls = [];
  state.refuseWithWyoming = false;
  state.assignments = [
    {
      id: ASSIGNMENT_ID,
      dealId: DEAL_ID,
      endBuyerName: "Cash Buyer LLC",
      assignmentFeeCents: 750_000,
      status: "draft",
      generatedDocumentId: null,
    },
  ];
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => fetchMock(String(input), init)),
  );
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function mount() {
  await act(async () => {
    root.render(wrap(React.createElement(AssignmentPanel, { dealId: DEAL_ID, propertyId: 3 })));
  });
  await flush();
}

function q(selector: string): HTMLElement | null {
  return document.body.querySelector<HTMLElement>(selector);
}

async function click(selector: string) {
  const el = q(selector);
  if (!el) throw new Error(`missing element: ${selector}`);
  await act(async () => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
  await flush();
}

const writes = () => calls.filter((c) => c.method !== "GET");

describe("assignment document — review before anything exists", () => {
  it("the panel's action opens a review and writes nothing", async () => {
    await mount();
    expect(writes()).toHaveLength(0);

    await click('[data-testid="button-generate-assignment-doc"]');

    const shown = q('[data-testid="assignment-preview-content"]');
    expect(shown).not.toBeNull();
    expect(shown?.textContent).toContain("ASSIGNMENT OF REAL ESTATE CONTRACT");
    expect(shown?.textContent).toContain("Cash Buyer LLC");
    expect(shown?.textContent).toContain("$7,500.00"); // the real assignment fee
    // Reviewing is not creating.
    expect(writes()).toHaveLength(0);
    expect(document.body.textContent).toContain("Nothing sent yet");
  });

  it("creates the draft only after the operator confirms that exact body", async () => {
    await mount();
    await click('[data-testid="button-generate-assignment-doc"]');

    const create = q('[data-testid="button-create-assignment-doc"]') as HTMLButtonElement | null;
    expect(create?.disabled).toBe(true);
    await click('[data-testid="button-create-assignment-doc"]');
    expect(writes()).toHaveLength(0);

    await click('[data-testid="checkbox-assignment-confirm-review"]');
    await click('[data-testid="button-create-assignment-doc"]');

    const created = calls.filter((c) => c.url === `/api/deals/${DEAL_ID}/contract`);
    expect(created).toHaveLength(1);
    expect(created[0].body).toMatchObject({
      kind: "assignment_of_contract",
      assignmentId: ASSIGNMENT_ID,
      confirmReviewed: true,
      reviewedContentHash: draft.contentHash,
      ackComplianceWarning: false,
    });
    // Still nothing sent: the signing rail was never touched.
    expect(calls.some((c) => c.url.includes("/request-signature"))).toBe(false);
  });

  it("refuses by name in a state with no reviewed assignment template", async () => {
    state.refuseWithWyoming = true;
    await mount();
    await click('[data-testid="button-generate-assignment-doc"]');

    const refusal = q('[data-testid="assignment-chain-refusal"]');
    expect(refusal).not.toBeNull();
    expect(refusal?.textContent).toContain("Wyoming");
    expect(refusal?.textContent).toContain(WY_REFUSAL.message);
    expect(q('[data-testid="assignment-preview-content"]')).toBeNull();
    expect(q('[data-testid="button-create-assignment-doc"]')).toBeNull();
    expect(writes()).toHaveLength(0);
  });

  it("a draft assignment offers no send action at all until a document exists", async () => {
    await mount();
    expect(q('[data-testid="button-send-assignment-signature"]')).toBeNull();
    expect(calls.some((c) => c.url.includes("/request-signature"))).toBe(false);
  });
});
