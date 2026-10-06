// ============================================================================
// shared/contracts/serverOwnedFields.ts — the fields a request never sets.
// ----------------------------------------------------------------------------
// A row's primary key, its tenant key, and its lifecycle timestamps are owned
// by the server: the database assigns `id` and the timestamps, and the handler
// attaches `organizationId` from the authenticated organization. A create or
// update body must never be the source of any of them.
//
// This is the ONE list. The lead create contract strips it on the client and
// the server alike (it is isomorphic), and `server/utils/updatePayload.ts`
// builds `omitServerOwnedFields` on it for handlers that compose a row from a
// request body. Keep this module free of imports: it reaches the browser
// through shared/contracts/leads.ts.
//
// Pinned by tests/unit/requestSchemasNeverCarryServerFields.test.ts, which
// probes every request schema a POST handler parses with these keys and
// fails if any of them survives into the parsed output.
// ============================================================================

/**
 * Columns the server owns on every row it writes from a request. Both the
 * camelCase field names and their snake_case column spellings are listed, so
 * a body written in either style is stripped the same way.
 */
const SERVER_OWNED_REQUEST_FIELDS = [
  "id",
  "organizationId",
  "organization_id",
  "createdAt",
  "created_at",
  "updatedAt",
  "updated_at",
  "deletedAt",
  "deleted_at",
  "deletedBy",
  "deleted_by",
] as const;

export type ServerOwnedRequestField = (typeof SERVER_OWNED_REQUEST_FIELDS)[number];

const SERVER_OWNED = new Set<string>(SERVER_OWNED_REQUEST_FIELDS);

/**
 * Shallow copy of `body` without any server-owned field (and without any of
 * `extra`, for a table with further server-owned columns of its own). A
 * non-object input yields an empty object.
 */
export function stripServerOwnedFields(
  body: unknown,
  extra: readonly string[] = [],
): Record<string, unknown> {
  if (body === null || typeof body !== "object" || Array.isArray(body)) return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
    if (SERVER_OWNED.has(key) || extra.includes(key)) continue;
    out[key] = value;
  }
  return out;
}
