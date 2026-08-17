/**
 * The outcome PROMPT — closing the last open end of the canonical loop.
 *
 * Every layer of the loop worked before this and one thing was still missing:
 * nothing ever ASKED for an outcome. So the loop closed only when someone
 * spontaneously chose to close it.
 *
 * That is not merely incomplete, and the reason is the point of this unit.
 * **Volunteered outcomes are a biased sample by construction.** People record
 * the deals they remember, and memorable usually means extreme — the one that
 * tripled and the one that went to zero. A calibration computed over volunteered
 * outcomes measures what someone remembers, not how they forecast. The prompt is
 * what turns the learning layer from anecdote into measurement.
 *
 * THE DESIGN IS BORROWED, THE TABLE IS NOT
 * ----------------------------------------
 * `server/services/outcomeLedger.ts` already solved the hard half on the founder
 * plane: the review date is written BY THE CREATOR at decision time, not guessed
 * later by a heuristic. That is the right answer — the person making the call
 * knows whether they will know in thirty days or two years, and a rule that
 * guessed would nag about a long land hold and stay silent on a flip.
 *
 * What is NOT reused is its table. `decisions_inbox_items` is founder
 * control-plane state, and BI5 forbids Founder OS owning customer investment
 * truth. So the pattern is copied onto `decision_snapshots.review_due_at` and
 * the founder's queue is left alone.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { freezeDecision } from "@shared/decisions/snapshot";
import { OUTCOME_KINDS, isTerminal } from "@shared/outcomes/outcome";

const ROOT = path.resolve(__dirname, "../..");

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

/** Source with comments stripped — a rule must hold in CODE, not in prose. */
function code(rel: string): string {
  return read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((l) => l.replace(/(^|[^:])\/\/.*$/, "$1"))
    .join("\n");
}

function decision(over: Record<string, unknown> = {}) {
  return freezeDecision(
    {
      subjectType: "property",
      subjectId: 1,
      kind: "pass",
      choice: "Pass — wetlands unresolved",
      rationale: "r",
      actorType: "user",
      actorRef: "1",
      authority: "owner",
      strategyPackId: null,
      strategyPackVersion: null,
      assumptions: [],
      alternatives: [],
      ...over,
    },
    [],
    new Date("2026-03-01T00:00:00Z"),
  );
}

describe("the review date is frozen at decision time, and null is a real answer", () => {
  it("records null rather than inventing a date", () => {
    // A decision that will never be reviewed must be distinguishable from one
    // whose review was forgotten. Both are common; conflating them means the
    // prompt either nags about the first or stays silent on the second.
    expect(decision().reviewDueAt).toBeNull();
  });

  it("keeps the date the decision-maker chose", () => {
    const due = new Date("2026-09-01T00:00:00Z");
    expect(decision({ reviewDueAt: due }).reviewDueAt).toEqual(due);
  });

  it("the API does NOT default a missing review date to thirty days", () => {
    // A default would manufacture a due date the customer never chose, and the
    // sweep would then nag about every decision ever recorded — which is exactly
    // how a prompt earns being ignored.
    const routes = code("server/routes-decisions.ts");
    expect(routes).toMatch(/reviewDueAt:\s*z\.coerce\.date\(\)\.nullable\(\)\.optional\(\)/);
    expect(routes).not.toMatch(/reviewDueAt[\s\S]{0,80}\.default\(/);
  });

  it("is frozen, not scheduled — the row stays immutable", () => {
    // "Too soon to tell" must not become an UPDATE to the due date. The store
    // has no update path at all, and the interim answer is an OUTCOME.
    const store = code("server/services/decisions/decisionStore.ts");
    expect(store).not.toMatch(/db\s*\.\s*update\(/);
    expect(store).not.toMatch(/db\s*\.\s*delete\(/);
    expect(OUTCOME_KINDS).toContain("still_open");
    expect(isTerminal("still_open")).toBe(false);
  });
});

describe("what the sweep asks for, and what it refuses to ask", () => {
  const sweep = (() => {
    const src = code("server/services/decisions/decisionStore.ts");
    return src.slice(src.indexOf("export async function decisionsDueForOutcome"));
  })();

  it("never asks about a decision with no review date", () => {
    // Null means the decision-maker expected no moment of knowing. Prompting
    // anyway is the nagging that makes a prompt worth ignoring.
    expect(sweep).toMatch(/isNotNull\(decisionSnapshots\.reviewDueAt\)/);
    expect(sweep).toMatch(/lte\(decisionSnapshots\.reviewDueAt,\s*asOf\)/);
  });

  it("only a TERMINAL outcome closes the question", () => {
    // `still_open` is a real answer to "what happened?" — just not the last one.
    // Treating it as resolution would lose every position that has not settled;
    // treating it as silence would ask again as though never answered.
    expect(sweep).toMatch(/ne\(\s*outcomes\.kind,\s*"still_open"\s*\)/);
    expect(sweep).toMatch(/notInArray\(decisionSnapshots\.id,\s*resolved\)/);
  });

  it("counts the interim observations rather than ignoring them", () => {
    expect(sweep).toContain("interimObservations");
    expect(sweep).toMatch(/eq\(\s*outcomes\.kind,\s*"still_open"\s*\)/);
  });

  it("asks the OLDEST question first", () => {
    // Not the newest. The longest-unanswered decision is the one whose outcome
    // is least likely to be remembered later, and therefore the one worth
    // asking about now.
    expect(sweep).toMatch(/orderBy\(asc\(decisionSnapshots\.reviewDueAt\)\)/);
  });

  it("NEVER writes — being asked for an outcome cannot create one", () => {
    // A sweep that could write into the learning layer would be a fabrication
    // engine pointed at exactly the records that must stay observations.
    expect(sweep).not.toMatch(/db\s*\.\s*(insert|update|delete)\(/);
  });

  it("is tenant-scoped in BOTH of its queries, and in the subquery", () => {
    // It reads two tables and builds a subquery, so it has three chances to
    // leak. Each carries its own org predicate.
    const orgPredicates = sweep.match(/organizationId,\s*organizationId\)/g) ?? [];
    expect(orgPredicates.length).toBeGreaterThanOrEqual(3);
  });

  it("does not default a null due date into the result", () => {
    // The `!` states that the isNotNull predicate above guarantees it, rather
    // than a `?? new Date()` quietly inventing a date nobody chose.
    expect(sweep).toMatch(/reviewDueAt:\s*row\.reviewDueAt!/);
    expect(sweep).not.toMatch(/reviewDueAt[^\n]*\?\?/);
  });
});

describe("the `pass` case, which is the whole point", () => {
  it("a pass can carry a review date like any other decision", () => {
    // The schema's own comment: a pass's outcome — "the parcel sold for 3x nine
    // months later" — is the single most valuable and least recorded fact in an
    // investor's history. It is also the one nobody EVER volunteers, because
    // there is no deal in the pipeline to remind them. If the prompt only
    // covered decisions that became deals, it would systematically miss the
    // most informative half of the record.
    const due = new Date("2026-12-01T00:00:00Z");
    const passed = decision({ kind: "pass", reviewDueAt: due });
    expect(passed.kind).toBe("pass");
    expect(passed.reviewDueAt).toEqual(due);
  });

  it("the sweep filters on nothing but due-ness and resolution", () => {
    // No kind filter, no subject-type filter, no "only if it became a deal".
    const src = code("server/services/decisions/decisionStore.ts");
    const sweep = src.slice(src.indexOf("export async function decisionsDueForOutcome"));
    const where = sweep.slice(sweep.indexOf(".from(decisionSnapshots)"));
    expect(where.slice(0, 600)).not.toMatch(/decisionSnapshots\.kind/);
    expect(where.slice(0, 600)).not.toMatch(/decisionSnapshots\.subjectType/);
  });
});

describe("it borrows the founder ledger's design, not its table", () => {
  it("does not touch the founder control-plane queue", () => {
    // BI5: Founder OS is a control plane, not a second product database.
    const store = read("server/services/decisions/decisionStore.ts");
    expect(store).not.toContain("decisionsInboxItems");
    expect(store).not.toContain("outcomeLedger");
  });

  it("names the founder ledger so the shared pattern stays findable", () => {
    // The reuse is of the DESIGN — a creator-written check-in date rather than a
    // heuristic — and a future reader should be able to find the other half.
    expect(read("shared/schema/decision-snapshots.ts")).toContain(
      "server/services/outcomeLedger.ts",
    );
  });

  it("the founder ledger is untouched", () => {
    // Nothing here changes founder behaviour. Asserted because "reuse the
    // pattern" is one slip away from "edit the founder's queue".
    const ledger = read("server/services/outcomeLedger.ts");
    expect(ledger).not.toContain("decision_snapshots");
    expect(ledger).not.toContain("decisionSnapshots");
  });
});

describe("wired end to end", () => {
  it("the column exists in schema, migration AND the release mirror", () => {
    // A schema column with no migration 500s on deploy — a defect this repo has
    // shipped before, which is why all three are asserted rather than one.
    expect(read("shared/schema/decision-snapshots.ts")).toContain(
      'reviewDueAt: timestamp("review_due_at")',
    );
    expect(
      fs.existsSync(path.join(ROOT, "migrations/0232_decision_review_due.sql")),
    ).toBe(true);
    const migrate = read("scripts/migrate.mjs");
    expect(migrate).toContain(
      'ALTER TABLE "decision_snapshots" ADD COLUMN IF NOT EXISTS "review_due_at"',
    );
    expect(migrate).toContain('"decision_snapshots_org_review_due_idx"');
  });

  it("the sweep index is org-LEADING", () => {
    // A prompt index that does not lead with the tenant invites a scan across
    // tenants, which is what check-org-leading-index exists to prevent.
    expect(read("shared/schema/decision-snapshots.ts")).toMatch(
      /decision_snapshots_org_review_due_idx"\)\.on\(\s*table\.organizationId,\s*table\.reviewDueAt,/,
    );
  });

  it("round-trips through the store body", () => {
    // Written on insert AND read back — a column written and never projected is
    // a value the API can never show.
    const store = code("server/services/decisions/decisionStore.ts");
    expect(store).toContain("reviewDueAt: body.reviewDueAt");
    expect(store).toContain("reviewDueAt: row.reviewDueAt,");
  });

  it("has a mounted, read-only route registered before /:id", () => {
    const routes = code("server/routes-decisions.ts");
    expect(routes).toContain('router.get("/due"');
    expect(routes).toContain("decisionsDueForOutcome(organizationId)");
    expect(routes.indexOf('router.get("/due"')).toBeLessThan(
      routes.indexOf('router.get("/:id(\\\\d+)"'),
    );
    // No POST/PUT/PATCH on the due surface: asking is not answering.
    const dueBlock = routes.slice(routes.indexOf('router.get("/due"'));
    expect(dueBlock.slice(0, 700)).not.toMatch(/router\.(post|put|patch)/);
  });
});
