/**
 * Fly.io Machines API client for Atlas operational hands (Phase G).
 *
 * Thin wrapper around the Machines API at https://api.machines.dev/v1
 * using the existing FLY_API_TOKEN env var (also used by
 * scripts/fly-night-mode.ts). Returns shape-typed responses so Atlas
 * tools can format them deterministically.
 *
 * Read-only methods only in this initial drop:
 *   - listMachines(appName)        — GET /apps/:app/machines
 *   - getMachine(appName, id)      — GET /apps/:app/machines/:id
 *   - listReleases(appName, limit) — GET /apps/:app/releases
 *   - listSecretNames(appName)     — GET /apps/:app/secrets (NAMES ONLY)
 *
 * Destructive operations (restart/scale/secret_set/deploy) land in a
 * follow-up commit with the sealed-paste flow + Tier-3 confirmation per
 * the founder-chat plan.
 */

import { logger } from "../../../utils/logger";

export const FLY_API_BASE = "https://api.machines.dev/v1";

const DEFAULT_TIMEOUT_MS = 8000;

export interface FlyMachine {
  id: string;
  name: string;
  region: string;
  state: string;
  config?: {
    image?: string;
    metadata?: Record<string, string>;
    processes?: Array<{ name?: string; cmd?: string[] }>;
  };
  created_at?: string;
  updated_at?: string;
  instance_id?: string;
}

export interface FlyRelease {
  id: string | number;
  version: number;
  status: string;
  description?: string;
  created_at?: string;
  user_email?: string;
  image_ref?: string;
}

export interface FlySecret {
  name: string;
  label?: string;
  type?: string;
  created_at?: string;
}

export class FlyClientError extends Error {
  status: number;
  body: string;
  constructor(message: string, status: number, body: string) {
    super(message);
    this.name = "FlyClientError";
    this.status = status;
    this.body = body;
  }
}

function token(): string {
  const t = process.env.FLY_API_TOKEN;
  if (!t) {
    throw new FlyClientError(
      "FLY_API_TOKEN not configured — Fly tools unavailable in this environment",
      503,
      "",
    );
  }
  return t;
}

function appName(override?: string): string {
  return override ?? process.env.FLY_APP_NAME ?? "acreos";
}

async function flyFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const url = `${FLY_API_BASE}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${token()}`,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      logger.warn({ url, status: res.status, body: text.slice(0, 200) }, "fly api non-ok");
      throw new FlyClientError(`Fly API ${res.status} on ${path}`, res.status, text);
    }
    return text ? (JSON.parse(text) as T) : ({} as T);
  } finally {
    clearTimeout(timer);
  }
}

/** List all machines for an app. Returns [] if app is empty. */
export async function listMachines(app?: string): Promise<FlyMachine[]> {
  const data = await flyFetch<FlyMachine[]>(`/apps/${appName(app)}/machines`);
  return Array.isArray(data) ? data : [];
}

/** Get one machine by id. */
export async function getMachine(id: string, app?: string): Promise<FlyMachine> {
  return flyFetch<FlyMachine>(`/apps/${appName(app)}/machines/${id}`);
}

/**
 * List recent releases. The Machines API doesn't expose releases directly
 * (that's the older GraphQL-only endpoint), so we approximate via the
 * `/apps/:app/machines` events stream and bucket by image_ref+created_at.
 *
 * For simplicity in this drop we return [] when the simpler endpoint is
 * unavailable, so callers degrade gracefully.
 */
export async function listReleases(limit = 10, app?: string): Promise<FlyRelease[]> {
  try {
    // Machines API has releases at /apps/:app/releases on some versions.
    const data = await flyFetch<FlyRelease[]>(
      `/apps/${appName(app)}/releases?limit=${limit}`,
    );
    return Array.isArray(data) ? data.slice(0, limit) : [];
  } catch (err) {
    if (err instanceof FlyClientError && err.status === 404) {
      logger.info({ app: appName(app) }, "fly /releases endpoint not available; returning []");
      return [];
    }
    throw err;
  }
}

/** List secret NAMES (never values). Throws if Fly API rejects the call. */
export async function listSecretNames(app?: string): Promise<FlySecret[]> {
  const data = await flyFetch<FlySecret[]>(`/apps/${appName(app)}/secrets`);
  return Array.isArray(data) ? data : [];
}

/** Summary of an app's current health for the Atlas inquiry surface. */
export interface FlyAppHealth {
  appName: string;
  machineCount: number;
  states: Record<string, number>;
  regions: string[];
  oldestMachineAgeHours: number | null;
}

export async function getAppHealth(app?: string): Promise<FlyAppHealth> {
  const name = appName(app);
  const machines = await listMachines(name);
  const states: Record<string, number> = {};
  const regions = new Set<string>();
  let oldest: number | null = null;
  const now = Date.now();
  for (const m of machines) {
    states[m.state] = (states[m.state] ?? 0) + 1;
    if (m.region) regions.add(m.region);
    if (m.created_at) {
      const age = (now - new Date(m.created_at).getTime()) / 3_600_000;
      if (oldest === null || age > oldest) oldest = age;
    }
  }
  return {
    appName: name,
    machineCount: machines.length,
    states,
    regions: [...regions].sort(),
    oldestMachineAgeHours: oldest === null ? null : Math.round(oldest * 10) / 10,
  };
}
