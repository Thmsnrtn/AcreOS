import * as Sentry from "@sentry/node";

let initialized = false;

/**
 * Initialize Sentry once at server startup.
 * No-op when SENTRY_DSN is not set (local dev / test environments).
 */
export function initSentry(): void {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;
  if (initialized) return;

  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? "development",
    // Capture 10% of transactions for performance profiling in production;
    // override with SENTRY_TRACES_SAMPLE_RATE env var.
    tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE ?? "0.1"),
    // Never send sensitive auth / session data to Sentry
    beforeSend(event) {
      // Strip cookie and authorization headers
      if (event.request?.headers) {
        delete event.request.headers["cookie"];
        delete event.request.headers["authorization"];
        delete event.request.headers["x-csrf-token"];
      }
      return event;
    },
  });

  initialized = true;
}

/**
 * Capture an exception manually (e.g. inside try/catch blocks
 * where you still want to re-throw or handle the error yourself).
 */
export function captureException(err: unknown, context?: Record<string, unknown>): void {
  if (!initialized) return;
  Sentry.withScope((scope) => {
    if (context) scope.setExtras(context);
    Sentry.captureException(err);
  });
}

/**
 * Attach the current authenticated user to Sentry events for the
 * lifetime of the request. Call this from a middleware after auth.
 */
export function setSentryUser(user: { id: string | number; email?: string; orgId?: number }): void {
  if (!initialized) return;
  Sentry.setUser({
    id: String(user.id),
    email: user.email,
    // Custom tag — useful for multi-tenant debugging
    ...(user.orgId !== undefined ? { segment: `org-${user.orgId}` } : {}),
  });
}

export { Sentry };
