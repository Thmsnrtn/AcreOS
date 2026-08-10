/**
 * The "If you do nothing" contract — founder-trust audit 2026-07-28.
 *
 * Every needs-you card on /founder/decisions now carries one muted sentence
 * stating what ACTUALLY happens if the founder never answers. The no-
 * fabrication rule makes these sentences load-bearing: each one must state
 * true current behavior, verified against the code that owns the class.
 *
 * This suite pins:
 *   1. Every known class returns a non-empty sentence.
 *   2. The load-bearing truths per class:
 *        promotion      → the level STAYS; only the founder's tap widens it
 *                         (promotionRequest.applyPromotionAnswer is the only
 *                         widening path).
 *        witnessed send → NOTHING SENDS; drafts expire after 24h
 *                         (pendingHands.ts TTL_MS).
 *        hard-stops     → wait FOREVER (checkHardGuardrails blocks the class
 *                         before any model is consulted; >$500 spends are
 *                         founder-only at every tier in financialAuthorityGate).
 *        check-ins      → original shows as overdue; no score invented
 *                         (outcomeLedger: "honestly overdue, never backfilled").
 *        asks           → agents never act on an unanswered ask; timeout
 *                         closes to the safe side (founderCollab.ts).
 *   3. Executor-eligible classes are HONEST about the opt-in executor: the
 *      autonomousDecisionExecutor scans all pending items when the founder
 *      has enabled it, so those sentences must not claim "nothing proceeds
 *      without you" unconditionally.
 *   4. Server and client consume the SAME shared module (no duplicated map
 *      that could drift), via source-shape contracts in the same style as
 *      decisionsDoorPlainLanguage.test.ts.
 *   5. The hard-stop substring list stays in sync with the guardrail action
 *      lists in autonomousDecisionExecutor.ts — the code that actually
 *      enforces the "forever" claim.
 */

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import {
  doNothingContract,
  DO_NOTHING_CONTRACTS,
  DEFAULT_DO_NOTHING,
  HARD_STOP_DO_NOTHING,
  isHardStopItemType,
} from "@shared/decisions/doNothing";
import { FOUNDER_ASK_DEFAULT_TIMEOUT_HOURS } from "@shared/schema/solene-founder-collab";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf-8");

const KNOWN_TYPES = Object.keys(DO_NOTHING_CONTRACTS);

describe("doNothingContract — every known class has a sentence", () => {
  it("covers the full known-type roster", () => {
    // The classes verified in the 2026-07-28 audit. Adding a class here
    // requires verifying its real do-nothing behavior first.
    for (const t of [
      "shadow_promotion_request",
      "outcome_check_in",
      "letter_reply_confirm",
      "witnessed_send",
      "founder_ask",
      "support_escalation",
      "churn_risk_intervention",
      "dunning_recovery",
      "critical_alert",
      "feature_request_flagged",
      // F2 mirror cards (2026-08-10) — behavior verified against
      // routes-founder-appeals.ts (sole terminal writer; appeals never
      // expire) and routes-founder-recourse.ts (drafts sent/dismissed only
      // by founder routes; never expire).
      "appeal_review",
      "recourse_draft",
    ]) {
      expect(KNOWN_TYPES).toContain(t);
    }
  });

  it("returns a non-empty sentence for every known type", () => {
    for (const t of KNOWN_TYPES) {
      const sentence = doNothingContract(t);
      expect(sentence.length).toBeGreaterThan(20);
      expect(sentence).toBe(DO_NOTHING_CONTRACTS[t]);
    }
  });

  it("unknown types get the conservative catch-all, never an empty string", () => {
    expect(doNothingContract("some_future_item_type")).toBe(DEFAULT_DO_NOTHING);
    expect(DEFAULT_DO_NOTHING).toContain("this waits");
  });
});

describe("doNothingContract — load-bearing truths per class", () => {
  it("promotion: the level stays; only the founder's tap widens authority", () => {
    const s = doNothingContract("shadow_promotion_request");
    expect(s).toContain("stays");
    expect(s).toContain("Only your tap");
  });

  it("witnessed send: nothing sends, and the 24h expiry matches pendingHands TTL", () => {
    const s = doNothingContract("witnessed_send");
    expect(s).toContain("nothing sends");
    expect(s).toContain("24 hours");
    // Pin the claim to the enforcing constant: TTL_MS = 24h in pendingHands.ts.
    const pendingHandsSrc = read("server/services/autopilot/pendingHands.ts");
    expect(pendingHandsSrc).toContain("const TTL_MS = 24 * 60 * 60 * 1000");
  });

  it("hard-stop classes wait forever — pricing, legal signing, >$500 spend, data deletion", () => {
    for (const t of [
      "pricing_changes",
      "pricing_change",
      "legal_signing",
      "spend_over_500_usd",
      "customer_data_deletion",
    ]) {
      expect(doNothingContract(t)).toBe(HARD_STOP_DO_NOTHING);
    }
    expect(HARD_STOP_DO_NOTHING).toContain("forever");
    expect(HARD_STOP_DO_NOTHING).toContain("never proceed without you");
  });

  it("outcome check-in: original shows as overdue; nothing else happens; no invented score", () => {
    const s = doNothingContract("outcome_check_in");
    expect(s).toContain("overdue");
    expect(s).toContain("nothing else happens");
    expect(s).toContain("no score is ever invented");
  });

  it("letter reply: nothing is applied until the founder confirms", () => {
    const s = doNothingContract("letter_reply_confirm");
    expect(s).toContain("nothing is applied");
  });

  it("asks: agents never act on an unanswered ask; timeout matches the schema default", () => {
    const s = doNothingContract("founder_ask");
    expect(s).toContain("never acts on an unanswered question");
    expect(s).toContain(`${FOUNDER_ASK_DEFAULT_TIMEOUT_HOURS} hours`);
  });

  it("F2 mirror cards: the deep queue is the truth — the card only mirrors it", () => {
    // appeal_review — routes-founder-appeals.ts is the ONLY writer of a
    // terminal appeal status; nothing rules automatically and appeals never
    // expire, so an unanswered card leaves the refusal standing.
    const appeal = doNothingContract("appeal_review");
    expect(appeal).toContain("stays open");
    expect(appeal).toContain("the refusal stands");
    expect(appeal).toContain("clears itself");
    // recourse_draft — drafts are sent/dismissed only by the founder routes;
    // they never send themselves. The executor caveat may clear the CARD,
    // never send the reply.
    const recourse = doNothingContract("recourse_draft");
    expect(recourse).toContain("no reply goes to the customer");
    expect(recourse).toContain("never send themselves");
    expect(recourse).toContain("can never send the reply");
  });

  it("executor-eligible classes are honest about the opt-in autonomous executor", () => {
    // runAutonomousDecisionExecutor scans ALL pending items when the founder
    // has set AUTONOMOUS_EXECUTOR_ENABLED=true, so these sentences must not
    // claim unconditional inaction — they must name the caveat plainly.
    for (const t of [
      "support_escalation",
      "churn_risk_intervention",
      "dunning_recovery",
      "critical_alert",
      "feature_request_flagged",
      // F2 mirror cards are pending inbox rows too — same honesty required.
      "appeal_review",
      "recourse_draft",
    ]) {
      const s = doNothingContract(t);
      expect(s).toContain("autonomous executor");
      expect(s).toContain("Auto-handled");
      expect(s).not.toMatch(/never proceed without you/i);
    }
    // The catch-all inherits the same honesty (unknown types escalate to the
    // executor's model path when the executor is enabled).
    expect(DEFAULT_DO_NOTHING).toContain("autonomous executor");
    expect(DEFAULT_DO_NOTHING).toContain("Auto-handled");
    // ...and the executor really is opt-in (default off), which the caveat
    // wording relies on ("it stays off until you opt in").
    const executorSrc = read("server/services/autonomousDecisionExecutor.ts");
    expect(executorSrc).toContain('ENABLED: process.env.AUTONOMOUS_EXECUTOR_ENABLED === "true"');
  });
});

describe("doNothingContract — hard-stop matching stays in sync with the enforcing guardrails", () => {
  it("every action substring in checkHardGuardrails' class lists maps to the hard-stop sentence", () => {
    const src = read("server/services/autonomousDecisionExecutor.ts");
    const lists = [
      "BILLING_SUBSCRIPTION_ACTIONS",
      "DATA_DELETION_ACTIONS",
      "LEGAL_SIGNING_ACTIONS",
    ];
    for (const listName of lists) {
      const m = src.match(new RegExp(`const ${listName} = \\[([\\s\\S]*?)\\];`));
      expect(m, `${listName} array literal found in executor source`).toBeTruthy();
      const entries = [...m![1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
      expect(entries.length).toBeGreaterThan(0);
      for (const entry of entries) {
        expect(
          isHardStopItemType(entry),
          `guardrail action "${entry}" must map to the hard-stop sentence`,
        ).toBe(true);
        expect(doNothingContract(entry)).toBe(HARD_STOP_DO_NOTHING);
      }
    }
  });
});

describe("doNothingContract — server and client consume the same shared module", () => {
  const serverSrc = read("server/services/decisionsInbox.ts");
  const pageSrc = read("client/src/pages/founder-decisions.tsx");

  it("decisionsInbox.ts exports doNothingContract from the shared module", () => {
    expect(serverSrc).toContain(
      'export { doNothingContract, DO_NOTHING_CONTRACTS } from "@shared/decisions/doNothing"',
    );
  });

  it("founder-decisions.tsx imports the same shared module — no duplicated map", () => {
    expect(pageSrc).toContain('from "@shared/decisions/doNothing"');
    // The page renders the mapping, never hardcodes a copy of a sentence.
    expect(pageSrc).not.toContain("If you never answer");
  });

  it("the page renders the sentence on needs-you cards, the witnessed-send queue, and open asks", () => {
    expect(pageSrc).toContain("doNothingContract(row.itemType)");
    expect(pageSrc).toContain('doNothingContract("witnessed_send")');
    expect(pageSrc).toContain('doNothingContract("founder_ask")');
    // Muted rendering — the contract is ambient truth, not a headline.
    expect(pageSrc).toMatch(
      /text-micro text-muted-foreground[^>]*"\s*data-testid=\{`decision-do-nothing-\$\{row\.id\}`\}/,
    );
  });
});
