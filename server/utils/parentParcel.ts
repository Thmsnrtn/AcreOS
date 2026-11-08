/**
 * A property row may name another property as its parent parcel
 * (`properties.parent_parcel_id`). The parent must be a parcel of the same
 * organization as the row being written. Every property writer that accepts a
 * payload runs this check (server/storage/propertyRepo.ts), so the rule holds
 * for routes, workflows and any later writer that goes through the repository.
 *
 * A reference that does not resolve inside the organization is refused with
 * one error, whatever the reason, so the response is the same for every id
 * outside the organization.
 */
import { and, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "../db";
import { properties } from "@shared/schema";

export class ParentParcelNotFoundError extends Error {
  constructor() {
    super("The parent parcel was not found in this organization.");
    this.name = "ParentParcelNotFoundError";
  }
}

/**
 * Resolves a supplied parent reference inside `organizationId`. Absent or
 * null is fine (no parent); anything else must be the id of a parcel in that
 * organization or the write is refused.
 */
/** The supplied parent id, `null` when none is supplied; throws when it cannot be an id. */
function suppliedParentId(payload: { parentParcelId?: unknown } | null | undefined): number | null {
  if (!payload || !("parentParcelId" in payload)) return null;
  const value = payload.parentParcelId;
  if (value === undefined || value === null) return null;
  const parentId = typeof value === "number" ? value : typeof value === "string" && /^\d+$/.test(value.trim()) ? Number(value.trim()) : NaN;
  if (!Number.isSafeInteger(parentId) || parentId <= 0 || parentId > 2147483647) throw new ParentParcelNotFoundError();
  return parentId;
}

/**
 * For an update that names no organization: the supplied parent must be in
 * the same organization as the row being updated.
 */
export async function assertParentParcelSharesOrganization(
  payload: { parentParcelId?: unknown } | null | undefined,
  propertyId: number,
): Promise<void> {
  const parentId = suppliedParentId(payload);
  if (parentId === null) return;
  const parent = alias(properties, "parent_parcel");
  const [row] = await db
    .select({ id: parent.id })
    .from(parent)
    .innerJoin(properties, eq(properties.organizationId, parent.organizationId))
    .where(and(eq(parent.id, parentId), eq(properties.id, propertyId)))
    .limit(1);
  if (!row) throw new ParentParcelNotFoundError();
}

export async function assertParentParcelInOrganization(
  payload: { parentParcelId?: unknown } | null | undefined,
  organizationId: number | null | undefined,
): Promise<void> {
  const parentId = suppliedParentId(payload);
  if (parentId === null) return;
  if (typeof organizationId !== "number" || !Number.isFinite(organizationId)) throw new ParentParcelNotFoundError();
  const [row] = await db
    .select({ id: properties.id })
    .from(properties)
    .where(and(eq(properties.id, parentId), eq(properties.organizationId, organizationId)))
    .limit(1);
  if (!row) throw new ParentParcelNotFoundError();
}
