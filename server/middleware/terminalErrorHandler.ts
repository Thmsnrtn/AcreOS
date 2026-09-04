/**
 * The last error handler in the stack — and, before this file existed, the one
 * place in the product that did not honour the error contract.
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────────
 * CLAUDE.md and server/utils/errors.ts define every API error as
 * `{ error, message, statusCode, details?, docsUrl?, requestId? }`, and
 * errors.ts goes to real trouble to stamp `requestId` from the correlation-id
 * middleware onto 5xx responses so a customer can paste it into support.
 *
 * The terminal handler in server/index.ts emitted `res.status(status).json({
 * message })`. No `error` code, no `statusCode`, no `requestId`, and in
 * production the message flattened to "Internal Server Error". So the one case
 * where a correlation id matters most — an unhandled throw out of any of ~1,725
 * handlers — was the one case that had none, and the client could not tell it
 * apart from a handled 500 (2026-09-04 review, CONFIRMED).
 *
 * ── WHY A MODULE AND NOT FIVE LINES IN index.ts ─────────────────────────────
 * The handler was previously an inline closure inside an async bootstrap
 * function, which is why nothing had ever tested it: there was no way to call
 * it. Extracting it is what makes the contract assertable, and the contract is
 * the whole point.
 */

import type { NextFunction, Request, Response } from "express";
import { Errors, httpErrorCode, sendError } from "../utils/errors";

/** In production a 5xx message is never the raw error; a 4xx safely can be. */
function devOnlyMessage(err: unknown): string | undefined {
  if (process.env.NODE_ENV === "production") return undefined;
  return err instanceof Error ? err.message : undefined;
}

export function terminalErrorHandler(
  err: any,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  // Nothing to say once the response is on the wire.
  if (res.headersSent) return;

  // Pillar D / D3 — legal-hold violations surface as 423 Locked with the
  // case_ref so the client can render an actionable "this row is under legal
  // hold" panel rather than a generic error. Through the helper now, so it
  // also carries the contract's shape rather than a hand-built lookalike.
  if (err?.name === "LegalHoldViolationError") {
    Errors.legalHoldActive(res, err.message || "Resource is under an active legal hold", {
      holdId: err.hold?.id,
      caseRef: err.hold?.caseRef,
      scope: err.hold?.scope,
      resourceType: err.resourceType,
      resourceId: err.resourceId,
    });
    return;
  }

  const parsed = Number(err?.status ?? err?.statusCode);
  const status = Number.isInteger(parsed) && parsed >= 400 && parsed <= 599 ? parsed : 500;

  // 5xx goes through the same producers a handled failure uses, so an uncaught
  // throw and a deliberate `Errors.internal(...)` are indistinguishable to the
  // client — same code, same shape, same request id, same logging.
  if (status >= 500) {
    switch (status) {
      case 502:
        sendError(res, 502, "BAD_GATEWAY", devOnlyMessage(err) ?? upstreamMessage, undefined, undefined, true);
        return;
      case 503:
        sendError(res, 503, "SERVICE_UNAVAILABLE", devOnlyMessage(err) ?? unavailableMessage, undefined, undefined, true);
        return;
      case 504:
        sendError(res, 504, "GATEWAY_TIMEOUT", devOnlyMessage(err) ?? timeoutMessage, undefined, undefined, true);
        return;
      default:
        // Errors.internal logs, stamps the request id, and downgrades a
        // missing AI provider to 503 rather than reporting a bug on our end.
        Errors.internal(res, err);
        return;
    }
  }

  // 4xx is the caller's own request coming back to them, so the message is
  // safe to pass through in any environment — which is what the old handler
  // did too. What it lacked was the code and the status in the body.
  const message =
    (typeof err?.message === "string" && err.message.length > 0 && err.message) ||
    "Request could not be completed.";
  const code = typeof err?.code === "string" && err.code.length > 0 ? err.code : httpErrorCode(status);
  sendError(res, status, code, message, undefined, undefined, true);
}

// Copy kept beside the statuses it belongs to. Deliberately plain and
// retryable, and with no external links: the 5xx copy in errors.ts once
// pointed at status.acreos.io, which was never stood up, and a dead link
// inside an error message reads as a second failure.
const upstreamMessage = "An upstream service returned an error. Please try again in a moment.";
const unavailableMessage =
  "This feature is temporarily unavailable. Please try again in a few minutes.";
const timeoutMessage = "That took too long upstream and was stopped. Please try again.";
