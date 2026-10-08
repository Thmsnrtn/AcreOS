/**
 * Shared utilities for the synthetic beta simulation suite.
 *
 * Provides authenticated session management, API call wrappers,
 * org isolation assertions, CSV generation, and endpoint timing.
 */

import type { PersonaDefinition, PersonaKey } from "./personas";
import { PERSONAS } from "./personas";
import { simBaseUrl } from "./target";

// ── Configuration ──────────────────────────────────────────────────────────
// Resolved once, through the one rule for where the suite may point.
const BASE_URL = simBaseUrl();
const CSRF_COOKIE_NAME = "csrf_token";

// ── Types ──────────────────────────────────────────────────────────────────
export interface AuthSession {
  cookie: string;
  csrfToken: string;
  persona: PersonaDefinition;
  orgId?: number;
}

export interface ApiCallResult {
  status: number;
  body: any;
  durationMs: number;
  headers: Record<string, string>;
  error?: string;
}

export interface TimingStats {
  p50: number;
  p95: number;
  p99: number;
  min: number;
  max: number;
  mean: number;
  samples: number;
}

// ── Session Management ─────────────────────────────────────────────────────

/**
 * The test-auth identity a simulation persona claims.
 *
 * AcreOS authenticates through Clerk; there is no password signup or login
 * endpoint. This helper used to POST to `/api/auth/signup` and
 * `/api/auth/login` — routes that do not exist — and returned a session with
 * an empty cookie whatever they answered. Every test then ran
 * unauthenticated, and a test asserting "not a 500" passed on the 401. The
 * session is now the E2E test-auth identity (server/auth/testAuth.ts, active
 * only with E2E_TEST_AUTH=1 off Fly), and it is VERIFIED before it is returned.
 */
export function simPersonaSlug(personaKey: PersonaKey): string {
  return `sim-${personaKey.toLowerCase()}`;
}

/**
 * Claim a persona's test-auth identity, prove it is authenticated, and return
 * the session. Throws — never returns a partial session — when the server does
 * not accept the identity, so a suite cannot pass without having signed in.
 * The persona's user row must exist (vitest.simulation.config.ts's global
 * setup seeds it when a database URL is given).
 */
export async function createAuthenticatedSession(
  personaKey: PersonaKey,
): Promise<AuthSession> {
  const persona = PERSONAS[personaKey];
  const sessionCookie = `__session=e2e-persona-${simPersonaSlug(personaKey)}`;

  const meRes = await rawFetch("GET", "/api/auth/user", undefined, { cookie: sessionCookie, csrfToken: "" });
  if (meRes.status !== 200 || !meRes.body?.id) {
    throw new Error(
      `[sim] ${personaKey}: GET /api/auth/user answered ${meRes.status} — the test-auth identity was not ` +
        "accepted. Start the server with E2E_TEST_AUTH=1 and seed the persona users " +
        "(SIM_DATABASE_URL=… for the global setup).",
    );
  }

  // A safe request under /api issues the double-submit CSRF cookie, and
  // GET /api/organization provisions the persona's org on first contact.
  const orgRes = await rawFetch("GET", "/api/organization", undefined, { cookie: sessionCookie, csrfToken: "" });
  const csrfToken = extractCsrf(orgRes.headers) || extractCsrf(meRes.headers);
  const orgId = orgRes.body?.id;
  if (orgRes.status !== 200 || typeof orgId !== "number" || !csrfToken) {
    throw new Error(
      `[sim] ${personaKey}: GET /api/organization answered ${orgRes.status} ` +
        `(org id ${String(orgId)}, csrf ${csrfToken ? "issued" : "missing"}) — no usable session.`,
    );
  }

  return { cookie: `${sessionCookie}; csrf_token=${csrfToken}`, csrfToken, persona, orgId };
}

/** A test that needs a session fails without one; it never returns early as a pass. */
export function assertSession(session: AuthSession | undefined): asserts session is AuthSession {
  if (!session?.cookie || typeof session.orgId !== "number") {
    throw new Error("[sim] no authenticated session — this test cannot run, and does not pass by returning");
  }
}

// ── API Call Wrapper ───────────────────────────────────────────────────────

/**
 * Make an HTTP request against the running app. Logs timing and captures errors.
 */
export async function apiCall(
  method: string,
  path: string,
  body?: any,
  session?: Pick<AuthSession, "cookie" | "csrfToken">,
): Promise<ApiCallResult> {
  const start = performance.now();
  const res = await rawFetch(method, path, body, session);
  const durationMs = Math.round(performance.now() - start);

  return {
    status: res.status,
    body: res.body,
    durationMs,
    headers: Object.fromEntries(res.headers.entries()),
    error: res.status >= 400 ? (res.body?.message ?? res.body?.error ?? `HTTP ${res.status}`) : undefined,
  };
}

// ── Org Isolation Assertion ────────────────────────────────────────────────

/**
 * Verify that sessionB cannot read/update/delete an entity owned by sessionA.
 * Returns an array of violations (empty = all good).
 */
export async function assertOrgIsolation(
  sessionA: AuthSession,
  sessionB: AuthSession,
  entityType: string,
  entityId: number,
): Promise<string[]> {
  const violations: string[] = [];
  const basePath = `/api/${entityType}/${entityId}`;

  // Try GET
  const getRes = await apiCall("GET", basePath, undefined, sessionB);
  if (getRes.status !== 404 && getRes.status !== 403) {
    violations.push(`GET ${basePath} returned ${getRes.status} (expected 404 or 403)`);
  }

  // Try PUT
  const putRes = await apiCall("PUT", basePath, { name: "hacked" }, sessionB);
  if (putRes.status !== 404 && putRes.status !== 403) {
    violations.push(`PUT ${basePath} returned ${putRes.status} (expected 404 or 403)`);
  }

  // Try DELETE
  const delRes = await apiCall("DELETE", basePath, undefined, sessionB);
  if (delRes.status !== 404 && delRes.status !== 403) {
    violations.push(`DELETE ${basePath} returned ${delRes.status} (expected 404 or 403)`);
  }

  return violations;
}

// ── CSV Generation ─────────────────────────────────────────────────────────

const LAND_COUNTIES = [
  "Mohave, AZ", "La Paz, AZ", "Costilla, CO", "Hudspeth, TX",
  "Elko, NV", "Nye, NV", "San Bernardino, CA", "Dona Ana, NM",
  "Otero, NM", "Valencia, NM",
];

const FIRST_NAMES = [
  "James", "Maria", "Robert", "Linda", "Michael", "Patricia",
  "John", "Jennifer", "David", "Elizabeth",
];

const LAST_NAMES = [
  "Smith", "Garcia", "Johnson", "Martinez", "Williams", "Lopez",
  "Brown", "Gonzalez", "Jones", "Rodriguez",
];

/**
 * Generate a CSV string with realistic real estate professional lead data.
 */
export function generateCSV(
  rows: number,
  columns: string[] = ["firstName", "lastName", "email", "phone", "county", "state", "status"],
): string {
  const lines: string[] = [columns.join(",")];

  for (let i = 0; i < rows; i++) {
    const first = FIRST_NAMES[i % FIRST_NAMES.length];
    const last = LAST_NAMES[i % LAST_NAMES.length];
    const county = LAND_COUNTIES[i % LAND_COUNTIES.length];
    const [countyName, state] = county.split(", ");

    const row: Record<string, string> = {
      firstName: first,
      lastName: `${last}${i}`,
      email: `lead${i}@sim-test.com`,
      phone: `555-${String(i).padStart(4, "0")}`,
      county: countyName,
      state: state,
      status: "new",
    };

    lines.push(columns.map((c) => row[c] ?? "").join(","));
  }

  return lines.join("\n");
}

// ── Endpoint Timing ────────────────────────────────────────────────────────

/**
 * Run N iterations of an API call and return timing percentiles.
 */
export async function measureEndpointTiming(
  method: string,
  path: string,
  session: Pick<AuthSession, "cookie" | "csrfToken">,
  iterations: number = 20,
): Promise<TimingStats> {
  const durations: number[] = [];

  for (let i = 0; i < iterations; i++) {
    const result = await apiCall(method, path, undefined, session);
    durations.push(result.durationMs);
  }

  durations.sort((a, b) => a - b);

  return {
    p50: percentile(durations, 50),
    p95: percentile(durations, 95),
    p99: percentile(durations, 99),
    min: durations[0],
    max: durations[durations.length - 1],
    mean: Math.round(durations.reduce((a, b) => a + b, 0) / durations.length),
    samples: durations.length,
  };
}

// ── Concurrency Helper ─────────────────────────────────────────────────────

/**
 * Fire N requests concurrently and return all results.
 */
export async function fireConcurrent(
  count: number,
  method: string,
  path: string,
  bodyFn: (i: number) => any,
  session: Pick<AuthSession, "cookie" | "csrfToken">,
): Promise<ApiCallResult[]> {
  const promises = Array.from({ length: count }, (_, i) =>
    apiCall(method, path, bodyFn(i), session),
  );
  return Promise.all(promises);
}

// ── Internal Helpers ───────────────────────────────────────────────────────

interface RawFetchResult {
  status: number;
  body: any;
  headers: Headers;
}

async function rawFetch(
  method: string,
  path: string,
  body?: any,
  session?: Pick<AuthSession, "cookie" | "csrfToken">,
): Promise<RawFetchResult> {
  const url = `${BASE_URL}${path}`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  if (session?.cookie) headers["Cookie"] = session.cookie;
  if (session?.csrfToken) headers["X-CSRF-Token"] = session.csrfToken;

  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    redirect: "manual",
  });

  let resBody: any;
  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    resBody = await res.json();
  } else {
    resBody = await res.text();
  }

  return { status: res.status, body: resBody, headers: res.headers };
}

function extractCsrf(headers: Headers): string {
  const setCookies = headers.getSetCookie?.() ?? [];
  for (const c of setCookies) {
    const match = c.match(new RegExp(`${CSRF_COOKIE_NAME}=([^;]+)`));
    if (match) return match[1];
  }
  return "";
}

function percentile(sorted: number[], pct: number): number {
  const idx = Math.ceil((pct / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}
