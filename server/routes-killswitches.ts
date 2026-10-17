/**
 * routes-killswitches — Kill Switch status and control API for the AI COO.
 *
 * GET  /api/ops/kill-switches       — status of all four switches
 * POST /api/ops/kill-switches/:name — engage or release a switch
 *   body: { action: "engage" | "release", reasoning?: string }
 *
 * Switches:
 *  - deploy_freeze      → sets GitHub variable DEPLOY_FROZEN (workflows enforce)
 *  - autopilot_pause    → ledger actionType='autopilot_pause' / 'autopilot_resume'
 *  - coo_stand_down     → ledger actionType='coo_stand_down' / 'coo_stand_up'
 *  - cost_circuit_breaker → read-only status; trips automatically on threshold
 *                           (manual reset logs cost_circuit_breaker_reset)
 *
 * Auth: Same bearer <redacted> as /api/ops/* (OPS_SERVICE_TOKEN).
 * Follows the routes-ledger.ts auth pattern.
 *
 * Implemented 2026-10-17.
 */

import type { Express, Request, Response } from "express";
import crypto from "crypto";
import { Errors, sendError } from "./utils/errors";
import { logger } from "./utils/logger";
import {
  getKillSwitchStatus,
  logKillSwitchEvent,
  type KillSwitchName,
} from "./services/killSwitches";

function opsServiceAuth(req: Request, res: Response, next: Function): void {
  const expected = process.env.OPS_SERVICE_TOKEN;
  if (!expected) {
    sendError(res, 503, "UNAVAILABLE", "Ops API not configured");
    return;
  }
  if (req.method !== "GET" && req.method !== "HEAD" && req.method !== "POST") {
    sendError(res, 403, "FORBIDDEN", "Ops service token is read-only except kill-switch control");
    return;
  }
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith("Bearer ")) {
    sendError(res, 401, "UNAUTHORIZED", "Missing bearer <redacted>");
    return;
  }
  const token = auth.slice("Bearer ".length).trim();
  const a = Buffer.from(token, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    sendError(res, 401, "UNAUTHORIZED", "Invalid token");
    return;
  }
  (next as Function)();
}

const VALID_SWITCHES: KillSwitchName[] = [
  "deploy_freeze",
  "autopilot_pause",
  "coo_stand_down",
  "cost_circuit_breaker",
];

/** Maps (switch, action) → ledger actionType */
function toActionType(
  name: KillSwitchName,
  action: "engage" | "release",
): string {
  const map: Record<string, string> = {
    "deploy_freeze:engage": "deploy_freeze",
    "deploy_freeze:release": "deploy_unfreeze",
    "autopilot_pause:engage": "autopilot_pause",
    "autopilot_pause:release": "autopilot_resume",
    "coo_stand_down:engage": "coo_stand_down",
    "coo_stand_down:release": "coo_stand_up",
    "cost_circuit_breaker:engage": "cost_circuit_breaker_triggered",
    "cost_circuit_breaker:release": "cost_circuit_breaker_reset",
  };
  return map[`${name}:${action}`];
}

export function registerKillSwitchRoutes(app: Express): void {
  // Status of all switches — the dashboard payload
  app.get("/api/ops/kill-switches", opsServiceAuth, async (_req: Request, res: Response) => {
    try {
      const status = await getKillSwitchStatus();
      res.json(status);
    } catch (err) {
      logger.error("[/api/ops/kill-switches] failed", err instanceof Error ? err : undefined);
      return Errors.internal(res);
    }
  });

  // Engage or release a switch
  app.post("/api/ops/kill-switches/:name", opsServiceAuth, async (req: Request, res: Response) => {
    try {
      const name = req.params.name as KillSwitchName;
      if (!VALID_SWITCHES.includes(name)) {
        return Errors.badRequest(res, `Unknown switch: ${name}. Valid: ${VALID_SWITCHES.join(", ")}`);
      }
      const { action, reasoning } = req.body ?? {};
      if (action !== "engage" && action !== "release") {
        return Errors.badRequest(res, `action must be "engage" or "release"`);
      }

      // cost_circuit_breaker engages automatically; manual engage is a no-op log
      // (release = manual reset, e.g. Tom approves continued spending)
      const actionType = toActionType(name, action) as Parameters<typeof logKillSwitchEvent>[1];
      const actor = "coo"; // via service token; founder dashboard passes actor=founder

      await logKillSwitchEvent(
        actor,
        actionType,
        typeof reasoning === "string" && reasoning.length > 0
          ? reasoning
          : `Kill switch ${name} ${action}d via ops API`,
      );

      // For deploy_freeze, Tom (or COO with GitHub access) must also flip the
      // GitHub variable — the workflow is the enforcer. Note it in the response.
      const note =
        name === "deploy_freeze"
          ? "Also set GitHub variable DEPLOY_FROZEN=true/false — the workflows enforce it; this ledger entry is the audit trail."
          : undefined;

      const status = await getKillSwitchStatus();
      res.json({ ok: true, action, switch: name, note, status });
    } catch (err) {
      logger.error("[/api/ops/kill-switches] control failed", err instanceof Error ? err : undefined);
      return Errors.internal(res);
    }
  });
}
