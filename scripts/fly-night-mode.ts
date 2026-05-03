/**
 * fly-night-mode.ts — Off-hours Fly.io scale-down for AcreOS.
 *
 * Why this exists
 * ───────────────
 * Production runs 2× performance VMs (2 CPU / 4 GB) in `iad`, always warm:
 *
 *   [http_service]
 *     auto_stop_machines    = 'off'
 *     min_machines_running  = 2
 *
 * That's ~$80–100/mo. Customer traffic between 02:00–06:00 UTC is near-zero
 * across our customer base (US land investors are asleep), so we can safely
 * run on a single warm machine for those four hours and recoup ~30–40%.
 *
 * Hard guardrails (must hold):
 *   1. NEVER scale to 0 — we always keep at least 1 warm machine.
 *   2. Skip Fridays + Saturdays UTC — high-volume mailer prep days.
 *   3. Skip if a P0 or P1 incident is currently un-acked.
 *   4. Idempotent — re-running the flip is a no-op.
 *
 * How it's invoked
 * ────────────────
 * Wired into the self-rescheduling job framework (`server/jobs/scheduler.ts`)
 * as `fly_night_mode`. Ticks every 5 minutes, checks the wall clock, and
 * flips at the boundary windows:
 *
 *     02:00 UTC  → scale min_machines_running from 2 → 1   (sleep)
 *     06:00 UTC  → scale min_machines_running from 1 → 2   (wake)
 *
 * The flip is performed against the Fly Machines API:
 *   PATCH https://api.machines.dev/v1/apps/{app}/services
 *
 * Required env:
 *   FLY_API_TOKEN  — fly auth token (deploy token works)
 *   FLY_APP_NAME   — defaults to 'acreos'
 *
 * Disabled in non-prod (NODE_ENV !== 'production') and when FLY_API_TOKEN
 * is missing — the function returns 0 records processed without erroring.
 */

import { and, isNull, inArray } from "drizzle-orm";
import { db } from "../server/db";
import { criticalAlertAcks } from "@shared/schema";
import { logger } from "../server/utils/logger";

export const FLY_API_BASE = "https://api.machines.dev/v1";
export const TARGET_DAY_MIN = 2; // wake state — current production default
export const TARGET_NIGHT_MIN = 1; // sleep state — never zero
export const NIGHT_START_HOUR_UTC = 2; // 02:00 UTC
export const NIGHT_END_HOUR_UTC = 6; // 06:00 UTC

/** UTC weekday numbers we skip the flip on (Friday=5, Saturday=6). */
export const HIGH_TRAFFIC_WEEKDAYS_UTC = new Set<number>([5, 6]);

export type NightModeDecision =
  | { action: "noop"; reason: string; targetMin: number }
  | { action: "scale-down"; targetMin: number }
  | { action: "scale-up"; targetMin: number };

/**
 * Decide what to do at this clock moment, given (a) current min_machines_running
 * and (b) whether an active P0/P1 incident is in flight.
 *
 * Pure — fully unit-testable; no IO.
 */
export function decideNightMode(opts: {
  now: Date;
  currentMin: number;
  hasActiveIncident: boolean;
}): NightModeDecision {
  const { now, currentMin, hasActiveIncident } = opts;
  const day = now.getUTCDay();
  const hour = now.getUTCHours();

  if (hasActiveIncident) {
    return {
      action: "noop",
      reason: "active P0/P1 incident — holding at current scale",
      targetMin: currentMin,
    };
  }

  if (HIGH_TRAFFIC_WEEKDAYS_UTC.has(day)) {
    // We still want to wake on Sat morning if we're somehow asleep, but never
    // scale down on Fri/Sat. The logic below handles "wake even on Fri/Sat".
    if (currentMin < TARGET_DAY_MIN) {
      return { action: "scale-up", targetMin: TARGET_DAY_MIN };
    }
    return {
      action: "noop",
      reason: "Fri/Sat UTC high-traffic window — no scale-down",
      targetMin: currentMin,
    };
  }

  const inNightWindow = hour >= NIGHT_START_HOUR_UTC && hour < NIGHT_END_HOUR_UTC;

  if (inNightWindow) {
    if (currentMin > TARGET_NIGHT_MIN) {
      return { action: "scale-down", targetMin: TARGET_NIGHT_MIN };
    }
    return {
      action: "noop",
      reason: "already at night-mode min",
      targetMin: currentMin,
    };
  }

  // Outside the night window — restore day-mode.
  if (currentMin < TARGET_DAY_MIN) {
    return { action: "scale-up", targetMin: TARGET_DAY_MIN };
  }
  return {
    action: "noop",
    reason: "already at day-mode min",
    targetMin: currentMin,
  };
}

/**
 * Returns true iff there is at least one un-acknowledged P0 or P1 critical
 * alert. We hold scale at current level if so — never pull capacity during
 * a live incident.
 */
export async function hasActiveP0P1Incident(): Promise<boolean> {
  try {
    const rows = await db
      .select({ id: criticalAlertAcks.id })
      .from(criticalAlertAcks)
      .where(
        and(
          inArray(criticalAlertAcks.severity, ["P0", "P1"]),
          isNull(criticalAlertAcks.ackedAt),
        ),
      )
      .limit(1);
    return rows.length > 0;
  } catch (err) {
    // Fail-closed — if we can't read the table, assume there might be an
    // incident and skip the flip. Safer than ripping capacity blind.
    logger.warn("[fly-night-mode] incident lookup failed; treating as active", {
      metadata: { error: err instanceof Error ? err.message : String(err) },
    });
    return true;
  }
}

interface FlyService {
  protocol?: string;
  internal_port?: number;
  ports?: unknown[];
  concurrency?: { type?: string; soft_limit?: number; hard_limit?: number };
  // Some Fly API revisions expose autoscaling on the service:
  min_machines_running?: number;
  auto_stop_machines?: string | boolean;
  auto_start_machines?: boolean;
  [k: string]: unknown;
}

interface FlyMachine {
  id: string;
  name: string;
  region: string;
  state: string;
  config?: {
    services?: FlyService[];
    [k: string]: unknown;
  };
}

/**
 * Read the current min_machines_running value off the live Fly app config.
 * Implementation reads the first machine's services[].min_machines_running
 * (Fly stores this per-service, not per-app, even though the toml looks
 * app-scoped).
 */
export async function readCurrentMinMachines(opts: {
  flyApiToken: string;
  flyAppName: string;
  fetchImpl?: typeof fetch;
}): Promise<number> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const res = await fetchImpl(
    `${FLY_API_BASE}/apps/${opts.flyAppName}/machines`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${opts.flyApiToken}`,
        "Content-Type": "application/json",
      },
    },
  );
  if (!res.ok) {
    throw new Error(
      `Fly API GET /machines returned ${res.status} ${res.statusText}`,
    );
  }
  const machines = (await res.json()) as FlyMachine[];
  for (const m of machines) {
    const svc = m.config?.services?.[0];
    if (svc && typeof svc.min_machines_running === "number") {
      return svc.min_machines_running;
    }
  }
  // Default to current production value if not set on any machine.
  return TARGET_DAY_MIN;
}

/**
 * Flip min_machines_running on the live app. We update each running machine's
 * services[0].min_machines_running and PATCH the machine config — Fly merges
 * the rest of the config and only the autoscaling fields change.
 *
 * Hard guardrail: targetMin is clamped to >= 1 before any HTTP call.
 */
export async function setMinMachines(opts: {
  flyApiToken: string;
  flyAppName: string;
  targetMin: number;
  fetchImpl?: typeof fetch;
}): Promise<{ updated: number }> {
  const fetchImpl = opts.fetchImpl ?? fetch;

  // ── HARD GUARDRAIL ─────────────────────────────────────────────────────
  // Never, under any circumstances, send a value < 1 to the Fly API. This
  // is the last line of defence against an off-by-one or a misconfigured
  // env flipping the customer-facing service to zero warm machines.
  const safeTarget = Math.max(1, Math.floor(opts.targetMin));
  if (safeTarget !== opts.targetMin) {
    logger.warn("[fly-night-mode] clamped targetMin to safe minimum", {
      metadata: { requested: opts.targetMin, clamped: safeTarget },
    });
  }

  const listRes = await fetchImpl(
    `${FLY_API_BASE}/apps/${opts.flyAppName}/machines`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${opts.flyApiToken}`,
        "Content-Type": "application/json",
      },
    },
  );
  if (!listRes.ok) {
    throw new Error(
      `Fly API GET /machines returned ${listRes.status} ${listRes.statusText}`,
    );
  }
  const machines = (await listRes.json()) as FlyMachine[];

  let updated = 0;
  for (const m of machines) {
    if (!m.config?.services?.length) continue;
    const newServices = m.config.services.map((svc, idx) =>
      idx === 0 ? { ...svc, min_machines_running: safeTarget } : svc,
    );
    const newConfig = { ...m.config, services: newServices };

    const updateRes = await fetchImpl(
      `${FLY_API_BASE}/apps/${opts.flyAppName}/machines/${m.id}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${opts.flyApiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ config: newConfig }),
      },
    );
    if (!updateRes.ok) {
      throw new Error(
        `Fly API POST /machines/${m.id} returned ${updateRes.status} ${updateRes.statusText}`,
      );
    }
    updated++;
  }
  return { updated };
}

/**
 * One tick of the night-mode scheduler. Returns the number of machines whose
 * config was changed (0 on noop). Designed for `scheduleSelfRescheduling`.
 */
export async function runFlyNightModeTick(opts?: {
  now?: Date;
  flyApiToken?: string;
  flyAppName?: string;
  fetchImpl?: typeof fetch;
}): Promise<number> {
  const now = opts?.now ?? new Date();
  const flyApiToken = opts?.flyApiToken ?? process.env.FLY_API_TOKEN;
  const flyAppName = opts?.flyAppName ?? process.env.FLY_APP_NAME ?? "acreos";

  if (!flyApiToken) {
    // Local dev / preview environments — skip silently.
    return 0;
  }
  if (process.env.NODE_ENV !== "production") {
    return 0;
  }

  let currentMin: number;
  try {
    currentMin = await readCurrentMinMachines({
      flyApiToken,
      flyAppName,
      fetchImpl: opts?.fetchImpl,
    });
  } catch (err) {
    logger.error("[fly-night-mode] failed to read current min_machines", err);
    throw err;
  }

  const hasActiveIncident = await hasActiveP0P1Incident();

  const decision = decideNightMode({ now, currentMin, hasActiveIncident });

  if (decision.action === "noop") {
    logger.info("[fly-night-mode] noop", {
      metadata: {
        reason: decision.reason,
        currentMin,
        hourUtc: now.getUTCHours(),
        dayUtc: now.getUTCDay(),
        hasActiveIncident,
      },
    });
    return 0;
  }

  logger.info(`[fly-night-mode] ${decision.action}`, {
    metadata: {
      currentMin,
      targetMin: decision.targetMin,
      hourUtc: now.getUTCHours(),
      dayUtc: now.getUTCDay(),
    },
  });

  const { updated } = await setMinMachines({
    flyApiToken,
    flyAppName,
    targetMin: decision.targetMin,
    fetchImpl: opts?.fetchImpl,
  });

  logger.info(`[fly-night-mode] flip complete`, {
    metadata: { action: decision.action, updated, targetMin: decision.targetMin },
  });

  return updated;
}
