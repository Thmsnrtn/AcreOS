/**
 * One unanswered question, one row, one page — not one every half hour.
 *
 * askFounder() had no duplicate suppression, and three of its escalation paths
 * live inside planAndAct(), which the autopilot loop re-enters every 30 minutes
 * with the moves that are still pending. A move that escalated on one tick
 * escalated again on the next, and every tick after, until answered. Each
 * repeat inserted a fresh solene_founder_asks row AND fired a pager — urgency
 * "normal" maps to pager severity "urgent", so it reached Tom's phone.
 *
 * ActContext.idempotencyKey looks like it would prevent this and does not. Its
 * own doc says it seals the OUTWARD EFFECT so "a concurrent tick / retry dedups
 * instead of double-firing"; it is forwarded to enqueue() and never consulted
 * on the ask path. Reading the field name rather than its one call site is how
 * this survived.
 *
 * The cost lands exactly where it hurts most: FOUNDER_DOORS calls Decisions
 * "the only routine place the founder is required to interact", and the failure
 * mode is that door filling with copies of one question while the phone repeats
 * it. Two of askFounder's other recurring callers — runPolicyInduction ("at
 * most one calm ask per (kind, play), ever") and maybeProposeBudgetRamp
 * ("once, with a cooldown") — had each built their own guard, which is the
 * signal that the guard belonged at the chokepoint.
 *
 * Re-paging an open ask is a real need and was never the missing piece:
 * runAskEscalationLadder() already does it properly, on a per-urgency backoff
 * (REPAGE_HOURS), with its own "Still waiting on you" subject.
 *
 * WHY THIS FILE AND NOT founderCollab.test.ts. That suite passes both before
 * and after the fix. Its in-memory mock decodes only byId / byStatus /
 * expireOverdue predicates, so the four-clause dedup select falls through and
 * returns [] — the mock agrees with every implementation of a query it cannot
 * read, exactly the failure CLAUDE.md records for the nudger mock resolving
 * undefined. So this file asserts the RENDERED SQL of the predicate, and drives
 * the consequences through a mock whose result the test controls.
 *
 * Mutation probes (each must go RED): drop the status='open' clause; drop the
 * questionBody clause; move the dedup check below the sendSolenePage call;
 * return a fresh insert instead of the existing id.
 *
 * idempotent: true — db and pager fully mocked.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { stripComments } from "../helpers/stripComments";

const ROOT = path.resolve(__dirname, "../..");
const SRC_REL = "server/services/solene/founderCollab.ts";
const SRC = stripComments(fs.readFileSync(path.join(ROOT, SRC_REL), "utf8"));

const state = vi.hoisted(() => ({
  /** Rows the mocked SELECT will return — the test decides whether a duplicate exists. */
  duplicateRows: [] as Array<{ id: number; askedAt: Date }>,
  selects: [] as Array<{ sql: string; params: unknown[] }>,
  inserts: [] as Array<Record<string, unknown>>,
  pages: [] as Array<{ severity: string; subject: string }>,
}));

vi.mock("../../server/db", async () => {
  const { PgDialect } = await import("drizzle-orm/pg-core");
  const dialect = new PgDialect();
  return {
    db: {
      select: () => ({
        from: () => ({
          where: (pred: unknown) => {
            const q = dialect.sqlToQuery(pred as never);
            state.selects.push({ sql: q.sql, params: q.params });
            return { limit: async () => state.duplicateRows };
          },
        }),
      }),
      insert: () => ({
        values: (row: Record<string, unknown>) => {
          state.inserts.push(row);
          return { returning: async () => [{ id: 4242 }] };
        },
      }),
    },
  };
});

vi.mock("../../server/services/solene/pagerService", () => ({
  sendSolenePage: vi.fn(async (p: { severity: string; subject: string }) => {
    state.pages.push({ severity: p.severity, subject: p.subject });
    return { eventId: 99 };
  }),
}));

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const ASK = {
  askingAgentRole: "growth" as const,
  questionSummary: "Approve a growth action: send_campaign",
  questionBody: "The same rationale, reproduced verbatim by the next tick.",
  answerFormat: "yes_no" as const,
  urgency: "normal" as const,
};

describe("an identical open ask is reused, not duplicated", () => {
  beforeEach(() => {
    state.duplicateRows = [];
    state.selects = [];
    state.inserts = [];
    state.pages = [];
    vi.clearAllMocks();
  });

  it("with nothing open, it creates the ask and pages once", async () => {
    const { askFounder } = await import("../../server/services/solene/founderCollab");
    const r = await askFounder(ASK);
    expect(r.deduped).toBe(false);
    expect(r.askId).toBe(4242);
    expect(state.inserts).toHaveLength(1);
    expect(state.pages).toHaveLength(1);
  });

  it("with the identical question already open, it writes nothing and pages nobody", async () => {
    state.duplicateRows = [{ id: 17, askedAt: new Date(Date.now() - 3_600_000) }];
    const { askFounder } = await import("../../server/services/solene/founderCollab");
    const r = await askFounder(ASK);

    expect(r.askId, "the caller must still get a pollable id — the open one").toBe(17);
    expect(r.deduped).toBe(true);
    expect(r.pagerFired).toBe(false);
    expect(
      state.inserts,
      "a second row for a question already waiting — this is what filled the door",
    ).toHaveLength(0);
    expect(
      state.pages,
      "a second page for a question already waiting. Reminding is the escalation " +
        "ladder's job, on a backoff, not the ask path's on every tick.",
    ).toHaveLength(0);
  });

  it("the dedup query runs BEFORE the pager, not after", async () => {
    // Ordering is the whole point: a check that runs after sendSolenePage still
    // pages the founder every tick and only saves a row.
    state.duplicateRows = [{ id: 17, askedAt: new Date() }];
    const { askFounder } = await import("../../server/services/solene/founderCollab");
    await askFounder({ ...ASK, urgency: "urgent" });
    expect(state.selects.length, "no dedup query ran at all").toBeGreaterThan(0);
    expect(state.pages).toHaveLength(0);
  });

  it("the predicate binds status, role, summary and body — checked as SQL", async () => {
    // A symbol check would pass on `eq(status,'open')` alone. This asserts the
    // rendered WHERE actually names every column that makes two asks the same
    // question, with the values the caller passed.
    const { askFounder } = await import("../../server/services/solene/founderCollab");
    await askFounder(ASK);

    expect(state.selects, "the dedup SELECT never ran").toHaveLength(1);
    const { sql, params } = state.selects[0];

    for (const col of ["status", "asking_agent_role", "question_summary", "question_body"]) {
      expect(sql, `the dedup predicate does not constrain ${col}`).toContain(`"${col}"`);
    }
    expect(params).toContain("open");
    expect(params).toContain(ASK.askingAgentRole);
    expect(params).toContain(ASK.questionSummary);
    expect(params).toContain(ASK.questionBody);
  });

  it("a different question from the same agent is not suppressed", async () => {
    // The rule must be narrow. Suppressing a genuinely new question would be a
    // worse defect than the duplicates: an agent would block forever on an ask
    // the founder never sees.
    const { askFounder } = await import("../../server/services/solene/founderCollab");
    await askFounder(ASK);
    const first = state.selects[0].params;
    state.selects = [];
    await askFounder({ ...ASK, questionBody: "A different rationale entirely." });
    const second = state.selects[0].params;
    expect(second).not.toEqual(first);
    expect(second).toContain("A different rationale entirely.");
  });
});

describe("the reminder path the dedup relies on still exists", () => {
  it("runAskEscalationLadder re-pages open asks on a backoff", () => {
    // If this were ever deleted, deduping at creation would silently become
    // "ask once and never remind" — the dedup is only safe because this exists.
    expect(SRC).toContain("export async function runAskEscalationLadder");
    expect(SRC).toContain("REPAGE_HOURS");
    expect(SRC).toMatch(/Still waiting on you/);
  });
});
