/**
 * Shared utilities for the synthetic beta simulation suite.
 *
 * Provides authenticated session management, API call wrappers,
 * org isolation assertions, CSV generation, and endpoint timing.
 */

import type { PersonaDefinition, PersonaKey } from "./personas";
import { PERSONAS } from "./personas";

// ── Configuration ──────────────────────────────────────────────────────────
const BASE_URL = process.env.SIM_BASE_URL ?? "http://localhost:5000";
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
 * Sign up a persona, complete onboarding, and return an authenticated session.
 * Works against a running AcreOS instance (docker-compose.test.yml).
 */
export async function createAuthenticatedSession(
  personaKey: PersonaKey,
): Promise<AuthSession> {
  const persona = PERSONAS[personaKey];
  const { email, password, name } = persona;

  // 1. Sign up
  const signupRes = await rawFetch("POST", "/api/auth/signup", {
    email,
    password,
    name,
  });

  // If already exists, try logging in
  const loginRes =
    signupRes.status === 201 || signupRes.status === 200
      ? signupRes
      : await rawFetch("POST", "/api/auth/login", { email, password });

  const cookie = extractSetCookie(loginRes.headers);
  const csrfToken = extractCsrf(loginRes.headers);

  // 2. Complete onboarding
  await rawFetch(
    "POST",
    "/api/onboarding/complete",
    {
      orgName: `${name}'s Org`,
      goals: ["land_flipping"],
      targetAcreage: 100,
      targetBudgetCents: 50000_00,
    },
    { cookie, csrfToken },
  );

  // 3. Get org id
  const meRes = await rawFetch("GET", "/api/auth/user", undefined, {
    cookie,
    csrfToken,
  });
  const orgId = meRes.body?.organizationId ?? meRes.body?.orgId;

  return { cookie, csrfToken, persona, orgId };
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

function extractSetCookie(headers: Headers): string {
  const setCookies = headers.getSetCookie?.() ?? [];
  return setCookies.join("; ");
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
