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
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(__dirname, "../..");

type WriterClass =
  | "human-route"
  | "founder-route"
  | "pax-governed"
  | "cascade-gated"
  | "agent-autonomous";

const REGISTER: Record<string, [number, WriterClass]> = {
  "server/ai/paxSupportResolver.ts": [1, "cascade-gated"],
  "server/ai/supportAgent.ts": [4, "pax-governed"],
  "server/routes-admin.ts": [1, "founder-route"],
  "server/routes-support-tickets.ts": [1, "human-route"],
  "server/services/agentActionExecutors.ts": [1, "agent-autonomous"],
  "server/services/autonomousDecisionExecutor.ts": [1, "agent-autonomous"],
  "server/services/customerSupportAutoResolver.ts": [2, "cascade-gated"],
};

/** Turn 10 lowers this to zero when both writers converge on supportReply.ts. */
const AGENT_AUTONOMOUS_BASELINE = 2;

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

  it("the agent-autonomous pair only shrinks (to zero at turn 10)", () => {
    let n = 0;
    for (const [f, [count, klass]] of Object.entries(REGISTER)) {
      if (klass === "agent-autonomous") n += found.get(f) ?? count;
    }
    expect(n).toBeLessThanOrEqual(AGENT_AUTONOMOUS_BASELINE);
    expect(
      n,
      `agent-autonomous writers ${n} < baseline ${AGENT_AUTONOMOUS_BASELINE} — a writer ` +
        "converged (good!); lower AGENT_AUTONOMOUS_BASELINE in this commit",
    ).toBeGreaterThanOrEqual(AGENT_AUTONOMOUS_BASELINE);
  });
});
