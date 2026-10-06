/**
 * The ONE route-side mapper for the deal repository's typed refusals
 * (W10.4 contract item 6). Every route that writes a deal's status or creates
 * a deal hands its catch to this before falling back to Errors.internal, so a
 * refusal the repository decided is answered the same way on every surface:
 *
 *  - StaleDealWriteError       → 409 CONFLICT (the deal moved under the write;
 *                                nothing was written — reload and retry)
 *  - DealTransitionRefusedError → 400 with the state machine's refusal
 *  - DealCreationRefusedError   → 400 naming the allowed creation statuses
 *
 * Returns true when it answered, false for anything else (the caller then
 * answers Errors.internal). Detects the classes by `instanceof` — the classes
 * live in storage/dealRepo.ts, which never imports from routes.
 */
import type { Response } from "express";
import { Errors } from "./errors";
import {
  DealCreationRefusedError,
  DealTransitionRefusedError,
  StaleDealWriteError,
} from "../storage/dealRepo";

export function sendDealWriteError(res: Response, err: unknown): boolean {
  if (err instanceof StaleDealWriteError) {
    Errors.conflict(
      res,
      "This deal was changed by someone else while you were saving. Reload it to see the current stage, then try again.",
      { dealId: err.dealId, expectedStatus: err.expectedStatus },
    );
    return true;
  }
  if (err instanceof DealTransitionRefusedError) {
    Errors.badRequest(res, err.refusal, { dealId: err.dealId });
    return true;
  }
  if (err instanceof DealCreationRefusedError) {
    Errors.badRequest(
      res,
      `A deal can't be created at "${err.status}". Allowed statuses: ${err.allowed.join(", ")}.`,
      { status: err.status, allowedStatuses: [...err.allowed] },
    );
    return true;
  }
  return false;
}

/**
 * The per-item twin of sendDealWriteError, for a batch route that answers 207
 * with one outcome per deal (the bulk-stage undo): the same three refusals,
 * named by the same codes the envelope carries, without sending a response.
 * null for anything else — the caller reports that one as an unknown failure.
 */
export function dealWriteErrorCode(err: unknown): "CONFLICT" | "TRANSITION_REFUSED" | "CREATION_REFUSED" | null {
  if (err instanceof StaleDealWriteError) return "CONFLICT";
  if (err instanceof DealTransitionRefusedError) return "TRANSITION_REFUSED";
  if (err instanceof DealCreationRefusedError) return "CREATION_REFUSED";
  return null;
}
