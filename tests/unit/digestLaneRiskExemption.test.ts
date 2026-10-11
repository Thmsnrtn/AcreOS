/**
 * Founder ruling 2026-10-10: a digest-lane move (reversible, internal ops or
 * deploy, passing digestLaneRefusal) is exempt from the risk check's
 * "unproven calibration escalates medium risk" rule. Nothing else is.
 *
 * Every case goes through the same path the loop uses: the medium-tier risk
 * verdict under unproven calibration, with digestLane = isDigestLaneMove(move).
 * Only the routine ops move runs. An irreversible move, a customer-facing move,
 * a hard stop, an unknown kind and moves in every non-digest domain still
 * escalate, and so do the over-confident hard gate and the high tier.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { isDigestLaneMove } from "../../server/services/autopilot/act";
import { markServerAuthored, type RankedMove } from "../../server/services/autopilot/decide";
import { shouldEscalateForRisk, type RiskAssessment } from "../../server/services/autopilot/riskautonomy";
import { stripComments } from "../helpers/stripComments";

const mv = (over: Partial<RankedMove>): RankedMove => markServerAuthored({ priority: 3, domain: "ops", kind: "optimize", rationale: "Nothing urgent — improve.", ...over } as RankedMove);
const MEDIUM: RiskAssessment = { tier: "medium", score: 3, reasons: ["novel", "costs up to $5"] };
const UNPROVEN = 0.4;
/** The loop's decision for one move (continuousLoop assessRisk). */
const escalates = (m: RankedMove, a: RiskAssessment = MEDIUM, conf = UNPROVEN) => shouldEscalateForRisk(true, a, conf, { digestLane: isDigestLaneMove(m) });

describe("the digest-lane exemption from unproven-calibration escalation", () => {
  it("a routine reversible internal ops move and deploy move run", () => {
    expect(escalates(mv({ kind: "optimize", domain: "ops" }))).toBe(false);
    expect(escalates(mv({ kind: "resolve_incident", domain: "deploy" }))).toBe(false);
  });

  it.each<[string, Partial<RankedMove>]>([
    ["irreversible (growth's role-worker move tagged ops)", { kind: "grow_owned_channels", domain: "ops" }],
    ["customer-facing (an unknown kind binds customer-facing)", { kind: "email_every_customer", domain: "ops" }],
    ["hard stop (pricing worded as an ops move)", { kind: "optimize", domain: "ops", rationale: "Lower the Pro price to $39 a month." }],
    ["hard stop (customer-data deletion)", { kind: "optimize", domain: "ops", rationale: "Delete customer data for churned organizations." }],
    ["non-digest domain: finance (reversible and internal, still out)", { kind: "recover_payments", domain: "finance" }],
    ["non-digest domain: support", { kind: "retain_at_risk", domain: "support" }],
    ["non-digest domain: growth", { kind: "grow_owned_channels", domain: "growth" }],
    ["new (net-new) move", { kind: "optimize", domain: "ops", isNetNew: true }],
    ["a move whose stated domain is not its binding's", { kind: "optimize", domain: "finance" }],
  ])("still escalates: %s", (_label, over) => {
    expect(escalates(mv(over))).toBe(true);
  });

  it("the over-confident hard gate and the high tier still escalate a digest-lane move", () => {
    expect(escalates(mv({}), MEDIUM, 0.15)).toBe(true);
    expect(escalates(mv({}), { tier: "high", score: 5, reasons: ["x"] })).toBe(true);
  });

  it("the loop's risk check passes isDigestLaneMove into shouldEscalateForRisk (the real path)", () => {
    const src = stripComments(fs.readFileSync(path.resolve(__dirname, "../../server/services/solene/continuousLoop.ts"), "utf8"));
    expect(src).toMatch(/shouldEscalateForRisk\(true, a, loopConfidence, \{ digestLane: isDigestLaneMove\(m\) \}\)/);
    expect(src.match(/shouldEscalateForRisk\(/g)?.length).toBe(1);
  });
});
