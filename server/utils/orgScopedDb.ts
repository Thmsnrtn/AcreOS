/**
 * Tier 1F (elevation blueprint 2026-06-10) — Tenancy by construction.
 *
 * Extends the proven type-brand technique from `server/db.ts` (the
 * `ReadOnlyDb` replica brand in `shared/db/read-only.ts`) to ORG SCOPING:
 * a scoped-repository layer where fetch-by-bare-id does not typecheck.
 *
 * The shape of the guarantee:
 *
 *   - `forOrg(organizationId)` is the ONLY way to obtain an `OrgScopedDb`.
 *     Its constructor is private; the factory validates the org id at
 *     runtime (positive integer) so `forOrg(undefined as any)` fails loudly
 *     instead of silently widening the query to every tenant.
 *
 *   - Every query helper on `OrgScopedDb` (`findById`, `listWhere`,
 *     `existsById`, `updateById`, `deleteById`) injects
 *     `eq(table.organizationId, this.organizationId)` into the WHERE
 *     clause unconditionally. There is no code path through this class
 *     that emits a bare-id predicate.
 *
 *   - The helpers only accept `OrgScopedTable` — a structural type that
 *     REQUIRES the table to expose `id` + `organizationId` columns. Handing
 *     a non-tenant table to `findById` is a compile error, and a defensive
 *     runtime assert backs the compiler up against `as any` smuggling.
 *
 *   - Cross-org / platform-level access is still possible, but only through
 *     the explicit, greppable escape hatch `unscopedForPlatformOps(reason)`,
 *     which logs its reason. `git grep unscopedForPlatformOps` is the
 *     complete audit surface for intentional tenancy bypasses.
 *
 * RLS was considered and deliberately deferred (pgBouncer transaction mode
 * + 465 tables = too much blast radius for now) — this layer is the
 * type-level stand-in until that calculus changes.
 *
 * Companion pieces:
 *   - `server/utils/orgScope.ts` — behavioral IDOR guards; now backed by the
 *     mechanical registry below (all org-scoped tables, not a hand-list of 8).
 *   - `scripts/check-org-scoped-fetch.mjs` — ratchet lint that blocks NEW
 *     storage methods from querying org-scoped tables without an
 *     organizationId predicate.
 */

import { and, eq, getTableColumns, getTableName, is, type SQL } from "drizzle-orm";
import { PgTable, type AnyPgColumn, type AnyPgTable } from "drizzle-orm/pg-core";
import * as schema from "@shared/schema";
import { db, type PrimaryDb } from "../db";
import { logger } from "./logger";
import { assertWritablePatch } from "./patch";

// ----------------------------------------------------------------------------
// Org-scoped table shape
// ----------------------------------------------------------------------------

/**
 * Structural constraint for tables this layer can scope: the table must
 * expose an `id` primary-key column and an `organizationId` tenant column.
 * Tables without both simply don't satisfy the type — passing them to any
 * `OrgScopedDb` helper is a compile-time error.
 */
export type OrgScopedTable = AnyPgTable & {
  readonly id: AnyPgColumn;
  readonly organizationId: AnyPgColumn;
};

/** Registry entry for one mechanically-discovered org-scoped table. */
export interface OrgScopedTableEntry {
  tableName: string;
  table: OrgScopedTable;
  idCol: AnyPgColumn;
  orgCol: AnyPgColumn;
}

// ----------------------------------------------------------------------------
// Mechanical registry — every org-scoped table in shared/schema.ts
// ----------------------------------------------------------------------------
//
// Instead of a hand-curated list (the old orgScope.ts TABLE_REGISTRY covered
// 8 tables), we walk the schema module once and register every pgTable that
// declares BOTH an `id` and an `organizationId` column. The registry is the
// shared source of truth for `assertEntityBelongsToOrg`-style guards and for
// coverage reporting.

let registryCache: Map<string, OrgScopedTableEntry> | null = null;

export function getOrgScopedTableRegistry(): Map<string, OrgScopedTableEntry> {
  if (registryCache) return registryCache;
  const registry = new Map<string, OrgScopedTableEntry>();
  for (const value of Object.values(schema)) {
    if (!is(value, PgTable)) continue;
    const columns = getTableColumns(value);
    const idCol = columns["id"];
    const orgCol = columns["organizationId"];
    if (!idCol || !orgCol) continue;
    const tableName = getTableName(value);
    registry.set(tableName, {
      tableName,
      table: value as unknown as OrgScopedTable,
      idCol: idCol as AnyPgColumn,
      orgCol: orgCol as AnyPgColumn,
    });
  }
  registryCache = registry;
  return registry;
}

/** Sorted list of every mechanically-covered org-scoped table name. */
export function listOrgScopedTableNames(): string[] {
  return [...getOrgScopedTableRegistry().keys()].sort();
}

/**
 * Defensive runtime backing for the `OrgScopedTable` compile-time
 * constraint — catches `as any` smuggling of a non-tenant table.
 */
function assertOrgScopedTable(table: AnyPgTable): void {
  const columns = getTableColumns(table);
  if (!columns["organizationId"]) {
    throw new Error(
      `[orgScopedDb] table "${getTableName(table)}" has no organizationId column — ` +
        `it cannot be queried through the org-scoped layer`,
    );
  }
}

// ----------------------------------------------------------------------------
// OrgScopedDb — the scoped repository
// ----------------------------------------------------------------------------

export class OrgScopedDb {
  /**
   * Private on purpose: `forOrg()` is the only construction path, so a value
   * of type `OrgScopedDb` is a proof-carrying token that an org context
   * exists. (Same brand philosophy as `RoleBrand` in shared/db/roles.ts.)
   */
  private constructor(readonly organizationId: number) {}

  static forOrg(organizationId: number): OrgScopedDb {
    if (!Number.isInteger(organizationId) || organizationId <= 0) {
      throw new Error(
        `[orgScopedDb] forOrg() requires a positive integer organizationId, got: ${String(organizationId)}`,
      );
    }
    return new OrgScopedDb(organizationId);
  }

  /**
   * The org predicate, composable with extra conditions. Every helper below
   * routes through this — the org pin cannot be omitted.
   */
  scope<T extends OrgScopedTable>(table: T, ...extra: (SQL | undefined)[]): SQL {
    assertOrgScopedTable(table);
    return and(eq(table.organizationId, this.organizationId), ...extra)!;
  }

  /** Fetch one row by primary key, pinned to this org. */
  async findById<T extends OrgScopedTable>(
    table: T,
    id: number | string,
  ): Promise<T["$inferSelect"] | undefined> {
    const rows = await db
      .select()
      .from(table as AnyPgTable)
      .where(this.scope(table, eq(table.id, id as never)))
      .limit(1);
    return rows[0] as T["$inferSelect"] | undefined;
  }

  /** True iff the row exists AND belongs to this org. */
  async existsById<T extends OrgScopedTable>(table: T, id: number | string): Promise<boolean> {
    const rows = await db
      .select({ id: table.id })
      .from(table as AnyPgTable)
      .where(this.scope(table, eq(table.id, id as never)))
      .limit(1);
    return rows.length > 0;
  }

  /** List rows for this org, with an optional extra predicate. */
  async listWhere<T extends OrgScopedTable>(
    table: T,
    extraWhere?: SQL,
  ): Promise<T["$inferSelect"][]> {
    const rows = await db
      .select()
      .from(table as AnyPgTable)
      .where(this.scope(table, extraWhere));
    return rows as T["$inferSelect"][];
  }

  /** Update one row by primary key, pinned to this org. Returns the updated row or undefined if out-of-org/missing. */
  async updateById<T extends OrgScopedTable>(
    table: T,
    id: number | string,
    set: Partial<T["$inferInsert"]>,
  ): Promise<T["$inferSelect"] | undefined> {
    const rows = await db
      .update(table as AnyPgTable)
      .set(assertWritablePatch(set, "orgScopedDb.updateById") as never)
      .where(this.scope(table, eq(table.id, id as never)))
      .returning();
    return rows[0] as T["$inferSelect"] | undefined;
  }

  /** Delete one row by primary key, pinned to this org. Returns true iff a row was deleted. */
  async deleteById<T extends OrgScopedTable>(table: T, id: number | string): Promise<boolean> {
    const rows = await db
      .delete(table as AnyPgTable)
      .where(this.scope(table, eq(table.id, id as never)))
      .returning({ id: table.id });
    return rows.length > 0;
  }
}

/**
 * The construction path. `forOrg(orgId)` returns a handle whose every query is
 * tenant-pinned by construction — a value of type `OrgScopedDb` is a
 * proof-carrying token that an org context exists.
 *
 * WHAT THIS IS NOT, as of 2026-09-06, because the previous version of this
 * comment said "the one true entry point… route handlers call
 * `forOrg(getOrganizationId(req))`" and that had not happened:
 *
 *   - No route handler calls it. All THIRTEEN production call sites, across
 *     eight files, are in `server/storage/*Repo.ts`.
 *   - All thirteen call `findById`. `scope`, `existsById`, `listWhere`,
 *     `updateById` and `deleteById` have ZERO production callers, so a change
 *     to the org predicate inside any of them reaches nothing.
 *
 * This layer is therefore a partly-adopted convenience, NOT the mechanism that
 * enforces tenancy. The enforcement is `scripts/check-org-scoped-fetch.mjs`,
 * which reads every query in the repo and requires each to name the
 * organization itself. Do not read a call through `forOrg` as the guarantee —
 * read the lint.
 *
 * The adoption gap is pinned by `tests/unit/orgScopedDbAdoption.test.ts`: the
 * unadopted list may only shrink, an adopted method may not lose its last
 * caller, and a new helper must declare which it is. When the migration this
 * comment used to describe actually happens, that test is what makes someone
 * come back and rewrite this paragraph.
 */
export function forOrg(organizationId: number): OrgScopedDb {
  return OrgScopedDb.forOrg(organizationId);
}

// ----------------------------------------------------------------------------
// Escape hatch — explicit, greppable, logged
// ----------------------------------------------------------------------------

/**
 * Raw cross-org database access for genuine platform operations (founder
 * surfaces, billing reconciliation, migrations, scheduled platform jobs).
 *
 * Requirements:
 *   - `reason` is mandatory and must be a real sentence (>= 12 chars) —
 *     it is logged on every call so the audit trail explains every bypass.
 *   - `git grep unscopedForPlatformOps` enumerates every tenancy bypass
 *     in the codebase.
 *
 * Never call this from a customer route handler — use `forOrg()` there.
 */
export function unscopedForPlatformOps(reason: string): PrimaryDb {
  if (typeof reason !== "string" || reason.trim().length < 12) {
    throw new Error(
      "[orgScopedDb] unscopedForPlatformOps requires a meaningful reason (>= 12 chars) explaining why cross-org access is needed",
    );
  }
  logger.info("[orgScopedDb] UNSCOPED platform-ops db access", { reason: reason.trim() });
  return db;
}
