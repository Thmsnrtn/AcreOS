// @vitest-environment jsdom
/**
 * Offer Batches is not advertised while nothing processes a batch.
 *
 * Creating a batch is refused at the API (offerBatchGate) because no handler
 * runs the "process-offer-batch" job, yet Deals -> Offer Batches ("Bulk-generated
 * offers") sat in the sidebar for every persona. It is now in the hidden-route
 * registry's persona-independent list. Hide, not delete: a direct visit still
 * lands on a page that says plainly what exists.
 *
 * Three properties, each measured on the real thing:
 *   1. every persona's resolved hidden set contains the route (and the five
 *      protected doors are still never hidden);
 *   2. every nav entry pointing at the route (parsed from NAV_MODULES with the
 *      TypeScript AST, so comments are never read) is filtered by the same
 *      isRouteHidden() the sidebar uses -- with a vacuity floor on the population;
 *   3. the hide and the API gate agree: lifting one without the other fails.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import {
  resolveHiddenRoutes,
  isRouteHidden,
  _SIDEBAR_HIDDEN_ROUTES_REGISTRY,
  type InvestorType,
  type OrgInvestorType,
} from "../../client/src/lib/sidebar-hidden-routes";
import { assertOfferBatchCreatable } from "../../server/services/offerBatchGate";
vi.mock("../../client/src/components/page-shell", () => ({
  PageShell: ({ children }: { children: unknown }) => <main>{children as any}</main>,
}));

import OfferBatchesPage from "../../client/src/pages/offer-batches";

const ROOT = path.resolve(__dirname, "../..");
const ROUTE = "/offers/batches";
const DOORS = ["/today", "/maps", "/deals", "/pipeline", "/money", "/finance", "/ai", "/inbox", "/settings"];

function personas() {
  const reg: any = _SIDEBAR_HIDDEN_ROUTES_REGISTRY;
  const businessTypes = [undefined, ...Object.keys(reg.byBusinessType ?? {})];
  const detected = Object.keys(reg.byDetectedInvestorType ?? {}) as InvestorType[];
  const orgs: OrgInvestorType[] = ["land", "notes", "both"];
  const out: Array<{ businessType?: string; detectedInvestorType: InvestorType; orgInvestorType: OrgInvestorType }> = [];
  for (const businessType of businessTypes)
    for (const detectedInvestorType of detected)
      for (const orgInvestorType of orgs) out.push({ businessType, detectedInvestorType, orgInvestorType });
  return out;
}

/** Every `href: "<literal>"` under the NAV_MODULES initializer, from the AST. */
function navHrefs(): string[] {
  const file = path.join(ROOT, "client/src/components/layout-sidebar.tsx");
  const sf = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const hrefs: string[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isVariableDeclaration(n) && n.name.getText() === "NAV_MODULES" && n.initializer) {
      const walk = (m: ts.Node) => {
        if (ts.isPropertyAssignment(m) && m.name.getText() === "href" && ts.isStringLiteralLike(m.initializer)) {
          hrefs.push(m.initializer.text);
        }
        ts.forEachChild(m, walk);
      };
      walk(n.initializer);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return hrefs;
}

describe("registry", () => {
  it("has a real persona population", () => {
    expect(personas().length).toBeGreaterThan(30);
  });

  it("hides /offers/batches for every persona, including query-string forms", () => {
    for (const p of personas()) {
      const hidden = resolveHiddenRoutes(p);
      expect(hidden, JSON.stringify(p)).toContain(ROUTE);
      expect(isRouteHidden(`${ROUTE}?x=1`, hidden)).toBe(true);
    }
  });

  it("never hides a protected door while doing so", () => {
    for (const p of personas()) {
      const hidden = resolveHiddenRoutes(p);
      for (const d of DOORS) expect(hidden, `${d} for ${JSON.stringify(p)}`).not.toContain(d);
    }
  });
});

describe("nav entries", () => {
  it("every sidebar entry for the route is filtered for every persona", () => {
    const entries = navHrefs().filter((h) => h.split(/[?#]/)[0] === ROUTE);
    expect(entries.length, "vacuity: the Offer Batches entry must still be parsed from NAV_MODULES").toBeGreaterThanOrEqual(1);
    expect(navHrefs().length, "vacuity: NAV_MODULES parse floor").toBeGreaterThan(40);
    for (const p of personas()) {
      const hidden = resolveHiddenRoutes(p);
      for (const e of entries) expect(isRouteHidden(e, hidden)).toBe(true);
    }
  });

  it("the sidebar filters children and overflow through isRouteHidden", () => {
    const src = fs.readFileSync(path.join(ROOT, "client/src/components/layout-sidebar.tsx"), "utf8");
    expect((src.match(/!isRouteHidden\(child\.href, hiddenForType\)/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
});

describe("hide and API gate agree", () => {
  it("the route is hidden exactly while creation is refused", () => {
    let refused = false;
    try { assertOfferBatchCreatable(); } catch { refused = true; }
    const hiddenForAll = personas().every((p) => resolveHiddenRoutes(p).includes(ROUTE));
    expect(hiddenForAll).toBe(refused);
  });
});

describe("direct visit", () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("lands on an honest read-only page that says creation is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } })));
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false, queryFn: async ({ queryKey }) => (await fetch(String(queryKey[0]))).json() } },
    });
    await act(async () => {
      root.render(<QueryClientProvider client={qc}><OfferBatchesPage /></QueryClientProvider>);
    });
    await act(async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)); });
    const text = container.textContent ?? "";
    expect(text).toMatch(/can.?t be created yet|not available yet/i);
    expect(text).not.toMatch(/Pax hands|print vendor|reply windows/i);
    expect(container.querySelector("button")).toBeNull();
  });
});
