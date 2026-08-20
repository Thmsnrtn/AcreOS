/**
 * A support agent may not tell one customer about another customer.
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────────
 * `paxLearning.detectBulkIssue(issuePattern)` ran `db.select()` — every column —
 * over `support_tickets` with NO organization predicate, up to 100 rows, matched
 * by `LIKE %pattern%`. It then returned `affectedOrgs`: a literal list of other
 * tenants' organization ids, plus their support volume, narrated back to the
 * user by the LLM.
 *
 * `issuePattern` is an LLM TOOL ARGUMENT. The model composes it from the user's
 * own message inside a customer-facing support chat (`detect_bulk_issue` is
 * advertised to it as "Check if the current issue is affecting multiple users"),
 * so it is attacker-influencable by prompt injection, and a short pattern
 * matched essentially every ticket created platform-wide in the last hour.
 *
 * The route above it guards correctly and the guard was stepped around one layer
 * down: `routes-support-tickets.ts` 403s when `ticketForGuard.organizationId !==
 * org.id`, commented "so we never touch a sibling org's ticket". The agent then
 * ran under that same authenticated session and queried the table directly.
 *
 * ── AND IT WAS THE UPSTREAM HALF OF A PATCHED DEFECT ────────────────────────
 * `apply_bulk_fix`, the neighbouring tool, was hardened by DEFECT-0030 to reject
 * any `affected_org_ids` entry that is not the caller's own. But THIS function
 * is where the model obtained foreign org ids in the first place. The
 * enumeration that patch assumes cannot happen was exactly what this performed —
 * a downstream fix guarding against input its own upstream was manufacturing.
 *
 * ── WHAT THIS FILE PINS ─────────────────────────────────────────────────────
 * Behaviour, not spelling. It drives the real function against a fake db that
 * returns rows from THREE organizations, and asserts the caller learns about
 * exactly one. Asserting that the string "organizationId" appears in the file
 * would stay green through any rewrite that dropped the predicate — see
 * CLAUDE.md's first law.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

/** Every WHERE the unit built, so the test can prove a predicate was applied. */
const wheres: unknown[] = [];
/** What the fake table returns — deliberately THREE tenants. */
const ROWS_FROM_THREE_ORGS = [
  { organizationId: 7 },
  { organizationId: 8 },
  { organizationId: 9 },
];
let nextRows: Array<{ organizationId: number }> = [];

vi.mock("../../server/db", () => ({
  db: {
    select: vi.fn(() => ({
      from: () => ({
        where: (cond: unknown) => {
          wheres.push(cond);
          return { limit: async () => nextRows };
        },
      }),
    })),
    insert: vi.fn(() => ({ values: async () => undefined })),
  },
}));

const { paxLearningService } = await import("../../server/services/paxLearning");

beforeEach(() => {
  wheres.length = 0;
  nextRows = ROWS_FROM_THREE_ORGS;
});

describe("detectBulkIssue is bounded by the caller's organization", () => {
  it("requires an organization — the signature cannot drop back to a lone pattern", () => {
    // The defect's exact shape was a one-argument signature. Every sibling in
    // paxLearning.ts takes the org first; this was the lone exception.
    expect(
      paxLearningService.detectBulkIssue.length,
      "detectBulkIssue takes fewer than two arguments again — it is back to " +
        "`(issuePattern)`, which is the shape that scanned every tenant.",
    ).toBeGreaterThanOrEqual(2);
  });

  it("never reports an organization other than the caller's, even when the db returns three", () => {
    // THE LOAD-BEARING CASE. The fake db hands back rows from orgs 7, 8 and 9 —
    // i.e. it simulates a query that was NOT scoped. A correctly scoped unit
    // cannot report ids it did not ask for, so any leak shows up here.
    return paxLearningService.detectBulkIssue(7, "timeout").then((result) => {
      expect(
        result.affectedOrgs.filter((id) => id !== 7),
        `detectBulkIssue reported foreign organization ids ${JSON.stringify(
          result.affectedOrgs,
        )} to a caller from org 7. That list is narrated to a customer by the LLM.`,
      ).toEqual([]);
    });
  });

  it("applies a WHERE at all — the vacuity half", () => {
    // Without this, a unit that queried nothing would satisfy the case above by
    // returning an empty list, and the leak check would be free.
    return paxLearningService.detectBulkIssue(7, "timeout").then(() => {
      expect(wheres.length, "detectBulkIssue issued no query — the assertions above are vacuous").
        toBeGreaterThan(0);
    });
  });

  it("does not select ticket subjects or descriptions into the model's context", () => {
    // Defence in depth, and it is the half that survives a future predicate
    // regression: the projection is narrowed to the org column, so foreign
    // ticket TEXT cannot reach an LLM prompt even if the WHERE is weakened.
    // BOUNDED BY THE NEXT METHOD, not by the next `\n  }`.
    //
    // The first draft sliced to `body.indexOf("\n  }", at)` and got 210
    // characters: that brace closes the `Promise<{ … }>` RETURN TYPE in the
    // signature, so the assertion scanned the signature and never reached the
    // query. It passed against a deliberately widened `db.select()` — an inert
    // check that read as a passing one. Fifth encounter in this repo with a
    // truncating reader (the SIGPIPE'd diff, the mispaired comment stripper, the
    // fixed-width slice, the brace-truncated interpolation capture, this).
    // `\n  async ` is a real method boundary; the vacuity assertion below proves
    // the window actually contains the query.
    const src = new URL("../../server/services/paxLearning.ts", import.meta.url).pathname;
    const fs = require("node:fs") as typeof import("node:fs");
    const body = fs.readFileSync(src, "utf8");
    const at = body.indexOf("async detectBulkIssue(");
    const nextMethod = body.indexOf("\n  async ", at + 1);
    const fnSrc = body.slice(at, nextMethod === -1 ? body.length : nextMethod);
    expect(
      fnSrc,
      "the slice does not reach the query — this assertion would be inert",
    ).toContain("from(supportTickets)");
    expect(
      fnSrc,
      "detectBulkIssue is back to select() with no projection, so every column " +
        "of up to 100 foreign tickets — subject and description included — is " +
        "read into a customer-facing agent's context.",
    ).not.toMatch(/db\s*\.\s*select\s*\(\s*\)/);
  });
});
