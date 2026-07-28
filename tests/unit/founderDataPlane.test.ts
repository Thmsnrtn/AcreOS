/**
 * founderDataPlane.test.ts — the one honest founder pane for the data plane
 * (ruling #9 wave 4) stays honest.
 *
 * Source-shape coverage, same discipline as breakGlassCard.test.ts:
 *  1. GET /data-plane exists in routes-founder-intelligence.ts, founder-gated,
 *     and answers with ALL SIX sections — probeHealth, circuits, recentChanges,
 *     corpora, discoveryQueue, licenses.
 *  2. Every section read is best-effort: each rides the readDataPlaneSection
 *     wrapper whose failure branch is an explicit { available: false, reason }
 *     — a failed sub-read is reported, never silently omitted.
 *  3. The change-events count is never presented as exact past the read cap
 *     (countIsLowerBound).
 *  4. The consumed services are READ-ONLY imports (listRecentChangeEvents,
 *     getCorporaStatus, DATA_LICENSE_REGISTER) — the route never imports the
 *     probe/discovery/self-healing machinery itself.
 *  5. The client pane (Data plane tab in /founder/admin/costs) renders the
 *     "couldn't check" branch for EVERY section, the reason verbatim, shape-
 *     matched skeletons, QueryErrorState with retry, an aria-label on the
 *     icon-only refresh button, and no dead links (the discovery tile names
 *     the admin API honestly instead of linking to a review UI that doesn't
 *     exist).
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf-8");

const routes = read("server/routes-founder-intelligence.ts");
const costs = read("client/src/pages/founder/admin/costs.tsx");

// ── Server route slice ──────────────────────────────────────────────────────
// Isolate the /data-plane block so assertions can't be satisfied by unrelated
// routes in the (large) file.
const routeStart = routes.indexOf('router.get("/data-plane"');
const helperStart = routes.indexOf("async function readDataPlaneSection");
const routeEnd = routes.indexOf("POST /api/founder/intelligence/break-glass/email", routeStart);
const routeSection = routes.slice(helperStart, routeEnd);
const handlerSection = routes.slice(routeStart, routeEnd);

const SECTIONS = [
  "probeHealth",
  "circuits",
  "recentChanges",
  "corpora",
  "discoveryQueue",
  "licenses",
] as const;

describe("routes-founder-intelligence.ts — GET /data-plane", () => {
  it("exists and is founder-gated", () => {
    expect(routeStart).toBeGreaterThan(-1);
    expect(helperStart).toBeGreaterThan(-1);
    expect(helperStart).toBeLessThan(routeStart);
    expect(handlerSection).toContain('router.get("/data-plane", requireFounder,');
  });

  it("answers with all six sections — none may be omitted", () => {
    // The success res.json payload names every section explicitly.
    const jsonStart = handlerSection.indexOf("res.json({");
    expect(jsonStart).toBeGreaterThan(-1);
    const jsonBlock = handlerSection.slice(jsonStart, handlerSection.indexOf("});", jsonStart));
    for (const s of SECTIONS) {
      expect(jsonBlock, `response must carry section "${s}"`).toMatch(new RegExp(`\\b${s}\\b`));
    }
    expect(jsonBlock).toContain("generatedAt");
  });

  it("every section is best-effort via readDataPlaneSection ({available:false, reason} on failure)", () => {
    // The wrapper's failure branch is the explicit unavailable shape…
    expect(routeSection).toContain("available: false");
    expect(routeSection).toMatch(/reason:\s*err instanceof Error \? err\.message/);
    // …and all six sections go through it.
    const uses = handlerSection.match(/readDataPlaneSection\(/g)?.length ?? 0;
    expect(uses).toBeGreaterThanOrEqual(6);
  });

  it("probe health reads provider_health latest-per-probe with source/status/checkedAt", () => {
    expect(handlerSection).toContain("providerHealth");
    expect(handlerSection).toContain("latestByProbe");
    for (const field of ["source", "healthy", "lastCheckedAt", "darkCount", "healthyCount"]) {
      expect(handlerSection).toContain(field);
    }
  });

  it("circuits read the persisted circuit_breaker_state rows (source, state, updatedAt)", () => {
    expect(handlerSection).toContain("circuitBreakerState");
    expect(handlerSection).toContain("state: r.state");
    expect(handlerSection).toContain("updatedAt: r.updatedAt");
  });

  it("change-events count is honest about the read cap (countIsLowerBound)", () => {
    expect(handlerSection).toContain("countIsLowerBound");
    expect(handlerSection).toContain("events.length === 500");
  });

  it("consumes the openData/license services READ-ONLY — never the probe/discovery machinery", () => {
    expect(handlerSection).toContain("listRecentChangeEvents");
    expect(handlerSection).toContain('import("./services/openData/changeDetection")');
    expect(handlerSection).toContain("getCorporaStatus");
    expect(handlerSection).toContain('import("./services/openData/corporaStatus")');
    expect(handlerSection).toContain("DATA_LICENSE_REGISTER");
    expect(handlerSection).toContain('import("./services/providers/data-licenses")');
    // Write-side / sibling-owned machinery must never be pulled in here.
    for (const banned of [
      "dataSourceProbe",
      "selfHealing",
      "arcgis-discovery",
      "statewideParcelEndpoints",
      "discoveryPipeline",
      "recordCategoryChanges",
      "seedOpenDataCorporaDecisionCard",
    ]) {
      expect(handlerSection, `route must not touch ${banned}`).not.toContain(banned);
    }
  });

  it("discovery queue counts pending discovered_endpoints only", () => {
    expect(handlerSection).toContain("discoveredEndpoints");
    expect(handlerSection).toContain('eq(discoveredEndpoints.status, "pending")');
    expect(handlerSection).toContain("pendingReviewCount");
  });
});

// ── Client pane slice ───────────────────────────────────────────────────────
const paneStart = costs.indexOf("// ─── Data plane");
const paneEnd = costs.indexOf("// ─── Outreach stop-loss");
const pane = costs.slice(paneStart, paneEnd);

describe("founder/admin/costs.tsx — the Data plane tab", () => {
  it("is a tab inside the existing /founder/admin/costs page (no new route)", () => {
    expect(paneStart).toBeGreaterThan(-1);
    expect(costs).toContain('{ value: "data-plane", label: "Data plane" }');
    expect(costs).toContain('<TabsContent value="data-plane"><DataPlaneContent /></TabsContent>');
  });

  it('renders the "couldn\'t check" branch for EVERY section — a failed read is said out loud', () => {
    expect(pane).toContain("Couldn't check.");
    // The unavailable tile renders the server's reason VERBATIM.
    expect(pane).toMatch(/<span className="break-words">\{reason\}<\/span>/);
    // Every one of the six sections has the available:false branch wired.
    const unavailableUses = pane.match(/<SectionUnavailable reason=/g)?.length ?? 0;
    expect(unavailableUses).toBe(6);
    for (const s of [
      "d.probeHealth.available",
      "d.circuits.available",
      "d.recentChanges.available",
      "d.corpora.available",
      "d.discoveryQueue.available",
      "d.licenses.available",
    ]) {
      expect(pane, `pane must branch on ${s}`).toContain(`!${s}`);
    }
  });

  it("loading state is shape-matched skeletons, error state is QueryErrorState with retry", () => {
    expect(pane).toContain("DataPlaneTileSkeleton");
    expect(pane).toContain('data-testid="data-plane-loading"');
    expect(pane).toContain("<QueryErrorState");
    expect(pane).toContain("onRetry={() => query.refetch()}");
  });

  it("the icon-only refresh button carries an aria-label", () => {
    expect(pane).toContain('aria-label="Refresh data plane"');
  });

  it("all headline numbers come from the response, never hardcoded", () => {
    // Canary copy is computed from real counts…
    expect(pane).toContain("All ${d.probeHealth.healthyCount} instruments answering.");
    expect(pane).toContain("${d.probeHealth.darkCount} of ${d.probeHealth.instruments.length} instruments dark");
    // …the canary-silent window and change window quote the server's values…
    expect(pane).toContain("${d.probeHealth.windowHours} hours");
    expect(pane).toContain("{d.recentChanges.windowDays} days");
    // …and the discovery count renders the real record count.
    expect(pane).toContain("{d.discoveryQueue.pendingReviewCount}");
  });

  it("change-events feed renders the REAL narratives and honest lower-bound counts", () => {
    expect(pane).toContain("{e.narrative}");
    expect(pane).toContain('{d.recentChanges.countIsLowerBound ? "+" : ""}');
  });

  it("corpora tile shows the not-provisioned reason verbatim", () => {
    expect(pane).toContain("{c.reason}");
  });

  it("discovery tile links nowhere fake — it names the admin API instead", () => {
    const tileStart = pane.indexOf('data-testid="data-plane-discovery"');
    const tileEnd = pane.indexOf('data-testid="data-plane-licenses"');
    const tile = pane.slice(tileStart, tileEnd);
    expect(tile).toContain("no review screen yet");
    expect(tile).toContain("/api/discovery/pending");
    expect(tile).not.toContain("href=");
    expect(tile).not.toContain("<a ");
    expect(tile).not.toContain("<Link");
  });

  it("uses design tokens only — no hex colors in the pane", () => {
    expect(pane).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});
