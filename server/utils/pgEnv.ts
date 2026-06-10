/**
 * pgEnv.ts — Tier 1E credential hygiene helper.
 *
 * Decompose a postgres:// connection URL into libpq environment variables so
 * credentials NEVER appear on a child-process command line (argv is visible
 * to every process on the box via `ps`; a child's env is not). Used by
 * pg_dump in server/jobs/dbBackup.ts and psql in
 * server/jobs/backupRestoreVerify.ts.
 *
 * Dependency-free on purpose: unit tests import this without dragging in the
 * server bootstrap.
 */

/**
 * @param dbUrl postgres:// or postgresql:// connection URL
 * @param databaseOverride target a different database (e.g. the
 *   restore-verification scratch DB) with the same host/credentials.
 */
export function pgEnvFromDatabaseUrl(
  dbUrl: string,
  databaseOverride?: string,
): Record<string, string> {
  const u = new URL(dbUrl);
  const env: Record<string, string> = {
    PGHOST: u.hostname,
    PGPORT: u.port || "5432",
    PGUSER: decodeURIComponent(u.username),
    PGDATABASE: databaseOverride ?? decodeURIComponent(u.pathname.replace(/^\//, "")),
  };
  if (u.password) env.PGPASSWORD = decodeURIComponent(u.password);
  const sslmode = u.searchParams.get("sslmode");
  if (sslmode) env.PGSSLMODE = sslmode;
  return env;
}
