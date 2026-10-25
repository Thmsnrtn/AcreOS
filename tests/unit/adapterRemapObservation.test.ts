/**
 * D2d — what a heal leaves in etl_runs.observation, and the two readers of it:
 *   - activeMappingFromRuns (the next run's mapping), and
 *   - foldRemapRates (D2g's auto-remap rate, server/services/ops/dataOpsMetrics.ts).
 *
 * The attempts here are REAL healDrift outputs, wrapped in the exact shapes the
 * statewide handler writes (pinned against server/services/etlHandlers.ts
 * below) and round-tripped through JSON as jsonb does — so a change to either
 * the writer's shape or the reader's key goes red here, not on the ops page.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../server/db", () => ({ db: {} }));
vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { activeMappingFromRuns, healDrift, type RemapAttempt } from "../../server/services/openData/adapterRemap";
import { SchemaDriftError, buildSpecFor, type FieldMapping, type LayerDeps, type LayerField } from "../../server/services/landData/statewideCadastral";
import { foldRemapRates, type RunObservationRow } from "../../server/services/ops/dataOpsMetrics";
import { goldenCountyFor, verifiedParcels } from "../../shared/landData/goldenCounty";
import { stripComments } from "../helpers/stripComments";
import { REPO_SWEEP_TIMEOUT_MS } from "../helpers/sweepBudget";

vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });

const ROOT = path.join(__dirname, "../..");
const FL = buildSpecFor("FL");
const JOB = "fl_statewide_cadastral_v1";
const NOW = new Date("2026-10-24T12:00:00Z");
const GOLDEN = verifiedParcels(goldenCountyFor("FL"));
const f = (name: string, type: string, alias: string | null = null): LayerField => ({ name, type, alias });
const NUM = "esriFieldTypeDouble";
const TXT = "esriFieldTypeString";
const base = [f("OBJECTID", "esriFieldTypeOID"), f("CO_NO", TXT), f("PHY_CITY", TXT), f("PARCEL_ID", TXT), f("OWN_NAME", TXT), f("PHY_ADDR1", TXT), f("AV_NSD", NUM), f("SALE_PRC1", NUM), f("S_LEGAL", TXT)];

function layer(jvAs: string, jvFrom: "JV" | "AV_NSD"): LayerDeps {
  const rows = GOLDEN.map((p) => {
    const a = { ...(p.sourceAttributes ?? {}) };
    const v = a[jvFrom];
    delete a.JV;
    return { ...a, [jvAs]: v };
  });
  return {
    async getJson(url) {
      const m = /^(\w+) = '(.*)'$/.exec(new URLSearchParams(url.split("?")[1]).get("where") ?? "");
      return { ok: true, status: 200, body: { features: (m ? rows.filter((r) => String(r[m[1]]) === m[2]) : []).map((attributes) => ({ attributes })) } };
    },
  };
}
const jsonb = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

async function attempts() {
  const promoted = await healDrift(FL, new SchemaDriftError("FL", ["JV"], [...base, f("JV_", NUM)], FL.mapping), layer("JV_", "JV"), NOW);
  const rejected = await healDrift(FL, new SchemaDriftError("FL", ["JV"], [...base, f("JV_HMSTD", NUM)], FL.mapping), layer("JV_HMSTD", "AV_NSD"), NOW);
  const noProposal = await healDrift(FL, new SchemaDriftError("FL", ["JV"], base, FL.mapping), layer("UNUSED", "JV"), NOW);
  return { promoted, rejected, noProposal };
}

/** The handler's two observation shapes (see the source pin below). */
const successObs = (remap: RemapAttempt | null) => jsonb({ summary: { county: "55", normalized: 5 }, outcome: { status: "dry_run_only" }, remap });
const failureObs = (remap: RemapAttempt) => jsonb({ kind: "statewide_cadastral_drift", remap });

describe("the attempts are what they claim (vacuity)", () => {
  it("one real attempt of each outcome", async () => {
    const a = await attempts();
    expect([a.promoted.outcome, a.rejected.outcome, a.noProposal.outcome]).toEqual(["promoted", "rejected", "no_proposal"]);
  });
});

describe("D2g's auto-remap rate reads exactly what the handler writes", () => {
  it("success-with-heal, plain success, failed-rejected, failed-no-proposal, failed-with-no-observation → 5 runs, 3 attempts, 1/1/1, rate 0.2", async () => {
    const a = await attempts();
    const rows: RunObservationRow[] = [
      { jobName: JOB, status: "success", observation: successObs(a.promoted) },
      { jobName: JOB, status: "success", observation: successObs(null) },
      { jobName: JOB, status: "failure", observation: failureObs(a.rejected) },
      { jobName: JOB, status: "failure", observation: failureObs(a.noProposal) },
      { jobName: JOB, status: "failure", observation: null },
    ];
    expect(foldRemapRates(rows)).toEqual([
      expect.objectContaining({ jobName: JOB, runs: 5, attempts: 3, promoted: 1, rejected: 1, noProposal: 1, promotionRate: 0.2 }),
    ]);
  });

  it("source pin: the handler writes `remap` on both the success observation and the failed run's failureObservation, and finalize returns the build", () => {
    const src = stripComments(readFileSync(path.join(ROOT, "server/services/etlHandlers.ts"), "utf8"));
    expect(src).toMatch(/runState\.failureObservation\s*=\s*\{\s*kind:\s*"statewide_cadastral_drift",\s*remap\s*\}/);
    expect(src).toMatch(/runState\.build\s*=\s*\{\s*\.\.\.report,\s*remap\s*\}/);
    expect(src).toMatch(/const built = opts\.runState\?\.build[\s\S]{0,200}return built \?/);
    const orch = stripComments(readFileSync(path.join(ROOT, "server/services/etlOrchestrator.ts"), "utf8"));
    expect(orch).toMatch(/runState\?\.failureObservation[\s\S]{0,120}observation = fo/);
  });

  it("population: healDrift has exactly one production call site (the statewide handler) — a second caller must be added to this contract", () => {
    const files: string[] = [];
    const walk = (d: string) => {
      for (const e of readdirSync(d)) {
        const p = path.join(d, e);
        if (statSync(p).isDirectory()) walk(p);
        else if (p.endsWith(".ts")) files.push(p);
      }
    };
    walk(path.join(ROOT, "server"));
    expect(files.length).toBeGreaterThan(100);
    const callers = files.filter((p) => !p.endsWith("adapterRemap.ts") && /\bhealDrift\s*\(/.test(stripComments(readFileSync(p, "utf8"))));
    expect(callers.map((p) => path.relative(ROOT, p))).toEqual(["server/services/etlHandlers.ts"]);
  });
});

describe("the active mapping is adopted only from a promoted remap WITH its passing evidence", () => {
  it("a real promoted attempt, round-tripped through jsonb, becomes the active mapping; rejected / no-proposal never do", async () => {
    const a = await attempts();
    expect(activeMappingFromRuns([failureObs(a.rejected), successObs(a.promoted)])?.marketValue).toBe("JV_");
    expect(activeMappingFromRuns([failureObs(a.rejected), failureObs(a.noProposal), successObs(null)])).toBeNull();
  });

  it("FALSIFICATION: a record that SAYS promoted but carries no passing verification is never adopted", async () => {
    const a = await attempts();
    const forged: RemapAttempt = { ...a.promoted, verification: null };
    const failedEvidence: RemapAttempt = { ...a.promoted, verification: { ...(a.promoted.verification as NonNullable<RemapAttempt["verification"]>), passed: false } };
    expect(activeMappingFromRuns([successObs(forged)])).toBeNull();
    expect(activeMappingFromRuns([successObs(failedEvidence)])).toBeNull();
  });

  it("a promoted mapping with no parcel-id field is never adopted (it would wedge every later run in buildSpecFor)", async () => {
    const a = await attempts();
    const noApn: FieldMapping = { ...(a.promoted.mappingAfter ?? {}) };
    delete noApn.apn;
    expect(noApn.marketValue).toBe("JV_");
    expect(activeMappingFromRuns([successObs({ ...a.promoted, mappingAfter: noApn })])).toBeNull();
  });
});
