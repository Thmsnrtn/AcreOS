/**
 * The Pax pause gate over executeSupportTool — population + classification.
 *
 * /settings/pax promises "Stops every auto-execution path … enforced
 * server-side." paxToolsReportRealEffects taught this repo that
 * executeSupportTool is a SECOND dispatch switch no gate had ever read
 * (CLAUDE.md, third law). The truth-sweep (2026-09-01) found the pause had
 * the identical blind spot: tools.ts, paxScheduler, financeAgent and the
 * autonomousDecisionExecutor all consulted getPaxPauseState while a model
 * talking to a paying customer could still create tasks, send warnings,
 * apply credits and reset settings through supportAgent.ts.
 *
 * This suite pins the fix the population-first way:
 *   1. The gate CALL exists inside executeSupportTool, before the switch,
 *      guarded by the PAUSE_SAFE allowlist (fail closed for new tools).
 *   2. EVERY case label in the file's switches is explicitly classified:
 *      on the PAUSE_SAFE allowlist or on the GATED list below. A new tool
 *      added without classification fails here — it does not silently
 *      default into either set unseen.
 *   3. The side-effecting archetypes can never migrate onto the safe list.
 *   4. Vacuity guards on every extraction.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../..");
const src = fs.readFileSync(path.join(ROOT, "server/ai/supportAgent.ts"), "utf-8");

/**
 * The gated complement: every case label that mutates business data, sends
 * or schedules anything, applies money, resets user settings, or retries
 * operations. Kept in the test deliberately — moving a tool OFF this list
 * and ONTO the allowlist must show up as a diff in BOTH files.
 */
const GATED_SUPPORT_TOOLS = new Set([
  "apply_billing_fix",
  "apply_bulk_fix",
  "apply_credit",
  "apply_self_healing_fix",
  "cancel_pending_invoice",
  "create_followup_task",
  "enrich_property_coordinates",
  "fix_common_issue",
  "fix_data_integrity_issue",
  "reset_ai_settings",
  "reset_notification_preferences",
  "reset_onboarding",
  "reset_user_preferences",
  "resolve_alert",
  "resync_stripe",
  "retry_failed_jobs",
  "retry_payment",
  "schedule_proactive_outreach",
  "send_proactive_warning",
  "send_update_payment_link",
  "unlock_stuck_jobs",
]);

function executeSupportToolBody(): string {
  const start = src.indexOf("export async function executeSupportTool");
  expect(start, "executeSupportTool not found — repin this suite").toBeGreaterThan(-1);
  return src.slice(start);
}

function caseLabels(): string[] {
  const body = executeSupportToolBody();
  return [...body.matchAll(/case "([a-z_]+)"/g)].map((m) => m[1]);
}

async function loadAllowlist(): Promise<ReadonlySet<string>> {
  // Import via source-scan rather than module import: supportAgent.ts pulls
  // in OpenAI/db/broker at module load, which this unit suite must not.
  const m = src.match(
    /export const PAUSE_SAFE_SUPPORT_TOOLS: ReadonlySet<string> = new Set\(\[([\s\S]*?)\]\);/,
  );
  expect(m, "PAUSE_SAFE_SUPPORT_TOOLS literal not found").toBeTruthy();
  return new Set([...m![1].matchAll(/"([a-z_]+)"/g)].map((x) => x[1]));
}

describe("executeSupportTool is inside the Pax pause population", () => {
  it("the gate call sits inside executeSupportTool, before the switch, allowlist-guarded", () => {
    // Since 2026-09-02 the pause is read through the ONE reader of the org's
    // Pax controls (getPaxControls folds the pause primitive in), skipped
    // only for pause-safe tools and the human-approved replay, and the
    // refusal is the glossary line (paxControlsRefusalMessage).
    const body = executeSupportToolBody();
    const gateAt = body.indexOf("await getPaxControls(org.id)");
    const switchAt = body.indexOf("switch (toolName)");
    expect(gateAt, "pause gate missing from executeSupportTool").toBeGreaterThan(-1);
    expect(switchAt).toBeGreaterThan(-1);
    expect(gateAt, "gate must run BEFORE dispatch").toBeLessThan(switchAt);
    expect(body).toContain("const pauseSafe = PAUSE_SAFE_SUPPORT_TOOLS.has(toolName)");
    expect(body).toContain("!pauseSafe && !trustedApproval ? await getPaxControls(org.id) : null");
    const refuseAt = body.indexOf("if (controls?.paused) {");
    expect(refuseAt, "paused branch missing").toBeGreaterThan(gateAt);
    expect(refuseAt).toBeLessThan(switchAt);
    expect(body.slice(refuseAt, switchAt)).toContain("paxControlsRefusalMessage(controls)");
  });

  it("every case label is explicitly classified — allowlisted or gated, never unlisted", async () => {
    const allow = await loadAllowlist();
    const labels = caseLabels();
    // Vacuity: the parser must actually see this switch's real size.
    expect(labels.length, "case-label parser went blind").toBeGreaterThan(60);
    expect(allow.size, "allowlist parser went blind").toBeGreaterThan(40);
    const unclassified = [...new Set(labels)].filter(
      (l) => !allow.has(l) && !GATED_SUPPORT_TOOLS.has(l),
    );
    expect(
      unclassified,
      "new support tools must be classified explicitly: add each to " +
        "PAUSE_SAFE_SUPPORT_TOOLS (read-only/draft/escalation) or to " +
        "GATED_SUPPORT_TOOLS in this test (side-effecting). Unlisted tools " +
        "are gated at runtime, but the classification must be deliberate.",
    ).toEqual([]);
  });

  it("no label is on both lists, and the side-effecting archetypes stay gated", async () => {
    const allow = await loadAllowlist();
    const both = [...GATED_SUPPORT_TOOLS].filter((l) => allow.has(l));
    expect(both, "a tool cannot be both pause-safe and gated").toEqual([]);
    // The archetypes the truth-sweep caught running during a pause. Moving
    // any of these onto the allowlist re-opens the exact hole.
    for (const t of [
      "create_followup_task",
      "send_proactive_warning",
      "schedule_proactive_outreach",
      "apply_bulk_fix",
      "apply_self_healing_fix",
      "apply_billing_fix",
      "apply_credit",
      "send_update_payment_link",
    ]) {
      expect(allow.has(t), `${t} must never be pause-safe`).toBe(false);
      expect(GATED_SUPPORT_TOOLS.has(t), `${t} missing from the gated list`).toBe(true);
    }
  });

  it("escalation to a human stays available while paused", async () => {
    // Pausing the machine must never block reaching a person.
    const allow = await loadAllowlist();
    expect(allow.has("escalate_to_human")).toBe(true);
  });

  it("the pause primitive is not read directly — only through the aggregator", () => {
    // One reader (spec §4.2): a second direct read would be a second truth.
    expect(src).not.toContain("getPaxPauseState(");
    expect(src).not.toContain("paxPauseRefusalMessage(");
  });

  it("paxPause.ts names supportAgent among its enforcement points", () => {
    const pauseSrc = fs.readFileSync(
      path.join(ROOT, "server/services/paxPause.ts"),
      "utf-8",
    );
    expect(pauseSrc).toContain("server/ai/supportAgent.ts");
  });
});
