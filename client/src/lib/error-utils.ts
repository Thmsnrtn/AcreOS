/**
 * Plain-English error classification.
 *
 * Voice rules: see `docs/voice.md`. Errors must explain *why* in plain English
 * and offer a CTA. Classification is status-code first, message second; we only
 * fall back to free-text matching when no status is available.
 */

export type ErrorKind =
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "validation"
  | "rate_limited"
  | "server"
  | "network"
  | "timeout"
  | "unknown";

interface ErrorShape {
  status?: number;
  message?: string;
}

function shapeFromError(error: unknown): ErrorShape {
  if (!error) return {};
  if (error instanceof Error) {
    const anyErr = error as Error & { status?: number; statusCode?: number };
    return {
      status: anyErr.status ?? anyErr.statusCode,
      message: error.message,
    };
  }
  if (typeof error === "object") {
    const obj = error as { status?: number; statusCode?: number; message?: string };
    return { status: obj.status ?? obj.statusCode, message: obj.message };
  }
  if (typeof error === "string") return { message: error };
  return {};
}

/**
 * Classify an error into a stable kind using status code first, then message
 * heuristics. Status codes come from `apiRequest` which throws Error instances
 * whose message starts with "<status>:" — we parse that as a fallback.
 */
export function classifyError(error: unknown): ErrorKind {
  const { status, message } = shapeFromError(error);

  // Prefer numeric status when available.
  if (typeof status === "number") {
    if (status === 401) return "unauthorized";
    if (status === 403) return "forbidden";
    if (status === 404) return "not_found";
    if (status === 422) return "validation";
    if (status === 429) return "rate_limited";
    if (status >= 500 && status <= 599) return "server";
  }

  if (!message) return "unknown";

  // Status-prefix pattern from apiRequest: "401: ..." etc.
  const prefixMatch = message.match(/^(\d{3})\b/);
  if (prefixMatch) {
    const code = Number(prefixMatch[1]);
    if (code === 401) return "unauthorized";
    if (code === 403) return "forbidden";
    if (code === 404) return "not_found";
    if (code === 422) return "validation";
    if (code === 429) return "rate_limited";
    if (code >= 500 && code <= 599) return "server";
  }

  const lower = message.toLowerCase();
  if (lower.includes("unauthorized") || lower.includes("not signed in")) return "unauthorized";
  if (lower.includes("forbidden") || lower.includes("permission")) return "forbidden";
  if (lower.includes("not found")) return "not_found";
  if (lower.includes("validation") || lower.includes("invalid")) return "validation";
  if (lower.includes("rate limit") || lower.includes("too many")) return "rate_limited";
  if (lower.includes("timeout") || lower.includes("timed out")) return "timeout";
  if (lower.includes("network") || lower.includes("fetch") || lower.includes("offline")) {
    return "network";
  }
  if (lower.includes("500") || lower.includes("server")) return "server";

  return "unknown";
}

/**
 * Plain-English message for a classified error. Each message explains *why*
 * and includes a CTA. Voice rules in `docs/voice.md`.
 */
export function getErrorMessage(error: unknown): string {
  const kind = classifyError(error);
  switch (kind) {
    case "unauthorized":
      return "You're signed out. Refresh and sign back in.";
    case "forbidden":
      return "You don't have permission for that. Ask the org owner if you need access.";
    case "not_found":
      return "We couldn't find that. It may have been deleted.";
    case "validation":
      return "We couldn't process that — check the highlighted fields.";
    case "rate_limited":
      return "You're moving too fast. Try again in a moment.";
    case "server":
      return "That one's on us — give it a second and try again. Still stuck? We're already looking.";
    case "network":
      return "Connection issue. Check your internet.";
    case "timeout":
      return "That took too long. Check your connection and try again.";
    default: {
      // Fall back to the raw message if it's already plain-English-ish.
      if (error instanceof Error && error.message && !/^\d{3}\b/.test(error.message)) {
        return error.message;
      }
      return "Something didn't work. Try again in a moment.";
    }
  }
}

/**
 * Short title suitable for toast headers / error cards.
 */
export function getErrorTitle(error: unknown): string {
  const kind = classifyError(error);
  switch (kind) {
    case "unauthorized":
      return "Signed out";
    case "forbidden":
      return "No permission";
    case "not_found":
      return "Not found";
    case "validation":
      return "Check your input";
    case "rate_limited":
      return "Slow down";
    case "server":
      return "That's on us";
    case "network":
      return "Connection issue";
    case "timeout":
      return "Took too long";
    default:
      return "Something didn't work";
  }
}

/** True for 401 / "unauthorized" classification. */
export function isAuthError(error: unknown): boolean {
  return classifyError(error) === "unauthorized";
}

/** True for 403 / "forbidden" classification. */
export function isPermissionError(error: unknown): boolean {
  return classifyError(error) === "forbidden";
}

/**
 * Errors safe to retry automatically. Keep this conservative: never retry
 * 4xx (the request itself is bad) and never retry 401/403 (no point).
 */
export function isRetryableError(error: unknown): boolean {
  const kind = classifyError(error);
  return kind === "network" || kind === "timeout" || kind === "server" || kind === "rate_limited";
}

/**
 * React-Query retry callback. Caps at 1 retry (2 total attempts) so a failing
 * query never blocks the UI for more than ~2s of retry backoff. Previously
 * 3 retries with exponential backoff felt like a broken page.
 */
export function shouldRetry(error: unknown, attempt: number): boolean {
  if (attempt >= 1) return false;
  return isRetryableError(error);
}
