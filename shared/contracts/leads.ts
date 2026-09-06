// ============================================================================
// shared/contracts/leads.ts — API contract for the leads endpoints.
// ----------------------------------------------------------------------------
// T3-3E Phase 3 (API contract layer). The SINGLE source of truth for the
// request + response shape of POST /api/leads, validated BOTH ways:
//   - server handler parses req.body with `requestSchema`
//   - client call site parses the result with `responseSchema`
//
// ISOMORPHIC: this module is imported by BOTH the client bundle and the
// server. It must therefore contain NO server-only imports and NO Node
// builtins (check-boundaries.mjs enforces this). It composes the existing
// canonical zod from shared/schema.ts (`insertLeadSchema`) rather than
// re-declaring the lead field set.
// ============================================================================

import { z } from "zod";
// Client-safe: this contract reaches the browser through contracts/index.ts,
// so it composes the plain-zod lead schema rather than the drizzle-zod one.
// Same accept-set, pinned by clientFormSchemasMatchDrizzle.test.ts.
import { insertLeadSchema } from "../forms/lead";
import type { ApiContract } from "./index";

/**
 * Request body for POST /api/leads.
 *
 * Composes the canonical `insertLeadSchema` (which already omits id /
 * organizationId / timestamps / the generated phoneNormalized column and
 * tightens `email` to an email-or-null). The handler attaches
 * `organizationId` from the authenticated org, so the wire body must NOT
 * carry it — `insertLeadSchema` already omits it.
 *
 * `.passthrough()` is deliberate: the live handler accepts a handful of
 * transport-only extras the lead table never persists (latitude/longitude
 * for async enrichment, consentText / consentCheckboxChecked / pageUrl for
 * the TCPA evidence chain). Stripping them here would silently drop the
 * consent audit row, so we let them ride through and let the handler pick
 * what it needs.
 */
export const leadCreateRequestSchema = insertLeadSchema.passthrough();

/**
 * Response body for POST /api/leads (HTTP 201).
 *
 * The handler returns the freshly-created lead row. We assert the
 * load-bearing identity fields (`id`, `firstName`, `lastName`) and keep the
 * rest permissive via `.passthrough()` so an additive DB column never
 * 500s a live route (response validation is WARN-ONLY in prod — see the
 * handler). `email` / `phone` are nullable to mirror the columns.
 */
export const leadResponseSchema = z
  .object({
    id: z.number().int().positive(),
    organizationId: z.number().int().optional(),
    type: z.string().optional(),
    firstName: z.string(),
    lastName: z.string(),
    email: z.string().nullable().optional(),
    phone: z.string().nullable().optional(),
    status: z.string().optional(),
  })
  .passthrough();

export type LeadCreateRequest = z.infer<typeof leadCreateRequestSchema>;
export type LeadResponse = z.infer<typeof leadResponseSchema>;

/**
 * POST /api/leads — create a lead.
 */
export const createLeadContract: ApiContract<
  typeof leadCreateRequestSchema,
  typeof leadResponseSchema
> = {
  method: "POST",
  path: "/api/leads",
  requestSchema: leadCreateRequestSchema,
  responseSchema: leadResponseSchema,
};
