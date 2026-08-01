import type { Response } from "express";
import { logger } from "./logger";

/**
 * Standardized API error response shape.
 * All error responses from the API conform to this interface.
 */
export interface ApiErrorResponse {
  error: string;
  message: string;
  details?: unknown;
  statusCode: number;
  /**
   * Optional deep-link to the matching knowledge-base article. When set,
   * the client toast handler renders a "Learn why" link. Sourced from the
   * `docsSlug` option on each `Errors.*` helper.
   */
  docsUrl?: string;
  /**
   * Correlation / request ID surfaced on 5xx so users can paste it into
   * support. Pulled from `req.correlationId` (set by correlationIdMiddleware)
   * or the `X-Request-ID` response header.
   */
  requestId?: string;
}

/**
 * Optional per-call extras supported by every `Errors.*` helper. Right
 * now this is just `docsSlug` (rendered as `docsUrl: /help/article/<slug>`
 * on the response), but it's structured as an options bag so we can add
 * `traceId`, `retryAfter`, etc. without breaking 2,900 existing call sites.
 */
export interface ErrorOptions {
  /**
   * Slug of the knowledge-base article that explains this error. The
   * server resolves it to `docsUrl: /help/article/<slug>` so the client
   * doesn't need to know the route shape.
   */
  docsSlug?: string;
}

function buildDocsUrl(opts?: ErrorOptions): string | undefined {
  if (!opts?.docsSlug) return undefined;
  return `/help/article/${opts.docsSlug}`;
}

/**
 * Pull the per-request correlation ID off the response. Prefers the value
 * set by `correlationIdMiddleware` on `req.correlationId`; falls back to
 * the `X-Request-ID` response header (set by the same middleware) so this
 * works even on code paths that bypass the typed Express augmentation.
 *
 * `getHeader` is probed rather than assumed. This runs INSIDE the error
 * responder, so a `res` that isn't a full Express response (a minimal handler
 * double, a stream already torn down) would otherwise turn a clean 500 body
 * into a TypeError thrown from the very code whose job is reporting the
 * failure. Absent correlation id → the field is simply omitted; it is never
 * invented.
 */
function resolveRequestId(res: Response): string | undefined {
  const req = res.req as (Response["req"] & { correlationId?: string }) | undefined;
  if (req?.correlationId) return req.correlationId;
  if (typeof res.getHeader !== "function") return undefined;
  const header = res.getHeader("X-Request-ID");
  if (typeof header === "string") return header;
  if (Array.isArray(header) && typeof header[0] === "string") return header[0];
  return undefined;
}

/**
 * Send a standardized error response.
 */
export function sendError(
  res: Response,
  statusCode: number,
  error: string,
  message: string,
  details?: unknown,
  docsUrl?: string,
  includeRequestId = false,
): void {
  const body: ApiErrorResponse = {
    error,
    message,
    statusCode,
    ...(details !== undefined && { details }),
    ...(docsUrl !== undefined && { docsUrl }),
    ...(includeRequestId && (() => {
      const rid = resolveRequestId(res);
      return rid ? { requestId: rid } : {};
    })()),
  };
  res.status(statusCode).json(body);
}

/**
 * Standardized error helpers — use `Errors.notFound(res, "Lead")` etc.
 * in route handlers instead of raw `res.status(X).json(...)`.
 *
 * Every helper accepts an optional final `opts: { docsSlug }` arg. When
 * set, the response body includes `docsUrl: /help/article/<slug>` so the
 * client can render a "Learn why" link in the failure toast.
 */
/**
 * Voice pattern: every default copy line uses AcreOS's client-toast
 * voice — "Couldn't X — what's still true / what to try". Mirrors the
 * tone the front-end toast handler uses so users get one coherent
 * experience whether the failure surfaces in the UI or in a raw API
 * response. Status codes are unchanged; only the human-readable
 * `message` is rewritten.
 */
export const Errors = {
  notFound(res: Response, entity: string, opts?: ErrorOptions): void {
    const message = `We couldn't find that ${entity} — it may have been deleted, archived, or moved between organizations.`;
    sendError(res, 404, "NOT_FOUND", message, undefined, buildDocsUrl(opts) ?? "/help/article/not-found");
  },

  badRequest(res: Response, message?: string, details?: unknown, opts?: ErrorOptions): void {
    const finalMessage =
      message && message.length > 0
        ? message
        : "We couldn't process that request — the input didn't match what we expected.";
    sendError(res, 400, "BAD_REQUEST", finalMessage, details, buildDocsUrl(opts));
  },

  validationFailed(res: Response, details: unknown, opts?: ErrorOptions): void {
    sendError(
      res,
      422,
      "VALIDATION_FAILED",
      "Some fields need a fix:",
      details,
      buildDocsUrl(opts) ?? "/help/article/validation",
    );
  },

  unauthorized(res: Response, opts?: ErrorOptions): void {
    sendError(
      res,
      401,
      "UNAUTHORIZED",
      "Your session is no longer valid. Sign in again to pick up where you left off.",
      undefined,
      buildDocsUrl(opts) ?? "/help/article/session-expired",
    );
  },

  forbidden(res: Response, message?: string, opts?: ErrorOptions): void {
    const finalMessage =
      message && message.length > 0
        ? message
        : "Your role doesn't include this action. An organization owner can update permissions in Settings → Team.";
    sendError(res, 403, "FORBIDDEN", finalMessage, undefined, buildDocsUrl(opts) ?? "/help/article/permissions");
  },

  /**
   * 410 — the resource existed once and was deliberately removed. Used by
   * stubs left behind when a subsystem is deleted (deletion-ledger execution
   * rule: ungated webhooks get a permanent-failure signal, not a 404 that
   * reads as a routing bug to the external caller).
   */
  gone(res: Response, message: string, opts?: ErrorOptions): void {
    sendError(res, 410, "GONE", message, undefined, buildDocsUrl(opts));
  },

  limitExceeded(res: Response, details: unknown, opts?: ErrorOptions): void {
    sendError(
      res,
      429,
      "LIMIT_EXCEEDED",
      "You're sending requests faster than the system can handle. Wait a few seconds and try again.",
      details,
      buildDocsUrl(opts) ?? "/help/article/rate-limit",
    );
  },

  /**
   * 402 — the account can read everything but must resolve a billing state
   * (dunning read-only window, paused subscription) before mutating.
   */
  paymentRequired(res: Response, message: string, details?: unknown, opts?: ErrorOptions): void {
    sendError(res, 402, "PAYMENT_REQUIRED", message, details, buildDocsUrl(opts) ?? "/help/article/billing");
  },

  legalHoldActive(res: Response, message: string, details?: unknown, opts?: ErrorOptions): void {
    // 423 Locked — surface the FRCP 37(e) delete-block as a distinct status
    // so client UI can render a "this is under legal hold" panel rather than
    // a generic error. See server/services/legalHold.ts.
    sendError(res, 423, "LEGAL_HOLD_ACTIVE", message, details, buildDocsUrl(opts));
  },

  serviceUnavailable(res: Response, message?: string, opts?: ErrorOptions): void {
    // 503 — a dependency the request needs isn't configured/reachable right now
    // (e.g. no AI provider key set). Distinct from 500 so the client can render a
    // "temporarily unavailable, try later" state and retries are sane, rather than
    // treating it as a bug on our end.
    const finalMessage =
      message && message.length > 0
        ? message
        : "This feature is temporarily unavailable. Please try again in a few minutes.";
    sendError(res, 503, "SERVICE_UNAVAILABLE", finalMessage, undefined, buildDocsUrl(opts));
  },

  badGateway(res: Response, message?: string, opts?: ErrorOptions): void {
    // 502 — an upstream dependency we proxy returned an unusable response
    // (e.g. the Clerk reverse proxy). Distinct from 500 (our bug) and 503
    // (we're up but a dependency is unconfigured); the client should treat it
    // as a transient upstream problem and retry.
    const finalMessage =
      message && message.length > 0
        ? message
        : "An upstream service returned an unexpected response. Please try again in a moment.";
    sendError(res, 502, "BAD_GATEWAY", finalMessage, undefined, buildDocsUrl(opts));
  },

  gatewayTimeout(res: Response, message?: string, opts?: ErrorOptions): void {
    // 504 — an upstream dependency we proxy didn't respond in time (the Clerk
    // upstream timeout guard). Retry-safe by nature.
    const finalMessage =
      message && message.length > 0
        ? message
        : "An upstream service took too long to respond. Please try again in a moment.";
    sendError(res, 504, "GATEWAY_TIMEOUT", finalMessage, undefined, buildDocsUrl(opts));
  },

  internal(res: Response, error: unknown, opts?: ErrorOptions): void {
    // A missing AI provider is a config/operational state, not a code bug — every
    // route that funnels its AI failure through internal() should surface a 503,
    // not a 500. Detect the typed error by shape (no import of aiRouter — that
    // would invert the layering) and delegate. See aiRouter.NoAIProviderError.
    if (
      error instanceof Error &&
      ((error as { code?: string }).code === "NO_AI_PROVIDER" || error.name === "NoAIProviderError")
    ) {
      this.serviceUnavailable(
        res,
        "AI features are temporarily unavailable. Our team has been notified — please try again shortly.",
        opts,
      );
      return;
    }
    // In production we never leak the raw error to the client — it goes
    // to the logger so SRE can correlate via the request ID we surface
    // alongside the message. In dev we keep the underlying message so
    // local debugging stays painless.
    // No external links here: the copy previously pointed at
    // status.acreos.io, which was never stood up — a dead link inside an
    // error message reads as a second failure. Plain, honest, retryable.
    const prodMessage =
      "Something broke on our end. It's been logged automatically — please try again in a moment.";
    const message =
      process.env.NODE_ENV === "production"
        ? prodMessage
        : error instanceof Error
          ? error.message
          : prodMessage;

    logger.error("Internal server error", error instanceof Error ? error : undefined);
    sendError(
      res,
      500,
      "INTERNAL_ERROR",
      message,
      undefined,
      buildDocsUrl(opts) ?? "/help/article/internal-error",
      true,
    );
  },
} as const;
