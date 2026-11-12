// @vitest-environment jsdom
/**
 * Settings → Organization → Lead routing (W2-TEAM light-up).
 *
 * The lead-assignment rules ran on every lead added from the Leads list, but
 * the page that edits them (/settings/lead-assignment) was linked from
 * nowhere. This pins the way in:
 *   - the card renders loading / empty / error / data from the REAL rules
 *     endpoint (fetch is the only thing faked);
 *   - it links to a page App.tsx actually routes;
 *   - settings.tsx mounts it inside the Organization tab (parsed, not
 *     substring-scanned, so a commented-out mount does not count);
 *   - the card and the editor page share one fetcher, so the cached shape
 *     under the shared query key cannot diverge.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { LeadRoutingCard } from "../../client/src/components/settings/LeadRoutingCard";
import { LEAD_ASSIGNMENT_RULES_API, LEAD_ROUTING_PATH } from "../../client/src/lib/lead-routing";
import { clientRoutes } from "../helpers/clientRoutes";
import { stripComments } from "../helpers/stripComments";

const ROOT = resolve(__dirname, "../..");
const F = vi.hoisted(() => ({ status: 200, body: { rules: [] } as unknown, calls: [] as string[], hang: false }));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  F.calls = [];
  F.hang = false;
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    F.calls.push(String(input));
    if (F.hang) return new Promise<Response>(() => {});
    return new Response(JSON.stringify(F.body), { status: F.status, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function render() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(React.createElement(QueryClientProvider, { client }, React.createElement(LeadRoutingCard)));
  });
  for (let i = 0; i < 20 && !F.hang && container.querySelector('[aria-label="Loading lead routing rules"]'); i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
  }
}

const rule = (id: number, over: Record<string, unknown> = {}) => ({
  id,
  organizationId: 7,
  name: `Rule ${id}`,
  ruleType: "round_robin",
  priority: id,
  territoryFilter: null,
  weightedAssignees: [{ teamMemberId: 11, weight: 1 }],
  isDefault: false,
  isActive: true,
  ...over,
});

describe("LeadRoutingCard", () => {
  it("loading: skeletons while the rules are on their way", async () => {
    F.hang = true;
    await render();
    expect(container.querySelector('[aria-label="Loading lead routing rules"]')).not.toBeNull();
  });

  it("calls the real rules endpoint", async () => {
    await render();
    expect(F.calls).toEqual([LEAD_ASSIGNMENT_RULES_API]);
  });

  it("empty: says leads stay unassigned and links to the editor", async () => {
    F.status = 200;
    F.body = { rules: [] };
    await render();
    const empty = container.querySelector('[data-testid="empty-lead-routing"]');
    expect(empty, "empty state did not render").not.toBeNull();
    expect(empty!.textContent).toContain("stay unassigned");
    const cta = container.querySelector('[data-testid="empty-lead-routing-setup"]');
    expect(cta?.getAttribute("href")).toBe(LEAD_ROUTING_PATH);
  });

  it("error: a retryable error panel, not an empty list", async () => {
    F.status = 500;
    F.body = { error: "INTERNAL_ERROR", message: "Something broke on our end.", statusCode: 500 };
    await render();
    expect(container.querySelector('[data-testid="error-lead-routing"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="empty-lead-routing"]')).toBeNull();
  });

  it("data: each stored rule, in order, with its type in words and an Off badge when paused", async () => {
    F.status = 200;
    F.body = { rules: [rule(1), rule(2, { ruleType: "territory", isActive: false, weightedAssignees: [] })] };
    await render();
    const rows = [...container.querySelectorAll('[data-testid^="row-lead-routing-rule-"]')];
    expect(rows.map((r) => r.getAttribute("data-testid"))).toEqual(["row-lead-routing-rule-1", "row-lead-routing-rule-2"]);
    expect(rows[0].textContent).toContain("Take turns · 1 teammate");
    expect(rows[1].textContent).toContain("By location · 0 teammates");
    expect(rows[1].textContent).toContain("Off");
    expect(rows[0].textContent).not.toMatch(/round_robin|territory/);
    expect(container.querySelector('[data-testid="link-lead-routing-manage"]')?.getAttribute("href")).toBe(LEAD_ROUTING_PATH);
  });

  it("an unexpected body is an error, never a silent 'no rules'", async () => {
    F.status = 200;
    F.body = { notRules: true };
    await render();
    expect(container.querySelector('[data-testid="error-lead-routing"]')).not.toBeNull();
  });
});

describe("the way in is wired", () => {
  it("the editor the card links to is a routed customer page", () => {
    const route = clientRoutes().find((r) => r.path === LEAD_ROUTING_PATH);
    expect(route?.kind).toBe("customer");
  });

  it("settings.tsx renders <LeadRoutingCard /> inside the Organization tab", () => {
    const file = resolve(ROOT, "client/src/pages/settings.tsx");
    const sf = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const tagName = (n: ts.Node) =>
      ts.isJsxElement(n) ? n.openingElement.tagName.getText(sf) : ts.isJsxSelfClosingElement(n) ? n.tagName.getText(sf) : null;
    const attrs = (n: ts.Node) => (ts.isJsxElement(n) ? n.openingElement.attributes : ts.isJsxSelfClosingElement(n) ? n.attributes : null);
    const tabs: ts.Node[] = [];
    const walk = (n: ts.Node) => {
      if (tagName(n) === "TabsContent") {
        const value = attrs(n)!.properties.find((p) => ts.isJsxAttribute(p) && p.name.getText(sf) === "value");
        if (value && ts.isJsxAttribute(value) && value.initializer?.getText(sf) === '"organization"') tabs.push(n);
      }
      ts.forEachChild(n, walk);
    };
    walk(sf);
    expect(tabs, "Organization TabsContent not found — re-derive this test").toHaveLength(1);
    let mounted = 0;
    const find = (n: ts.Node) => {
      if (tagName(n) === "LeadRoutingCard") mounted++;
      ts.forEachChild(n, find);
    };
    find(tabs[0]);
    expect(mounted).toBe(1);
  });

  it("the card and the editor page read the rules through the one shared fetcher", () => {
    for (const f of ["client/src/components/settings/LeadRoutingCard.tsx", "client/src/pages/settings/lead-assignment.tsx"]) {
      const src = stripComments(readFileSync(resolve(ROOT, f), "utf8"));
      expect(src, f).toMatch(/queryKey:\s*\[LEAD_ASSIGNMENT_RULES_API\],\s*queryFn:\s*fetchLeadRoutingRules/);
    }
  });
});
