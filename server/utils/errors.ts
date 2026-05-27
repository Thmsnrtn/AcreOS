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
 * Send a standardized error response.
 */
export function sendError(
  res: Response,
  statusCode: number,
  error: string,
  message: string,
  details?: unknown,
  docsUrl?: string,
): void {
  const body: ApiErrorResponse = {
    error,
    message,
    statusCode,
    ...(details !== undefined && { details }),
    ...(docsUrl !== undefined && { docsUrl }),
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
export const Errors = {
  notFound(res: Response, entity: string, opts?: ErrorOptions): void {
    sendError(res, 404, "NOT_FOUND", `${entity} not found`, undefined, buildDocsUrl(opts));
  },

  badRequest(res: Response, message: string, details?: unknown, opts?: ErrorOptions): void {
    sendError(res, 400, "BAD_REQUEST", message, details, buildDocsUrl(opts));
  },

  validationFailed(res: Response, details: unknown, opts?: ErrorOptions): void {
    sendError(res, 422, "VALIDATION_FAILED", "Validation failed", details, buildDocsUrl(opts));
  },

  unauthorized(res: Response, opts?: ErrorOptions): void {
    sendError(res, 401, "UNAUTHORIZED", "Authentication required", undefined, buildDocsUrl(opts));
  },

  forbidden(res: Response, message?: string, opts?: ErrorOptions): void {
    sendError(res, 403, "FORBIDDEN", message ?? "Insufficient permissions", undefined, buildDocsUrl(opts));
  },

  limitExceeded(res: Response, details: unknown, opts?: ErrorOptions): void {
    sendError(res, 429, "LIMIT_EXCEEDED", "Usage limit exceeded", details, buildDocsUrl(opts));
  },

  legalHoldActive(res: Response, message: string, details?: unknown, opts?: ErrorOptions): void {
    // 423 Locked — surface the FRCP 37(e) delete-block as a distinct status
    // so client UI can render a "this is under legal hold" panel rather than
    // a generic error. See server/services/legalHold.ts.
    sendError(res, 423, "LEGAL_HOLD_ACTIVE", message, details, buildDocsUrl(opts));
  },

  internal(res: Response, error: unknown, opts?: ErrorOptions): void {
    const message =
      process.env.NODE_ENV === "production"
        ? "Internal server error"
        : error instanceof Error
          ? error.message
          : "Internal server error";

    logger.error("Internal server error", error instanceof Error ? error : undefined);
    sendError(res, 500, "INTERNAL_ERROR", message, undefined, buildDocsUrl(opts));
  },
} as const;
