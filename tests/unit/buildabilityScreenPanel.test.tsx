// @vitest-environment jsdom
/**
 * Subdivision V1, Legs 1–2 — the buildability-screen panel on the Subdivision tab.
 *   1. not yet screened: a taught empty state, never a pass;
 *   2. every input starts EMPTY (no platform figure prefilled) and is labelled;
 *   3. a stored run renders its headline, each verdict with its evidence and,
 *      for not-determinable, its priced resolution path; the yield estimate and
 *      the drawn plan render side by side; nothing is computed client-side —
 *      the panel shows exactly what the server stored;
 *   4. the request sends only what was recorded: a value without its source is
 *      not sent as a fact; percentages go as fractions.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BuildabilityScreenSection } from "../../client/src/components/parcels/buildability-screen";
import { runBuildabilityScreen } from "../../shared/subdivision/buildabilityScreen";
import { estimateLotYield, reconcileWithDrawnPlans } from "../../shared/subdivision/lotYield";

const yieldEstimate = estimateLotYield({
  grossAcres: { value: 13.5, source: "county GIS", asOf: null },
  floodwayAcres: null,
  easementAcres: { value: 0, source: "title", asOf: null },
  unbuildableSlopeAcres: { value: 0, source: "topo", asOf: null },
  roadsRowFraction: 0.1,
  minimumLot: { acres: 1.2, citation: "regs" },
  targetLotAcres: 1.5,
});
const result = runBuildabilityScreen(
  {
    legalAccess: { value: "recorded_access", source: "deed book 1234", asOf: null },
    grossAcres: { value: 13.5, source: "county GIS", asOf: null },
    floodwayAcres: null,
    floodplainAcres: null,
    percResult: { value: "fail", source: "perc test by A. Soil", asOf: "2026-09-12" },
    sewerAvailable: null,
    waterAvailable: null,
    unresolvedEasementAcres: null,
    maxSlopePct: null,
    percEstimate: null,
  },
  { floodplainShareMax: null, maxBuildableSlopePct: null },
  yieldEstimate,
);
const RUN = {
  id: 1,
  ruleVersion: result.version,
  createdAt: "2026-11-05T12:00:00Z",
  triggeredCount: 1,
  notDeterminableCount: result.notDeterminable.length,
  yieldEstimate,
  result,
  reconciliationAtRun: reconcileWithDrawnPlans(yieldEstimate, [{ planId: "p1", name: "Plan A", lotCount: 12 }]),
};

let root: Root;
let host: HTMLDivElement;
let runs: unknown[] = [];
const posted: unknown[] = [];

beforeEach(() => {
  posted.length = 0;
  vi.stubGlobal("fetch", async (url: string, init?: { method?: string; body?: string }) => {
    if (init?.method === "POST") {
      posted.push(JSON.parse(init.body as string));
      return { ok: true, json: async () => ({ run: RUN }) } as unknown as Response;
    }
    return {
      ok: true,
      json: async () => ({ runs, latestReconciliation: runs.length ? reconcileWithDrawnPlans(yieldEstimate, [{ planId: "p1", name: "Plan A", lotCount: 9 }]) : [], truncated: false }),
    } as unknown as Response;
  });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const render = async () => {
  await act(async () => {
    root.render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <BuildabilityScreenSection parentParcelId={42} />
      </QueryClientProvider>,
    );
  });
  for (let i = 0; i < 5; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
};

const setValue = (id: string, value: string) => {
  const el = host.querySelector<HTMLInputElement | HTMLSelectElement>(`#${id}`)!;
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  act(() => {
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
  });
};

describe("BuildabilityScreenSection", () => {
  it("not yet screened: a taught empty state; every input empty and labelled", async () => {
    runs = [];
    await render();
    expect(host.querySelector('[data-testid="screen-empty"]')?.textContent).toMatch(/Not yet screened/);
    expect(host.querySelector('[data-testid="screen-empty-cta"]')).not.toBeNull();
    expect(host.textContent).not.toMatch(/\bbuildable\b(?! slope| acres| area)/i);
    const fields = [...host.querySelectorAll<HTMLInputElement | HTMLSelectElement>("input, select")];
    expect(fields.length).toBeGreaterThanOrEqual(30);
    for (const el of fields) {
      expect(el.value, el.id).toBe("");
      expect(host.querySelector(`label[for="${el.id}"]`), el.id).not.toBeNull();
    }
  });

  it("a stored run renders as stored: headline, verdicts with evidence and resolution paths, yield beside the drawn plan", async () => {
    runs = [RUN];
    await render();
    expect(host.querySelector('[data-testid="screen-headline"]')?.textContent).toBe(result.headline);
    const septic = host.querySelector('[data-testid="screen-verdict-septic"]')!.textContent!;
    expect(septic).toContain("triggered");
    expect(septic).toContain("perc test result: fail — perc test by A. Soil (as of 2026-09-12)");
    const flood = host.querySelector('[data-testid="screen-verdict-flood"]')!.textContent!;
    expect(flood).toContain("not determinable");
    expect(flood).toMatch(/To resolve: FEMA flood map panel/);
    const y = host.querySelector('[data-testid="screen-yield"]')!.textContent!;
    expect(y).toContain("Yield, low: not computed");
    expect(y).toContain("Gross 13.5 ac — county GIS");
    expect(y).toContain("At this run — Plan A: drawn 12 lots vs estimated range up to 10 (low end not determinable)");
    expect(y).toContain("Today — Plan A: drawn 9 lots vs estimated range up to 10 (low end not determinable)");
  });

  it("a value without its source is REFUSED by field name (never silently dropped); fixed, the run sends percentages as fractions", async () => {
    runs = [];
    await render();
    setValue("bs-legalAccess", "recorded_access");
    setValue("bs-legalAccess-source", "deed book 1234");
    setValue("bs-floodwayAcres", "2"); // no source
    setValue("bs-waterAvailable", "false"); // no source
    const problems = () => host.querySelector('[data-testid="screen-problems"]')?.textContent ?? "";
    expect(problems()).toContain("Floodway acres: add where this value comes from (its source), or clear the value.");
    expect(problems()).toContain("Water available: add where this value comes from (its source), or clear the value.");
    expect(host.querySelector<HTMLButtonElement>('[data-testid="screen-run-button"]')!.disabled).toBe(true);
    setValue("bs-floodwayAcres", "");
    setValue("bs-waterAvailable", "");
    setValue("bs-min-lot", "1"); // no citation
    expect(problems()).toContain("Minimum lot: add where you read it (its citation)");
    setValue("bs-min-lot", "");
    setValue("bs-floodplain-pct", "20");
    setValue("bs-roads", "10");
    expect(host.querySelector('[data-testid="screen-problems"]')).toBeNull();
    await act(async () => {
      host.querySelector<HTMLButtonElement>('[data-testid="screen-run-button"]')!.click();
    });
    await act(async () => {});
    const body = posted[0] as any;
    expect(body.facts.legalAccess).toEqual({ value: "recorded_access", source: "deed book 1234", asOf: null });
    expect(body.facts.floodwayAcres).toBeNull();
    expect(body.facts).not.toHaveProperty("percEstimate");
    expect(body.thresholds.floodplainShareMax).toBe(0.2);
    expect(body.yield.roadsRowFraction).toBe(0.1);
  });
});
