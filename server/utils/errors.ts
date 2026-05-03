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
}

/**
 * Send a standardized error response.
 */
export function sendError(
  res: Response,
  statusCode: number,
  error: string,
  message: string,
  details?: unknown
): void {
  const body: ApiErrorResponse = {
    error,
    message,
    statusCode,
    ...(details !== undefined && { details }),
  };
  res.status(statusCode).json(body);
}

/**
 * Standardized error helpers — use `Errors.notFound(res, "Lead")` etc.
 * in route handlers instead of raw `res.status(X).json(...)`.
 */
export const Errors = {
  notFound(res: Response, entity: string): void {
    sendError(res, 404, "NOT_FOUND", `${entity} not found`);
  },

  badRequest(res: Response, message: string, details?: unknown): void {
    sendError(res, 400, "BAD_REQUEST", message, details);
  },

  validationFailed(res: Response, details: unknown): void {
    sendError(res, 422, "VALIDATION_FAILED", "Validation failed", details);
  },

  unauthorized(res: Response): void {
    sendError(res, 401, "UNAUTHORIZED", "Authentication required");
  },

  forbidden(res: Response, message?: string): void {
    sendError(res, 403, "FORBIDDEN", message ?? "Insufficient permissions");
  },

  limitExceeded(res: Response, details: unknown): void {
    sendError(res, 429, "LIMIT_EXCEEDED", "Usage limit exceeded", details);
  },

  legalHoldActive(res: Response, message: string, details?: unknown): void {
    // 423 Locked — surface the FRCP 37(e) delete-block as a distinct status
    // so client UI can render a "this is under legal hold" panel rather than
    // a generic error. See server/services/legalHold.ts.
    sendError(res, 423, "LEGAL_HOLD_ACTIVE", message, details);
  },

  internal(res: Response, error: unknown): void {
    const message =
      process.env.NODE_ENV === "production"
        ? "Internal server error"
        : error instanceof Error
          ? error.message
          : "Internal server error";

    logger.error("Internal server error", error instanceof Error ? error : undefined);
    sendError(res, 500, "INTERNAL_ERROR", message);
  },
} as const;
