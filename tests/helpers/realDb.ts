/**
 * Tests that must run against a REAL Postgres built from this repository. A
 * mock cannot evaluate a WHERE clause or an index, so a test about either
 * needs the database.
 *
 * The database is opt-in and explicit: only ACREOS_REAL_DATABASE_URL enables
 * these tests. A developer shell's DATABASE_URL is never picked up, so a local
 * `npm test` cannot write fixture rows into whatever database that points at.
 *
 * The CI jobs that build a schema with `npm run db:build-from-repo` (Test, the
 * deploy gate, staging) set ACREOS_REAL_DATABASE_URL and ACREOS_REQUIRE_REAL_DB.
 * Where REQUIRE is set a missing URL fails, so a real-database test cannot turn
 * vacuous in those jobs by its environment going missing; elsewhere (the CI
 * workflow, which builds no database, and a plain local run) it skips.
 * tests/unit/realDbTestsRunWhereASchemaIsBuilt.test.ts pins that wiring.
 */
export const realDbUrl = process.env.ACREOS_REAL_DATABASE_URL ?? "";
export const realDbAvailable = realDbUrl.length > 0;

/**
 * Points the app's database module at the real database, or throws when the
 * job requires one and has none. Call at module scope, BEFORE anything imports
 * server/db.
 */
export function useRealDb(what: string): void {
  if (!realDbAvailable) {
    if (process.env.ACREOS_REQUIRE_REAL_DB) {
      throw new Error(`${what} needs ACREOS_REAL_DATABASE_URL (a database built from this repo) and this job requires one`);
    }
    return;
  }
  process.env.DATABASE_URL = realDbUrl;
}
