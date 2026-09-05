/**
 * The reachability gate must recognise a relational read whatever the DB
 * handle is spelled — and must NOT mistake `req.query.<param>` for one.
 *
 * ── THE FALSE ACCUSATION THIS PREVENTS ────────────────────────────────────
 * `tables-no-reader` reported `scp_golden_cases` as a table NOTHING READS on
 * 2026-09-05, the day two of its reads were routed through the sanctioned
 * cross-org hatch:
 *
 *     unscopedForPlatformOps("…reason…").query.scpGoldenCases.findMany({ … })
 *
 * Two founder-gated routes read that table through those exact calls. What
 * changed was not the reads; it was the RECEIVER. The gate's reader pattern
 * was `/\bdb\.query\.(\w+)/` — the literal identifier `db` — so it encoded a
 * population claim ("a relational read is one written on a variable named db")
 * inside what looked like a pattern.
 *
 * That is the expensive direction for THIS gate to be wrong in, by its own
 * stated bias: a false "no reader" invites DROP TABLE. And it would have
 * recurred on every hatch conversion still to come in the tenancy burn-down.
 *
 * ── WHY A FIXTURE TEST AND NOT A SOURCE SCAN ──────────────────────────────
 * A source scan can only assert that some regex is present. What matters is
 * what the regex MATCHES, so this file lifts the live pattern out of the gate
 * and runs it against one fixture per extraction shape the gate relies on —
 * including the shape it must REFUSE. Break any shape and exactly one fixture
 * goes red, which is the property a per-member canary exists to give.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const gate = readFileSync(
  path.resolve(process.cwd(), "scripts/lint-reachability.mjs"),
  "utf8",
);

/**
 * Lift the relational-read pattern out of the gate itself rather than
 * restating it here. A copy would drift, and a drifted copy tests nothing —
 * the second CLAUDE.md law, applied to a test's own inputs.
 */
const RELATIONAL_READ = (() => {
  const at = gate.indexOf("const READ_RES = [");
  if (at < 0) throw new Error("READ_RES is gone from lint-reachability.mjs — re-point this test");
  const block = gate.slice(at, gate.indexOf("];", at));

  // Comment lines FIRST, and this is not defensive housekeeping — the first
  // draft of this file skipped it and crashed on startup. The pattern's own
  // explanation inside the gate contains `unscopedForPlatformOps(reason).query.x`
  // on a line beginning with `//`, so "the line that starts with a slash and
  // mentions query" selected the COMMENT describing the fix instead of the fix.
  // A gate reads its own documentation as the defect — including when the gate
  // is a test, and including when its author had just written that law down.
  const line = block
    .split("\n")
    .filter((l) => !/^\s*\/\//.test(l))
    .find((l) => /query/.test(l) && l.trim().startsWith("/"));

  if (!line) {
    throw new Error(
      "the relational-read alternative is gone from READ_RES. Without it every " +
        "db.query.<table> read in the repo leaves its table looking unread, and " +
        "tables-no-reader starts accusing live tables. Re-point this test:\n" + block,
    );
  }
  const src = line.trim().replace(/,\s*$/, "");
  const lastSlash = src.lastIndexOf("/");
  return new RegExp(src.slice(1, lastSlash), src.slice(lastSlash + 1));
})();

const readsOf = (code: string) => {
  const re = new RegExp(RELATIONAL_READ.source, RELATIONAL_READ.flags);
  const found: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) found.push(m[1]);
  return found;
};

describe("shapes the gate must READ", () => {
  it("the plain handle", () => {
    expect(readsOf(`const rows = await db.query.leads.findMany({});`)).toContain("leads");
  });

  it("a transaction handle", () => {
    expect(
      readsOf(`await db.transaction(async (tx) => { await tx.query.deals.findFirst({}); });`),
      "reads inside a transaction are reads — `tx` is the handle Drizzle hands the callback",
    ).toContain("deals");
  });

  it("THE REGRESSION: the sanctioned cross-org hatch", () => {
    const code = `
      return unscopedForPlatformOps(
        "golden cases across every internal company agent",
      ).query.scpGoldenCases.findMany({ orderBy: [sql\`created_at DESC\`] });
    `;
    expect(
      readsOf(code),
      "a read through unscopedForPlatformOps() is still a read. When this stops " +
        "matching, every table whose only readers are hatched platform ops is " +
        "reported as having NO READER — and the remedy that gate prints is DROP.",
    ).toContain("scpGoldenCases");
  });

  it("the same hatch written on one line", () => {
    expect(
      readsOf(`await unscopedForPlatformOps("founder decisions inbox").query.decisionsInboxItems.findMany({})`),
    ).toContain("decisionsInboxItems");
  });
});

describe("shapes the gate must REFUSE", () => {
  it("an HTTP query parameter is not a table read", () => {
    // The lazy fix for the regression above is a bare `/\.query\.(\w+)/`,
    // which matches this — and then any table sharing a name with a query
    // string parameter is silently marked as read, hiding a real dead table.
    const code = `
      const status = req.query.status;
      const leads = String(req.query.leads ?? "");
    `;
    expect(
      readsOf(code),
      "`req.query.<param>` is a URL query string, not a relational read. " +
        "Matching it turns tables-no-reader into a gate that passes because a " +
        "route happens to accept a parameter of the same name.",
    ).toEqual([]);
  });

  it("a nested request object is not a table read either", () => {
    expect(readsOf(`const v = ctx.req.query.properties;`)).toEqual([]);
  });
});
