/**
 * DEFECT-0155 — the market network never serves one operator's deal.
 *
 * Each closed deal became its own market_metrics row (organizationId NULL,
 * periodType "transaction", median = that deal's $/acre). Every other reader
 * took "the latest row for the county", so any customer's market health /
 * analysis showed another operator's just-closed deal, and analyzeMarket
 * re-published it as a monthly metric. The cohort floor counted deals, not
 * operators, min/max were single deals, and the copy claimed "N operators …
 * over the last 90 days" (neither true).
 *
 * Ruling 2026-09-29 #11 (DEFECT-0159) raised the operator floor from 3 to 5
 * and made it opt-in: a contribution counts only while its org CURRENTLY
 * consents, so an opt-out leaves the next figure served.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { stripComments } from "../helpers/stripComments";
import { REPO_SWEEP_TIMEOUT_MS } from "../helpers/sweepBudget";

vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });

const h = vi.hoisted(() => ({
  rows: [] as Array<{ ppa: string; contributor: string | null }>,
  consenting: new Set<number>(),
  consentChecks: [] as number[],
  hasConsent: true,
}));

vi.mock("../../server/db", () => ({
  db: {
    select: () => {
      const q: Record<string, unknown> = {};
      q.from = () => q;
      q.innerJoin = () => q;
      q.where = () => Object.assign(Promise.resolve(h.rows), { limit: async () => h.rows });
      return q;
    },
  },
}));
vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../../server/services/sophiePrivacyGuard", () => ({
  consentingOrgIds: async () => h.consenting,
  sophiePrivacyGuard: { hasConsent: async (id: number) => (h.consentChecks.push(id), h.hasConsent) },
}));

import { createHash } from "node:crypto";
import { contributeClosedDealToNetwork, getNetworkCompsForCounty } from "../../server/services/marketNetworkContributor";

const ROOT = resolve(__dirname, "../..");
/** The contributor tag the module stores for an org (pinned here on purpose). */
const tag = (orgId: number) => createHash("sha256").update(`acreos-market-network:${orgId}`).digest("hex").slice(0, 16);
const row = (ppa: number, orgId: number | null) => ({ ppa: String(ppa), contributor: orgId === null ? null : tag(orgId) });

beforeEach(() => {
  h.rows = [];
  h.consenting = new Set([1, 2, 3, 4, 5, 6, 7]);
  h.consentChecks = [];
  h.hasConsent = true;
});

describe("DEFECT-0155 — the cohort floor counts operators", () => {
  it("five deals from ONE operator are not served", async () => {
    h.rows = [1000, 1500, 2000, 2500, 3000].map((p) => row(p, 1));
    expect(await getNetworkCompsForCounty("Travis", "TX")).toBeNull();
  });

  it("untagged legacy rows do not count as distinct operators", async () => {
    h.rows = [1000, 1500, 2000, 2500, 3000].map((p) => row(p, null));
    expect(await getNetworkCompsForCounty("Travis", "TX")).toBeNull();
  });

  it("three operators are no longer enough (the floor is five, ruling #11)", async () => {
    h.rows = [row(1000, 1), row(1500, 1), row(2000, 2), row(2500, 3), row(3000, 3)];
    expect(await getNetworkCompsForCounty("Travis", "TX")).toBeNull();
  });

  it("five deals from five consenting operators are served, without single-deal extremes", async () => {
    h.rows = [row(1000, 1), row(1500, 2), row(2000, 3), row(2500, 4), row(3000, 5)];
    const r = await getNetworkCompsForCounty("Travis", "TX");
    expect(r).not.toBeNull();
    expect(r).toMatchObject({ medianPricePerAcre: 2000, dataPoints: 5 });
    expect(r).not.toHaveProperty("minPricePerAcre");
    expect(r).not.toHaveProperty("maxPricePerAcre");
  });

  it("an org that has not opted in contributes nothing when its deal closes", async () => {
    h.hasConsent = false;
    h.rows = [{ dealValue: "50000", closingDate: new Date(), propertyId: 1, county: "Travis", state: "TX", sizeAcres: "10", zoning: null } as never];
    const r = await contributeClosedDealToNetwork(42, 7);
    expect(r).toEqual({ contributed: false, reason: "Organization has not opted in to shared market data" });
    expect(h.consentChecks).toEqual([7]);
  });

  it("an operator who opted OUT leaves the figure at once — its rows no longer count", async () => {
    h.rows = [row(1000, 1), row(1500, 2), row(2000, 3), row(2500, 4), row(3000, 5)];
    h.consenting = new Set([1, 2, 3, 4]); // org 5 switched sharing off
    expect(await getNetworkCompsForCounty("Travis", "TX")).toBeNull();
  });

  it("a figure is never computed from non-consenting rows, even with enough consenting operators", async () => {
    h.rows = [row(1000, 1), row(1000, 2), row(1000, 3), row(1000, 4), row(1000, 5), row(99000, 99)];
    const r = await getNetworkCompsForCounty("Travis", "TX");
    expect(r).toMatchObject({ dataPoints: 5, medianPricePerAcre: 1000 }); // org 99's deal is not in it
  });
});

function serverFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (name !== "node_modules") serverFiles(p, out); }
    else if (p.endsWith(".ts") && !p.endsWith(".test.ts") && !p.endsWith(".d.ts")) out.push(p);
  }
  return out;
}

describe("DEFECT-0155 population — every market_metrics reader excludes raw contributions", () => {
  const readers: string[] = [];
  const offenders: string[] = [];
  for (const p of serverFiles(resolve(ROOT, "server"))) {
    const rel = relative(ROOT, p);
    if (rel === "server/services/marketNetworkContributor.ts") continue; // owns the raw rows
    const src = stripComments(readFileSync(p, "utf8"));
    let at = src.indexOf(".from(marketMetrics)");
    while (at >= 0) {
      readers.push(`${rel}@${at}`);
      const chain = src.slice(at, src.indexOf(";", at));
      if (!/publishedMarketMetric\(\)/.test(chain)) offenders.push(`${rel}@${at}`);
      at = src.indexOf(".from(marketMetrics)", at + 1);
    }
  }

  it("reads the population (vacuity)", () => {
    expect(readers.length).toBeGreaterThanOrEqual(11);
  });

  it("no reader can pick up a single deal's row", () => {
    expect(offenders).toEqual([]);
  });

  it("the customer copy claims neither operators nor a date window it does not have", () => {
    const src = stripComments(readFileSync(resolve(ROOT, "server/services/marketIntelligence.ts"), "utf8"));
    expect(src).not.toMatch(/operators closed deals|over the last 90 days at/);
  });
});
