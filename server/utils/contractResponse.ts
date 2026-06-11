// ============================================================================
// server/utils/contractResponse.ts — response-side contract validation.
// ----------------------------------------------------------------------------
// T3-3E Phase 3. Validates an outgoing response payload against its contract
// `responseSchema` BEFORE it is sent. The discipline mirrors the existing
// ratchets:
//   - dev/test (NODE_ENV !== "production"): THROW on mismatch so a drift
//     between the handler and the contract is caught at the point of change
//     (and by the unit tests / local run).
//   - prod: WARN-ONLY. Log the zod error with structured context and send
//     the payload anyway, so an unexpected-but-harmless field never 500s a
//     live customer route.
//
// This does NOT change the response SHAPE — it only inspects it. Handlers
// keep building and sending exactly the object they always did.
// ============================================================================

import type { z } from "zod";
import { logger } from "./logger";

/**
 * Validate `payload` against `schema` and return the (parsed) value.
 *
 * In dev/test a mismatch throws the ZodError. In prod a mismatch is logged
 * via `logger.warn` (with the contract path for triage) and the ORIGINAL
 * payload is returned unchanged — the response still goes out.
 *
 * @param schema   the contract's responseSchema
 * @param payload  the object the handler is about to `res.json(...)`
 * @param contractKey  human label for logs, e.g. "POST /api/leads"
 */
export function validateResponse<S extends z.ZodTypeAny>(
  schema: S,
  payload: unknown,
  contractKey: string,
): z.infer<S> {
  const result = schema.safeParse(payload);
  if (result.success) {
    return result.data;
  }

  // In production we never break a live response over a schema drift —
  // log it loudly for the next deploy to fix, then send the payload as-is.
  if (process.env.NODE_ENV === "production") {
    logger.warn("Contract response validation mismatch (sent anyway)", {
      contract: contractKey,
      issues: result.error.issues,
    });
    return payload as z.infer<S>;
  }

  // Dev/test: surface the drift immediately.
  throw result.error;
}
