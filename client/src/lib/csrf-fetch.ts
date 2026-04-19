/**
 * Global CSRF fetch interceptor.
 *
 * The server's double-submit CSRF middleware (server/middleware/csrf.ts)
 * requires every mutating request under /api to carry `x-csrf-token`
 * matching the `csrf_token` cookie. Most hooks use `apiRequest` from
 * queryClient which handles this, but a dozen or so components call
 * `fetch` directly. Rather than patch each call site, we monkey-patch
 * `window.fetch` once at app start so same-origin mutations pick up the
 * header automatically.
 *
 * No-op when:
 *   - method is GET/HEAD/OPTIONS
 *   - URL is cross-origin
 *   - header is already set (respect explicit callers)
 *   - no csrf_token cookie exists (server hasn't issued one yet)
 */

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function readCsrfToken(): string {
  if (typeof document === "undefined") return "";
  const m = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : "";
}

function isSameOrigin(url: string): boolean {
  if (url.startsWith("/")) return true;
  try {
    const u = new URL(url, window.location.origin);
    return u.origin === window.location.origin;
  } catch {
    return false;
  }
}

export function installCsrfFetchInterceptor(): void {
  if (typeof window === "undefined") return;
  const original = window.fetch.bind(window);
  if ((original as any).__csrfPatched) return;

  const patched: typeof fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof Request ? input.url : String(input);
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();

    if (!MUTATING.has(method) || !isSameOrigin(url)) {
      return original(input as any, init);
    }

    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    if (!headers.has("x-csrf-token")) {
      const token = readCsrfToken();
      if (token) headers.set("x-csrf-token", token);
    }

    return original(input as any, { ...(init ?? {}), headers });
  };

  (patched as any).__csrfPatched = true;
  window.fetch = patched;
}
