// @vitest-environment jsdom
/**
 * W2-RENT — rent-ops endpoints that had NO client caller, lit up on /rent-roll.
 *
 *   GET  /api/rent-charges/scheduled-preview      → the "Rent due" card
 *   POST /api/rent-charges/generate-scheduled     → its per-lease "Post" button
 *   GET  /api/rent/late-fee-proposals             → the "Proposed fee" column
 *   GET  /api/rent-charges/:id/late-fee-proposal  → the late-fee dialog's figure
 *   POST /api/rent-charges/:id/legal-posture      → the ledger's posture select
 *
 * Each surface is mounted on the REAL page against a fetch mock and checked in
 * its loading / empty / error / data states. The last block ties every call
 * the page makes back to a route `server/routes-rent-ledger.ts` actually
 * registers — read with the TypeScript parser, never a substring scan — so
 * "no client caller" (or a client calling a path nobody serves) cannot come
 * back silently.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

import { queryClient } from "../../client/src/lib/queryClient";

vi.mock("@/components/page-shell", async () => {
  const react = await import("react");
  return {
    PageShell: ({ children }: { children: React.ReactNode }) =>
      react.createElement("div", { "data-testid": "page-shell" }, children),
  };
});

import RentRollPage from "../../client/src/pages/rent-roll";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// ---------------------------------------------------------------------------
// Harness (repo pattern — waveDTaxRentSurfaces.test.tsx)
// ---------------------------------------------------------------------------

interface FetchCall {
  url: string;
  method: string;
  body: Record<string, unknown> | null;
}
type Reply = { status?: number; body: unknown } | "pending" | undefined;
type Handler = (call: FetchCall) => Reply;

let calls: FetchCall[] = [];

function installFetch(handler: Handler) {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      let body: Record<string, unknown> | null = null;
      if (typeof init?.body === "string") {
        try {
          body = JSON.parse(init.body) as Record<string, unknown>;
        } catch {
          body = null;
        }
      }
      const call = { url, method, body };
      calls.push(call);
      const res = handler(call);
      if (res === "pending") return new Promise<Response>(() => {});
      const { status = 200, body: payload } = res ?? { status: 500, body: { message: `unhandled ${method} ${url}` } };
      return Promise.resolve(
        new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } }),
      );
    }),
  );
}

async function flush(times = 6) {
  for (let i = 0; i < times; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

let container: HTMLDivElement;
let root: Root;

async function mountPage() {
  await act(async () => {
    root.render(
      React.createElement(QueryClientProvider, { client: queryClient }, React.createElement(RentRollPage)),
    );
  });
  await flush();
}

const byTestId = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);

async function click(el: Element | null) {
  expect(el, "element to click").not.toBeNull();
  await act(async () => {
    (el as HTMLElement).click();
  });
  await flush();
}

const DEFAULT_QUERIES = queryClient.getDefaultOptions().queries;
beforeAll(() => {
  // Error states must render on the first failure, not after the app's backoff.
  queryClient.setDefaultOptions({ queries: { ...DEFAULT_QUERIES, retry: false } });
});
afterAll(() => {
  queryClient.setDefaultOptions({ queries: DEFAULT_QUERIES });
});

beforeEach(() => {
  calls = [];
  queryClient.clear();
  Element.prototype.scrollIntoView = vi.fn();
  if (!(globalThis as { ResizeObserver?: unknown }).ResizeObserver) {
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const LEASE_ID = "aaaaaaaa-0000-4000-8000-000000000001";
const HAND_LEASE_ID = "aaaaaaaa-0000-4000-8000-000000000002";
const JUNE_ID = "cccccccc-0000-4000-8000-000000000006";
const JULY_ID = "cccccccc-0000-4000-8000-000000000007";

const LEASE = {
  id: LEASE_ID,
  propertyId: 1,
  unitLabel: "3B",
  status: "active",
  startDate: "2026-01-01",
  endDate: null,
  monthlyRentCents: 140_000,
  rentDueDayOfMonth: 1,
  securityDepositCents: 140_000,
  isSection8: false,
  state: "TX",
};

function proposal(over: Record<string, unknown>) {
  return {
    status: "proposed",
    proposedFeeCents: 0,
    uncappedFeeCents: 0,
    capCents: 16_800,
    capped: false,
    graceDays: 2,
    daysLate: 10,
    state: "TX",
    citation: "Tex. Prop. Code §92.019",
    unitBranch: "large_4_plus",
    explanation: "",
    requiresOperatorConfirmation: true,
    ...over,
  };
}

// The server's figure for July: 6 units on record → the 12% branch, $84.00.
// The dialog used to compute $70.00 itself (unit-count floor 1, lower branch),
// which is exactly the figure the operator must no longer be shown.
const JULY_PROPOSAL = proposal({
  proposedFeeCents: 8_400,
  explanation:
    "10 days late (2-day grace) → proposed fee $84.00. Rule: Tex. Prop. Code §92.019. Requires operator confirmation before it is charged.",
});
const JUNE_PROPOSAL = proposal({ status: "already_charged", proposedFeeCents: 0, daysLate: 40 });

const PREVIEW = {
  throughDate: "2026-07-11",
  leases: [
    {
      leaseId: LEASE_ID,
      propertyId: 1,
      unitLabel: "3B",
      monthlyRentCents: 140_000,
      create: [
        { chargedForMonth: "2026-06-01", dueDate: "2026-06-01", amountCents: 140_000 },
        { chargedForMonth: "2026-07-01", dueDate: "2026-07-01", amountCents: 140_000 },
      ],
      skipped: [],
      totalToPostCents: 280_000,
    },
    {
      leaseId: HAND_LEASE_ID,
      propertyId: 2,
      unitLabel: null,
      monthlyRentCents: 90_000,
      create: [],
      skipped: [{ chargedForMonth: "2026-07-01", code: "partial_first_period", reason: "…" }],
      totalToPostCents: 0,
    },
  ],
  totalToPostCents: 280_000,
  chargeCount: 2,
};

const LEDGER_CHARGE = {
  id: JULY_ID,
  leaseId: LEASE_ID,
  chargedForMonth: "2026-07-01",
  dueDate: "2026-07-01",
  amountCents: 140_000,
  lateFeeCents: 0,
  paidCents: 0,
  balanceCents: 140_000,
  legalPosture: "late",
  payments: [],
};

interface Overrides {
  businessType?: string;
  preview?: Reply;
  proposals?: Reply;
  proposal?: Reply;
  apply?: Reply;
}

function handler(o: Overrides = {}): Handler {
  return ({ url, method }) => {
    if (url === "/api/organization") {
      return { body: { id: 1, onboardingData: { businessType: o.businessType ?? "buy_and_hold" } } };
    }
    if (url === "/api/rent/aging") {
      return {
        body: {
          asOf: "2026-07-11",
          totalsByBucket: {},
          charges: [
            { id: JUNE_ID, lease_id: LEASE_ID, charged_for_month: "2026-06-01", due_date: "2026-06-01", amount_cents: 140_000, balance_cents: 154_000, late_fee_cents: 14_000, legal_posture: "late", days_overdue: 40 },
            { id: JULY_ID, lease_id: LEASE_ID, charged_for_month: "2026-07-01", due_date: "2026-07-01", amount_cents: 140_000, balance_cents: 140_000, late_fee_cents: 0, legal_posture: "ok", days_overdue: 10 },
          ],
        },
      };
    }
    if (url === "/api/leases") return { body: { leases: [LEASE] } };
    if (url === "/api/late-fee-rules") return { body: { rules: [] } };
    if (url === "/api/rent/late-fee-proposals") {
      return o.proposals ?? {
        body: {
          proposals: [
            { rentChargeId: JUNE_ID, proposal: JUNE_PROPOSAL },
            { rentChargeId: JULY_ID, proposal: JULY_PROPOSAL },
          ],
        },
      };
    }
    if (url === "/api/rent-charges/scheduled-preview") return o.preview ?? { body: PREVIEW };
    if (url === "/api/rent-charges/generate-scheduled" && method === "POST") {
      return { body: { throughDate: "2026-07-11", leasesConsidered: 1, inserted: 2, skippedDuplicate: 0, skippedPartialPeriods: [], insertedTotalCents: 280_000 } };
    }
    if (url === `/api/rent-charges/${JULY_ID}/late-fee-proposal`) {
      return o.proposal ?? { body: { proposal: JULY_PROPOSAL, requiresOperatorConfirmation: true } };
    }
    if (url === `/api/rent-charges/${JULY_ID}/apply-late-fee` && method === "POST") {
      return o.apply ?? { body: { feeCents: 8_400, charged: true, explanation: JULY_PROPOSAL.explanation } };
    }
    if (url === `/api/leases/${LEASE_ID}/ledger`) {
      return {
        body: {
          lease: LEASE,
          charges: [LEDGER_CHARGE],
          unappliedPayments: [],
          totals: { totalDueCents: 140_000, totalPaidCents: 0, totalBalanceCents: 140_000, totalLateFeesCents: 0 },
        },
      };
    }
    if (url === `/api/rent-charges/${JULY_ID}/legal-posture` && method === "POST") {
      return { body: { charge: { ...LEDGER_CHARGE, legalPosture: "notice_served" } } };
    }
    return undefined;
  };
}

// ---------------------------------------------------------------------------
// Rent due — scheduled charges
// ---------------------------------------------------------------------------

describe("Rent due (scheduled-preview + generate-scheduled)", () => {
  it("lists each lease's months and posts ONE lease at the preview's own horizon", async () => {
    installFetch(handler());
    await mountPage();

    const row = byTestId(`rent-due-${LEASE_ID}`)!;
    expect(row.textContent).toContain("2 months · 2026-06 → 2026-07");
    expect(row.textContent).toContain("$2,800.00");
    // A partial month is said out loud — and never offered as postable.
    const partial = byTestId(`rent-due-${HAND_LEASE_ID}`)!;
    expect(partial.textContent).toContain("2026-07 is a partial month and is not posted");
    expect(byTestId(`button-post-rent-${HAND_LEASE_ID}`)).toBeNull();
    // Nothing is posted by looking.
    expect(calls.some((c) => c.url.includes("generate-scheduled"))).toBe(false);

    await click(byTestId(`button-post-rent-${LEASE_ID}`));

    const posts = calls.filter((c) => c.url === "/api/rent-charges/generate-scheduled");
    expect(posts).toHaveLength(1);
    expect(posts[0].method).toBe("POST");
    // One lease, at the horizon the operator was shown — never "everything, as of now".
    expect(posts[0].body).toEqual({ leaseId: LEASE_ID, throughDate: "2026-07-11" });
  });

  it("says plainly when there is nothing to post", async () => {
    installFetch(handler({ preview: { body: { throughDate: "2026-07-11", leases: [], totalToPostCents: 0, chargeCount: 0 } } }));
    await mountPage();
    expect(byTestId("rent-due-empty")!.textContent).toContain("No rent to post");
    expect(byTestId("list-rent-due")).toBeNull();
  });

  it("shows a retryable error, not an empty card, when the preview fails", async () => {
    installFetch(handler({ preview: { status: 500, body: { message: "boom" } } }));
    await mountPage();
    expect(byTestId("rent-due-query-error")).not.toBeNull();
    expect(byTestId("rent-due-empty")).toBeNull();
  });

  it("shows a skeleton while the preview loads", async () => {
    installFetch(handler({ preview: "pending" }));
    await mountPage();
    const card = byTestId("card-rent-due")!;
    expect(card.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(byTestId("list-rent-due")).toBeNull();
    expect(byTestId("rent-due-empty")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Proposed fee — the org-wide proposals
// ---------------------------------------------------------------------------

describe("Proposed fee column (late-fee-proposals)", () => {
  it("shows the server's figure per charge, and its reason when there is none", async () => {
    installFetch(handler());
    await mountPage();
    expect(byTestId(`proposed-fee-${JULY_ID}`)!.textContent).toBe("$84.00");
    expect(byTestId(`proposed-fee-${JUNE_ID}`)!.textContent).toBe("already charged");
  });

  it("shows a retryable error instead of guessing a fee when the proposals fail", async () => {
    installFetch(handler({ proposals: { status: 500, body: { message: "boom" } } }));
    await mountPage();
    expect(byTestId("late-fee-proposals-query-error")).not.toBeNull();
    expect(byTestId(`proposed-fee-${JULY_ID}`)!.textContent).toBe("—");
  });

  it("shows a placeholder while the proposals load", async () => {
    installFetch(handler({ proposals: "pending" }));
    await mountPage();
    expect(byTestId(`proposed-fee-${JULY_ID}`)!.querySelector(".animate-pulse")).not.toBeNull();
  });

  it("is neither fetched nor shown for a commercial org (statutory fees are residential)", async () => {
    installFetch(handler({ businessType: "commercial" }));
    await mountPage();
    expect(calls.some((c) => c.url === "/api/rent/late-fee-proposals")).toBe(false);
    expect(byTestId(`proposed-fee-${JULY_ID}`)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Late-fee dialog — the server's figure, echoed back
// ---------------------------------------------------------------------------

describe("Late-fee dialog (late-fee-proposal + apply-late-fee)", () => {
  it("shows the server's figure and confirms exactly that figure", async () => {
    installFetch(handler());
    await mountPage();
    await click(byTestId(`button-propose-fee-${JULY_ID}`));

    expect(calls.some((c) => c.url === `/api/rent-charges/${JULY_ID}/late-fee-proposal` && c.method === "GET")).toBe(true);
    expect(byTestId("text-proposed-fee")!.textContent).toBe("$84.00");

    // Nothing is charged until the operator confirms the figure they were shown.
    expect((byTestId("button-charge-fee") as HTMLButtonElement).disabled).toBe(true);
    await click(byTestId("checkbox-confirm-fee"));
    await click(byTestId("button-charge-fee"));

    const applies = calls.filter((c) => c.url.endsWith("/apply-late-fee"));
    expect(applies).toHaveLength(1);
    expect(applies[0].body).toEqual({ confirmFeeCents: 8_400 });
    expect(byTestId("late-fee-applied")!.textContent).toContain("$84.00 charged");
  });

  it("when the server refuses a moved figure (409), claims nothing and re-reads the proposal", async () => {
    installFetch(
      handler({
        apply: {
          status: 409,
          body: { error: "LATE_FEE_PROPOSAL_CHANGED", message: "The fee you confirmed is not the fee the state rule now proposes." },
        },
      }),
    );
    await mountPage();
    await click(byTestId(`button-propose-fee-${JULY_ID}`));
    await click(byTestId("checkbox-confirm-fee"));
    await click(byTestId("button-charge-fee"));

    expect(byTestId("late-fee-applied")).toBeNull();
    expect((byTestId("button-charge-fee") as HTMLButtonElement).disabled).toBe(true);
    const reads = calls.filter((c) => c.url === `/api/rent-charges/${JULY_ID}/late-fee-proposal`);
    expect(reads.length).toBeGreaterThanOrEqual(2);
  });

  it("offers no charge when the proposal cannot be loaded", async () => {
    installFetch(handler({ proposal: { status: 500, body: { message: "boom" } } }));
    await mountPage();
    await click(byTestId(`button-propose-fee-${JULY_ID}`));
    expect(byTestId("late-fee-proposal-query-error")).not.toBeNull();
    expect(byTestId("button-charge-fee")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Legal posture
// ---------------------------------------------------------------------------

describe("Legal posture (legal-posture)", () => {
  it("records the posture the operator picks on the ledger", async () => {
    installFetch(handler());
    await mountPage();
    await click(byTestId(`button-open-ledger-${JULY_ID}`));

    await click(byTestId(`select-posture-${JULY_ID}`));
    const option = Array.from(document.querySelectorAll('[role="option"]')).find(
      (o) => o.textContent?.trim() === "Notice served",
    );
    await click(option ?? null);

    const posts = calls.filter((c) => c.url === `/api/rent-charges/${JULY_ID}/legal-posture`);
    expect(posts).toHaveLength(1);
    expect(posts[0].method).toBe("POST");
    expect(posts[0].body).toEqual({ legalPosture: "notice_served" });
  });
});

// ---------------------------------------------------------------------------
// Every lit-up call reaches a route the server registers
// ---------------------------------------------------------------------------

/** method + path for every `app.<verb>("…")` in the route file — parsed, so comments never count. */
function serverRoutes(): Array<{ method: string; path: string }> {
  const file = path.resolve(__dirname, "../../server/routes-rent-ledger.ts");
  const source = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  const out: Array<{ method: string; path: string }> = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === "app" &&
      ["get", "post", "put", "patch", "delete"].includes(node.expression.name.text) &&
      node.arguments[0] &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      out.push({ method: node.expression.name.text.toUpperCase(), path: node.arguments[0].text });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return out;
}

function matches(route: { method: string; path: string }, call: FetchCall): boolean {
  const pattern = route.path
    .split("/")
    .map((seg) => (seg.startsWith(":") ? "[^/?]+" : seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
    .join("/");
  return call.method === route.method && new RegExp(`^${pattern}(\\?.*)?$`).test(call.url);
}

const LIT_UP = [
  { method: "GET", path: "/api/rent-charges/scheduled-preview" },
  { method: "POST", path: "/api/rent-charges/generate-scheduled" },
  { method: "GET", path: "/api/rent/late-fee-proposals" },
  { method: "GET", path: "/api/rent-charges/:id/late-fee-proposal" },
  { method: "POST", path: "/api/rent-charges/:id/legal-posture" },
];

describe("the client calls routes the server actually registers", () => {
  it("parses the real route file (vacuity floor) and finds every lit-up route in it", () => {
    const routes = serverRoutes();
    expect(routes.length, "routes parsed from server/routes-rent-ledger.ts").toBeGreaterThanOrEqual(40);
    for (const r of LIT_UP) {
      expect(routes.some((s) => s.method === r.method && s.path === r.path), `${r.method} ${r.path} registered`).toBe(true);
    }
  });

  it("every lit-up route is called by the page, through one full operator pass", async () => {
    installFetch(handler());
    await mountPage();
    await click(byTestId(`button-post-rent-${LEASE_ID}`));
    await click(byTestId(`button-propose-fee-${JULY_ID}`));
    await click(byTestId("checkbox-confirm-fee"));
    await click(byTestId("button-charge-fee"));
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    await flush();
    await click(byTestId(`button-open-ledger-${JULY_ID}`));
    await click(byTestId(`select-posture-${JULY_ID}`));
    await click(
      Array.from(document.querySelectorAll('[role="option"]')).find((o) => o.textContent?.trim() === "Eviction filed") ??
        null,
    );

    const routes = serverRoutes();
    for (const r of LIT_UP) {
      const route = routes.find((s) => s.method === r.method && s.path === r.path)!;
      expect(calls.some((c) => matches(route, c)), `${r.method} ${r.path} has a client caller`).toBe(true);
    }
    // And no call the page makes to the rent ledger misses every registered route.
    const ledgerCalls = calls.filter((c) => /^\/api\/(rent|rent-charges|late-fee-rules)\b/.test(c.url));
    expect(ledgerCalls.length).toBeGreaterThan(0);
    for (const c of ledgerCalls) {
      expect(routes.some((r) => matches(r, c)), `${c.method} ${c.url} reaches a registered route`).toBe(true);
    }
  });
});
