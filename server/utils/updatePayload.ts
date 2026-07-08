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
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
    if (!PROTECTED_FIELDS.has(key)) out[key] = value;
  }
  return out as Partial<T>;
}
