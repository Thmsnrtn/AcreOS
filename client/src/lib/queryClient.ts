import { QueryClient, QueryFunction } from "@tanstack/react-query";
import { toast } from "@/hooks/use-toast";

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

function handleQueryError(error: unknown): void {
  const err = error instanceof Error ? error : new Error(String(error));
  const message = err.message;
  
  if (message.includes("401")) {
    toast({
      title: "Session Expired",
      description: "Please sign in again to continue.",
      variant: "destructive",
    });
    return;
  }
  
  if (message.includes("500")) {
    toast({
      title: "Server Error",
      description: "Something went wrong on our end. Please try again.",
      variant: "destructive",
    });
    return;
  }
  
  if (message.includes("network") || message.includes("fetch") || message.includes("Failed to fetch")) {
    toast({
      title: "Connection Error",
      description: "Unable to connect to the server. Please check your connection.",
      variant: "destructive",
    });
    return;
  }
  
  console.error("[Query Error]", err);
}

function handleMutationError(error: unknown): void {
  const err = error instanceof Error ? error : new Error(String(error));
  const message = err.message;
  
  if (message.includes("401")) {
    toast({
      title: "Session Expired",
      description: "Please sign in again to continue.",
      variant: "destructive",
    });
    return;
  }
  
  if (message.includes("403")) {
    toast({
      title: "Permission Denied",
      description: "You don't have permission to perform this action.",
      variant: "destructive",
    });
    return;
  }
  
  if (message.includes("429")) {
    toast({
      title: "Rate Limited",
      description: "Too many requests. Please wait a moment and try again.",
      variant: "destructive",
    });
    return;
  }
  
  toast({
    title: "Request Failed",
    description: "Something went wrong. Please try again.",
    variant: "destructive",
  });
  
  console.error("[Mutation Error]", err);
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const res = await fetch(url, {
    method,
    headers: data ? { "Content-Type": "application/json" } : {},
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
        return failureCount < 2;
      },
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 10000),
    },
    mutations: {
      retry: false,
      onError: handleMutationError,
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
