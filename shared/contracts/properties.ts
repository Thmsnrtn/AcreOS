// ============================================================================
// shared/contracts/properties.ts — API contract for the properties endpoints.
// ----------------------------------------------------------------------------
// T3-3E Phase 3 (API contract layer). SINGLE source of truth for the
// response shape of GET /api/properties (the paginated list envelope),
// validated BOTH ways. ISOMORPHIC — no server imports, no Node builtins.
// ============================================================================

import { z } from "zod";
import type { ApiContract } from "./index";

/**
 * A single property item in the GET /api/properties list.
 *
 * Permissive by construction (`.passthrough()`): the row carries ~40 DB
 * columns (financials, jsonb parcel data, enrichment) that evolve over
 * time. We assert only the load-bearing identity fields so an additive
 * column never breaks the response (validation is WARN-ONLY in prod).
 */
export const propertyItemSchema = z
  .object({
    id: z.number().int().positive(),
    organizationId: z.number().int().optional(),
    apn: z.string(),
    county: z.string(),
    state: z.string(),
    sizeAcres: z.union([z.string(), z.number()]).nullable().optional(),
    status: z.string().optional(),
  })
  .passthrough();

/**
 * Response body for GET /api/properties — the canonical paginated envelope
 * (`{ data, total, page, pageSize, totalPages }`) emitted by
 * `storage.getPropertiesPaginated`. Every list endpoint in AcreOS returns
 * this shape; codifying it here makes the contract reusable for the other
 * list routes as adoption grows.
 */
export const propertyListResponseSchema = z.object({
  data: z.array(propertyItemSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  totalPages: z.number().int().nonnegative(),
});

export type PropertyItem = z.infer<typeof propertyItemSchema>;
export type PropertyListResponse = z.infer<typeof propertyListResponseSchema>;

/**
 * GET /api/properties — list properties (paginated).
 *
 * Request body is null (query-param pagination is validated by the
 * handler's existing `paginationQuerySchema`); the contract codifies the
 * RESPONSE envelope.
 */
export const listPropertiesContract: ApiContract<
  null,
  typeof propertyListResponseSchema
> = {
  method: "GET",
  path: "/api/properties",
  requestSchema: null,
  responseSchema: propertyListResponseSchema,
};
