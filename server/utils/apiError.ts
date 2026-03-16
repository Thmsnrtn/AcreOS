export interface ApiError {
  code: string;
  message: string;
  retryable: boolean;
  details?: unknown;
  requestId?: string;
}

export function apiError(
  res: import("express").Response,
  status: number,
  code: string,
  message: string,
  opts?: { retryable?: boolean; details?: unknown }
): void {
  const body: ApiError = {
    code,
    message,
    retryable: opts?.retryable ?? (status >= 500),
    ...(opts?.details !== undefined && { details: opts.details }),
    requestId: (res.req as any)?.correlationId,
  };
  res.status(status).json(body);
}

export function notFound(res: import("express").Response, resource = "Resource"): void {
  apiError(res, 404, "NOT_FOUND", `${resource} not found`, { retryable: false });
}

export function unauthorized(res: import("express").Response): void {
  apiError(res, 401, "UNAUTHORIZED", "Authentication required", { retryable: false });
}

export function forbidden(res: import("express").Response): void {
  apiError(res, 403, "FORBIDDEN", "Insufficient permissions", { retryable: false });
}

export function internalError(res: import("express").Response, error: unknown, requestId?: string): void {
  const message = process.env.NODE_ENV === "production"
    ? "Internal server error"
    : (error instanceof Error ? error.message : "Internal server error");
  // Import lazily to avoid circular dep (apiError.ts ← logger ← sentry ← apiError)
  import("./logger").then(({ logger }) => {
    logger.error(`API Error ${requestId || ""}`, error instanceof Error ? error : undefined);
  }).catch(() => console.error(`[API Error] ${requestId || ""}:`, error));
  apiError(res, 500, "INTERNAL_ERROR", message, { retryable: true });
}

export function validationError(res: import("express").Response, details: unknown): void {
  apiError(res, 422, "VALIDATION_ERROR", "Validation failed", { retryable: false, details });
}
