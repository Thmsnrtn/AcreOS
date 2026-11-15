/**
 * P1-5 / I-5 R3 — Solene founder chat spend lands in the ceiling's sum.
 *
 * turnRunner always CHECKED the platform ceiling, but recorded its
 * spend only to solene_capital_events, which the ceiling never sums —
 * the gate could never trip because of the path it gated. These are
 * wiring pins in the repo's source-test idiom (a full runTurn drive
 * needs the conversation store, both provider streams and the tool
 * executor; the recorder the bridge calls is behaviour-proven in
 * aiFailedCallCosting / aiSpendGuard suites):
 *   - a completed turn writes via recordExternalAiSpend with
 *     taskType "solene_chat" and orgId null (platform spend);
 *   - a failed turn records too (success: false), with partial usage or
 *     the R5 floor-estimate override;
 *   - the capital-event envelope write is unchanged (both ledgers, one
 *     spend — the envelope gates dispatch, the telemetry gates the
 *     platform, and neither replaces the other).
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { stripComments } from "../helpers/stripComments";

const ROOT = path.resolve(__dirname, "../..");
const src = stripComments(fs.readFileSync(path.join(ROOT, "server/services/solene/chat/turnRunner.ts"), "utf8"));

describe("Solene chat telemetry bridge (R3) — wiring pins", () => {
  it("vacuity: the bridge helper and both call sites exist in the runner", () => {
    expect(src).toContain("recordSoleneChatTelemetry");
    expect(src.match(/recordSoleneChatTelemetry\(\{/g)?.length).toBe(2);
  });

  it("records through the shared spend recorder as org-null solene_chat", () => {
    expect(src).toContain('taskType: "solene_chat"');
    expect(src).toContain("orgId: null");
    expect(src).toContain('await import("../../aiSpendGuard")');
  });

  it("the completed-turn site passes the turn's real usage (incl. cache reads in prompt tokens)", () => {
    const done = src.slice(src.indexOf("recordCapitalEvent("));
    const call = done.slice(done.indexOf("recordSoleneChatTelemetry({"), done.indexOf("recordSoleneChatTelemetry({") + 500);
    expect(call).toContain("inputTokens: usage.inputTokens");
    expect(call).toContain("outputTokens: usage.outputTokens");
    expect(call).toContain("cachedReadTokens: usage.cachedReadTokens");
    expect(call).toContain("success: true");
  });

  it("the failed-turn site records success: false with an error message", () => {
    const failed = src.slice(src.indexOf("if (streamErrored)"));
    const call = failed.slice(failed.indexOf("recordSoleneChatTelemetry({"), failed.indexOf("recordSoleneChatTelemetry({") + 600);
    expect(call).toContain("success: false");
    expect(call).toContain("streamErrorMessage");
  });

  it("the capital-event envelope write is still there (the bridge adds a ledger, it does not move one)", () => {
    expect(src).toContain("recordCapitalEvent(");
    expect(src).toContain('"anthropic_api"');
  });
});
