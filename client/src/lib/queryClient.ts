import { QueryClient, QueryCache, MutationCache, QueryFunction } from "@tanstack/react-query";
import { toast } from "@/hooks/use-toast";
import React from "react";
import { ToastAction } from "@/components/ui/toast";
import { getErrorMessage, getErrorTitle, shouldRetry, isAuthError } from "@/lib/error-utils";
import { clientLogger } from "@/lib/clientLogger";
// Canonical 401-recovery Clerk-session touch. Aliased as
// `refreshSessionCookie` to preserve the historical call-site name in
// the three places this fires (fetchJsonArray, apiRequest 401 retry,
// query 401 retry). See client/src/lib/clerk-touch.ts.
import { touchClerkSession as refreshSessionCookie } from "@/lib/clerk-touch";
import { TIER_LIMITS, type SubscriptionTier } from "@shared/billing/tier-limits";
import { TIER_PRICES_CENTS, type Tier } from "@shared/billing/tier-pricing";

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
  /**
   * Optional KB deep-link populated by `Errors.*` helpers when the route
   * handler sets `docsSlug`. Surfaced in the failure toast as "Learn why".
   */
  docsUrl?: string;
}

/**
 * Custom error subclass that preserves the parsed server response so
 * downstream toast/error handlers can render the KB deep-link, structured
 * details, etc. The parent (Error) message is kept as
 * `"<status>: <message>"` for backwards compatibility with every
 * `error.message.includes("403")`-style check in the codebase.
 */
export class ApiError extends Error {
  status: number;
  body: ApiErrorBody | null;
  docsUrl?: string;
  constructor(status: number, message: string, body: ApiErrorBody | null) {
    super(`${status}: ${message}`);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
    this.docsUrl = body?.docsUrl;
  }
}

/**
 * Lens 3 (Pricing Coherence) — translate a 429 limit-exceeded body into a
 * tier-specific upsell. Server posts `tier`, `current`, `limit`, and
 * `resourceType` (per server/utils/errors.ts → Errors.limitExceeded(...)).
 * We pick the NEXT paid tier above the user's current one and render
 * "Starter unlocks 250 leads (you're at 10) for $20/mo". Falls back to the
 * pre-existing generic copy when the body doesn't include enough detail.
 */
interface LimitExceededDetails {
  current?: number;
  limit?: number;
  tier?: SubscriptionTier | string;
  resourceType?: keyof typeof TIER_LIMITS["free"] | string;
}

const TIER_ORDER: readonly SubscriptionTier[] = ["free", "starter", "pro", "scale", "enterprise"];

function nextPaidTier(current: string | undefined): SubscriptionTier | null {
  const cur = (current ?? "free").toLowerCase();
  const idx = TIER_ORDER.indexOf(cur as SubscriptionTier);
  // Pick the next visible tier above the current one — Scale is live,
  // Enterprise is not.
  for (let i = Math.max(0, idx) + 1; i < TIER_ORDER.length; i++) {
    const t = TIER_ORDER[i];
    if (t === "enterprise") continue;
    return t;
  }
  return null;
}

function resourceLabel(resourceType: string | undefined): string {
  if (!resourceType) return "this resource";
  if (resourceType === "ai_requests") return "AI requests";
  if (resourceType in TIER_LIMITS.free) return resourceType;
  return resourceType.replace(/_/g, " ");
}

function formatUpgradeUpsell(body: {
  message?: string;
  details?: LimitExceededDetails;
  docsUrl?: string;
  upgradeUrl?: string;
}): { title: string; description: string; cta: string; upgradeUrl: string } {
  const details = body.details ?? {};
  const target = nextPaidTier(details.tier);
  const resource = resourceLabel(details.resourceType);

  // If we don't have a target tier or a resource type, fall back to the
  // generic message.
  if (!target || !details.resourceType) {
    return {
      title: "Usage limit reached",
      description: body.message || "You've reached the plan limit.",
      cta: body.docsUrl ? "Learn why" : "Upgrade",
      upgradeUrl: body.docsUrl || body.upgradeUrl || "/settings#billing",
    };
  }

  const targetLimits = TIER_LIMITS[target];
  const targetValue = (targetLimits as Record<string, unknown>)[details.resourceType];
  // Targets price comes from tier-pricing.ts so the toast and Stripe stay
  // aligned. enterprise is excluded by nextPaidTier(), so target is always
  // a paid Tier key in TIER_PRICES_CENTS.
  const pricing = TIER_PRICES_CENTS[target as Tier];
  const monthlyDollars = pricing ? `$${pricing.priceMonthlyCents / 100}/mo` : "more";

  const targetLabel = typeof targetValue === "number"
    ? targetValue.toLocaleString("en-US")
    : targetValue === null
      ? "unlimited"
      : String(targetValue);

  const tierName = target.charAt(0).toUpperCase() + target.slice(1);
  const currentClause = typeof details.current === "number"
    ? ` (you're at ${details.current.toLocaleString("en-US")})`
    : "";

  return {
    title: `${resource[0].toUpperCase()}${resource.slice(1)} limit reached`,
    description: `${tierName} unlocks ${targetLabel} ${resource}${currentClause} for ${monthlyDollars}.`,
    cta: `Upgrade to ${tierName}`,
    // Deep-link the settings billing panel to the target tier so the
    // upgrade modal preselects it.
    upgradeUrl: body.docsUrl || body.upgradeUrl || `/settings#billing?tier=${target}`,
  };
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

    // Handle 429 usage limit responses with an upgrade prompt.
    //
    // Lens 3 (Pricing Coherence): the toast now reads `tier`, `current`,
    // `limit`, and `resourceType` from the response body and renders a
    // tier-specific upsell — "Starter unlocks 250 leads (you're at 10) for
    // $20/mo" — with a deep link to /settings#billing?tier=<next>. Falls
    // back to the generic copy when the body doesn't include details.
    if (res.status === 429) {
      try {
        const body = parsed ?? JSON.parse(text);
        if (body.error === "limit_exceeded" || body.error === "LIMIT_EXCEEDED") {
          const upsell = formatUpgradeUpsell(body);
          toast({
            title: upsell.title,
            description: upsell.description,
            variant: "destructive",
            action: React.createElement(
              ToastAction as any,
              {
                altText: upsell.cta,
                onClick: () => {
                  window.location.href = upsell.upgradeUrl;
                },
              },
              upsell.cta,
            ) as any,
          });
        }
      } catch {
        // Not JSON — fall through to normal error
      }
    }

    // Use the parsed message if available, otherwise fall back to raw text
    const errorMessage = parsed?.message ?? text;
    throw new ApiError(res.status, errorMessage, parsed);
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
  const docsUrl = (err as ApiError).docsUrl;

  toast({
    title,
    description,
    variant: "destructive",
    action: React.createElement(
      ToastAction as any,
      {
        altText: docsUrl ? "Learn why" : "Copy details",
        onClick: () => {
          if (docsUrl) {
            window.location.href = docsUrl;
            return;
          }
          const details = `${title}: ${String((error as Error)?.message || error)}`;
          navigator.clipboard?.writeText(details).catch(() => {});
        },
      },
      docsUrl ? "Learn why" : "Copy details"
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
  const docsUrl = (err as ApiError).docsUrl;

  toast({
    title,
    description,
    variant: "destructive",
    action: React.createElement(
      ToastAction as any,
      {
        altText: docsUrl ? "Learn why" : "Copy details",
        onClick: () => {
          if (docsUrl) {
            window.location.href = docsUrl;
            return;
          }
          const details = `${title}: ${String((error as Error)?.message || error)}`;
          navigator.clipboard?.writeText(details).catch(() => {});
        },
      },
      docsUrl ? "Learn why" : "Copy details"
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
