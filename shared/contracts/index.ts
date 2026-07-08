// ============================================================================
// shared/contracts/index.ts — the API contract layer (T3-3E Phase 3).
// ----------------------------------------------------------------------------
// A per-endpoint contract is a single zod-backed object that is the SINGLE
// source of truth for one endpoint's request + response shape, validated on
// BOTH sides of the wire:
//   - server: the route handler parses req.body with `requestSchema` and
//     validates the outgoing payload with `responseSchema`
//     (server/utils/contractResponse.ts: dev/test → throw, prod → warn).
//   - client: the call site parses the fetched result with `responseSchema`
//     (client/src/lib/contractFetch.ts).
//
// ADDITIVE: this layer starts with 2 endpoints (POST /api/leads,
// GET /api/properties) and is grown one route at a time. An UP-ratchet
// (scripts/check-contract-adoption.mjs) keeps the count of route files that
// import from @shared/contracts only increasing.
//
// ISOMORPHIC: imported by both client and server — no server-only imports,
// no Node builtins (enforced by scripts/check-boundaries.mjs). It composes
// the existing canonical zod in shared/schema.ts; it never re-declares a
// field set drizzle-zod already owns.
// ============================================================================

import type { z } from "zod";

/**
 * HTTP methods covered by a contract.
 */
export type ContractMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/**
 * A single endpoint contract.
 *
 * @typeParam Req  — the request-body zod schema, or `null` for endpoints
 *                   whose input is query/path params (validated by the
 *                   handler's own param schema, not by the body contract).
 * @typeParam Res  — the response-payload zod schema.
 */
export interface ApiContract<
  Req extends z.ZodTypeAny | null,
  Res extends z.ZodTypeAny,
> {
  method: ContractMethod;
  /** Canonical path (no host, no query string). */
  path: string;
  /** Request-body schema, or null when there is no validated body. */
  requestSchema: Req;
  /** Response-payload schema. */
  responseSchema: Res;
}

export {
  createLeadContract,
  leadCreateRequestSchema,
  leadResponseSchema,
  type LeadCreateRequest,
  type LeadResponse,
} from "./leads";

export {
  listPropertiesContract,
  propertyItemSchema,
  propertyListResponseSchema,
  type PropertyItem,
  type PropertyListResponse,
} from "./properties";

import { createLeadContract } from "./leads";
import { listPropertiesContract } from "./properties";

/**
 * Registry of every adopted contract, keyed by `"<METHOD> <path>"`. Grows
 * as adoption increases; the OpenAPI export (server/routes-api-contract.ts)
 * and the adoption ratchet both read against the same source.
 */
export const API_CONTRACTS = {
  "POST /api/leads": createLeadContract,
  "GET /api/properties": listPropertiesContract,
} as const;
