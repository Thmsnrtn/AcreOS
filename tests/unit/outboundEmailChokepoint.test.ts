/**
 * OUTBOUND-EMAIL CHOKEPOINT — stage-4 turn 1 (gates before movement).
 *
 * docs/autonomous/BRAIN_CONSOLIDATION_STAGE4.md, phase 0. Before any caller
 * moves onto the witnessed-hands lane, the WHOLE population of
 * emailService.sendEmail call sites is enumerated HERE, classified, and
 * frozen — so a new ungoverned send path is a red test, not an audit
 * finding, and every migration turn lowers its class count in the same
 * commit (wave rule 5).
 *
 * The census (2026-08-28) corrected the design itself: the design's
 * agent-autonomous baseline said 6 (agentActionExecutors ×5 +
 * autonomousDecisionExecutor ×1). Reading every site found a SEVENTH —
 * server/services/agent-skills.ts's sendEmail skill: a model-composed
 * recipient/subject/body sent with NO autonomy gate, NO TCPA check, NO
 * rate envelope (only "is SES configured"). It is the least governed
 * agent send lane in the repo and is in the migration's scope. ai/tools.ts
 * is NOT in that class: Pax's send tool runs its own draft-for-approval
 * ladder + rate envelope + TCPA (ai/tools.ts:1950-1985) — a parallel
 * approval lane whose convergence with pendingHands is stage-4 material,
 * but not an ungoverned send. base-agent.ts's sendEmail wrapper has zero
 * callers (dead helper; reachability debt, not a live lane).
 *
 * BOTH call shapes are counted — `emailService.sendEmail(` AND bare
 * `sendEmail(` under a named import from emailService — because a
 * population gate that reads one dispatch shape is blind to the second
 * (the executeSupportTool lesson, CLAUDE.md third law).
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(__dirname, "../..");

type SendClass =
  | "system-mail" // AcreOS-to-its-own-customer operational mail (digests, billing, alerts, receipts)
  | "witnessed-hand" // the canonical governed lane
  | "pax-governed" // Pax's own approval ladder (tools.ts) — separate lane, converges later
  | "agent-autonomous" // agent/engine-initiated with no witness — the migration's shrink-to-zero class
  | "dead-helper"; // a wrapper nothing calls

/**
 * file -> [expected call-site count, class]. Per-member vacuity: a listed
 * file whose parser finds a different count fails LOUDLY in either
 * direction — a silently-unparsed member reads exactly like a clean one.
 */
const REGISTER: Record<string, [number, SendClass]> = {
  "server/agents/base-agent.ts": [1, "dead-helper"],
  "server/ai/tools.ts": [1, "pax-governed"],
  "server/jobs/accessReview.ts": [1, "system-mail"],
  "server/jobs/autonomousDealMachine.ts": [1, "system-mail"],
  "server/jobs/costOptimizerWeeklyDigest.ts": [1, "system-mail"],
  "server/jobs/courseCompletionCheck.ts": [1, "system-mail"],
  "server/jobs/customerConcentration.ts": [1, "system-mail"],
  "server/jobs/founderWeeklyDigest.ts": [1, "system-mail"],
  "server/jobs/growthAutomation.ts": [6, "system-mail"],
  "server/jobs/runScheduledJobs.ts": [1, "system-mail"],
  "server/routes-admin-recovery.ts": [2, "system-mail"],
  "server/routes-billing.ts": [1, "system-mail"],
  "server/routes-buyer-blasts.ts": [1, "system-mail"],
  "server/routes-campaigns.ts": [2, "system-mail"],
  "server/routes-communications.ts": [1, "system-mail"],
  "server/routes-deal-rooms.ts": [1, "system-mail"],
  "server/routes-feedback.ts": [1, "system-mail"],
  "server/routes-founder-intelligence.ts": [1, "system-mail"],
  "server/routes-inbound-email.ts": [1, "system-mail"],
  "server/routes-marketplace.ts": [1, "system-mail"],
  "server/services/agent-skills.ts": [1, "agent-autonomous"],
  "server/services/agentActionExecutors.ts": [2, "agent-autonomous"],
  "server/services/alertPolicy.ts": [3, "system-mail"],
  "server/services/autonomousDecisionExecutor.ts": [1, "agent-autonomous"],
  "server/services/autonomyGuardrails.ts": [1, "system-mail"],
  "server/services/autopilot/hands/send-email.ts": [1, "witnessed-hand"],
  "server/services/communications.ts": [1, "system-mail"],
  "server/services/credits.ts": [2, "system-mail"],
  "server/services/customerNarrative.ts": [1, "system-mail"],
  "server/services/dailyAiCostGuard.ts": [1, "system-mail"],
  "server/services/digest.ts": [1, "system-mail"],
  "server/services/dunning.ts": [1, "system-mail"],
  "server/services/emailRegistry.ts": [1, "system-mail"],
  "server/services/founderDigest.ts": [2, "system-mail"],
  "server/services/oncall.ts": [1, "system-mail"],
  "server/services/periodicStatements/delivery.ts": [1, "system-mail"],
  "server/services/revenueProtection.ts": [3, "system-mail"],
  "server/services/sequenceProcessor.ts": [1, "system-mail"],
  "server/services/solene/pagerService.ts": [1, "system-mail"],
  "server/services/workflow-engine.ts": [2, "system-mail"],
  "server/webhookHandlers.ts": [4, "system-mail"],
  "server/worker.ts": [1, "system-mail"],
};

/**
 * The migration ratchet: turns 6-9 lower this in the SAME commit as each
 * caller flip; at zero the assertion flips to MUST-BE-ZERO forever.
 */
// 7 at install; 6 after turn 6 (send_retention_email); 4 after turn 7
// (send_churn_rescue + send_upgrade_nudge) — all onto the outbound seam.
const AGENT_AUTONOMOUS_BASELINE = 4;

const QUAL = /\bemailService\s*\.\s*sendEmail\s*\(/g;
const BARE = /(?<![.\w])sendEmail\s*\(/g;
const IMP = /import\s*\{[^}]*\bsendEmail\b[^}]*\}\s*from\s*["'][^"']*emailService/;

function* walk(dir: string): Generator<string> {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (e.endsWith(".ts")) yield p;
  }
}

function countSites(src: string): number {
  let n = (src.match(QUAL) ?? []).length;
  if (IMP.test(src)) {
    for (const line of src.split("\n")) {
      if (IMP.test(line)) continue;
      n += (line.match(BARE) ?? []).length;
    }
  }
  return n;
}

function census(): Map<string, number> {
  const found = new Map<string, number>();
  for (const abs of walk(join(ROOT, "server"))) {
    const rel = abs.slice(ROOT.length + 1);
    if (rel === "server/services/emailService.ts") continue;
    const n = countSites(readFileSync(abs, "utf8"));
    if (n > 0) found.set(rel, n);
  }
  return found;
}

describe("outbound email chokepoint — the population is enumerated and frozen", () => {
  const found = census();

  it("vacuity: the scan still sees the population", () => {
    // 42 files / 63 sites at install. Floors guard against the scan itself
    // silently breaking — a parser that stops matching reads as clean.
    expect(found.size).toBeGreaterThanOrEqual(35);
    let total = 0;
    for (const n of found.values()) total += n;
    expect(total).toBeGreaterThanOrEqual(55);
  });

  it("every call site is registered — a new send path is a red test, not an audit finding", () => {
    const unregistered = [...found.keys()].filter((f) => !(f in REGISTER));
    expect(
      unregistered,
      `unregistered emailService.sendEmail call site(s): ${unregistered.join(", ")} — ` +
        `classify in REGISTER. Agent-initiated customer mail belongs on the witnessed-hands ` +
        `lane (docs/autonomous/BRAIN_CONSOLIDATION_STAGE4.md), not a new direct call.`,
    ).toEqual([]);
  });

  it("per-member vacuity: every registered file matches its expected count exactly", () => {
    const wrong: string[] = [];
    for (const [f, [expected]] of Object.entries(REGISTER)) {
      const actual = found.get(f) ?? 0;
      if (actual !== expected) wrong.push(`${f}: expected ${expected}, found ${actual}`);
    }
    expect(
      wrong,
      "count drift — a site was added (register it or use the hands lane) or removed " +
        "(lower the entry in this commit; at zero, delete the entry):\n" + wrong.join("\n"),
    ).toEqual([]);
  });

  it("the agent-autonomous class only shrinks", () => {
    let n = 0;
    for (const [f, [count, klass]] of Object.entries(REGISTER)) {
      if (klass === "agent-autonomous") n += found.get(f) ?? count;
    }
    expect(
      n,
      `agent-autonomous sendEmail sites: ${n} > baseline ${AGENT_AUTONOMOUS_BASELINE} — ` +
        "ungoverned agent sends may never grow",
    ).toBeLessThanOrEqual(AGENT_AUTONOMOUS_BASELINE);
    // Stale-high: lock reductions into the commit that earns them.
    expect(
      n,
      `agent-autonomous count ${n} < baseline ${AGENT_AUTONOMOUS_BASELINE} — a caller ` +
        "migrated (good!); lower AGENT_AUTONOMOUS_BASELINE in this commit",
    ).toBeGreaterThanOrEqual(AGENT_AUTONOMOUS_BASELINE);
  });

  it("the witnessed hand is exactly one file", () => {
    const hands = Object.entries(REGISTER).filter(([, [, k]]) => k === "witnessed-hand");
    expect(hands.map(([f]) => f)).toEqual(["server/services/autopilot/hands/send-email.ts"]);
  });
});
