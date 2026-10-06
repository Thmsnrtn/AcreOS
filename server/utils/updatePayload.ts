/**
 * Update-payload hygiene (2026-07 security sweep).
 *
 * The tenant-isolation audit found ~25 PATCH/PUT handlers piping raw
 * `req.body` into storage.update* calls. Reads are org-scoped by ownership
 * pre-checks, but the WRITE payload was unfiltered — so a request body
 * could reassign `organizationId` (moving a row into another tenant),
 * rewrite `id`, or forge audit columns (`createdBy`, `createdAt`).
 *
 * `omitProtectedFields` is the minimum seam every raw-body update site must
 * pass through. Where a zod insert schema exists, prefer
 * `schema.partial().parse(...)` — this helper is the floor, not the goal.
 */

import {
  isCopyableBodyKey,
  stripServerOwnedFields,
  type ServerOwnedRequestField,
} from "@shared/contracts/serverOwnedFields";

const PROTECTED_FIELDS = new Set([
  "id",
  "organizationId",
  "organization_id",
  "createdAt",
  "created_at",
  "createdBy",
  "created_by",
  "updatedAt",
  "updated_at",
]);

/**
 * Shallow-copy `body` minus identity/tenancy/audit columns. Non-object
 * inputs return an empty object (an update payload must be an object).
 */
export function omitProtectedFields<T extends Record<string, unknown>>(
  body: unknown,
): Partial<T> {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return {};
  }
  // fromEntries defines own data properties; it never assigns through a setter.
  return Object.fromEntries(
    Object.entries(body as Record<string, unknown>).filter(
      ([key]) => isCopyableBodyKey(key) && !PROTECTED_FIELDS.has(key),
    ),
  ) as Partial<T>;
}

/**
 * Create-payload hygiene. A handler that composes a row from a request body
 * (`{ ...body, organizationId: org.id }`) must not let the body supply the
 * row's primary key, tenant key, lifecycle timestamps or soft-delete fields:
 * server-owned fields are set by the server, never the request. This strips
 * the canonical list in `shared/contracts/serverOwnedFields.ts` — the same
 * list the lead create contract strips. (`omitProtectedFields` above is the
 * older, narrower list — it does not strip the soft-delete fields — and is
 * still used by update paths that predate this one.)
 *
 * Pinned by tests/unit/requestSchemasNeverCarryServerFields.test.ts, which
 * fails any write handler that spreads the raw body anywhere but a schema
 * parse.
 */
export function omitServerOwnedFields<T>(body: T): WithoutServerOwned<T> {
  return stripServerOwnedFields(body) as WithoutServerOwned<T>;
}

/** `any` stays `any` (an Express body); a typed object loses the server-owned keys. */
export type WithoutServerOwned<T> = 0 extends 1 & T
  ? any
  : T extends object
    ? Omit<T, ServerOwnedRequestField>
    : Record<string, never>;
