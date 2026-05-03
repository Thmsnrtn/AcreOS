import { QueryClient, QueryCache, MutationCache, QueryFunction } from "@tanstack/react-query";
import { toast } from "@/hooks/use-toast";
import React from "react";
import { ToastAction } from "@/components/ui/toast";
import { getErrorMessage, getErrorTitle, shouldRetry, isAuthError } from "@/lib/error-utils";
import { clientLogger } from "@/lib/clientLogger";

// Per-request timeout (ms). Short enough that a stalled endpoint
// surfaces as a retry-able error rather than a perpetual spinner; long
// enough that genuinely slow but successful requests (PDF generation,
// AI drafts, exports) still complete. Tune via env if needed.
const REQUEST_TIMEOUT_MS = 30_000;

/**
 * Standardized API error shape returned by the server.
 */
interface ApiErrorBody {
  error: string;
  message: string;
  details?: unknown;
  statusCode: number;
}

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;

    // Try to parse standardized { error, message, details } response
    let parsed: ApiErrorBody | null = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      // Not JSON — fall through to raw error
    }

    // Handle 429 usage limit responses with an upgrade prompt
    if (res.status === 429) {
      try {
        const body = parsed ?? JSON.parse(text);
        if (body.error === "limit_exceeded" || body.error === "LIMIT_EXCEEDED") {
          toast({
            title: "Usage limit reached",
            description: body.message || `You've reached the plan limit.`,
            variant: "destructive",
            action: React.createElement(
              ToastAction as any,
              {
                altText: "Upgrade plan",
                onClick: () => { window.location.href = (body as any).upgradeUrl || "/settings#billing"; },
              },
              "Upgrade"
            ) as any,
          });
        }
      } catch {
        // Not JSON — fall through to normal error
      }
    }

    // Use the parsed message if available, otherwise fall back to raw text
    const errorMessage = parsed?.message ?? text;
    throw new Error(`${res.status}: ${errorMessage}`);
  }
}

function handleQueryError(error: unknown): void {
  const err = error instanceof Error ? error : new Error(String(error));

  if (isAuthError(err)) {
    return;
  }

  // 404s on background queries are almost always "optional data that
  // wasn't there" (founder-only endpoints on non-founder accounts,
  // flags not yet set, etc.) and should NOT surface a red error toast
  // to the user. Log to console for diagnosis, but don't interrupt.
  // Same for 403 — silent permission boundaries. Real failures (500,
  // network) still toast.
  if (err.message.includes("404") || err.message.includes("403")) {
    clientLogger.error("[Query Error — suppressed toast]", err);
    return;
  }

  const title = getErrorTitle(err);
  const description = getErrorMessage(err);

  toast({
    title,
    description,
    variant: "destructive",
    action: React.createElement(
      ToastAction as any,
      {
        altText: "Copy details",
        onClick: () => {
          const details = `${title}: ${String((error as Error)?.message || error)}`;
          navigator.clipboard?.writeText(details).catch(() => {});
        },
      },
      "Copy details"
    ) as any,
  });

  clientLogger.error("[Query Error]", err);
}

function handleMutationError(error: unknown): void {
  const err = error instanceof Error ? error : new Error(String(error));

  if (isAuthError(err)) {
    toast({
      title: "Session expired",
      description: "Your session has expired. Please sign in again.",
      variant: "destructive",
    });
    return;
  }

  const title = getErrorTitle(err);
  const description = getErrorMessage(err);

  toast({
    title,
    description,
    variant: "destructive",
    action: React.createElement(
      ToastAction as any,
      {
        altText: "Copy details",
        onClick: () => {
          const details = `${title}: ${String((error as Error)?.message || error)}`;
          navigator.clipboard?.writeText(details).catch(() => {});
        },
      },
      "Copy details"
    ) as any,
  });
  
  clientLogger.error("[Mutation Error]", err);
}

function readCsrfToken(): string {
  if (typeof document === "undefined") return "";
  const match = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : "";
}

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Cycles 7–11 repeatedly hit the same class of bug: pages use
 * `fetch(url).then(r => r.json())` as their React Query queryFn,
 * but many of our API endpoints return a paginated envelope
 * `{ data: [...], total, page, ... }`. Consumer code then calls
 * `.filter()` / `.map()` on the envelope, which throws
 * `q.filter is not a function` and fires the global error boundary.
 *
 * Use `fetchJsonArray<T>(url)` as a drop-in replacement for those
 * inline queryFns when the endpoint is supposed to return an array.
 * It handles: 401 retry via refreshSessionCookie (inherited from
 * apiRequest), array vs `{data}` envelope normalization, and empty
 * fallback on network failure.
 */
export async function fetchJsonArray<T>(url: string): Promise<T[]> {
  let res = await fetch(url, { credentials: "include" });
  if (res.status === 401 && url.startsWith("/api/")) {
    await refreshSessionCookie();
    res = await fetch(url, { credentials: "include" });
  }
  if (!res.ok) return [];
  try {
    const j = await res.json();
    if (Array.isArray(j)) return j as T[];
    if (Array.isArray(j?.data)) return j.data as T[];
    if (Array.isArray(j?.items)) return j.items as T[];
    return [];
  } catch {
    return [];
  }
}

// On 401 to an authenticated /api endpoint, proactively touch the Clerk
// session to refresh the __session JWT, then let the caller retry once.
// Cycle 3 r1 showed that the 45s keep-alive interval could race against
// the 60s+30s JWT validity window — an in-flight fetch could arrive
// after the cookie expired but before the next scheduled touch. This
// helper closes that race without changing user-visible behavior.
async function refreshSessionCookie(): Promise<void> {
  try {
    const m = document.cookie.match(/__session=([^;]+)/);
    const jwt = m?.[1];
    if (!jwt) return;
    const payload = JSON.parse(atob(jwt.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    const sid = payload?.sid;
    if (!sid) return;
    await fetch(
      `/__clerk/v1/client/sessions/${sid}/touch?__clerk_api_version=2025-11-10&_clerk_js_version=6.7.4`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "active_organization_id=",
        credentials: "include",
      }
    );
  } catch {
    // best effort
  }
}

/**
 * Per-request options for `apiRequest`.
 *
 * `idempotent: true` — for non-GET requests (POST/PATCH/PUT/DELETE),
 * generate a UUID v4 and send it as `Idempotency-Key`. The server's
 * idempotency middleware (server/middleware/idempotency.ts) replays
 * the prior response if the same key is seen again within the TTL.
 * Use this on every mutation that has a non-trivially-undoable side
 * effect: charging a card, sending a message, queuing a mailer, etc.
 *
 * `idempotencyKey: "..."` — explicitly set the key (overrides UUID).
 * Use a deterministic value (e.g. `refund:${request.id}`) when the
 * caller already has a stable identifier for the operation. Useful
 * when the underlying request can be retried by the user (e.g. a
 * "Process refund" button) and you want every retry to collapse to
 * the same idempotency key, regardless of how many times they click.
 */
export interface ApiRequestOptions {
  idempotent?: boolean;
  idempotencyKey?: string;
}

function generateIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Fallback for environments without crypto.randomUUID — RFC4122-ish
  // but not crypto-grade. The server treats the key as opaque.
  return "k-" + Math.random().toString(36).slice(2) + "-" + Date.now().toString(36);
}

async function doApiFetch(
  method: string,
  url: string,
  data?: unknown | undefined,
  options?: ApiRequestOptions,
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (data) {
    headers["Content-Type"] = "application/json";
  }
  // Mirror the csrf_token cookie into the x-csrf-token header for the
  // server's double-submit CSRF check. Safe on GETs (harmless extra header).
  if (MUTATING_METHODS.has(method.toUpperCase())) {
    const csrf = readCsrfToken();
    if (csrf) headers["x-csrf-token"] = csrf;
  }
  // Idempotency-Key: only meaningful on mutating methods. Caller opts in
  // either by passing a deterministic key (for retryable ops keyed off
  // a server-side id, e.g. `refund:${request.id}`) or by passing
  // `idempotent: true` to get a fresh UUID for the lifetime of the call.
  if (MUTATING_METHODS.has(method.toUpperCase())) {
    const key = options?.idempotencyKey ?? (options?.idempotent ? generateIdempotencyKey() : undefined);
    if (key) headers["Idempotency-Key"] = key;
  }
  return fetch(url, {
    method,
    headers,
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
    // 30s ceiling on every API request — without this every fetch can
    // hang forever on a stalled server / network drop, which was the
    // single biggest cause of the "indefinite spinner" UX symptom in
    // the 2026-05-01 audit. AbortSignal.timeout throws a TimeoutError
    // which the existing retry logic + error toasts handle cleanly.
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
  options?: ApiRequestOptions,
): Promise<Response> {
  // Generate the idempotency key ONCE, in this wrapper, so that the
  // post-401 retry below uses the same key as the original attempt
  // (the server collapses both into one effect — that's the whole
  // point). Without this, a mid-flight session refresh would mint a
  // fresh UUID and bypass the dedupe.
  const resolvedOptions: ApiRequestOptions | undefined = options
    ? {
        ...options,
        idempotencyKey:
          options.idempotencyKey ??
          (options.idempotent && MUTATING_METHODS.has(method.toUpperCase())
            ? generateIdempotencyKey()
            : undefined),
      }
    : undefined;

  let res = await doApiFetch(method, url, data, resolvedOptions);

  // Transparent 401 recovery for /api/* endpoints: refresh the Clerk
  // __session cookie via /__clerk/v1/client/sessions/:sid/touch (NOT
  // /api/auth/*), then retry once. Safe on /api/auth/user because the
  // refresh path doesn't loop through Express auth middleware.
  if (res.status === 401 && url.startsWith("/api/")) {
    await refreshSessionCookie();
    res = await doApiFetch(method, url, data, resolvedOptions);
  }

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const url = queryKey.join("/") as string;
    let res = await fetch(url, {
      credentials: "include",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    // Same 401 recovery as apiRequest: refresh Clerk session cookie,
    // retry once. See apiRequest for rationale.
    if (res.status === 401 && url.startsWith("/api/")) {
      await refreshSessionCookie();
      res = await fetch(url, {
        credentials: "include",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    }

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const CACHE_TIMES = {
  static: 1000 * 60 * 60,
  short: 1000 * 60 * 2,
  // gcTime default bumped from 5min → 30min — keeping query data warm
  // through tab switches makes nav feel instant. The audit found
  // tab-back round-trips were re-fetching everything because the data
  // was already garbage-collected at 5min.
  medium: 1000 * 60 * 30,
  long: 1000 * 60 * 60,
};

export const STALE_TIMES = {
  static: 1000 * 60 * 60,
  short: 1000 * 30,
  medium: 1000 * 60 * 2,
  long: 1000 * 60 * 5,
};

export const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: handleQueryError,
  }),
  mutationCache: new MutationCache({
    onError: handleMutationError,
  }),
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: STALE_TIMES.medium,
      gcTime: CACHE_TIMES.medium,
      retry: (failureCount, error) => {
        const err = error as Error;
        if (err?.message?.includes("401") || err?.message?.includes("403")) {
          return false;
        }
        return shouldRetry(err, failureCount);
      },
      retryDelay: (attemptIndex) => Math.min(500 * 2 ** attemptIndex, 3000),
    },
    mutations: {
      // P0 (Ines §1, Hessam §2, Alaric §2.3): mutations MUST NOT
      // retry by default. A 502 from Stripe on /api/stripe/checkout
      // or /api/credits/purchase looks identical to a transient
      // network error from the client's perspective, but the upstream
      // call may have already succeeded — retrying double-charges
      // the customer. The correct primitive for "safe to retry" is
      // an Idempotency-Key on the outbound request (see apiRequest's
      // ApiRequestOptions); call sites that need at-most-once
      // semantics opt in explicitly. Default is no retry.
      retry: false,
      retryDelay: (attemptIndex) => Math.min(500 * 2 ** attemptIndex, 3000),
    },
  },
});

export function prefetchRoute(path: string) {
  queryClient.prefetchQuery({
    queryKey: [path],
    staleTime: STALE_TIMES.short,
  });
}

export function prefetchCommonRoutes() {
  const routes = ['/api/leads', '/api/properties', '/api/deals', '/api/notes'];
  routes.forEach(route => prefetchRoute(route));
}
