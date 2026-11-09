// @vitest-environment jsdom
/**
 * /finance/commissions claims only what an agent_investor customer can reach
 * (W2-AGENT, 2026-11-06).
 *
 * The note on this page used to call net-of-split economics, a pipeline GCI
 * forecast, client-vs-own-book tagging, a dual-agency tracker and automatic
 * commission recording "live now". None had a screen, and recording needs a
 * deal assigned to an agent, which nothing in AcreOS sets. And the tier tab
 * listed a built-in 3/4/5/6% ladder as the org's own rates.
 *
 * Pinned against RENDERED output:
 *   1. every "works today" item is tied to a real client caller of a real
 *      route, and an item the test cannot tie to one fails;
 *   2. no "works today" item names a capability without a caller, and the
 *      "not set up yet" line names each of them;
 *   3. those capabilities still have no client caller — the day one is lit
 *      up, this fails and says to move its claim into the live list;
 *   4. the tier tab shows the org's saved rates or says none are saved —
 *      never a rate the org did not set.
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { stripComments } from "../helpers/stripComments";
import { REPO_SWEEP_TIMEOUT_MS } from "../helpers/sweepBudget";

import { CommissionScopeNote } from "../../client/src/pages/finance-commissions";
import { CommissionTiers, type CommissionConfigResponse } from "../../client/src/pages/commissions";

vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => stripComments(fs.readFileSync(path.join(ROOT, rel), "utf8"));

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
async function render(node: React.ReactElement) {
  await act(async () => root.render(node));
}
const byId = (id: string) => container.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;

/** Elements named `tag` rendered in `rel`, with their `attr` initializer text. */
function jsxUses(rel: string, tag: string, attr: string): string[] {
  const file = path.join(ROOT, rel);
  const sf = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const out: string[] = [];
  const visit = (n: ts.Node) => {
    if ((ts.isJsxSelfClosingElement(n) || ts.isJsxOpeningElement(n)) && n.tagName.getText(sf) === tag) {
      const a = n.attributes.properties.find(
        (p): p is ts.JsxAttribute => ts.isJsxAttribute(p) && p.name.getText(sf) === attr,
      );
      out.push(a?.initializer?.getText(sf) ?? "");
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

/**
 * Each capability the note may claim as working, with the proof that a
 * customer can reach it: the panel calls the route, the server registers it,
 * and the deal detail renders the panel.
 */
const REACHABLE: Array<{ name: string; claim: RegExp; proven: () => void }> = [
  {
    name: "CMA",
    claim: /\bCMA\b/,
    proven: () => {
      expect(read("client/src/components/deals/CmaPanel.tsx")).toContain("`/api/deals/${dealId}/cma`");
      expect(read("server/routes-deals.ts")).toMatch(/api\.get\(\s*"\/api\/deals\/:id\/cma"/);
      expect(jsxUses("client/src/components/deal-detail-content.tsx", "CmaPanel", "dealId")).toEqual(["{deal.id}"]);
    },
  },
  {
    name: "agency disclosure record",
    claim: /agency disclosure record/i,
    proven: () => {
      expect(read("client/src/components/deals/AgencyDisclosurePanel.tsx")).toContain("`/api/deals/${dealId}/dual-agency`");
      expect(read("server/routes-deals.ts")).toMatch(/api\.put\(\s*"\/api\/deals\/:id\/dual-agency"/);
      expect(jsxUses("client/src/components/deal-detail-content.tsx", "AgencyDisclosurePanel", "dealId")).toEqual(["{deal.id}"]);
    },
  },
];

/**
 * Capabilities with no client caller today, and how a caller would look.
 * `caller: null` marks one with no single client signature to scan for (deal
 * assignment shares its field name with lead assignment); its copy is still
 * pinned by the first two tests.
 */
const NOT_REACHABLE: Array<{ name: string; inNote: RegExp; liveClaim: RegExp; caller: RegExp | null }> = [
  { name: "commission rate setup", inNote: /commission rates/i, liveClaim: /\brates?\b|tiers?\b/i, caller: /apiRequest\(\s*"PUT",\s*"\/api\/commissions\/config"/ },
  { name: "broker split", inNote: /broker split/i, liveClaim: /split/i, caller: /["'`]\/api\/commissions\/split/ },
  { name: "pipeline forecast", inNote: /pipeline forecast/i, liveClaim: /forecast|GCI/i, caller: /["'`]\/api\/commissions\/forecast/ },
  { name: "own-investment tagging", inNote: /own investments/i, liveClaim: /own (book|investment)/i, caller: /\bdealBook\b/ },
  { name: "deal-to-agent assignment", inNote: /assigning a deal to an agent/i, liveClaim: /assign/i, caller: null },
  { name: "automatic recording", inNote: /records no new commission/i, liveClaim: /automatic|recorded when|when a deal closes/i, caller: null },
];

function clientSources(): Array<{ rel: string; src: string }> {
  const out: Array<{ rel: string; src: string }> = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) {
        out.push({ rel: path.relative(ROOT, p), src: stripComments(fs.readFileSync(p, "utf8")) });
      }
    }
  };
  walk(path.join(ROOT, "client/src"));
  return out;
}

describe("the commission scope note", () => {
  it("every 'works today' item is a capability with a real caller", async () => {
    await render(<CommissionScopeNote />);
    const items = [...byId("commission-scope-live")!.querySelectorAll("li")].map((li) => li.textContent ?? "");
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      const matches = REACHABLE.filter((c) => c.claim.test(item));
      expect(matches.map((m) => m.name), `no proof of reach for the claim: "${item}"`).toHaveLength(1);
      matches[0].proven();
    }
  });

  it("no 'works today' item names a capability without a caller; the 'not set up yet' line names each", async () => {
    await render(<CommissionScopeNote />);
    const live = byId("commission-scope-live")!.textContent ?? "";
    const notYet = byId("commission-scope-not-yet")!.textContent ?? "";
    for (const c of NOT_REACHABLE) {
      expect(live, `"${c.name}" is claimed as working`).not.toMatch(c.liveClaim);
      expect(notYet, `"${c.name}" is not named as not set up`).toMatch(c.inNote);
    }
  });

  it(
    "those capabilities still have no client caller (lighting one up must move its claim)",
    () => {
      const sources = clientSources();
      expect(sources.length).toBeGreaterThan(800);
      // Vacuity: the same scan does find the callers the live claims rely on.
      expect(sources.some((s) => s.src.includes("/api/commissions/summaries"))).toBe(true);
      expect(sources.some((s) => s.src.includes("/dual-agency`"))).toBe(true);
      for (const c of NOT_REACHABLE) {
        if (!c.caller) continue;
        const pattern = c.caller;
        const callers = sources.filter((s) => pattern.test(s.src)).map((s) => s.rel);
        expect(
          callers,
          `"${c.name}" now has a client caller — move it from "not set up yet" into the live list ` +
            "(client/src/pages/finance-commissions.tsx) and update this test",
        ).toEqual([]);
      }
    },
  );
});

describe("the tier tab shows only the org's own rates", () => {
  const noop = () => {};

  it("nothing saved: says so, and shows no rate at all", async () => {
    const data: CommissionConfigResponse = { configured: false, config: null };
    await render(<CommissionTiers data={data} isLoading={false} error={null} onRetry={noop} />);
    expect(byId("commission-tiers-unconfigured")).not.toBeNull();
    expect(container.textContent).not.toMatch(/\d\s*%/);
    expect(container.querySelector("table")).toBeNull();
  });

  it("saved rates: lists exactly those tiers", async () => {
    const data: CommissionConfigResponse = {
      configured: true,
      config: { trackingPeriod: "annual", tiers: [{ label: "Base", minDeals: 0, ratePercent: 2.5 }] },
    };
    await render(<CommissionTiers data={data} isLoading={false} error={null} onRetry={noop} />);
    expect(byId("commission-tiers-unconfigured")).toBeNull();
    const rows = [...container.querySelectorAll("tbody tr")].map((tr) => tr.textContent);
    expect(rows).toEqual(["Base0+2.5%"]);
  });

  it("loading is a skeleton and a failure is an error state with retry", async () => {
    await render(<CommissionTiers data={undefined} isLoading error={null} onRetry={noop} />);
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    const retry = vi.fn();
    await render(<CommissionTiers data={undefined} isLoading={false} error={new Error("500: boom")} onRetry={retry} />);
    expect(byId("query-error-state")).not.toBeNull();
    await act(async () => byId("query-error-state-retry-button")!.click());
    expect(retry).toHaveBeenCalledTimes(1);
  });
});
