/**
 * A cost bound must measure the thing it bounds.
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────────
 * The autonomous decision executor runs under a per-tick spend ceiling at the
 * scheduler layer, added by a 2026-06-05 cost audit that named this job "the
 * single most-likely $30/day burn source". The ceiling was enforced against
 * `sumAiSpendUsdSince`, which summed EVERY row in `ai_telemetry_events` in the
 * window — Pax chat, enrichment summarisation, the CMO pipeline, all of it.
 *
 *   1. The executor deferred because of spend it did not cause. On the $1.00 /
 *      30-min default, a busy Pax hour starves it — silently, one log line.
 *   2. The post-tick line said "this tick spent $X across N items" when $X was
 *      all platform AI spend in the window. That is the number a human reads to
 *      decide whether the executor is the burn source, so a misattributing
 *      measurement is exactly what would confirm a wrong diagnosis.
 *
 * The repository already knew which rows belong to the executor:
 * `intelligence/budget.ts` maps task types to budget categories and has an
 * `executor` bucket, consulted inside `aiRouter` before every call. The
 * scheduler was not using it.
 *
 * ── WHERE IT CAME FROM ──────────────────────────────────────────────────────
 * Foundry §16 — an effect receipt is not an outcome — read from the cost side:
 * a measurement attributed to an actor must be a measurement OF that actor.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { getTableName, type SQL } from "drizzle-orm";
import { categoryFor, EXECUTOR_TASK_TYPES } from "../../server/services/intelligence/budget";

/** Flatten a drizzle predicate into the (column, value) pairs it binds. */
function boundValues(node: unknown, column: string): unknown[] {
  const out: unknown[] = [];
  const tokens: Array<{ kind: "col" | "param"; v: unknown }> = [];
  const walk = (n: any): void => {
    if (n === null || typeof n !== "object") return;
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (typeof n.name === "string" && n.table !== undefined) { tokens.push({ kind: "col", v: n.name }); return; }
    if ("encoder" in n && "value" in n) { tokens.push({ kind: "param", v: n.value }); return; }
    if (Array.isArray(n.queryChunks)) { n.queryChunks.forEach(walk); return; }
  };
  walk(node);
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].kind !== "col" || tokens[i].v !== column) continue;
    for (let j = i + 1; j < tokens.length && tokens[j].kind === "param"; j++) out.push(tokens[j].v);
  }
  return out;
}

describe("the executor's spend is defined in exactly one place", () => {
  it("categoryFor branches on the same list the scheduler sums", () => {
    // If these were two lists, the second would go stale the first time a task
    // type is added — the hand-copied-fragment defect, in a cost control.
    for (const t of EXECUTOR_TASK_TYPES) {
      expect(categoryFor(t), t).toBe("executor");
    }
  });

  it("NOTHING outside the list maps to the executor bucket", () => {
    // The other direction, which is what makes the SQL filter equivalent to the
    // category test. Without it the list could be a strict subset and the sum
    // would silently under-count the executor's own spend.
    const others = [
      "morning_brief", "founder_brief", "atlas_brief", "agent_report",
      "agent_brief_daily", "company_briefing", "lead_scoring", "outreach_email",
      "cmo_creative", "script_gen", "ad_copy", "creative_gen", "self_assessment",
      "evolution_proposal", "telemetry_optimization", "outcome_analyzer",
      "retrospective_weekly", "pax_chat", "property_summary", "anything_else",
    ];
    for (const t of others) {
      expect(categoryFor(t), `${t} unexpectedly counts as executor spend`).not.toBe("executor");
    }
  });

  it("the list is not empty — an empty IN () would sum nothing and always pass", () => {
    expect(EXECUTOR_TASK_TYPES.length).toBeGreaterThan(0);
  });
});

describe("the per-tick bound counts the executor's calls and nothing else", () => {
  /**
   * Everything here runs through `runDecisionExecutorTickBounded`, the function
   * the scheduler calls. The sum it consults is module-private — an earlier
   * draft exported it so these assertions could call it directly, and the
   * reachability gate named that shape. Asserting through the tick is also the
   * stronger check: it shows whether the executor RAN, not what a helper
   * returned.
   */
  async function runTick(opts: { cents?: string; throws?: boolean } = {}) {
    vi.resetModules();
    const wheres: unknown[] = [];
    const logs: string[] = [];
    let executed = 0;

    vi.doMock("../../server/db", () => ({
      db: {
        select: () => {
          if (opts.throws) throw new Error("telemetry down");
          const state = { where: undefined as unknown };
          const self: any = {
            from(t: any) { (state as any).table = getTableName(t); return self; },
            where(p: SQL) { state.where = p; return self; },
            then(resolve: (v: unknown) => void) {
              wheres.push(state.where);
              resolve([{ cents: opts.cents ?? "10" }]);
            },
          };
          return self;
        },
      },
    }));
    vi.doMock("../../server/services/autonomousDecisionExecutor", () => ({
      runAutonomousDecisionExecutor: async () => { executed += 1; return { itemsProcessed: 1 }; },
    }));

    const { runDecisionExecutorTickBounded } = await import("../../server/jobs/decisionExecutorTick");
    await runDecisionExecutorTickBounded((msg) => logs.push(msg));
    return { wheres, logs, executed };
  }

  it("FILTERS TO THE EXECUTOR'S OWN TASK TYPES", async () => {
    const { wheres } = await runTick();
    expect(wheres.length, "the tick consulted no spend measurement at all").toBeGreaterThan(0);

    const taskTypes = boundValues(wheres[0], "task_type");
    expect(
      taskTypes.length,
      "the bound has no task_type predicate — it is counting every AI call on the platform",
    ).toBeGreaterThan(0);
    expect([...taskTypes].sort()).toEqual([...EXECUTOR_TASK_TYPES].sort());
  });

  it("still bounds the window, and still sums across ALL orgs", async () => {
    // The org-wide scope is deliberate and must NOT be "fixed" by analogy with
    // tenant-scoping work elsewhere: this bounds AcreOS's own AI spend on its
    // own autonomous work. It is not customer money.
    const { wheres } = await runTick();
    expect(boundValues(wheres[0], "created_at").length).toBe(1);
    expect(
      boundValues(wheres[0], "organization_id"),
      "a per-org predicate was added to a PLATFORM budget",
    ).toEqual([]);
  });

  it("defers the tick when the EXECUTOR's own spend is over the cap", async () => {
    // $10.00 against the $1.00 default.
    const { executed, logs } = await runTick({ cents: "1000" });
    expect(executed, "the executor ran despite being over its ceiling").toBe(0);
    expect(logs.join(" ")).toContain("per-tick spend cap hit");
  });

  it("runs the tick when the executor is under the cap", async () => {
    // Vacuity guard: a bound that always defers would pass the assertion above.
    const { executed } = await runTick({ cents: "10" });
    expect(executed).toBe(1);
  });

  it("FAILS OPEN when telemetry is unreadable — the executor still runs", async () => {
    // A cost measurement that cannot be read must not become an outage. This is
    // the behaviour the swallowed error exists for, asserted as behaviour.
    const { executed } = await runTick({ throws: true });
    expect(executed, "an unreadable telemetry table silently disabled the executor").toBe(1);
  });
});

describe("the extracted job is wired, not merely present", () => {
  it("the scheduler calls the extracted tick", async () => {
    // "Built but unwired" is this repository's most common defect class, and an
    // extraction is exactly when it happens.
    const fs = await import("node:fs");
    const path = await import("node:path");
    const src = fs.readFileSync(
      path.resolve(__dirname, "../../server/jobs/runScheduledJobs.ts"),
      "utf8",
    );
    expect(src).toContain('from "./decisionExecutorTick"');
    expect(src).toContain("runDecisionExecutorTickBounded(log)");
    // And the old platform-wide sum is gone from the scheduler entirely.
    expect(src).not.toContain("sumAiSpendUsdSince");
    expect(src).not.toContain("sumExecutorAiSpendUsdSince");
  });
});
