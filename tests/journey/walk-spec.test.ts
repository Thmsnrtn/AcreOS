/**
 * Journey-proof harness — pure unit tests (no database, no server imports).
 *
 * These pin the format's guarantees: spec validation refuses walks that
 * skip their Pax leg, hide a simulation, or cannot run a sql step on
 * staging; the runner stops at the first failed step, records a blocked
 * Pax leg without executing it, collects operator values for manual steps,
 * and renders the in-repo record from the same report it executed.
 */
import { describe, expect, it } from "vitest";
import { defineWalkSpec, validateWalkSpec } from "./walk-spec";
import type { WalkSpec, WalkStep } from "./walk-spec";
import { renderWalkRecord, runWalk } from "./runner";
import type { WalkDriver, WalkReport } from "./runner";
import { wholesaleWalk } from "./specs/wholesale";

function minimalStep(overrides: Partial<WalkStep> & { id: string }): WalkStep {
  return {
    title: "Step",
    kind: "api",
    how: "Call the API.",
    mustObserve: "200.",
    async run() {
      return { observed: { status: 200 } };
    },
    ...overrides,
  };
}

function minimalSpec(overrides?: Partial<WalkSpec>): WalkSpec {
  return defineWalkSpec({
    id: "test-vertical",
    vertical: "test_vertical",
    title: "Test vertical walk",
    version: 1,
    fences: { noSend: true, noRealMoney: true, stagingOnly: true },
    org: { businessType: "test_vertical", nameSuffix: "Test LLC", skipSampleData: true },
    cleanupTables: ["deals"],
    steps: [
      minimalStep({ id: "first" }),
      {
        id: "pax-leg",
        title: "Pax exercise",
        kind: "pax",
        how: "Through Pax.",
        mustObserve: "Exercised.",
        paxState: "exercised",
        async run() {
          return { observed: { exercised: true } };
        },
      },
    ],
    ...overrides,
  });
}

function fakeDriver(overrides?: Partial<WalkDriver>): WalkDriver {
  return {
    name: "realdb",
    label: "fake driver (unit test)",
    setupOrg: async () => ({ orgId: 1 }),
    api: async () => ({ status: 200, body: {} }),
    sql: async () => [],
    sentCount: () => 0,
    version: async () => ({ sha: "unknown" }),
    cleanup: async () => {},
    ...overrides,
  };
}

function fakeReport(overrides?: Partial<WalkReport>): WalkReport {
  return {
    specId: "test-vertical",
    vertical: "test_vertical",
    specVersion: 1,
    runId: "walk-test-vertical-20261120-abc123",
    driver: "staging",
    environment: "staging (unit test)",
    orgId: 42,
    tag: "walk-test-vertical-20261120-abc123",
    startedAtIso: "2026-11-20T05:30:00.000Z",
    finishedAtIso: "2026-11-20T05:31:00.000Z",
    startedAtEt: "11/20/2026, 00:30:00",
    deployedSha: "unknown",
    steps: [
      { id: "first", title: "First", kind: "api", status: "pass", observed: { status: 200 }, notes: [], durationMs: 12 },
    ],
    sentCount: null,
    passed: true,
    verdict: "PASS",
    ...overrides,
  };
}

describe("validateWalkSpec", () => {
  it("accepts the migrated wholesale spec", () => {
    expect(validateWalkSpec(wholesaleWalk)).toEqual([]);
  });

  it("refuses a spec with no Pax leg", () => {
    const spec = minimalSpec({ steps: [minimalStep({ id: "only" })] });
    expect(validateWalkSpec(spec).join("\n")).toMatch(/at least one Pax leg/);
  });

  it("refuses a simulated step without its footnote", () => {
    const spec = minimalSpec({
      steps: [
        minimalStep({ id: "send", simulated: true }),
        minimalStep({ id: "pax-leg", kind: "pax", paxState: "exercised" }),
      ],
    });
    expect(validateWalkSpec(spec).join("\n")).toMatch(/simulationNote/);
  });

  it("refuses a sql step with no staging path", () => {
    const spec = minimalSpec({
      steps: [
        minimalStep({ id: "seed", kind: "sql" }),
        minimalStep({ id: "pax-leg", kind: "pax", paxState: "exercised" }),
      ],
    });
    expect(validateWalkSpec(spec).join("\n")).toMatch(/cannot run on staging/);
  });

  it("accepts a sql step with a manual staging mode", () => {
    const spec = minimalSpec({
      steps: [
        minimalStep({ id: "seed", kind: "sql", staging: { mode: "manual", note: "Seed through the UI." } }),
        minimalStep({ id: "pax-leg", kind: "pax", paxState: "exercised" }),
      ],
    });
    expect(validateWalkSpec(spec)).toEqual([]);
  });

  it("refuses a blocked Pax leg that names no reason", () => {
    const spec = minimalSpec({
      steps: [
        minimalStep({ id: "first" }),
        minimalStep({ id: "pax-leg", kind: "pax", paxState: "blocked" }),
      ],
    });
    expect(validateWalkSpec(spec).join("\n")).toMatch(/must name the reason/);
  });

  it("refuses duplicate step ids and a non-slug spec id", () => {
    const dup = minimalSpec({ steps: [minimalStep({ id: "x" }), minimalStep({ id: "x" }), minimalStep({ id: "pax-leg", kind: "pax", paxState: "exercised" })] });
    expect(validateWalkSpec(dup).join("\n")).toMatch(/duplicate step id: x/);
    const badId = minimalSpec({ id: "Bad ID" });
    expect(validateWalkSpec(badId).join("\n")).toMatch(/lowercase slug/);
  });

  it("refuses a spec whose fences are not all true", () => {
    const spec = minimalSpec({ fences: { noSend: false, noRealMoney: true, stagingOnly: true } });
    expect(validateWalkSpec(spec).join("\n")).toMatch(/noSend must be true/);
  });
});

describe("runWalk with a fake driver", () => {
  it("passes a clean spec and reports the run", async () => {
    const report = await runWalk(minimalSpec(), fakeDriver());
    expect(report.passed).toBe(true);
    expect(report.verdict).toBe("PASS");
    expect(report.steps.map((s) => s.id)).toEqual(["first", "pax-leg"]);
    expect(report.sentCount).toBe(0);
  });

  it("records a blocked Pax leg without executing it, and stays PARTIAL", async () => {
    let executed = false;
    const spec = minimalSpec({
      steps: [
        minimalStep({ id: "first" }),
        {
          id: "pax-leg",
          title: "Pax exercise",
          kind: "pax",
          how: "Through Pax.",
          mustObserve: "Blocked.",
          paxState: "blocked",
          paxBlockedReason: "No tools yet.",
          async run() {
            executed = true;
            return { observed: {} };
          },
        },
      ],
    });
    const report = await runWalk(spec, fakeDriver());
    expect(executed).toBe(false);
    expect(report.steps[1].status).toBe("blocked");
    expect(report.passed).toBe(false);
    expect(report.verdict).toMatch(/PARTIAL — Pax leg blocked/);
  });

  it("stops at the first failed step and never runs the next one", async () => {
    let secondRan = false;
    const spec = minimalSpec({
      steps: [
        minimalStep({
          id: "first",
          async run(ctx) {
            ctx.check(false, "the first observation is wrong");
            return { observed: {} };
          },
        }),
        minimalStep({
          id: "second",
          async run() {
            secondRan = true;
            return { observed: {} };
          },
        }),
        minimalStep({ id: "pax-leg", kind: "pax", paxState: "exercised" }),
      ],
    });
    const report = await runWalk(spec, fakeDriver());
    expect(report.steps[0].status).toBe("fail");
    expect(report.steps).toHaveLength(1);
    expect(secondRan).toBe(false);
    expect(report.verdict).toMatch(/^FAIL/);
  });

  it("fails the walk when a message was sent", async () => {
    const report = await runWalk(minimalSpec(), fakeDriver({ sentCount: () => 1 }));
    expect(report.passed).toBe(false);
    expect(report.verdict).toMatch(/1 message\(s\) sent/);
  });

  it("collects operator values for a manual step and stores them for later steps", async () => {
    const spec = minimalSpec({
      steps: [
        {
          id: "manual-seed",
          title: "Seed through the UI",
          kind: "sql",
          how: "Create the record in the UI.",
          mustObserve: "The record exists.",
          staging: { mode: "manual", note: "Create the record in the UI, then supply its id." },
          collects: [{ key: "recordId", prompt: "id of the record you created" }],
          async run(ctx) {
            ctx.store("recordId", 7);
            return { observed: { recordId: 7 } };
          },
        },
        minimalStep({
          id: "use-it",
          async run(ctx) {
            ctx.check(ctx.get("recordId") === "42", "later steps read the collected value");
            return { observed: { recordId: ctx.get("recordId") } };
          },
        }),
        minimalStep({ id: "pax-leg", kind: "pax", paxState: "exercised" }),
      ],
    });
    const staging = fakeDriver({
      name: "staging",
      collectManualInput: async () => ({ recordId: "42" }),
    });
    const report = await runWalk(spec, staging);
    expect(report.steps[0].status).toBe("manual");
    expect(report.steps[1].status).toBe("pass");
    // A manual step keeps the walk PARTIAL even when everything else passes.
    expect(report.passed).toBe(false);
    expect(report.verdict).toMatch(/PARTIAL — manual steps not run/);
  });

  it("fails loudly when a manual step's collected value is missing", async () => {
    const spec = minimalSpec({
      steps: [
        {
          id: "manual-seed",
          title: "Seed through the UI",
          kind: "sql",
          how: "Create the record in the UI.",
          mustObserve: "The record exists.",
          staging: { mode: "manual", note: "Create the record in the UI, then supply its id." },
          collects: [{ key: "recordId", prompt: "id of the record you created" }],
          async run(ctx) {
            ctx.store("recordId", 7);
            return { observed: { recordId: 7 } };
          },
        },
        minimalStep({ id: "pax-leg", kind: "pax", paxState: "exercised" }),
      ],
    });
    const staging = fakeDriver({ name: "staging", collectManualInput: async () => ({}) });
    const report = await runWalk(spec, staging);
    expect(report.steps[0].status).toBe("fail");
    expect(report.verdict).toMatch(/missing manual input recordId/);
  });

  it("refuses to run an invalid spec", async () => {
    const spec = minimalSpec({ steps: [minimalStep({ id: "only" })] });
    await expect(runWalk(spec, fakeDriver())).rejects.toThrow(/at least one Pax leg/);
  });
});

describe("renderWalkRecord", () => {
  it("names the run, the environment, and the unknown SHA honestly", () => {
    const record = renderWalkRecord(fakeReport());
    expect(record).toContain("walk-test-vertical-20261120-abc123");
    expect(record).toContain("staging (unit test)");
    expect(record).toContain("`unknown`");
    expect(record).toContain("/api/version");
    expect(record).toContain("**Verdict: PASS**");
  });

  it("renders simulation footnotes in the record and in the step", () => {
    const report = fakeReport({
      steps: [
        {
          id: "send",
          title: "Send",
          kind: "api",
          status: "pass",
          observed: { simulated: true, simulationNote: "Letters were NOT created; simulation only." },
          notes: [],
          durationMs: 5,
        },
      ],
    });
    const record = renderWalkRecord(report);
    expect(record).toContain("## Simulation footnotes");
    expect(record).toContain("Letters were NOT created; simulation only.");
  });

  it("renders a failed step with its error", () => {
    const report = fakeReport({
      passed: false,
      verdict: "FAIL — step first failed: the first observation is wrong",
      steps: [
        { id: "first", title: "First", kind: "api", status: "fail", observed: {}, notes: [], durationMs: 3, error: "the first observation is wrong" },
      ],
    });
    const record = renderWalkRecord(report);
    expect(record).toContain("FAIL");
    expect(record).toContain("the first observation is wrong");
  });
});
