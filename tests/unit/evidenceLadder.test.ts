/**
 * The Evidence Ladder holds: no capability claims more than its pointers
 * prove, E3+ is never claimed without a proving run of that kind, and the
 * Letter and the public vertical claim CONSUME the ladder rather than
 * re-deriving it.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { CAPABILITIES, evidenceLevelOf, evidenceLine, evidenceSummary, type Capability } from "../../shared/governance/evidenceLadder";
import { checkLadder, type RunRecord } from "../simulation/evidence/checkLadder";
import { buildFounderBrief } from "../../server/services/autopilot/narrate";
import { publicMaturityOf } from "../../shared/business-types/publicClaims";
import { BUSINESS_TYPES } from "../../shared/business-types";

const io = {
  exists: (p: string) => existsSync(p),
  readRun: (p: string): RunRecord | null => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; } },
};

describe("evidence ladder — the real registry", () => {
  it("every claim is backed by pointers that resolve, at the level it claims", () => {
    expect(checkLadder(CAPABILITIES, io)).toEqual([]);
  });
  it("nothing claims E3 or above today (no real-model, shadow, pilot or production run exists)", () => {
    expect(evidenceSummary().provenBeyondSimulation).toBe(0);
  });
});

describe("evidence ladder — the check fails on an overclaim (canaries)", () => {
  const fake = (over: Partial<Capability>): Capability => ({ id: "x", claim: "x", level: "E1", proof: { unit: ["tests/unit/evidenceLadder.test.ts"] }, ...over });
  const run = (kind: string, proves: string[]): RunRecord => ({ id: "r", kind, at: "2026-10-07", proves });
  const ioWith = (records: Record<string, RunRecord>) => ({ exists: (p: string) => p in records || existsSync(p), readRun: (p: string) => records[p] ?? null });
  it("E3 with no run pointer", () => {
    expect(checkLadder([fake({ level: "E3" })], io).join(" ")).toMatch(/no pointer to a proving run/);
  });
  it("E3 pointing at a deterministic simulation", () => {
    const errs = checkLadder([fake({ level: "E3", proof: { unit: ["tests/unit/evidenceLadder.test.ts"], runs: ["r.json"] } })], ioWith({ "r.json": run("deterministic-sim", ["x"]) }));
    expect(errs.join(" ")).toMatch(/strongest proving run reaches E2/);
  });
  it("E2 pointing at a run that does not list the capability", () => {
    const errs = checkLadder([fake({ level: "E2", proof: { unit: ["tests/unit/evidenceLadder.test.ts"], runs: ["r.json"] } })], ioWith({ "r.json": run("deterministic-sim", ["other"]) }));
    expect(errs.join(" ")).toMatch(/does not list it/);
  });
  it("E1 pointing at a test that does not exist", () => {
    expect(checkLadder([fake({ proof: { unit: ["tests/unit/nope.test.ts"] } })], io).join(" ")).toMatch(/does not exist/);
  });
  it("a correct E3 claim passes", () => {
    expect(checkLadder([fake({ level: "E3", proof: { unit: ["tests/unit/evidenceLadder.test.ts"], runs: ["r.json"] } })], ioWith({ "r.json": run("real-model-sim", ["x"]) }))).toEqual([]);
  });
});

describe("evidence ladder — adoption", () => {
  it("the Letter states the ladder's own line and counts", () => {
    const b = buildFounderBrief({ frozenSends: null, partOfDay: "morning", founderName: "Tom", pulse: { mrr: 0, trials: 0, weeklySpendUsd: 0, envelopeStatus: "green", uptimePct: 99, dispatchesCompletedLast24h: 0, dispatchesFlaggedLast24h: 0, decisionsWaitingCount: 0 }, openAsks: [], plannedFocus: null, operatingMode: null, trustLedger: [] });
    expect(b.evidence.line).toBe(evidenceLine());
    expect(b.evidence.provenInSimulation).toBe(evidenceSummary().provenInSimulation);
  });
  it("a public vertical claim cannot be core when the ladder has no evidence for it", () => {
    const meta = BUSINESS_TYPES.fix_and_flip;
    expect(publicMaturityOf(meta)).toBe("core");
    expect(evidenceLevelOf("vertical.fix_and_flip")).toBe("E1");
    const without = CAPABILITIES.filter((c) => c.id !== "vertical.fix_and_flip");
    expect(publicMaturityOf(meta, {}, without)).toBe("beta");
  });
});
