/**
 * The four founder hard-stops, enforced by intent rather than by spelling.
 *
 * `checkHardGuardrails` (server/services/autonomousDecisionExecutor.ts) is the
 * function `shared/governance/constitution.ts` cites as the enforcement for FOUR
 * hard-stop entries — pricing changes, legal signing, customer-data deletion,
 * money custody — each of which CLAUDE.md's DO-NOT-DO list marks founder-only
 * forever. Until unit 118 it matched a deny-list of exact strings with
 * `actionType.includes(t)`, and an enforcement audit (unit 117's rules sweep)
 * bypassed ALL FOUR with trivially varied strings. Every entry in BYPASS_CORPUS
 * below returned `blocked: false` on the day it was written down.
 *
 * A deny-list of exact strings can never enforce a "never": whoever names the
 * action picks the string. The classifier now matches INTENT TOKENS — action
 * strings split on underscores/dashes/camelCase, blocking on single-token
 * triggers or noun+verb pairs in either order — and errs CLOSED: a false block
 * routes to founder review ("deferred"), a false pass would execute a
 * hard-stop-class action autonomously.
 *
 * THE COST IS PINNED TOO. The benign corpus is the executor's real universe
 * (its own switch cases and ordinary agent actions) and must stay unblocked —
 * a classifier that blocks everything passes the corpus above and turns the
 * autopilot off. Both corpora live in this one file so a future widening or
 * narrowing has to look at both.
 *
 * Also pinned: the execution switch's default case no longer fabricates.
 * It used to return `success: true, "Generic approval"` for item types with NO
 * registered executor — a "committed" preview record and an audit row for an
 * action nothing ran.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { checkHardGuardrails } from "../../server/services/autonomousDecisionExecutor";

const ROOT = path.resolve(__dirname, "../..");

/** Every one of these returned blocked:false before unit 118. From the audit. */
const BYPASS_CORPUS: Array<[string, Record<string, unknown>]> = [
  // legal signing — word order, synonyms, adjacent verbs
  ["execute_agreement", {}],
  ["countersign", {}],
  ["accept_loi", {}],
  ["bind_terms", {}],
  ["purchase_agreement_send", {}],
  ["contract_finalize", {}],
  ["document_send", {}],
  // pricing / billing — the fifteen the audit constructed, representative subset
  ["discount_apply", {}],
  ["promo_code_create", {}],
  ["credit_grant", {}],
  ["allowance_bump", {}],
  ["allowance_increase", {}],
  ["trial_extend", {}],
  ["tier_override", {}],
  ["comp_account", {}],
  ["waive_fee", {}],
  ["set_price", {}],
  ["seat_limit_raise", {}],
  // data deletion — regulation names, synonyms, bulk shapes
  ["gdpr_erasure", {}],
  ["right_to_be_forgotten", {}],
  ["truncate_table", {}],
  ["wipe_org", {}],
  ["prune_stale_records", { scope: "all_leads" }],
  ["archive_and_remove", { scope: "all_leads" }],
  // money movement
  ["funds_transfer", {}],
  ["payment_send", {}],
  ["payout_initiate", {}],
  ["wire_release", {}],
  // casing/format evasion of the same intents
  ["executeAgreement", {}],
  ["GDPR-Erasure", {}],
];

/**
 * The executor's legitimate universe: its own switch cases, its item types, and
 * ordinary agent actions that must keep flowing without founder friction.
 */
const BENIGN_CORPUS: Array<[string, Record<string, unknown>]> = [
  ["support_escalation", {}],
  ["churn_risk_intervention", {}],
  ["dunning_recovery", {}],
  ["critical_alert", {}],
  ["feature_request_flagged", {}],
  ["agent_event", {}],
  ["agent_initiative", {}],
  ["agent_recommendation", {}],
  ["dlq_poison_job", {}],
  ["follow_up_email", {}],
  ["lead_enrichment", {}],
  ["draft_response", {}],
  ["clear_cache", {}],
  ["cleanup_temp_files", {}],
  ["contract_review", {}],
  ["comps_refresh", {}],
  ["schedule_reminder", {}],
];

describe("the bypass corpus is closed", () => {
  it.each(BYPASS_CORPUS)("%s is blocked", (actionType, extra) => {
    const res = checkHardGuardrails({ actionPayload: { actionType, ...extra } });
    expect(
      res.blocked,
      `"${actionType}" passed the hard-stop guardrail. Every entry in this corpus ` +
        `returned blocked:false under the old substring deny-list — if it passes ` +
        `again, the enforcement has regressed to spelling-matching and all four ` +
        `founder hard-stops are open.`,
    ).toBe(true);
  });

  it("blocks via itemType too, not only actionPayload.actionType", () => {
    expect(checkHardGuardrails({ itemType: "gdpr_erasure" }).blocked).toBe(true);
  });

  it("blocks via the category field", () => {
    expect(
      checkHardGuardrails({ actionPayload: { actionType: "misc", category: "contract_signing" } })
        .blocked,
    ).toBe(true);
  });
});

describe("the benign corpus still flows (the cost side, pinned)", () => {
  it.each(BENIGN_CORPUS)("%s is NOT blocked", (actionType, extra) => {
    const res = checkHardGuardrails({ actionPayload: { actionType, ...extra } });
    expect(
      res.blocked,
      `"${actionType}" is now blocked: ${res.reason}. This is the executor's ` +
        `LEGITIMATE universe — if routine autonomy defers to the founder, the ` +
        `autopilot is off and the founder's inbox is the product. Narrow the ` +
        `classifier, do not delete the corpus entry.`,
    ).toBe(false);
  });

  it("the original amount and recipient limits still hold", () => {
    expect(checkHardGuardrails({ actionPayload: { amount: 50_001 } }).blocked).toBe(true);
    expect(checkHardGuardrails({ actionPayload: { amount: 49_999 } }).blocked).toBe(false);
    expect(
      checkHardGuardrails({ actionPayload: { recipients: new Array(101).fill("x") } }).blocked,
    ).toBe(true);
  });
});

describe("the stated limit is stated truthfully", () => {
  it("a purely novel euphemism still passes — the classifier is tokens, not semantics", () => {
    // Deliberately pinned so nobody reads the corpus above as "bypass-proof".
    // The backstop for this case is the execution switch's honest default: an
    // unknown item type executes NOTHING and is recorded as unexecuted.
    expect(checkHardGuardrails({ actionPayload: { actionType: "tidy_documents" } }).blocked).toBe(
      false,
    );
  });
});

describe("the execution default no longer fabricates", () => {
  const src = fs.readFileSync(
    path.join(ROOT, "server/services/autonomousDecisionExecutor.ts"),
    "utf8",
  );

  it('the "Generic approval" success:true default is gone', () => {
    expect(
      src,
      "the execution switch's default case is back to reporting success for " +
        "actions with no executor — a 'committed' record for work nothing ran.",
    ).not.toContain("Generic approval");
    const at = src.indexOf("No executor is registered for item type");
    expect(at, "the honest default message is gone").toBeGreaterThan(-1);
    // The honest default must report failure, not success.
    const block = src.slice(src.lastIndexOf("default:", at), at);
    expect(block).toContain("success: false");
  });
});
