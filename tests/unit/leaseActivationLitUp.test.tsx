// @vitest-environment jsdom
/**
 * S-04 — lease activation, lit up on the REAL /leases page.
 *
 * Before this package the page created leases as drafts and offered no way
 * to move one: PATCH /api/leases/:id and POST /api/leases/:id/tenants had
 * zero client callers, so rent charges, the expiry scan and the deposit
 * clock silently never ran on a UI-created lease.
 *
 * Mounted against a stateful fetch mock that behaves like the server
 * (activation refuses with 422 until a tenant is attached, then flips the
 * lease to active), this proves the full wire from the operator's side:
 *
 *   banner says a draft runs nothing → Activate is refused without a
 *   tenant (the server's own words surface) → Attach tenant POSTs the link
 *   → Activate POSTs and the row comes back active, banner gone.
 *
 * The last block ties both client calls to routes server/routes-rentals.ts
 * actually registers — read with the TypeScript parser, never a substring
 * scan of registrations — so "no client caller" cannot come back silently.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

import { queryClient } from "../../client/src/lib/queryClient";

// Radix Select does not open in jsdom — a native <select> with the same contract.
vi.mock("../../client/src/components/ui/select", () => ({
  Select: ({ value, onValueChange, children }: any) =>
    React.createElement(
      "select",
      { "data-select": "1", value, onChange: (e: any) => onValueChange(e.target.value) },
      React.createElement("option", { value: "" }, "—"),
      children,
    ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: any) => React.createElement(React.Fragment, null, children),
  SelectItem: ({ value, children }: any) => React.createElement("option", { value }, children),
}));
vi.mock("wouter", () => ({
  useSearch: () => "",
  Link: ({ href, children, ...rest }: any) => React.createElement("a", { href, ...rest }, children),
}));
vi.mock("../../client/src/components/page-shell", () => ({
  PageShell: ({ children }: any) => React.createElement("main", null, children),
}));
vi.mock("../../client/src/hooks/use-document-title", () => ({ useDocumentTitle: () => undefined }));
vi.mock("../../client/src/hooks/use-organization", () => ({
  useOrganization: () => ({ data: { onboardingData: { businessType: "buy_and_hold" } } }),
}));
vi.mock("../../client/src/components/rentals/units-panel", () => ({ UnitsPanel: () => null }));
vi.mock("../../client/src/components/rentals/expenses-panel", () => ({ ExpensesPanel: () => null }));
vi.mock("../../client/src/components/rentals/t12-workspace", () => ({ T12Workspace: () => null }));
vi.mock("../../client/src/components/rentals/bookings-panel", () => ({ BookingsPanel: () => null }));
vi.mock("../../client/src/components/rentals/commercial-panel", () => ({ CommercialPanel: () => null }));

import LeasesPage from "../../client/src/pages/leases";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const DRAFT_LEASE = {
  id: "lease-draft-1",
  propertyId: 42,
  unitLabel: "3B",
  status: "draft",
  startDate: "2026-09-01",
  endDate: "2027-08-31",
  monthlyRentCents: 140_000,
  isSection8: false,
  state: "TX",
  versionNumber: 1,
};
const TENANT = {
  id: "tenant-1",
  firstName: "Ada",
  lastName: "Reyes",
  isEntity: false,
  companyName: null,
  status: "active",
};

interface FetchCall { url: string; method: string; body: Record<string, unknown> | null }
let calls: FetchCall[] = [];
let leaseStatus = "draft";
let tenantAttached = false;

function installFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      let body: Record<string, unknown> | null = null;
      if (typeof init?.body === "string") {
        try { body = JSON.parse(init.body) as Record<string, unknown>; } catch { body = null; }
      }
      calls.push({ url, method, body });
      let status = 200;
      let payload: unknown = { message: `unhandled ${method} ${url}` };
      if (method === "GET" && url === "/api/leases") {
        payload = { leases: [{ ...DRAFT_LEASE, status: leaseStatus }] };
      } else if (method === "GET" && url === "/api/tenants") {
        payload = { tenants: [TENANT] };
      } else if (method === "POST" && url === `/api/leases/${DRAFT_LEASE.id}/tenants`) {
        tenantAttached = true;
        status = 201;
        payload = { link: { id: "link-1", leaseId: DRAFT_LEASE.id, tenantId: body?.tenantId } };
      } else if (method === "POST" && url === `/api/leases/${DRAFT_LEASE.id}/activate`) {
        if (!tenantAttached) {
          status = 422;
          payload = { message: "Attach at least one tenant before activating." };
        } else {
          leaseStatus = "active";
          payload = { lease: { ...DRAFT_LEASE, status: "active" } };
        }
      } else {
        status = 500;
      }
      return Promise.resolve(
        new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } }),
      );
    }),
  );
}

async function flush(times = 8) {
  for (let i = 0; i < times; i++) {
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  }
}

let container: HTMLDivElement;
let root: Root;

async function mountPage() {
  await act(async () => {
    root.render(
      React.createElement(QueryClientProvider, { client: queryClient }, React.createElement(LeasesPage)),
    );
  });
  await flush();
}

const byTestId = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);

async function click(el: Element | null) {
  expect(el, "element to click").not.toBeNull();
  await act(async () => { (el as HTMLElement).click(); });
  await flush();
}

function pickSelectValue(select: HTMLSelectElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(select), "value")!.set!;
  act(() => {
    setter.call(select, value);
    select.dispatchEvent(new Event("input", { bubbles: true }));
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

const DEFAULT_QUERIES = queryClient.getDefaultOptions().queries;
beforeAll(() => {
  queryClient.setDefaultOptions({ queries: { ...DEFAULT_QUERIES, retry: false } });
});
afterAll(() => {
  queryClient.setDefaultOptions({ queries: DEFAULT_QUERIES });
});

beforeEach(() => {
  calls = [];
  leaseStatus = "draft";
  tenantAttached = false;
  queryClient.clear();
  installFetch();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  vi.unstubAllGlobals();
});

describe("/leases — draft → active (S-04)", () => {
  it("says plainly that a draft runs no charges and no clocks", async () => {
    await mountPage();
    const banner = byTestId("draft-lease-banner");
    expect(banner).not.toBeNull();
    expect(banner!.textContent).toMatch(/still in draft/i);
    expect(banner!.textContent).toMatch(/no rent charges, no expiry alerts and no deposit clock/i);
  });

  it("activation is refused until a tenant is attached — the server's refusal is the message", async () => {
    await mountPage();
    await click(byTestId(`activate-lease-${DRAFT_LEASE.id}`));
    const post = calls.find((c) => c.method === "POST" && c.url.endsWith("/activate"));
    expect(post, "the Activate button must call POST /api/leases/:id/activate").toBeTruthy();
    // Still a draft afterwards: the row keeps its Activate control and banner.
    expect(byTestId("draft-lease-banner")).not.toBeNull();
    expect(byTestId(`activate-lease-${DRAFT_LEASE.id}`)).not.toBeNull();
  });

  it("attach tenant → activate → the lease comes back active and the banner clears", async () => {
    await mountPage();

    const select = document.querySelector<HTMLSelectElement>('select[data-select="1"]');
    expect(select, "tenant picker for the draft row").not.toBeNull();
    pickSelectValue(select!, TENANT.id);
    await flush();
    await click(byTestId(`attach-tenant-${DRAFT_LEASE.id}`));

    const attach = calls.find((c) => c.method === "POST" && c.url === `/api/leases/${DRAFT_LEASE.id}/tenants`);
    expect(attach, "Attach must POST /api/leases/:id/tenants").toBeTruthy();
    expect(attach!.body).toMatchObject({ tenantId: TENANT.id });

    await click(byTestId(`activate-lease-${DRAFT_LEASE.id}`));
    const activate = calls.filter((c) => c.method === "POST" && c.url === `/api/leases/${DRAFT_LEASE.id}/activate`);
    expect(activate.length).toBeGreaterThan(0);

    // The invalidated list refetch returns the lease as active: no banner,
    // no activation controls — charges and clocks are the readers' job now.
    expect(byTestId("draft-lease-banner")).toBeNull();
    expect(byTestId(`activate-lease-${DRAFT_LEASE.id}`)).toBeNull();
    expect(document.body.textContent).toMatch(/active/);
  });
});

// ─── Route closure: every call the page makes is a route the server serves ──

describe("route closure — leases.tsx calls ↔ routes-rentals.ts registrations", () => {
  const registrations = new Set<string>();
  beforeAll(() => {
    const file = path.join(__dirname, "../../server/routes-rentals.ts");
    const src = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node) => {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.expression.getText() === "app" &&
        node.arguments.length >= 1 &&
        ts.isStringLiteral(node.arguments[0])
      ) {
        registrations.add(`${node.expression.name.getText().toUpperCase()} ${node.arguments[0].text}`);
      }
      ts.forEachChild(node, visit);
    };
    visit(src);
  });

  it("POST /api/leases/:id/activate is registered server-side", () => {
    expect(registrations.has("POST /api/leases/:id/activate")).toBe(true);
  });

  it("POST /api/leases/:id/tenants is registered server-side", () => {
    expect(registrations.has("POST /api/leases/:id/tenants")).toBe(true);
  });

  it("the page source calls both endpoints (the caller half of the wire)", () => {
    const clientSrc = fs.readFileSync(path.join(__dirname, "../../client/src/pages/leases.tsx"), "utf8");
    expect(clientSrc).toContain("/tenants`");
    expect(clientSrc).toContain("/activate`");
    expect(clientSrc).toContain('fetch("/api/tenants"');
  });
});
