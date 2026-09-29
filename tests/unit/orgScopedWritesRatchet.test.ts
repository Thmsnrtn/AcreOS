/**
 * DEFECT-0184 — tenancy scope for WRITES has a gate, and the debt can only
 * shrink.
 *
 * `lint:org-fetch` rule 3 ("a scoped unit's query must name the org") slices
 * query chains from `.from(table)` — SELECT chains. `db.update(t)` and
 * `db.delete(t)` have no `.from(`, so every UPDATE and DELETE sat outside the
 * population it reads. DEFECT-0183 was exactly that: bulk delete HARD-deleted
 * another tenant's deals and listings with `db.delete(deals).where(inArray(
 * deals.propertyId, ids))` inside a unit holding `orgId`, and the gate stayed
 * green. Measured 2026-09-29: 603 UPDATE/DELETE statements on org-scoped
 * tables across server/, 390 of them with no organization token in the
 * statement.
 *
 * Many of those are safe — keyed on an id the same unit just read under an
 * org predicate — but none were CHECKED. This ratchet freezes the count per
 * file × kind × table (`orgScopedWrites.baseline.json`): a NEW unscoped write
 * fails; fixing one requires lowering its baseline in the same commit (a
 * stale-high entry fails too), so the number only goes down.
 *
 * Population: every non-test .ts under server/, with floors on files, tables
 * and statements; comments are stripped with the real scanner, so a comment
 * quoting an unscoped write does not count. Canaries pin each statement shape.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { stripComments } from "../helpers/stripComments";
import baseline from "./orgScopedWrites.baseline.json";

const ls = (spec: string) =>
  execSync(`git ls-files ${spec}`).toString().trim().split("\n").filter(Boolean);

/** Tables whose pgTable block declares an `organizationId` column. */
const ORG_TABLES = (() => {
  const out = new Set<string>();
  for (const f of ls("'shared/schema.ts' 'shared/schema/*.ts'")) {
    const s = readFileSync(f, "utf8");
    const re = /export const (\w+) = pgTable\(\s*"[^"]+",\s*\{([\s\S]*?)\n\}\s*[,)]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(s))) if (/\borganizationId\s*:/.test(m[2])) out.add(m[1]);
  }
  // The tenant row itself: its key IS the org (`eq(organizations.id, org.id)`).
  out.delete("organizations");
  return out;
})();

const SERVER_FILES = ls("'server/*.ts' 'server/**/*.ts'").filter((f) => !/\.(test|spec)\.ts$/.test(f));

const ORG_TOKEN = /organizationId|orgId|organization_id|forOrg\(|unscopedForPlatformOps\(/;

/**
 * The predicate a statement uses may live in a variable — the repo's most
 * common shape is `const conditions = [eq(t.organizationId, orgId)];` then
 * `.where(and(...conditions))`. Resolve exactly the two unambiguous shapes
 * `lint:org-fetch` resolves (a spread `...ident` and `.where(ident)`) by
 * reading that identifier's declaration and its `.push(` calls in the file.
 * (An OPTIONAL org — `if (organizationId) conditions.push(…)` — answers to
 * tenantKeyIsNeverOmitted.test.ts, not here.)
 */
function predicateText(statement: string, code: string): string {
  let text = statement;
  const idents = new Set([
    ...[...statement.matchAll(/\.\.\.\s*([A-Za-z_$][\w$]*)/g)].map((m) => m[1]),
    ...[...statement.matchAll(/\.\s*where\s*\(\s*([A-Za-z_$][\w$]*)\s*\)/g)].map((m) => m[1]),
  ]);
  for (const id of idents) {
    for (const m of code.matchAll(new RegExp(`\\b(?:const|let|var)\\s+${id}\\b[^;]*;`, "g"))) text += m[0];
    for (const m of code.matchAll(new RegExp(`\\b${id}\\s*\\.\\s*push\\s*\\([^;]*;`, "g"))) text += m[0];
  }
  return text;
}

/** Every UPDATE/DELETE statement on an org-scoped table, and whether it names the org. */
function writeStatements(src: string): Array<{ kind: string; table: string; scoped: boolean }> {
  const code = stripComments(src);
  const re = /\b(?:db|tx|trx|trans|client)\s*\.\s*(update|delete)\s*\(\s*(\w+)\s*\)([\s\S]*?);/g;
  const out: Array<{ kind: string; table: string; scoped: boolean }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) {
    if (!ORG_TABLES.has(m[2])) continue;
    out.push({ kind: m[1], table: m[2], scoped: ORG_TOKEN.test(predicateText(m[3], code)) });
  }
  return out;
}

function unscopedByKey(): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const f of SERVER_FILES) {
    for (const w of writeStatements(readFileSync(f, "utf8"))) {
      if (w.scoped) continue;
      const k = `${f}::${w.kind}::${w.table}`;
      counts[k] = (counts[k] ?? 0) + 1;
    }
  }
  return counts;
}

describe("the detector (canaries)", () => {
  const withTables = (s: string) => {
    // Canaries run against real table identifiers.
    expect(ORG_TABLES.has("deals")).toBe(true);
    return writeStatements(s);
  };
  it.each([
    ["an unscoped delete", "await db.delete(deals).where(inArray(deals.propertyId, ids));", false],
    ["an unscoped update", "await db.update(deals).set({ status: 'x' }).where(eq(deals.id, id));", false],
    ["a transaction update", "await tx.update(deals).set({ a: 1 }).where(eq(deals.id, id));", false],
    ["a multi-line scoped delete", "await db\n  .delete(deals)\n  .where(and(eq(deals.organizationId, orgId), eq(deals.id, id)));", true],
    ["a scoped update", "await db.update(deals).set({ a: 1 }).where(and(eq(deals.id, id), eq(deals.organizationId, org.id)));", true],
    [
      "a predicate list that names the org",
      "const conditions = [eq(deals.id, id)];\nconditions.push(eq(deals.organizationId, orgId));\nawait db.delete(deals).where(and(...conditions));",
      true,
    ],
    [
      "a predicate list that does NOT name the org",
      "const conds = [eq(deals.id, id)];\nawait db.delete(deals).where(and(...conds));",
      false,
    ],
    ["a whole clause in one variable", "const clause = eq(deals.propertyId, pid);\nawait db.update(deals).set({ a: 1 }).where(clause);", false],
  ])("sees %s", (_l, src, scoped) => {
    const w = withTables(src as string);
    expect(w).toHaveLength(1);
    expect(w[0].scoped).toBe(scoped);
  });
  it("ignores a write quoted in a comment", () => {
    expect(withTables("// was: await db.delete(deals).where(inArray(deals.propertyId, ids));\nconst x = 1;")).toEqual([]);
  });
});

describe("the population", () => {
  it("is real (floors)", () => {
    expect(SERVER_FILES.length).toBeGreaterThan(1000);
    expect(ORG_TABLES.size).toBeGreaterThan(200);
    const all = SERVER_FILES.flatMap((f) => writeStatements(readFileSync(f, "utf8")));
    expect(all.length).toBeGreaterThan(500);
  });
});

describe("unscoped writes only shrink", () => {
  const current = unscopedByKey();
  const base = baseline as Record<string, number>;

  it("no NEW unscoped UPDATE/DELETE on an org-scoped table", () => {
    const grown = Object.entries(current)
      .filter(([k, n]) => n > (base[k] ?? 0))
      .map(([k, n]) => `${k}: ${n} (baseline ${base[k] ?? 0}) — name the organization in the statement`);
    expect(grown).toEqual([]);
  });

  it("a fixed write lowers its baseline in the same commit (no stale headroom)", () => {
    const stale = Object.entries(base)
      .filter(([k, n]) => (current[k] ?? 0) < n)
      .map(([k, n]) => `${k}: baseline ${n}, now ${current[k] ?? 0} — lower it in orgScopedWrites.baseline.json`);
    expect(stale).toEqual([]);
  });
});
