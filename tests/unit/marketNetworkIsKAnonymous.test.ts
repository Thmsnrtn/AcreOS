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
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { stripComments } from "../helpers/stripComments";
import { REPO_SWEEP_TIMEOUT_MS } from "../helpers/sweepBudget";

vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });

const h = vi.hoisted(() => ({ rows: [] as Array<{ ppa: string; contributor: string | null }> }));

vi.mock("../../server/db", () => ({
  db: {
    select: () => {
      const q: Record<string, unknown> = {};
      q.from = () => q;
      q.where = async () => h.rows;
      return q;
    },
  },
}));
vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { getNetworkCompsForCounty } from "../../server/services/marketNetworkContributor";

const ROOT = resolve(__dirname, "../..");
const row = (ppa: number, contributor: string | null) => ({ ppa: String(ppa), contributor });

beforeEach(() => {
  h.rows = [];
});

describe("DEFECT-0155 — the cohort floor counts operators", () => {
  it("five deals from ONE operator are not served", async () => {
    h.rows = [1000, 1500, 2000, 2500, 3000].map((p) => row(p, "op-a"));
    expect(await getNetworkCompsForCounty("Travis", "TX")).toBeNull();
  });

  it("untagged legacy rows do not count as distinct operators", async () => {
    h.rows = [1000, 1500, 2000, 2500, 3000].map((p) => row(p, null));
    expect(await getNetworkCompsForCounty("Travis", "TX")).toBeNull();
  });

  it("five deals from three operators are served, without single-deal extremes", async () => {
    h.rows = [row(1000, "a"), row(1500, "a"), row(2000, "b"), row(2500, "c"), row(3000, "c")];
    const r = await getNetworkCompsForCounty("Travis", "TX");
    expect(r).not.toBeNull();
    expect(r).toMatchObject({ medianPricePerAcre: 2000, dataPoints: 5 });
    expect(r).not.toHaveProperty("minPricePerAcre");
    expect(r).not.toHaveProperty("maxPricePerAcre");
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
