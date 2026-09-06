/**
 * SUPPORT-REPLY CHOKEPOINT — stage-4 turn 1's second gate.
 *
 * docs/autonomous/BRAIN_CONSOLIDATION_STAGE4.md (phase 0, turn 1). The
 * design said "customer-visible support-message insert sites (baseline 2)";
 * the census (2026-08-28) found SEVEN files inserting into
 * supportTicketMessages — the design's two are the AGENT-AUTONOMOUS subset,
 * and the other five are distinct, legitimate lanes that must not be
 * conflated with them:
 *   - routes-support-tickets.ts: the customer's own operator replying (human).
 *   - routes-admin.ts: the founder support console (human, founder-gated).
 *   - supportAgent.ts (×4): Pax's live support chat — model-driven but its
 *     own governed lane (org guard at the route, tool honesty gates).
 *   - paxSupportResolver.ts + customerSupportAutoResolver.ts: the
 *     confidence-cascade-gated resolution lane (the design's canonical-to-be
 *     for turn 10's supportReply.ts consolidation).
 *   - agentActionExecutors.ts + autonomousDecisionExecutor.ts: the
 *     agent-autonomous pair turn 10 converges onto the canonical writer.
 *
 * Same construction as outboundEmailChokepoint.test.ts: whole population
 * enumerated, per-member exact counts (vacuity both directions), the
 * agent-autonomous class frozen shrink-only.
 */
import { describe, it, expect, vi } from "vitest";
import { REPO_SWEEP_TIMEOUT_MS } from "../helpers/sweepBudget";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
// This gate walks the source tree; its cost scales with the repo, and under the
// coverage run it does not fit the suite’s 30s default. A killed gate reports
// nothing about what it guards, so the budget is declared, not inherited.
vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });


const ROOT = resolve(__dirname, "../..");

type WriterClass =
  | "human-route"
  | "founder-route"
  | "pax-governed"
  | "cascade-gated"
  | "agent-autonomous"
  | "canonical-writer";

const REGISTER: Record<string, [number, WriterClass]> = {
  "server/ai/paxSupportResolver.ts": [1, "cascade-gated"],
  "server/ai/supportAgent.ts": [4, "pax-governed"],
  "server/routes-admin.ts": [1, "founder-route"],
  "server/routes-support-tickets.ts": [1, "human-route"],
  "server/services/customerComms/supportReply.ts": [1, "canonical-writer"],
  "server/services/customerSupportAutoResolver.ts": [2, "cascade-gated"],
};

/**
 * Turn 10 LANDED (2026-08-29): both agent-autonomous writers converged on
 * customerComms/supportReply.ts — and the convergence found that neither had
 * EVER posted a message (they inserted senderId/senderName/messageType/
 * isInternal behind `as any`; none of those columns exist, NOT NULL `role`
 * went unfilled, every insert threw). MUST-BE-ZERO forever: an
 * agent-autonomous inline insert is a schema bug waiting to recur.
 */
const AGENT_AUTONOMOUS_BASELINE = 0;

const PATTERN = /insert\(supportTicketMessages\)/g;

function* walk(dir: string): Generator<string> {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (e.endsWith(".ts")) yield p;
  }
}

function census(): Map<string, number> {
  const found = new Map<string, number>();
  for (const abs of walk(join(ROOT, "server"))) {
    const rel = abs.slice(ROOT.length + 1);
    const n = (readFileSync(abs, "utf8").match(PATTERN) ?? []).length;
    if (n > 0) found.set(rel, n);
  }
  return found;
}

describe("support-reply chokepoint — every writer of supportTicketMessages is enumerated", () => {
  const found = census();

  it("vacuity: the scan still sees the population (7 files / 11 sites at install)", () => {
    expect(found.size).toBeGreaterThanOrEqual(5);
    let total = 0;
    for (const n of found.values()) total += n;
    expect(total).toBeGreaterThanOrEqual(9);
  });

  it("every writer is registered", () => {
    const unregistered = [...found.keys()].filter((f) => !(f in REGISTER));
    expect(
      unregistered,
      `unregistered supportTicketMessages writer(s): ${unregistered.join(", ")} — a new ` +
        "customer-visible reply path must be classified here (and belongs on the canonical " +
        "writer once turn 10 lands).",
    ).toEqual([]);
  });

  it("per-member vacuity: exact counts both directions", () => {
    const wrong: string[] = [];
    for (const [f, [expected]] of Object.entries(REGISTER)) {
      const actual = found.get(f) ?? 0;
      if (actual !== expected) wrong.push(`${f}: expected ${expected}, found ${actual}`);
    }
    expect(wrong, "writer-count drift:\n" + wrong.join("\n")).toEqual([]);
  });

  it("agent-autonomous inline inserts are ZERO, forever", () => {
    let n = 0;
    for (const [f, [count, klass]] of Object.entries(REGISTER)) {
      if (klass === "agent-autonomous") n += found.get(f) ?? count;
    }
    expect(
      n,
      "an agent-autonomous inline supportTicketMessages insert appeared — agent replies go " +
        "through customerComms/supportReply.ts (the last two inline writers had never " +
        "successfully inserted a row; see the register note)",
    ).toBe(AGENT_AUTONOMOUS_BASELINE);
  });

  it("the canonical writer exists and is exactly one site", () => {
    expect(found.get("server/services/customerComms/supportReply.ts")).toBe(1);
  });
});
