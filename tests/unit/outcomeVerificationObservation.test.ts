/**
 * A verifier may only report an outcome it OBSERVED.
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────────
 * `outcomeVerificationLoop` decides whether an autonomous action HELPED, and
 * `autonomyScoreV14` turns that answer into a 0.5–1.5 multiplier on the
 * organization's autonomy score — the trust metric. Until 2026-08-18 the
 * fall-through branch produced that verdict by re-reading `agentActionLog`, the
 * ACTOR'S OWN record of its own execution:
 *
 *     const actionOutcome = logEntry.outcome === "success" ? "positive" : "negative";
 *
 * Three defects in one line:
 *
 *  1. A RECEIPT IS NOT AN OUTCOME. Eight of the ten sites that write that
 *     column write the literal `"success"` at ISSUE time — `predictiveAutoscaler`
 *     writes it beside `output: { scheduled: true }, durationMs: 0` — and
 *     `agentActionExecutors` writes `result.success ? …`, meaning "the executor
 *     did not throw". That was scored `"positive"`, equal in weight to "the lead
 *     progressed to qualified after our follow-up".
 *
 *  2. ESCALATION WAS SCORED AS HARM. The column's domain is
 *     `success | failure | escalated | pending` and `agentAuthorityGate` writes
 *     all four, so everything that was not exactly `"success"` fell into the
 *     false branch. An action correctly ESCALATED to a human — the safety valve
 *     working — became a NEGATIVE outcome that lowered the autonomy score, as
 *     did `"pending"`, which only means the work is still running. The loop put
 *     downward pressure on the one behaviour the constitution most requires.
 *
 *  3. IT CROSSED TENANTS. `agent_action_log` has no `organization_id` at all;
 *     the driving `agentEvents` query had no organization predicate; the entity
 *     lookups matched on primary key alone. `calculateDailyScore(orgId)` calls
 *     this per organization, so each org's multiplier was computed from every
 *     other org's actions.
 *
 * ── WHERE IT CAME FROM ──────────────────────────────────────────────────────
 * Foundry §16 — an effect receipt is not an outcome. The invariant crossed; no
 * Foundry noun did.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { and, eq, getTableName } from "drizzle-orm";
import { agentEvents } from "@shared/schema";

// ── A fake db that records what it was ASKED, and answers what we queue ──────
//
// The chain object is both chainable and thenable, because the service ends
// different queries at different links (`.limit(100)`, `.limit(1)`, and a
// COUNT that is awaited straight off `.where(...)`).

interface Ask {
  /** The drizzle table NAME. Identity is useless here: `vi.resetModules()` */
  /** hands the service its own instance of `@shared/schema`. */
  table: string;
  where: unknown;
}

function makeDb(rowsFor: (table: string) => unknown[]) {
  const asks: Ask[] = [];
  const inserted: Array<Record<string, any>> = [];

  const chain = () => {
    const state: Ask = { table: "", where: undefined };
    const self: any = {
      from(t: any) { state.table = getTableName(t); return self; },
      innerJoin() { return self; },
      where(p: unknown) { state.where = p; return self; },
      orderBy() { return self; },
      limit() { return self; },
      then(resolve: (v: unknown) => void, reject?: (e: unknown) => void) {
        try {
          asks.push({ ...state });
          resolve(rowsFor(state.table));
        } catch (e) { reject?.(e); }
      },
    };
    return self;
  };

  const db = {
    select: () => chain(),
    insert: () => ({
      values: async (v: Record<string, any>) => { inserted.push(v); },
    }),
  };

  return { db, asks, inserted };
}

/**
 * Flatten a drizzle SQL predicate into the (column, value) pairs the DATABASE
 * would actually be asked for.
 *
 * This reads the GENERATED predicate object, not the source text. It is still a
 * structural check, not an executed one — it proves the query carries the
 * tenant binding, not that PostgreSQL honoured it. Executed cross-tenant proof
 * lives in `tests/security/idorFuzz.ts`, which runs against a real database.
 */
function bindings(node: unknown): Array<{ column: string; value: unknown }> {
  const tokens: Array<{ kind: "col" | "param"; v: unknown }> = [];
  const walk = (n: any): void => {
    if (n === null || typeof n !== "object") return;
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (typeof n.name === "string" && n.table !== undefined) {
      tokens.push({ kind: "col", v: n.name });
      return;
    }
    if ("encoder" in n && "value" in n) {
      tokens.push({ kind: "param", v: n.value });
      return;
    }
    if (Array.isArray(n.queryChunks)) { n.queryChunks.forEach(walk); return; }
  };
  walk(node);

  const out: Array<{ column: string; value: unknown }> = [];
  for (let i = 0; i < tokens.length - 1; i++) {
    if (tokens[i].kind === "col" && tokens[i + 1].kind === "param") {
      out.push({ column: String(tokens[i].v), value: tokens[i + 1].v });
    }
  }
  return out;
}

/** One `agent_events` row of the shape the loop reads. */
const event = (payload: Record<string, unknown>) => ({
  id: 1,
  organizationId: 7,
  eventType: "action_succeeded",
  eventSource: "agent",
  payload,
  createdAt: new Date("2026-08-17T00:00:00Z"),
});

beforeEach(() => {
  vi.resetModules();
  vi.doMock("../../server/utils/logger", () => ({
    logger: { info: () => {}, warn: () => {}, error: () => {} },
  }));
});

async function runVerify(rowsFor: (table: string) => unknown[], orgId = 7) {
  const fake = makeDb(rowsFor);
  vi.doMock("../../server/db", () => ({ db: fake.db }));
  const { outcomeVerificationLoop } = await import("../../server/services/outcomeVerificationLoop");
  const summary = await outcomeVerificationLoop.verify(orgId);
  return { summary, ...fake };
}

describe("the actor's own execution record is never an outcome verdict", () => {
  /**
   * The whole domain of `agent_action_log.outcome`. Not one of these may become
   * a score. Sweeping all four is the point: pinning only `"success"` would
   * leave `"escalated"` free to go on counting as harm.
   */
  const SELF_REPORTS = ["success", "failure", "escalated", "pending"];

  for (const reported of SELF_REPORTS) {
    it(`an execution log reporting "${reported}" yields "unverified", and moves no score`, async () => {
      const { summary, inserted } = await runVerify((t) => {
        if (t === "agent_events") return [event({ agentCodename: "atlas_cto", action: "infrastructure_scale" })];
        if (t === "agent_action_log") return [{ outcome: reported, agentCodename: "atlas_cto" }];
        return [];
      });

      expect(inserted[0].payload.outcome, `a self-reported "${reported}" became a verdict`).toBe("unverified");
      expect(summary.positive).toBe(0);
      expect(summary.negative).toBe(0);
      expect(summary.verified, "an unobserved action was counted as observed").toBe(0);
      expect(summary.unverified).toBe(1);
      expect(
        summary.qualityScore,
        `a self-reported "${reported}" moved the quality score, which multiplies the autonomy score`,
      ).toBe(50);
    });
  }

  it("ESCALATING TO A HUMAN IS NOT A NEGATIVE OUTCOME", async () => {
    // The worst consequence of the old ternary: `agentAuthorityGate` writes
    // "escalated" when it correctly refuses to act alone, and that was scored
    // as harm — a gradient pointing away from asking permission.
    const { summary } = await runVerify((t) => {
      if (t === "agent_events") return [event({ agentCodename: "atlas_cto", action: "wire_transfer" })];
      if (t === "agent_action_log") return [{ outcome: "escalated" }];
      return [];
    });
    expect(summary.negative, "escalation was scored as harm").toBe(0);
    expect(summary.qualityScore).toBe(50);
  });

  it("keeps the self-report readable, plainly marked as testimony about execution", async () => {
    const { inserted } = await runVerify((t) => {
      if (t === "agent_events") return [event({ agentCodename: "atlas_cto", action: "canary_deploy_start" })];
      if (t === "agent_action_log") return [{ outcome: "success" }];
      return [];
    });
    const reason = String(inserted[0].payload.reason);
    // The actor's claim survives for a human reading the stream...
    expect(reason).toContain("success");
    // ...and is explicitly not a claim about whether it helped.
    expect(reason).toMatch(/whether it ran, not whether it helped/);
  });

  it("says so when there is no execution log at all", async () => {
    const { inserted, summary } = await runVerify((t) =>
      t === "agent_events" ? [event({ agentCodename: "sentinel_devops", action: "unknown_thing" })] : []);
    expect(inserted[0].payload.outcome).toBe("unverified");
    expect(summary.qualityScore).toBe(50);
  });
});

describe("an unobserved action is not averaged in as a measured non-effect", () => {
  it("EXCLUDES unverified from the quality denominator", async () => {
    // One real observation (a lead that progressed) plus three actions nobody
    // could observe. Excluded: (1-0)/1*100+50 = 150. Averaged in as neutral,
    // the way the old code counted them: (1-0)/4*100+50 = 75. The two answers
    // are distinguishable, which is what makes this assertion mean something.
    const events = [
      event({ agentCodename: "pax", action: "send_follow_up", leadId: 11 }),
      event({ agentCodename: "pax", action: "mystery_a" }),
      event({ agentCodename: "pax", action: "mystery_b" }),
      event({ agentCodename: "pax", action: "mystery_c" }),
    ];
    const { summary } = await runVerify((t) => {
      if (t === "agent_events") return events;
      if (t === "leads") return [{ id: 11, organizationId: 7, status: "qualified" }];
      return [];
    });

    expect(summary.verified).toBe(1);
    expect(summary.unverified).toBe(3);
    expect(
      summary.qualityScore,
      "absence of observation was averaged in as if it were a measured 'no effect'",
    ).toBe(150);
  });

  it("returns a neutral 50 — not a verdict — when nothing at all was observed", async () => {
    const { summary } = await runVerify((t) =>
      t === "agent_events" ? [event({ agentCodename: "pax", action: "mystery" })] : []);
    expect(summary.verified).toBe(0);
    expect(summary.qualityScore).toBe(50);
  });

  it("still measures a lead that was observed NOT to move", async () => {
    // Vacuity guard on the rule above. "Observed and unchanged" is a real
    // measurement and must keep landing in the denominator — otherwise the fix
    // would have quietly deleted every negative signal along with the fake ones.
    const { summary } = await runVerify((t) => {
      if (t === "agent_events") return [event({ agentCodename: "pax", action: "send_follow_up", leadId: 11 })];
      if (t === "leads") return [{ id: 11, organizationId: 7, status: "new" }];
      return [];
    });
    expect(summary.neutral).toBe(1);
    expect(summary.verified).toBe(1);
  });

  it("scores a lead that went dead as negative", async () => {
    const { summary } = await runVerify((t) => {
      if (t === "agent_events") return [event({ agentCodename: "pax", action: "send_follow_up", leadId: 11 })];
      if (t === "leads") return [{ id: 11, organizationId: 7, status: "dead" }];
      return [];
    });
    expect(summary.negative).toBe(1);
    expect(summary.qualityScore).toBe(-50);
  });
});

describe("an observation carries the agent that made it", () => {
  it("attributes an OBSERVED outcome to the real codename", async () => {
    // `agent_events` has no `agent_codename` column — the loop's own comment
    // says so and reads the payload — yet every verifier returned
    // `action.agentCodename`, i.e. `undefined`, hidden by `action: any`. So the
    // genuinely observed results reached trust evolution unattributed while the
    // self-reported ones kept their name. Asserted on the emitted event, which
    // is the surface trust evolution actually reads.
    const { inserted } = await runVerify((t) => {
      if (t === "agent_events") return [event({ agentCodename: "pax", action: "send_follow_up", leadId: 11 })];
      if (t === "leads") return [{ id: 11, organizationId: 7, status: "qualified" }];
      return [];
    });
    expect(inserted[0].payload.outcome).toBe("positive");
    expect(inserted[0].payload.agentCodename, "an observed outcome reached trust evolution unattributed").toBe("pax");
  });
});

describe("the verifier looks only inside one tenant", () => {
  it("binds the tenant on the driving query and on every entity it reads", async () => {
    const { asks } = await runVerify((t) => {
      if (t === "agent_events") return [
        event({ agentCodename: "pax", action: "send_follow_up", leadId: 11 }),
        event({ agentCodename: "pax", action: "flag_deal_risk", dealId: 12 }),
        event({ agentCodename: "pax", action: "update_lead_status", leadId: 13 }),
      ];
      if (t === "leads") return [{ id: 11, organizationId: 7, status: "qualified" }];
      if (t === "deals") return [{ id: 12, organizationId: 7, status: "closed_won" }];
      return [];
    }, 7);

    const boundOn = (table: string, column: string) =>
      asks.filter((a) => a.table === table)
        .some((a) => bindings(a.where).some((b) => b.column === column && b.value === 7));

    expect(boundOn("agent_events", "organization_id"), "the driving query swept every tenant").toBe(true);
    expect(boundOn("leads", "organization_id"), "a lead was matched by primary key alone").toBe(true);
    expect(boundOn("deals", "organization_id"), "a deal was matched by primary key alone").toBe(true);
  });

  it("the binding reader is not vacuous", () => {
    // If `bindings()` silently returned [] the assertions above would be a
    // clean bill of health over nothing. Prove it finds what is there and does
    // not invent what is not.
    const found = bindings(
      and(eq(agentEvents.organizationId, 7), eq(agentEvents.eventType, "action_succeeded")),
    );
    expect(found).toContainEqual({ column: "organization_id", value: 7 });
    expect(found.map((b) => b.column)).not.toContain("subscription_status");
  });
});

describe("the daily pass covers every organization", () => {
  it("verifies each organization, rather than one hard-coded id", async () => {
    // The scheduled job called `verify(1)`. That was survivable only because
    // the queries had no tenant predicate and therefore swept everyone anyway,
    // filing the results under org 1. Now that the predicate is real, a
    // hard-coded id would mean everybody else stops being verified.
    const fake = makeDb((t) => (t === "organizations" ? [{ id: 4 }, { id: 9 }] : []));
    vi.doMock("../../server/db", () => ({ db: fake.db }));
    const { outcomeVerificationLoop } = await import("../../server/services/outcomeVerificationLoop");
    const out = await outcomeVerificationLoop.verifyAllOrganizations();

    expect(out.organizations).toBe(2);
    const swept = fake.asks
      .filter((a) => a.table === "agent_events")
      .flatMap((a) => bindings(a.where))
      .filter((b) => b.column === "organization_id")
      .map((b) => b.value);
    expect(swept).toEqual([4, 9]);
  });

  it("the scheduler no longer pins the pass to a literal organization", () => {
    // A source check, and only that: it cannot prove the enumeration is right,
    // which is what the behavioural test above is for. It exists because the
    // defect it guards — re-pinning a literal org id into a scheduled job — is
    // one this repository has reintroduced before.
    const src = fs.readFileSync(
      path.resolve(__dirname, "../../server/jobs/runScheduledJobs.ts"),
      "utf8",
    );
    expect(src).not.toMatch(/outcomeVerificationLoop\.verify\(\s*\d+\s*\)/);
    expect(src).toContain("outcomeVerificationLoop.verifyAllOrganizations()");
  });
});
