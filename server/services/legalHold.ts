/**
 * legalHold — FRCP 37(e) preservation chokepoint (Phase 3 Week 11).
 *
 * Single helper used by every retention sweep + every storage-layer delete
 * to determine whether a (org, resourceType, resourceId) tuple is currently
 * frozen against deletion by an active `legal_holds` row.
 *
 * Semantics:
 *   * `org_wide`           — every resource in the org is preserved.
 *   * `lead_specific`      — preserved iff resourceType='lead' AND resourceId ∈ scope_ids.
 *   * `property_specific`  — preserved iff resourceType='property' AND resourceId ∈ scope_ids.
 *   * `user_specific`      — preserved iff resourceType='user' AND resourceId ∈ scope_ids.
 *
 * A hold is active when status='active' AND released_at IS NULL.
 *
 * Performance: callers are on the delete hot-path. We keep the active-hold
 * query org-scoped and indexed (idx_legal_holds_org_active). Per-call cost is
 * one indexed lookup and an in-memory loop over (typically) zero rows.
 */

import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "../db";
import { legalHolds, type LegalHold, type LegalHoldResourceType } from "@shared/schema";
import { logger } from "../utils/logger";

export class LegalHoldViolationError extends Error {
  public readonly statusCode = 423; // 423 Locked
  public readonly code = "LEGAL_HOLD_ACTIVE";
  constructor(
    public readonly organizationId: number,
    public readonly resourceType: LegalHoldResourceType,
    public readonly resourceId: string | number,
    public readonly hold: Pick<LegalHold, "id" | "caseRef" | "scope">,
  ) {
    super(
      `Legal hold ${hold.caseRef} (${hold.id}) prevents deletion of ${resourceType}:${resourceId} for org ${organizationId}.`,
    );
    this.name = "LegalHoldViolationError";
  }
}

/**
 * Map a resource type to the scope value that targets it directly. Returns
 * null for resource types that can only be covered by an `org_wide` hold
 * (e.g. audit_log, communication, deal — these don't have their own scope).
 */
function scopeForResourceType(resourceType: LegalHoldResourceType): string | null {
  switch (resourceType) {
    case "lead":
      return "lead_specific";
    case "property":
      return "property_specific";
    case "user":
      return "user_specific";
    default:
      return null;
  }
}

/**
 * Fetch every active legal hold covering the given org. Cached per-call by
 * the calling code if needed; we don't cache here because retention sweeps
 * call once and storage deletes are infrequent enough that an indexed
 * Postgres lookup is the right cost model.
 */
export async function getActiveHoldsForOrg(orgId: number): Promise<LegalHold[]> {
  const rows = await db
    .select()
    .from(legalHolds)
    .where(and(eq(legalHolds.organizationId, orgId), eq(legalHolds.status, "active"), isNull(legalHolds.releasedAt)));
  return rows;
}

/**
 * Returns true if (orgId, resourceType, resourceId) is covered by any active
 * legal-hold row. Coverage logic:
 *   * any `org_wide` hold     — covers everything in the org.
 *   * matching scope-specific — covers if resourceId ∈ scope_ids.
 */
export async function isUnderLegalHold(
  orgId: number,
  resourceType: LegalHoldResourceType,
  resourceId: string | number,
): Promise<boolean> {
  const holds = await getActiveHoldsForOrg(orgId);
  if (holds.length === 0) return false;
  const targetScope = scopeForResourceType(resourceType);
  const idStr = String(resourceId);
  for (const h of holds) {
    if (h.scope === "org_wide") return true;
    if (targetScope && h.scope === targetScope && (h.scopeIds ?? []).includes(idStr)) {
      return true;
    }
  }
  return false;
}

/**
 * Throws `LegalHoldViolationError` if (orgId, resourceType, resourceId) is
 * covered by an active hold. Use this immediately before any `db.delete(...)`
 * that targets a covered resource type.
 *
 * Callers should NOT swallow this error — it should propagate up so the
 * route handler can return 423 Locked + a human-readable message naming the
 * caseRef. The calling route is also expected to audit-log the attempt.
 */
export async function assertNotUnderLegalHold(
  orgId: number,
  resourceType: LegalHoldResourceType,
  resourceId: string | number,
): Promise<void> {
  const holds = await getActiveHoldsForOrg(orgId);
  if (holds.length === 0) return;
  const targetScope = scopeForResourceType(resourceType);
  const idStr = String(resourceId);
  for (const h of holds) {
    if (h.scope === "org_wide") {
      throw new LegalHoldViolationError(orgId, resourceType, resourceId, {
        id: h.id,
        caseRef: h.caseRef,
        scope: h.scope,
      });
    }
    if (targetScope && h.scope === targetScope && (h.scopeIds ?? []).includes(idStr)) {
      throw new LegalHoldViolationError(orgId, resourceType, resourceId, {
        id: h.id,
        caseRef: h.caseRef,
        scope: h.scope,
      });
    }
  }
}

/**
 * Bulk variant — given a candidate id list, returns the subset NOT under
 * legal hold (i.e. safe to delete). The retention sweepers use this to
 * exclude held rows from a bulk delete in a single round-trip.
 */
export async function filterOutHeldIds<T extends string | number>(
  orgId: number,
  resourceType: LegalHoldResourceType,
  candidateIds: T[],
): Promise<T[]> {
  if (candidateIds.length === 0) return candidateIds;
  const holds = await getActiveHoldsForOrg(orgId);
  if (holds.length === 0) return candidateIds;

  // Any org_wide hold blocks the entire batch.
  if (holds.some((h) => h.scope === "org_wide")) {
    logger.info("[legalHold] org_wide hold suppressed bulk delete", {
      metadata: { orgId, resourceType, count: candidateIds.length },
    });
    return [];
  }

  const targetScope = scopeForResourceType(resourceType);
  if (!targetScope) return candidateIds; // nothing scope-specific applies; only org_wide does, already handled.

  const blocked = new Set<string>();
  for (const h of holds) {
    if (h.scope === targetScope) {
      for (const id of h.scopeIds ?? []) blocked.add(id);
    }
  }
  if (blocked.size === 0) return candidateIds;

  return candidateIds.filter((id) => !blocked.has(String(id)));
}

/**
 * Returns true if the org has ANY active legal hold (used by the site-wide
 * banner that surfaces hold status to operators).
 */
export async function orgHasActiveHold(orgId: number): Promise<boolean> {
  const [row] = await db
    .select({ id: legalHolds.id })
    .from(legalHolds)
    .where(and(eq(legalHolds.organizationId, orgId), eq(legalHolds.status, "active"), isNull(legalHolds.releasedAt)))
    .limit(1);
  return Boolean(row);
}

/**
 * Returns the most recent active hold for an org (used to populate the
 * banner with caseRef). Returns null if no active hold exists.
 */
export async function getActiveHoldSummary(
  orgId: number,
): Promise<Pick<LegalHold, "id" | "caseRef" | "scope" | "placedAt"> | null> {
  const [row] = await db
    .select({
      id: legalHolds.id,
      caseRef: legalHolds.caseRef,
      scope: legalHolds.scope,
      placedAt: legalHolds.placedAt,
    })
    .from(legalHolds)
    .where(and(eq(legalHolds.organizationId, orgId), eq(legalHolds.status, "active"), isNull(legalHolds.releasedAt)))
    .orderBy(sql`${legalHolds.placedAt} DESC`)
    .limit(1);
  return row ?? null;
}
