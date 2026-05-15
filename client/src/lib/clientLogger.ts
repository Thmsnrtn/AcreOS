import { Sentry } from "./sentry";

/**
 * Frontend structured logger. The mirror of `server/utils/logger.ts`.
 *
 * Goals:
 *  - debug    → dev-only, never reaches Sentry
 *  - info     → breadcrumb + dev console (cheap, useful for local debugging)
 *  - warn     → Sentry message (level=warning) + dev console
 *  - error    → Sentry exception with optional context + dev console
 *
 * The native sink fall-through is intentional: it keeps DevTools useful
 * during local development. In production, the dev branches are stripped
 * by Vite via `import.meta.env.DEV` so only the Sentry path remains.
 */
/**
 * Accepts the common things call sites pass: a plain context object, an
 * Error caught from a try/catch, a raw string, or an `unknown` value. The
 * error() implementation coerces non-Record values into `{ value: x }`
 * before handing them to Sentry's `extra` field. Widening here avoids
 * forcing every caller to wrap their value in an object literal.
 */
type LogContext = Record<string, unknown> | Error | string | unknown | undefined;

function isDev(): boolean {
  // `import.meta.env.DEV` is `true` for `vite dev`, false for prod builds.
  return !!import.meta.env.DEV;
}

export const clientLogger = {
  debug(...args: unknown[]): void {
    if (isDev()) {
      // eslint-disable-next-line no-console
      console.debug(...args);
    }
  },

  info(...args: unknown[]): void {
    // Breadcrumbs are the right primitive for "info" — they enrich
    // future error reports without paying for a Sentry event each time.
    Sentry.addBreadcrumb({
      level: "info",
      category: "client",
      message: args.map(stringify).join(" "),
    });
    if (isDev()) {
      // eslint-disable-next-line no-console
      console.info(...args);
    }
  },

  warn(...args: unknown[]): void {
    Sentry.captureMessage(args.map(stringify).join(" "), "warning");
    // eslint-disable-next-line no-console
    console.warn(...args);
  },

  error(err: Error | string | unknown, context?: LogContext): void {
    const extra = coerceContext(context);
    if (err instanceof Error) {
      Sentry.captureException(err, extra ? { extra } : undefined);
    } else if (typeof err === "string") {
      Sentry.captureException(new Error(err), extra ? { extra } : undefined);
    } else {
      Sentry.captureException(new Error(stringify(err)), extra ? { extra } : undefined);
    }
    // eslint-disable-next-line no-console
    console.error(err, ...(context ? [context] : []));
  },
};

/**
 * Convert whatever the caller passed as context into a Record Sentry can
 * stash under `extra`. Errors → { name, message, stack }; strings →
 * { value }; anything else → { value }.
 */
function coerceContext(ctx: LogContext): Record<string, unknown> | undefined {
  if (ctx == null) return undefined;
  if (ctx instanceof Error) return { name: ctx.name, message: ctx.message, stack: ctx.stack };
  if (typeof ctx === "string") return { value: ctx };
  if (typeof ctx === "object") return ctx as Record<string, unknown>;
  return { value: ctx };
}

function stringify(v: unknown): string {
  if (typeof v === "string") return v;
  if (v instanceof Error) return v.message;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
