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

// ─── Destructive operations (Phase G/H/I batch 2) ───────────────────────────
// These methods are ONLY invoked from a confirmed Tier-3 tool handler (see
// tools/operations.ts). The kill-switch + cooldown live in the executor, NOT
// here — this layer just talks to the Fly API.

/** POST /apps/:app/machines/:id/restart — returns the API ack. */
export async function restartMachine(
  machineId: string,
  app?: string,
): Promise<{ ok: boolean; raw: unknown }> {
  const raw = await flyFetch<unknown>(
    `/apps/${appName(app)}/machines/${encodeURIComponent(machineId)}/restart`,
    { method: "POST" },
  );
  return { ok: true, raw };
}

/**
 * Scale a process group to N machines. The Fly Machines API does this by
 * cloning / removing machines; we use the higher-level /apps/:app/processes
 * scale endpoint when present, and fall back to a POST against the
 * /apps/:app/scale endpoint shape used by older flyctl.
 */
export async function scaleApp(
  processGroup: string,
  count: number,
  app?: string,
): Promise<{ ok: boolean; raw: unknown }> {
  const body = JSON.stringify({ process_group: processGroup, count });
  try {
    const raw = await flyFetch<unknown>(`/apps/${appName(app)}/scale`, {
      method: "POST",
      body,
    });
    return { ok: true, raw };
  } catch (err) {
    if (err instanceof FlyClientError && (err.status === 404 || err.status === 405)) {
      logger.warn("[fly] /scale not available; falling back to process-group POST", {
        metadata: { app: appName(app), processGroup, count, status: err.status },
      });
      const raw = await flyFetch<unknown>(
        `/apps/${appName(app)}/processes/${encodeURIComponent(processGroup)}/scale`,
        { method: "POST", body: JSON.stringify({ count }) },
      );
      return { ok: true, raw };
    }
    throw err;
  }
}

/**
 * Set (or rotate) a Fly secret. ONLY called from the sealed-paste
 * endpoint — never from a tool handler. The value never enters the
 * LLM context. Returns a SHA-256 fingerprint of the value so the audit
 * row can later prove "same value as last time" without revealing it.
 */
export async function setSecret(
  keyName: string,
  value: string,
  app?: string,
): Promise<{ fingerprint: string; raw: unknown }> {
  if (!keyName || !/^[A-Z][A-Z0-9_]{2,}$/.test(keyName)) {
    throw new FlyClientError(
      `Invalid secret name '${keyName}' — must be UPPER_SNAKE_CASE`,
      400,
      "",
    );
  }
  if (typeof value !== "string" || value.length < 1) {
    throw new FlyClientError(`Secret value missing`, 400, "");
  }
  const { createHash } = await import("node:crypto");
  const fingerprint = createHash("sha256").update(value).digest("hex");
  const body = JSON.stringify({ secrets: { [keyName]: value } });
  const raw = await flyFetch<unknown>(`/apps/${appName(app)}/secrets`, {
    method: "POST",
    body,
  });
  return { fingerprint, raw };
}

/**
 * Trigger a deploy by dispatching the deploy.yml workflow on GitHub. We
 * route deploys through GitHub Actions (not the Machines API direct)
 * because that's where the build pipeline lives.
 */
export async function triggerDeploy(
  commitSha?: string,
): Promise<{ ok: boolean; commitSha: string }> {
  const { dispatchWorkflow, latestMainSha } = await import("./github");
  const ref = commitSha ?? (await latestMainSha());
  await dispatchWorkflow("deploy.yml", "main", { sha: ref });
  return { ok: true, commitSha: ref };
}

/**
 * Roll back to a prior release. The Machines API doesn't expose a
 * dedicated rollback for all app types; the universal path is "re-deploy
 * the image_ref of the desired prior version", which we do via the
 * deploy workflow.
 */
export async function rollbackToVersion(version: number): Promise<{ ok: boolean; version: number }> {
  const { dispatchWorkflow } = await import("./github");
  await dispatchWorkflow("deploy.yml", "main", { rollback_version: String(version) });
  return { ok: true, version };
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
