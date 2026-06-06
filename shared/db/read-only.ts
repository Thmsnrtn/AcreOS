/**
 * Tahoe L12 — `ReadOnlyDb` TypeScript wrapper.
 *
 * Today `dbReplica` was the same Drizzle type as the primary. Callers
 * didn't know they were on a replica until something broke. This module
 * defines a read-only structural projection of `NodePgDatabase` that
 * EXCLUDES every mutating method:
 *
 *   - `insert`
 *   - `update`
 *   - `delete`
 *   - `transaction`         (transactions can carry writes — opt out)
 *   - `refreshMaterializedView`
 *
 * and keeps the read surface: `select`, `selectDistinct`,
 * `selectDistinctOn`, `$count`, `$with` / `with`, `execute`, `query`.
 *
 * Crucially, `execute` is still exposed — `/api/health/replica` and
 * the read-replica routing helper use `db.execute(sql\`SELECT 1\`)` /
 * `pg_stat_replication` probes. The replica_ro Postgres role itself
 * enforces "no writes" at the database level when
 * `DB_REPLICA_RO_ENFORCED=1`, so `execute` cannot smuggle DML
 * past the type system in any environment we deploy.
 *
 * Combined with the `__role` brand from `shared/db/roles.ts`, a value
 * of type `ReadOnlyDb` is structurally incapable of holding `insert`,
 * `update`, `delete`, or `transaction` — `dbReplica.insert(...)` is a
 * compile-time TS2339 error.
 *
 * Escape hatch: code that genuinely needs a writable handle on the
 * replica connection (test setup, maintenance scripts) imports
 * `dbReplicaUnsafe` from `server/db.ts` and explains why in a comment.
 */

import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import type { DbRole, RoleBrand } from "./roles.js";

/**
 * The Drizzle method names that should NOT appear on a replica handle.
 * Listed as a string union so the type below stays in sync if drizzle
 * adds new mutation verbs.
 */
export type MutatingDbMethods =
  | "insert"
  | "update"
  | "delete"
  | "transaction"
  | "refreshMaterializedView";

/**
 * Read-only projection of a Drizzle `NodePgDatabase`.
 *
 * Equivalent to `Omit<NodePgDatabase<TSchema>, MutatingDbMethods>` with
 * the role brand attached so the compiler treats it as distinct from a
 * primary `NodePgDatabase`.
 */
export type ReadOnlyDb<TSchema extends Record<string, unknown> = Record<string, never>> =
  Omit<NodePgDatabase<TSchema>, MutatingDbMethods> & RoleBrand<"replica_ro">;

/**
 * Identity-typed helper used at construction time in `server/db.ts` to
 * project a full `NodePgDatabase` down to its `ReadOnlyDb` shape and
 * attach the `replica_ro` brand. At runtime this is a no-op cast — the
 * brand exists only at the type level.
 *
 * The branded shape is what the rest of the codebase imports as
 * `dbReplica`; the underlying Drizzle instance is unchanged.
 */
export function asReadOnlyDb<TSchema extends Record<string, unknown>>(
  inner: NodePgDatabase<TSchema>,
): ReadOnlyDb<TSchema> {
  return inner as unknown as ReadOnlyDb<TSchema>;
}

/**
 * Helper for asserting on the role brand at a runtime boundary. Used by
 * `dbForReads()` / `dbForReadsSync()` to verify the instance we just
 * picked actually claims the role we expect.
 *
 * The check itself is informational — the truth is in the connection
 * string and the Postgres-level `default_transaction_read_only`
 * setting — but it gives us a structured failure mode if someone
 * rewires the exports later without updating the brand.
 */
export function assertRoleAtBoundary(
  actual: DbRole | undefined,
  expected: DbRole,
  context: string,
): void {
  if (actual !== expected) {
    throw new Error(
      `[db] role boundary violation in ${context}: expected app_role=${expected}, got app_role=${actual ?? "undefined"}`,
    );
  }
}
