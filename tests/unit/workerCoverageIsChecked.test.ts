/**
 * The simulated year fails loudly when the brain did not model a worker it
 * reached (tests/simulation/platform/workerCoverage.ts), and the capable brain
 * now models the generic autopilot dispatch (Iris: ops and deploy), with a
 * stated, non-zero share of failures and no-work outcomes.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { workerCoverage, workerShapeOf, BRAIN_SKIPPED, NO_ANSWER_MAX_SHARE } from "../simulation/platform/workerCoverage";
// @ts-expect-error — plain .mjs brain, no declarations
import { answer, IRIS_FAILURE_PER_100, IRIS_NO_WORK_PER_100 } from "../simulation/standin/brains/capable.mjs";
import { stripComments } from "../helpers/stripComments";

const DISPATCH = "# Team-state preamble (auto-generated, 15-min refresh)";

describe("worker coverage", () => {
  it("names each worker shape; non-worker calls are not counted", () => {
    expect(workerShapeOf("AcreOS role worker — Support You answer")).toBe("role worker: support");
    expect(workerShapeOf("You are Pax, the AcreOS Support Agent")).toBe("pax");
    expect(workerShapeOf(DISPATCH)).toMatch(/autopilot dispatch/);
    expect(workerShapeOf("You are a constitutional pre-call screener")).toBeNull();
  });

  it("canary: a worker the brain skipped fails the run (the 2026-10-10 Iris gap)", () => {
    const rows = Array.from({ length: 38 }, () => ({ caller: DISPATCH, brain: BRAIN_SKIPPED }));
    expect(workerCoverage(rows).failing).toHaveLength(1);
  });

  it("a modelled worker passes; a skip rate at or under the limit passes, over it fails", () => {
    const ok = Array.from({ length: 100 }, (_, i) => ({ caller: "AcreOS role worker — Writer", brain: i < NO_ANSWER_MAX_SHARE * 100 ? BRAIN_SKIPPED : "applied" }));
    expect(workerCoverage(ok).failing).toEqual([]);
    ok.push({ caller: "AcreOS role worker — Writer", brain: BRAIN_SKIPPED }, { caller: "AcreOS role worker — Writer", brain: BRAIN_SKIPPED });
    expect(workerCoverage(ok).failing).toHaveLength(1);
  });

  it("the year run computes coverage over this run's calls and exits non-zero on a gap", () => {
    const src = stripComments(fs.readFileSync(path.resolve(__dirname, "../simulation/platform/year.ts"), "utf8"));
    expect(src).toMatch(/workerCoverage\(callRows\)/);
    expect(src).toMatch(/\.slice\(standinCallsStart\)/);
    expect(src).toMatch(/coverage\.failing\.length > 0\)[\s\S]{0,400}k\.shutdown\(1\)/);
  });
});

describe("the capable brain models the autopilot dispatch", () => {
  const task = (kind: string, domain: string) => ({ system: DISPATCH, messages: [{ role: "user", content: `Autopilot task — ${kind} (${domain}).\nNothing urgent — improve.` }], tools: [], forced: null, schema: null });

  it("answers every ops/deploy kind (never the stand-in's skip)", () => {
    for (const [k, d] of [["optimize", "ops"], ["resolve_incident", "deploy"], ["stabilize_reflexes", "deploy"], ["unblock_activation", "deploy"], ["protect_deliverability", "ops"], ["clear_compliance", "ops"]]) {
      expect(answer(task(k, d)), k).not.toBeNull();
    }
  });

  it("its stated failure and no-work shares are real and non-zero", () => {
    expect(IRIS_FAILURE_PER_100).toBeGreaterThan(0);
    expect(IRIS_NO_WORK_PER_100).toBeGreaterThan(0);
    const out = { fail: 0, none: 0, work: 0 };
    for (let i = 0; i < 100; i++) {
      const a = answer(task("optimize", "ops"));
      if (/^Nothing further to add\.$/.test(a.content)) out.fail++;
      else if (/nothing needs changing/.test(a.content)) out.none++;
      else out.work++;
    }
    expect(out.fail).toBe(IRIS_FAILURE_PER_100);
    expect(out.none).toBe(IRIS_NO_WORK_PER_100);
    expect(out.work).toBe(100 - IRIS_FAILURE_PER_100 - IRIS_NO_WORK_PER_100);
  });
});
