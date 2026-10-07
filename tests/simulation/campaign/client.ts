/**
 * Campaign HTTP client for driving a LOCAL AcreOS under the E2E test-auth
 * bypass (server/auth/testAuth.ts). Never valid against a deployed instance.
 *
 *  - identity: `__session=e2e-persona-<slug>` → stable per-persona user + org
 *  - CSRF: double-submit (`csrf_token` cookie mirrored into `x-csrf-token`)
 *  - every call is timed; 5xx and malformed JSON are surfaced, never swallowed
 */
import { personaCookieValue, E2E_FOUNDER_COOKIE } from "../../../server/auth/testAuth";

export const BASE_URL = process.env.SIM_BASE_URL ?? "http://localhost:5000";

export interface Resp<T = any> {
  status: number;
  body: T;
  text: string;
  ms: number;
  headers: Headers;
}

export class SimClient {
  readonly cookieValue: string;
  readonly csrf = "campaign-csrf-" + Math.random().toString(36).slice(2);
  private extraCookies: Record<string, string> = {};

  constructor(readonly slug: string, opts?: { founder?: boolean }) {
    this.cookieValue = opts?.founder ? E2E_FOUNDER_COOKIE : personaCookieValue(slug);
  }

  setCookie(name: string, value: string) {
    this.extraCookies[name] = value;
  }

  private cookieHeader(): string {
    const parts = [`__session=${this.cookieValue}`, `csrf_token=${this.csrf}`];
    for (const [k, v] of Object.entries(this.extraCookies)) parts.push(`${k}=${v}`);
    return parts.join("; ");
  }

  async call<T = any>(
    method: string,
    path: string,
    body?: unknown,
    opts?: { headers?: Record<string, string>; raw?: BodyInit; noCsrf?: boolean; noAuth?: boolean },
  ): Promise<Resp<T>> {
    const headers: Record<string, string> = {
      accept: "application/json",
      ...(opts?.headers ?? {}),
    };
    if (!opts?.noAuth) headers.cookie = this.cookieHeader();
    if (!opts?.noCsrf) headers["x-csrf-token"] = this.csrf;
    let payload: BodyInit | undefined = opts?.raw;
    if (body !== undefined && payload === undefined) {
      headers["content-type"] = "application/json";
      payload = JSON.stringify(body);
    }
    const t0 = performance.now();
    let res: Response;
    try {
      res = await fetch(BASE_URL + path, { method, headers, body: payload, redirect: "manual" });
    } catch (e) {
      return { status: 0, body: null as any, text: String(e), ms: performance.now() - t0, headers: new Headers() };
    }
    const ms = performance.now() - t0;
    const text = await res.text();
    let parsed: any = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = null;
    }
    return { status: res.status, body: parsed, text, ms, headers: res.headers };
  }

  get<T = any>(path: string, opts?: Parameters<SimClient["call"]>[3]) {
    return this.call<T>("GET", path, undefined, opts);
  }
  post<T = any>(path: string, body?: unknown, opts?: Parameters<SimClient["call"]>[3]) {
    return this.call<T>("POST", path, body, opts);
  }
  put<T = any>(path: string, body?: unknown, opts?: Parameters<SimClient["call"]>[3]) {
    return this.call<T>("PUT", path, body, opts);
  }
  patch<T = any>(path: string, body?: unknown, opts?: Parameters<SimClient["call"]>[3]) {
    return this.call<T>("PATCH", path, body, opts);
  }
  delete<T = any>(path: string, opts?: Parameters<SimClient["call"]>[3]) {
    return this.call<T>("DELETE", path, undefined, opts);
  }
}

/** Fire `n` calls concurrently and return every result (never throws). */
export async function concurrently<T>(n: number, fn: (i: number) => Promise<T>): Promise<T[]> {
  return Promise.all(Array.from({ length: n }, (_, i) => fn(i)));
}

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

/** Ensure the persona's org exists and onboarding is marked complete (DB-free path). */
export async function warmPersona(client: SimClient): Promise<{ orgId: number | null; user: any }> {
  const me = await client.get("/api/auth/user");
  const orgId = me.body?.organizationId ?? me.body?.organization?.id ?? me.body?.orgId ?? null;
  return { orgId, user: me.body };
}
