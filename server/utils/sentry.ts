import * as Sentry from "@sentry/node";

let initialized = false;

/**
 * Drop expected 4xx errors before they hit Sentry. They're already in the
 * access logs and they swamp the free-tier quota. We treat them as "known
 * client errors" — anything 5xx still goes through.
 *
 * We also drop a small set of well-known client-disconnect / abort errors
 * that Node surfaces during normal request lifecycles.
 */
const NOISE_ERROR_NAMES = new Set([
  "AbortError",
  "RequestAbortedError",
  "NotAuthenticatedError", // 401 — captured at access log
]);

const NOISE_MESSAGE_PATTERNS = [
  /aborted$/i,
  /ECONNRESET/i,
  /Client network socket disconnected/i,
];

function shouldDropEvent(event: Sentry.ErrorEvent, hint?: Sentry.EventHint): boolean {
  // Drop expected 4xx — these belong in access logs, not Sentry.
  // Express/Sentry usually populates `event.contexts.response.status_code`,
  // and our middleware puts the status into `tags.http_status`.
  const tagStatus = Number((event.tags as Record<string, unknown> | undefined)?.["http_status"]);
  const ctxStatus = Number(
    (event.contexts as Record<string, { status_code?: number }> | undefined)?.response?.status_code,
  );
  const status = Number.isFinite(tagStatus) && tagStatus > 0
    ? tagStatus
    : Number.isFinite(ctxStatus) && ctxStatus > 0
      ? ctxStatus
      : 0;
  if (status >= 400 && status < 500) return true;

  const original = hint?.originalException as
    | { name?: string; message?: string; statusCode?: number; status?: number }
    | undefined;
  const errStatus = original?.statusCode ?? original?.status;
  if (typeof errStatus === "number" && errStatus >= 400 && errStatus < 500) return true;
  if (original?.name && NOISE_ERROR_NAMES.has(original.name)) return true;

  const msg = event.message || event.exception?.values?.[0]?.value || original?.message || "";
  if (msg && NOISE_MESSAGE_PATTERNS.some((re) => re.test(msg))) return true;

  return false;
}

/**
 * Initialize Sentry once at server startup.
 * No-op when SENTRY_DSN is not set (local dev / test environments).
 */
export function initSentry(): void {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;
  if (initialized) return;

  // Release tag matches the client (VITE_GIT_SHA → SENTRY_RELEASE).
  // CI/Fly should set SENTRY_RELEASE=$VITE_GIT_SHA at deploy time so
  // server-side stack traces align with the same release as the
  // browser bundle's source maps.
  const release = process.env.SENTRY_RELEASE ?? process.env.VITE_GIT_SHA ?? undefined;

  // Cost-tuning: traces drop to 5% by default; founder can re-tune via env
  // without redeploy. Errors remain at 100% (we want every 5xx).
  const tracesRate = parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE ?? "0.05");

  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? "development",
    ...(release ? { release } : {}),
    tracesSampleRate: Number.isFinite(tracesRate) && tracesRate >= 0 && tracesRate <= 1 ? tracesRate : 0.05,
    beforeSend(event, hint) {
      // Drop expected 4xx — they belong in access logs, not Sentry.
      if (shouldDropEvent(event, hint)) return null;

      // Never send sensitive auth / session data to Sentry
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
