/**
 * Audit of 1694a0b — once a lead's soft delete became `deletedAt` (and no
 * longer `status: "deleted"`), a reader that excluded deleted leads by STATUS
 * alone began reading them: the dedupe scanners proposed merging live leads
 * into deleted ones, the stale-lead initiative and Today's cards proposed
 * follow-ups on them, a CSV re-import skipped a deleted lead's parcel as a
 * duplicate, the public API listed them, and the plan limit counted them.
 *
 * The population here is the readers fixed so far plus the book aggregates
 * that already held the rule. It is NOT every reader of `leads` (~96 files
 * read the table; the rest is DEFECT-0273, OPEN). Each member must still read
 * `leads` (vacuity), and every statement in it that reads or writes `leads` —
 * through the query builder under either alias, or in raw SQL — must carry an
 * IS NULL predicate on the soft-delete column. Merely NAMING the column is not
 * enough: `isNotNull(leads.deletedAt)` is the opposite filter.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { stripComments } from "../helpers/stripComments";

const LEAD_READERS = [
  "server/services/leadDedupeScanner.ts",
  "server/services/agentInitiativeEngine.ts",
  "server/services/crmEnhancements.ts",
  "server/services/usageLimits.ts",
  "server/services/autopilot/dealActions.ts",
  "server/api-v1/leads.ts",
  "server/routes-today.ts",
  "server/storage/bookAggregates.ts",
  "server/storage/wholeBookReads.ts",
] as const;

const BUILDER = /\.(from|update)\(\s*(leads|leadsTable)\s*\)/g;
const RAW = /\bFROM\s+leads\b/gi;
const LIVE = /(leads|leadsTable)\.deletedAt\}\s*IS\s+NULL|isNull\(\s*(leads|leadsTable)\.deletedAt\s*\)|\bdeleted_at\s+IS\s+NULL/i;

/** Where the NEXT query begins — so siblings in a Promise.all do not share a span. */
const NEXT_QUERY = /\b(db|tx)\b\s*\.\s*(select|update|insert|delete|execute)\b/g;

/** Each statement that touches `leads`: to its `;` or the next query, whichever is first. */
function leadStatements(src: string): string[] {
  const out: string[] = [];
  for (const re of [BUILDER, RAW]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) {
      const semi = src.indexOf(";", m.index);
      NEXT_QUERY.lastIndex = m.index + 1;
      const next = NEXT_QUERY.exec(src);
      const ends = [semi, next ? next.index : -1].filter((i) => i > m!.index);
      out.push(src.slice(m.index, ends.length ? Math.min(...ends) : undefined));
    }
  }
  return out;
}

describe("the one exception: duplicate checks that guard lead creation SEE deleted leads", () => {
  // A STOP writes doNotContact onto the row even after it is deleted. If
  // import or create stopped counting deleted rows as duplicates, a re-import
  // would mint a fresh, contactable row for someone who revoked consent
  // (audit of the fourth follow-up caught exactly that change).
  it("the CSV import's parcel dedupe reads deleted leads", () => {
    const src = stripComments(readFileSync(resolve(__dirname, "../../server/services/importExport.ts"), "utf8"));
    const at = src.indexOf("select({ apn: leads.apn, state: leads.state, county: leads.county })");
    expect(at, "the parcel dedupe read moved — re-anchor this pin").toBeGreaterThan(-1);
    const stmt = src.slice(at, src.indexOf(";", at));
    expect(stmt).toMatch(/eq\(leads\.organizationId, organizationId\)/); // vacuity
    expect(LIVE.test(stmt), "the parcel dedupe must count deleted leads (their opt-outs)").toBe(false);
  });

  it("leadRepo.findDuplicateLeads (import and create) reads deleted leads", () => {
    const src = stripComments(readFileSync(resolve(__dirname, "../../server/storage/leadRepo.ts"), "utf8"));
    const at = src.indexOf("async findDuplicateLeads(");
    expect(at, "findDuplicateLeads moved").toBeGreaterThan(-1);
    const body = src.slice(at, src.indexOf("async mergeLeads(", at));
    expect(body).toMatch(/\.from\(leads\)/); // vacuity
    expect(LIVE.test(body), "findDuplicateLeads must count deleted leads (their opt-outs)").toBe(false);
  });
});

describe("lead readers skip soft-deleted leads (deletedAt IS NULL)", () => {
  it("a statement's span ends at the next query — a Promise.all sibling cannot lend its predicate", () => {
    const src = [
      "await Promise.all([",
      "  db.select().from(leads).where(eq(leads.organizationId, 1)),",
      "  db.select().from(leads).where(and(eq(leads.organizationId, 1), sql`${leads.deletedAt} IS NULL`)),",
      "]);",
    ].join("\n");
    const spans = leadStatements(src);
    expect(spans).toHaveLength(2);
    expect(spans.filter((x) => !LIVE.test(x))).toHaveLength(1);
  });

  it("the predicate is not fooled by a statement that merely names the column", () => {
    expect(LIVE.test("isNotNull(leads.deletedAt)")).toBe(false);
    expect(LIVE.test("select({ deletedAt: leads.deletedAt })")).toBe(false);
    expect(LIVE.test("sql`${leads.deletedAt} IS NULL`")).toBe(true);
    expect(LIVE.test("isNull(leadsTable.deletedAt)")).toBe(true);
    expect(LIVE.test("WHERE organization_id = 1 AND deleted_at IS NULL")).toBe(true);
  });

  for (const file of LEAD_READERS) {
    it(`${file}: every leads statement filters deleted leads out`, () => {
      const src = stripComments(readFileSync(resolve(__dirname, "../..", file), "utf8"));
      const statements = leadStatements(src);
      expect(statements.length, `${file} no longer reads leads — remove it from the population`).toBeGreaterThan(0);
      const blind = statements.filter((s) => !LIVE.test(s));
      expect(blind, `${file}: a leads statement without a deletedAt IS NULL predicate`).toEqual([]);
    });
  }
});
