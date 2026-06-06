/**
 * Tahoe L13 — `app_role` schema convention.
 *
 * Every Drizzle DB instance in AcreOS carries one of these roles via a
 * branded TypeScript type. The role flows from the connection string
 * (`DATABASE_URL` → primary, `DATABASE_REPLICA_URL` → replica_ro) all
 * the way to the call site, so read paths can assert
 * `app_role === 'replica_ro'` at the boundary and the type system
 * blocks mutations against a replica-bound instance.
 *
 * The replica_ro role also instructs the connection layer to issue
 * `SET default_transaction_read_only = on` at connect time when
 * `DB_REPLICA_RO_ENFORCED=1`, turning the "this is a replica" claim
 * into a Postgres-level guarantee instead of an honour-system promise.
 *
 * Pairs with `shared/db/read-only.ts`, which exposes the read-only
 * Drizzle method surface used by the `ReadOnlyDb` brand.
 *
 * Companion to L12 (the `ReadOnlyDb` TypeScript wrapper). Together they
 * make active-active multi-region readiness type-enforceable: the
 * compiler refuses to let a write land on a replica connection no
 * matter how the call site is structured.
 */

export const APP_ROLES = {
  primary: "primary",
  replica_ro: "replica_ro",
} as const;

export type DbRole = (typeof APP_ROLES)[keyof typeof APP_ROLES];

/**
 * Branded marker — phantom property carried on Drizzle instances so the
 * compiler can distinguish a primary handle from a replica handle even
 * though they share the same underlying class.
 *
 * Production code never reads this field directly; it exists purely so
 * `PrimaryDb` and `ReplicaDb` (in `server/db.ts`) are structurally
 * incompatible at the type level.
 */
export interface RoleBrand<R extends DbRole> {
  readonly __role: R;
}

/** True if this role can accept writes. */
export function isPrimary(role: DbRole): role is typeof APP_ROLES.primary {
  return role === APP_ROLES.primary;
}

/** True if this role is restricted to read-only traffic. */
export function isReplicaRo(role: DbRole): role is typeof APP_ROLES.replica_ro {
  return role === APP_ROLES.replica_ro;
}
