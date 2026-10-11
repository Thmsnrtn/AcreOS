/**
 * A provider blip that is requeued is not the domain's failure; its final
 * attempt is. Found in the simulated year (2026-10-10): one model-provider
 * outage demoted support and growth to DRAFT, though every one of those
 * dispatches was requeued and completed.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { autonomyFeedbackApplies } from "../../server/services/autopilot/act";
import { stripComments } from "../helpers/stripComments";

describe("which runs earn or cost autonomy", () => {
  it("a requeued transient error costs nothing; a terminal failure still does", () => {
    expect(autonomyFeedbackApplies({ terminationReason: "error", statusAfterRun: "queued" })).toBe(false);
    expect(autonomyFeedbackApplies({ terminationReason: "error", statusAfterRun: "failed" })).toBe(true);
    expect(autonomyFeedbackApplies({ terminationReason: "empty_result", statusAfterRun: "failed" })).toBe(true);
    expect(autonomyFeedbackApplies({ terminationReason: "end_turn", statusAfterRun: "completed" })).toBe(true);
    expect(autonomyFeedbackApplies({ terminationReason: "no_work", statusAfterRun: "cancelled" })).toBe(false);
    // An unreadable status is not "requeued": the run counts.
    expect(autonomyFeedbackApplies({ terminationReason: "error", statusAfterRun: null })).toBe(true);
  });

  it("the worker's feedback edge reads the row's status after the run and asks this rule", () => {
    const src = stripComments(fs.readFileSync(path.resolve(__dirname, "../../server/worker.ts"), "utf8"));
    const at = src.indexOf("const result = await runDispatch(row);");
    expect(at).toBeGreaterThan(-1);
    const edge = src.slice(at, src.indexOf("applyAutonomyFeedback({", at));
    expect(edge).toMatch(/getDispatchById\(row\.id\)/);
    expect(edge).toMatch(/if \(autonomyFeedbackApplies\(\{ terminationReason: result\.terminationReason, statusAfterRun \}\)\)/);
  });
});
