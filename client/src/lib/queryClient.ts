import { QueryClient, QueryCache, MutationCache, QueryFunction } from "@tanstack/react-query";
import { toast } from "@/hooks/use-toast";
import React from "react";
import { ToastAction } from "@/components/ui/toast";
import { getErrorMessage, getErrorTitle, shouldRetry, isAuthError } from "@/lib/error-utils";

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
            title: "Usage Limit Reached",
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

  console.error("[Query Error]", err);
}

function handleMutationError(error: unknown): void {
  const err = error instanceof Error ? error : new Error(String(error));

  if (isAuthError(err)) {
    toast({
      title: "Session Expired",
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
  
  console.error("[Mutation Error]", err);
}

function readCsrfToken(): string {
  if (typeof document === "undefined") return "";
  const match = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : "";
}

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
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
  const res = await fetch(url, {
    method,
    headers,
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const res = await fetch(queryKey.join("/") as string, {
      credentials: "include",
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const CACHE_TIMES = {
  static: 1000 * 60 * 60,
  short: 1000 * 60 * 2,
  medium: 1000 * 60 * 5,
  long: 1000 * 60 * 15,
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
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 10000),
    },
    mutations: {
      retry: (failureCount, error) => {
        // Don't retry on auth or permission errors
        const err = error as Error;
        if (err?.message?.includes("401") || err?.message?.includes("403")) {
          return false;
        }
        return shouldRetry(err, failureCount);
      },
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 10000),
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
