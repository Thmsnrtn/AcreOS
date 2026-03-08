import * as Sentry from "@sentry/react";

/**
 * Initialize Sentry for the React client.
 * No-op when VITE_SENTRY_DSN is not set (local dev).
 */
export function initClientSentry(): void {
  const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
  if (!dsn) return;

  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    // 10% of sessions get full replay — useful for debugging UX issues
    replaysSessionSampleRate: 0.1,
    // 100% of sessions with an error get a replay
    replaysOnErrorSampleRate: 1.0,
    tracesSampleRate: parseFloat((import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE as string) ?? "0.1"),
    beforeSend(event) {
      // Never send auth tokens or session cookies to Sentry
      if (event.request?.headers) {
        delete event.request.headers["Authorization"];
        delete event.request.headers["Cookie"];
      }
      return event;
    },
  });
}

export { Sentry };
