/**
 * The Evidence Fabric's contract must be a constraint, and no table may be made
 * append-only with a rewrite RULE.
 *
 * ── WHY ─────────────────────────────────────────────────────────────────────
 * `shared/schema/evidence.ts` declares "APPEND-ONLY BY CONTRACT" and argues it
 * correctly: "a row that can be updated is a row whose history can be
 * rewritten." Nothing enforced it. `evidence_claims` shipped with ZERO
 * constraints — `authority = 'guess'` inserted cleanly — and the sole thing
 * behind the immutability promise was the ABSENCE of an `updated_at` column.
 * The promise is load-bearing: Law 6 and the frozen RESOLUTION_POLICY_VERSION
 * in decision snapshots both assume those rows never change.
 *
 * Migration 0238 makes it real. This file guards the two things that can rot
 * without a database: the SQL vocabularies drifting from the TypeScript ones,
 * and the rewrite-RULE pattern coming back.
 *
 * ── THE RULE PATTERN, AND WHY IT IS BANNED OUTRIGHT ─────────────────────────
 * `migrations/0086` enforced append-only on `earnest_money_events` with
 * `CREATE RULE … DO INSTEAD NOTHING` for UPDATE and DELETE. Two problems, one
 * cosmetic and one severe.
 *
 * Silent: an UPDATE reported success and changed nothing, so tampering and
 * legitimate writes were indistinguishable to the caller.
 *
 * Severe: PostgreSQL implements foreign-key checks with internal queries
 * against the referencing table, and a rewrite rule rewrites those too. The
 * check returns something unexpected and the statement aborts. Measured against
 * PostgreSQL 16, `DELETE FROM organizations WHERE id = 9` failed for an
 * organization with ZERO earnest_money_events rows — the rule does not need
 * matching data to break the check, it breaks the check itself. That statement
 * is server/services/orgDeletion.ts:122, the GDPR erasure path. No organization
 * could be deleted, ever, and the error named a foreign key rather than
 * anything a reader would connect to deletion.
 *
 * 0239 replaces the rules with a BEFORE UPDATE trigger, which does not rewrite
 * queries. Verified: UPDATE now refuses loudly and leaves the value unchanged,
 * and org deletion cascades escrow events correctly.
 *
 * A trigger is the only acceptable mechanism. This file makes sure the rule
 * never returns.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { EVIDENCE_SUBJECT_TYPES } from "../../shared/evidence/claim";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string): string => fs.readFileSync(path.join(ROOT, p), "utf8");

const migration0238 = read("migrations/0238_evidence_claims_integrity.sql");
const migrate = read("scripts/migrate.mjs");

/**
 * SQL and JS with comment lines removed.
 *
 * Without this the scan below matches its OWN explanation of the banned
 * pattern, and 0239 — the migration that REMOVES the rules — is reported as an
 * offender for quoting the thing it deleted. Prose about a defect is not the
 * defect.
 */
function codeOnly(src: string): string {
  return src
    .split("\n")
    .filter((l) => !l.trim().startsWith("--") && !l.trim().startsWith("//") && !l.trim().startsWith("*"))
    .join("\n");
}

/** The `IN ('a', 'b')` list of a named CHECK constraint, as written in SQL. */
function checkVocabulary(sql: string, constraint: string): string[] {
  const block = sql.slice(sql.indexOf(constraint));
  const m = block.match(/IN\s*\(([^)]*)\)/);
  if (!m) return [];
  return m[1]
    .split(",")
    .map((s) => s.trim().replace(/^'|'$/g, ""))
    .filter(Boolean);
}

describe("the SQL vocabularies match the TypeScript ones", () => {
  it("subject_type", () => {
    // Drift here is silent and expensive: the TS type would accept a value the
    // database then rejects at 3am, or the database would accept one the
    // resolution policy cannot interpret.
    expect(
      checkVocabulary(migration0238, "evidence_claims_subject_type_chk").sort(),
      "migrations/0238 disagrees with EVIDENCE_SUBJECT_TYPES in shared/evidence/claim.ts",
    ).toEqual([...EVIDENCE_SUBJECT_TYPES].sort());
  });

  it("authority", () => {
    // EvidenceAuthority is a bare union type with no runtime array to import,
    // so it is read from the source. If it ever gains a runtime constant,
    // import that instead of parsing.
    const src = read("shared/evidence/claim.ts");
    const decl = src.slice(src.indexOf("export type EvidenceAuthority"));
    const declared = [...decl.slice(0, decl.indexOf(";")).matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
    expect(declared.length, "could not parse EvidenceAuthority — the scan broke").toBeGreaterThan(2);
    expect(
      checkVocabulary(migration0238, "evidence_claims_authority_chk").sort(),
      "migrations/0238 disagrees with EvidenceAuthority",
    ).toEqual(declared.sort());
  });

  it("value_kind", () => {
    const src = read("shared/evidence/claim.ts");
    const decl = src.slice(src.indexOf("export type EvidenceValueKind"));
    const declared = [...decl.slice(0, decl.indexOf(";")).matchAll(/"([a-z]+)"/g)].map((m) => m[1]);
    expect(declared.length, "could not parse EvidenceValueKind — the scan broke").toBeGreaterThan(2);
    expect(
      checkVocabulary(migration0238, "evidence_claims_value_kind_chk").sort(),
      "migrations/0238 disagrees with EvidenceValueKind",
    ).toEqual(declared.sort());
  });
});

describe("append-only is enforced, and by a trigger", () => {
  it("both append-only tables refuse UPDATE in the path that runs on deploy", () => {
    // scripts/migrate.mjs is Fly's release_command. A migration file alone
    // proves nothing about production, because migrate.mjs does not run
    // migrations/*.sql.
    //
    // Asserted as a STATEMENT SHAPE, not a name. `toContain("…no_update")` was
    // the first version and it survived renaming the trigger to
    // `…no_update_RENAMED`, because the old name is a substring of the new one.
    // A gate that passes while the thing it guards has been renamed away is
    // worse than no gate: it reports coverage it does not have.
    const wired = (trigger: string, table: string) =>
      new RegExp(
        `CREATE TRIGGER "${trigger}"\\s*\\n\\s*BEFORE UPDATE ON "${table}"`,
      ).test(migrate);

    expect(
      wired("evidence_claims_no_update", "evidence_claims"),
      "evidence_claims has no BEFORE UPDATE trigger in the deploy path",
    ).toBe(true);
    expect(
      wired("emd_events_no_update_trg", "earnest_money_events"),
      "earnest_money_events has no BEFORE UPDATE trigger in the deploy path",
    ).toBe(true);
  });

  it("DELETE is NOT blocked — erasure is not rewriting", () => {
    // Deliberate asymmetry, and the reason 0239 exists. Both tables carry
    // ON DELETE CASCADE from organizations, so blocking DELETE makes a tenant
    // permanently undeletable and puts the table beyond reach of GDPR erasure.
    for (const fn of ["evidence_claims_refuse_update", "emd_events_refuse_update"]) {
      expect(migrate).toContain(fn);
    }
    expect(
      migrate.includes("evidence_claims_refuse_delete") ||
        migrate.includes("emd_events_refuse_delete"),
      "a DELETE-refusing trigger was added — that blocks organization deletion " +
        "and the GDPR erasure path (orgDeletion.ts:122). Corrections are new " +
        "rows; erasure is a different and lawful act.",
    ).toBe(false);
  });
});

describe("no table is made append-only with a rewrite RULE", () => {
  const sqlFiles = fs
    .readdirSync(path.join(ROOT, "migrations"))
    .filter((f) => f.endsWith(".sql"))
    .map((f) => ({ name: `migrations/${f}`, sql: codeOnly(read(`migrations/${f}`)) }));

  it("scanned the migration corpus (vacuity guard)", () => {
    expect(
      sqlFiles.length,
      "no migrations read — the zero below would prove nothing",
    ).toBeGreaterThan(200);
  });

  it("detects the banned pattern when present (positive control)", () => {
    const probe = "CREATE RULE x AS ON DELETE TO t DO INSTEAD NOTHING;";
    expect(/DO\s+INSTEAD\s+NOTHING/i.test(probe)).toBe(true);
  });

  it("contains no `DO INSTEAD NOTHING` rule anywhere", () => {
    const offenders = [...sqlFiles, { name: "scripts/migrate.mjs", sql: codeOnly(migrate) }]
      .filter((f) => /CREATE\s+(OR\s+REPLACE\s+)?RULE[\s\S]{0,400}?DO\s+INSTEAD\s+NOTHING/i.test(f.sql))
      .map((f) => f.name);
    expect(
      offenders,
      "A rewrite RULE silently swallows the write AND breaks PostgreSQL's " +
        "foreign-key checks against that table, which is how organization " +
        "deletion — the GDPR erasure path — was broken for every org. Use a " +
        "BEFORE UPDATE trigger that RAISEs instead.",
    ).toEqual([]);
  });
});
