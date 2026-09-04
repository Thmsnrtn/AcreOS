/**
 * The nightly purge was deleting the autopilot's own accountability record.
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────────
 * `activity_log` is not only activity logs. Every Pax RECEIPT lives there:
 * `paxReceipts.ts` writes each autonomous effect with `agent_type = 'pax'`, and
 * `paxReceiptsReader.ts` — the ONE reader behind `GET /api/pax/receipts` and
 * the "What Pax did" section — reads exactly those rows back.
 *
 * `jobs/dataRetention.ts` ran a nightly `DELETE FROM activity_log WHERE
 * created_at < now() - 90 days`. Not an archive. A delete.
 *
 * So the answer to the only question that matters about an autonomous system —
 * what did it do, on whose say-so — evaporated every ninety days, and a
 * customer asking about a send from four months ago got an empty list with no
 * indication that anything had ever been there.
 *
 * ── WHAT THIS PINS, AND WHY IT IS DERIVED ───────────────────────────────────
 * Not "the string agent_type appears in dataRetention.ts". The property is a
 * CORRESPONDENCE between two files: every row the reader can return is a row
 * the purge must not touch. So the test reads the reader's own predicate,
 * extracts the agent-type value it filters on, and asserts the retention rule
 * excludes THAT value. A reader widened to return more without retention being
 * widened to keep more fails here — which is the drift that would otherwise
 * lose rows silently, months later, with nobody watching.
 *
 * The second assertion is about the JOB rather than the data: a destructive job
 * that cannot fail loudly is a destructive job nobody is watching. Its catch
 * block used to swallow every error at DEBUG under the comment "table may not
 * exist yet", so a lock timeout, a constraint violation or a typo in the rule
 * list read exactly like a table that had not been created.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { stripComments } from "../helpers/stripComments";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => stripComments(fs.readFileSync(path.join(ROOT, rel), "utf8"));

const READER = read("server/services/paxReceiptsReader.ts");
const RETENTION = read("server/jobs/dataRetention.ts");

describe("Pax receipts survive data retention", () => {
  it("the purge exempts exactly what the receipts reader returns", () => {
    // DERIVED from the reader, not typed here: whatever agent_type it filters
    // on is what retention must keep.
    const m = /eq\(\s*activityLog\.agentType\s*,\s*["'`]([^"'`]+)["'`]\s*\)/.exec(READER);
    expect(
      m,
      "paxReceiptsReader no longer filters activity_log by agentType, so this " +
        "test can no longer derive what must be kept. Re-point it at the new " +
        "predicate — do not delete it: the correspondence it guards is the " +
        "whole reason receipts survive the nightly purge.\n" + READER.slice(0, 400),
    ).not.toBeNull();
    const agentType = m![1];
    expect(agentType).toBe("pax");

    // The activity_log rule must carry a keepWhere naming that value.
    const at = RETENTION.indexOf('table: "activity_log"');
    expect(at, "the activity_log retention rule is gone").toBeGreaterThan(-1);
    const rule = RETENTION.slice(at, RETENTION.indexOf("},", at) + 2);
    expect(
      rule,
      "the activity_log purge has no keepWhere, so it deletes every row older " +
        "than its window — including every Pax receipt, which is the " +
        "autopilot's accountability record:\n" + rule,
    ).toContain("keepWhere");
    expect(
      rule,
      `the keepWhere no longer excludes agent_type '${agentType}' — the exact ` +
        "value paxReceiptsReader filters on. Receipts are being deleted again.",
    ).toContain(`agent_type IS DISTINCT FROM '${agentType}'`);
  });

  it("the keepWhere is actually applied to the DELETE", () => {
    // A rule field nothing reads is a comment. This is the "built but unwired"
    // shape CLAUDE.md calls this codebase's commonest defect, and it would be
    // invisible: the rule would look correct and the rows would still go.
    expect(
      RETENTION,
      "keepWhere is declared on the rule and never interpolated into the " +
        "statement, so it protects nothing.",
    ).toMatch(/rule\.keepWhere\s*\?\?\s*sql``/);
  });

  it("the cutoff is a parameter, not a string built into the statement", () => {
    expect(
      RETENTION,
      "the DELETE interpolates a timestamp into its own text again.",
    ).not.toMatch(/WHERE \$\{rule\.column\} < '\$\{/);
    expect(RETENTION).toMatch(/\$\{cutoff\}/);
  });

  it("a failed purge is reported, not swallowed as a missing table", () => {
    expect(
      RETENTION,
      "the catch block no longer distinguishes a missing relation from a real " +
        "failure. Every error then reads as 'table does not exist yet' at " +
        "DEBUG, in a job whose whole purpose is deleting rows.",
    ).toContain("UNDEFINED_TABLE");
    expect(RETENTION).toContain('const UNDEFINED_TABLE = "42P01"');
    expect(
      RETENTION,
      "failures are no longer collected, so the caller cannot tell a clean run " +
        "from one where nothing was purged because every rule threw.",
    ).toMatch(/failures\.push\(/);
    expect(
      RETENTION,
      "the run summary no longer reports how many rules failed.",
    ).toMatch(/failures\.length > 0/);
  });
});
