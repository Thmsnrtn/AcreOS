/**
 * parcel_observations append-only LOCKDOWN — DDL gate (Iris, CTO).
 *
 * parcel_observations is the crown-jewel longitudinal system-of-record. Its
 * immutability used to be a code comment ONLY; migration 0147 installs the
 * audit_events trigger pattern (0049): a deny function gated behind a session
 * GUC + BEFORE UPDATE / BEFORE DELETE triggers. The runtime role can ONLY
 * INSERT; a DBA opting into the GUC can prune for retention.
 *
 * There is no live Postgres in this test runner (DB calls are mocked
 * everywhere; no pglite/pg-mem dep), so — exactly like
 * sovereign-protocol-immutables.test.ts and schemaIntegrity.test.ts — this is a
 * SOURCE gate: it asserts the protective DDL is present and correctly shaped on
 * BOTH paths that actually reach prod:
 *
 *   1. migrations/0148_parcel_observations_append_only.sql (drizzle path)
 *   2. scripts/migrate.mjs STATEMENTS (the path actually run on Fly deploy —
 *      drizzle migrations are NOT auto-run).
 *
 * The three load-bearing behaviors are proven STRUCTURALLY:
 *   - INSERT still SUCCEEDS  → there is NO trigger on INSERT, and the writer
 *     (observation-log.ts) only ever db.insert(...). A BEFORE UPDATE/DELETE
 *     trigger is incapable of firing on INSERT.
 *   - UPDATE RAISES          → BEFORE UPDATE trigger calls the deny function,
 *     which RAISEs unless the GUC is set.
 *   - DELETE RAISES          → BEFORE DELETE trigger, same deny function.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const MIGRATION_SQL = readFileSync(
  path.join(REPO_ROOT, "migrations", "0148_parcel_observations_append_only.sql"),
  "utf8",
);
const MIGRATE_MJS = readFileSync(
  path.join(REPO_ROOT, "scripts", "migrate.mjs"),
  "utf8",
);
const OBSERVATION_LOG = readFileSync(
  path.join(REPO_ROOT, "server", "services", "data-cache", "observation-log.ts"),
  "utf8",
);

const GUC = "acreos.allow_parcel_observation_mutation";
const FN = "parcel_observations_deny_mutation";

/** Collapse whitespace so multi-line SQL templates match regardless of indent. */
function squash(s: string): string {
  return s.replace(/\s+/g, " ");
}

// ─── The deny function + GUC gate, on BOTH paths ────────────────────────────
describe.each([
  ["migration 0147 (.sql)", MIGRATION_SQL],
  ["scripts/migrate.mjs (prod deploy path)", MIGRATE_MJS],
])("parcel_observations append-only DDL present in %s", (_label, src) => {
  const flat = squash(src);

  it("defines the deny-mutation function idempotently (CREATE OR REPLACE)", () => {
    expect(flat).toMatch(
      new RegExp(`CREATE OR REPLACE FUNCTION ${FN}\\s*\\(`, "i"),
    );
  });

  it("gates the bypass behind the session GUC (DBA retention pruning only)", () => {
    expect(flat).toContain(GUC);
    // The GUC is read with the missing_ok=true form and compared to 'on'.
    expect(flat).toMatch(
      new RegExp(`current_setting\\('${GUC.replace(".", "\\.")}',\\s*true\\)\\s*=\\s*'on'`, "i"),
    );
  });

  it("RAISEs when the GUC is not set (default = append-only)", () => {
    expect(flat.toLowerCase()).toContain("raise exception");
    expect(flat.toLowerCase()).toContain("append-only");
  });

  it("installs a BEFORE UPDATE trigger wired to the deny function", () => {
    expect(flat).toMatch(/DROP TRIGGER IF EXISTS parcel_observations_no_update ON/i);
    expect(flat).toMatch(
      new RegExp(
        `CREATE TRIGGER parcel_observations_no_update\\s+BEFORE UPDATE ON [\"']?parcel_observations[\"']?\\s+FOR EACH ROW\\s+EXECUTE FUNCTION ${FN}\\(\\)`,
        "i",
      ),
    );
  });

  it("installs a BEFORE DELETE trigger wired to the deny function", () => {
    expect(flat).toMatch(/DROP TRIGGER IF EXISTS parcel_observations_no_delete ON/i);
    expect(flat).toMatch(
      new RegExp(
        `CREATE TRIGGER parcel_observations_no_delete\\s+BEFORE DELETE ON [\"']?parcel_observations[\"']?\\s+FOR EACH ROW\\s+EXECUTE FUNCTION ${FN}\\(\\)`,
        "i",
      ),
    );
  });
});

// ─── INSERT must remain unblocked ───────────────────────────────────────────
describe("INSERT path is never touched by the lockdown", () => {
  it("installs NO trigger on INSERT (so the fire-and-forget write keeps working)", () => {
    for (const src of [MIGRATION_SQL, MIGRATE_MJS]) {
      // No BEFORE/AFTER INSERT trigger on parcel_observations anywhere in the
      // protective DDL. A BEFORE UPDATE/DELETE trigger cannot fire on INSERT.
      expect(/(BEFORE|AFTER)\s+INSERT\s+ON\s+["']?parcel_observations/i.test(src)).toBe(false);
    }
  });

  it("the writer (observation-log.ts) only ever db.insert — never update/delete", () => {
    expect(OBSERVATION_LOG).toContain("db.insert(parcelObservations)");
    expect(OBSERVATION_LOG).not.toMatch(/db\.update\(parcelObservations\)/);
    expect(OBSERVATION_LOG).not.toMatch(/db\.delete\(parcelObservations\)/);
  });
});

// ─── Mirror integrity: both paths must agree ────────────────────────────────
describe("the .sql migration and the prod migrate.mjs path mirror each other", () => {
  it("both reference the same function name, GUC, and both trigger names", () => {
    for (const src of [MIGRATION_SQL, MIGRATE_MJS]) {
      expect(src).toContain(FN);
      expect(src).toContain(GUC);
      expect(src).toContain("parcel_observations_no_update");
      expect(src).toContain("parcel_observations_no_delete");
    }
  });
});
