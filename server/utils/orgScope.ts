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

import { and, eq } from "drizzle-orm";
import type { AnyPgColumn, AnyPgTable } from "drizzle-orm/pg-core";
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

/**
 * Tables that we currently support behavioral IDOR checks against.
 * Add to this map when a new child-table FK starts showing up in
 * route handler bodies.
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

/**
 * Returns true iff the entity with the given id exists AND belongs to
 * the supplied organization. Returns false on either:
 *   - row missing
 *   - row exists but belongs to a different tenant
 *
 * Callers should treat both outcomes the same (404 / "not found") to
 * avoid leaking existence of cross-tenant rows.
 *
 * idempotent: true
 */
export async function assertEntityBelongsToOrg(
  entityType: GuardableEntityType,
  entityId: number | string,
  organizationId: number,
): Promise<boolean> {
  const def = TABLE_REGISTRY[entityType];
  if (!def) return false;
  const [row] = await db
    .select({ id: def.idCol })
    .from(def.table as AnyPgTable)
    .where(and(eq(def.idCol as AnyPgColumn, entityId as any), eq(def.orgCol as AnyPgColumn, organizationId)))
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
