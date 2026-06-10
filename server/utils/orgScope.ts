/**
 * Org-scope guards — Lens 48 (Behavioral IDOR Probe).
 *
 * The grep-findable cases (route loads `:id` and forgets `eq(table.org, orgId)`)
 * have been swept. What remains is the behavioral class:
 *
 *   1. A POST/PATCH accepts a foreign-key in the body (`propertyId`,
 *      `rehabId`, `dealId`, `contractorId`, `userId`, etc) and assumes
 *      same-org. Attacker writes a row in their own org pointing at the
 *      victim's resource → no read leak, but pollution / cross-tenant
 *      linkage that surfaces in joins later.
 *
 *   2. A child entity (`dispositionRecommendation`, `bid`, `payment`,
 *      `line-item`) is loaded via service layer that takes the child id
 *      raw without an `organizationId` parameter.
 *
 *   3. A `assignedTo` field is set from request body without verifying
 *      the target user belongs to the same org.
 *
 * `assertEntityBelongsToOrg` centralizes the canonical "does this id
 * exist in my tenant?" check so we don't sprinkle five-line SELECTs
 * everywhere. It's intentionally cheap — one indexed `id` lookup —
 * and intended to be called *before* the actual write that depends
 * on the FK being trustworthy.
 *
 * Tenants are integers; entity ids are usually serial integers but
 * a handful of newer tables (rehabs, bidEstimates, noteAcquisitions)
 * use UUID strings. The helper accepts either.
 */

import { and, eq, getTableName, is } from "drizzle-orm";
import { PgTable, type AnyPgColumn, type AnyPgTable } from "drizzle-orm/pg-core";
import { db } from "../db";
import {
  properties,
  rehabs,
  rehabLineItems,
  deals,
  leads,
  contractors,
  dispositionRecommendations,
  rentalLeases,
  teamMembers,
} from "@shared/schema";
import { getOrgScopedTableRegistry, type OrgScopedTable } from "./orgScopedDb";

/**
 * Friendly aliases for the tables that historically supported behavioral
 * IDOR checks (the original hand-curated 8). Kept for call-site
 * back-compat; coverage is no longer limited to this list — see
 * `getOrgScopedTableRegistry()` in orgScopedDb.ts, which mechanically
 * registers EVERY org-scoped table in shared/schema.ts (id +
 * organizationId columns). `assertEntityBelongsToOrg` now also accepts a
 * Drizzle table object or a raw table name for any of those.
 *
 * idempotent: true — these are pure reads; safe to retry.
 */
const TABLE_REGISTRY = {
  property: { table: properties, idCol: properties.id, orgCol: properties.organizationId },
  rehab: { table: rehabs, idCol: rehabs.id, orgCol: rehabs.organizationId },
  rehabLineItem: { table: rehabLineItems, idCol: rehabLineItems.id, orgCol: rehabLineItems.organizationId },
  deal: { table: deals, idCol: deals.id, orgCol: deals.organizationId },
  lead: { table: leads, idCol: leads.id, orgCol: leads.organizationId },
  contractor: { table: contractors, idCol: contractors.id, orgCol: contractors.organizationId },
  dispositionRecommendation: {
    table: dispositionRecommendations,
    idCol: dispositionRecommendations.id,
    orgCol: dispositionRecommendations.organizationId,
  },
  rentalLease: { table: rentalLeases, idCol: rentalLeases.id, orgCol: rentalLeases.organizationId },
} as const;

export type GuardableEntityType = keyof typeof TABLE_REGISTRY;

interface ResolvedGuardTarget {
  table: AnyPgTable;
  idCol: AnyPgColumn;
  orgCol: AnyPgColumn;
}

/**
 * Resolve a guard target from any of the accepted spellings:
 *   - legacy friendly alias ("deal", "lead", …) from TABLE_REGISTRY
 *   - raw Postgres table name ("inbox_messages", …) from the mechanical
 *     registry covering every org-scoped table in shared/schema.ts
 *   - a Drizzle table object (compile-time-safe; preferred for new code)
 */
function resolveGuardTarget(
  entityType: GuardableEntityType | string | OrgScopedTable,
): ResolvedGuardTarget | undefined {
  if (typeof entityType !== "string") {
    if (!is(entityType, PgTable)) return undefined;
    const entry = getOrgScopedTableRegistry().get(getTableName(entityType));
    return entry
      ? { table: entry.table as AnyPgTable, idCol: entry.idCol, orgCol: entry.orgCol }
      : undefined;
  }
  const legacy = TABLE_REGISTRY[entityType as GuardableEntityType];
  if (legacy) {
    return { table: legacy.table as AnyPgTable, idCol: legacy.idCol as AnyPgColumn, orgCol: legacy.orgCol as AnyPgColumn };
  }
  const entry = getOrgScopedTableRegistry().get(entityType);
  return entry
    ? { table: entry.table as AnyPgTable, idCol: entry.idCol, orgCol: entry.orgCol }
    : undefined;
}

/**
 * Returns true iff the entity with the given id exists AND belongs to
 * the supplied organization. Returns false on either:
 *   - row missing
 *   - row exists but belongs to a different tenant
 *
 * Callers should treat both outcomes the same (404 / "not found") to
 * avoid leaking existence of cross-tenant rows.
 *
 * Accepts a legacy alias, a raw table name, or (preferred) the Drizzle
 * table object itself — the latter two cover EVERY org-scoped table via
 * the mechanical registry, not just the original 8 aliases.
 *
 * idempotent: true
 */
export async function assertEntityBelongsToOrg(
  entityType: GuardableEntityType | string | OrgScopedTable,
  entityId: number | string,
  organizationId: number,
): Promise<boolean> {
  const def = resolveGuardTarget(entityType);
  if (!def) return false;
  const [row] = await db
    .select({ id: def.idCol })
    .from(def.table)
    .where(and(eq(def.idCol, entityId as any), eq(def.orgCol, organizationId)))
    .limit(1);
  return Boolean(row);
}

/**
 * Verify a userId is an active team member of the organization. Used
 * before accepting `assignedTo` / `createdBy` / `ownedBy` body fields
 * that would otherwise let a member assign a record to a user in a
 * different tenant.
 *
 * Null/undefined `userId` returns true so callers can pass the value
 * through without a null-guard at every call site.
 *
 * idempotent: true
 */
export async function assertUserIsOrgMember(
  userId: string | null | undefined,
  organizationId: number,
): Promise<boolean> {
  if (userId === null || userId === undefined || userId === "") return true;
  const [row] = await db
    .select({ id: teamMembers.id })
    .from(teamMembers)
    .where(
      and(
        eq(teamMembers.userId, String(userId)),
        eq(teamMembers.organizationId, organizationId),
        eq(teamMembers.isActive, true),
      ),
    )
    .limit(1);
  return Boolean(row);
}
