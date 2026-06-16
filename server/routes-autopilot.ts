/**
 * Founder Autopilot — Trust Ledger control plane (founder HTTP surface).
 *
 *   GET  /api/founder/autopilot/trust-ledger            — every domain's standing
 *   POST /api/founder/autopilot/domains/:domain/level   — sovereign override:
 *                                                          pause (→ observe) or
 *                                                          grant trust, with a reason
 *
 * Auth: isAuthenticated + requireFounder (404 for non-founder per the existing
 * founder-routes pattern). This is the reversibility/control guarantee — the
 * founder can always pause or re-trust any domain directly from the UI.
 */
import type { Express, Response } from "express";
import { isAuthenticated, requireFounder } from "./auth";
import type { AuthenticatedRequest } from "./types/request";
import { getUserId } from "./types/request";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";
import {
  getTrustLedger,
  setDomainLevel,
  AUTOPILOT_DOMAINS,
  DOMAIN_AUTONOMY_LEVELS,
  type DomainAutonomyLevel,
} from "./services/autopilot/domainAutonomy";
import type { AutopilotDomain } from "./services/autopilot/policyGate";
import {
  createStandingOrder,
  listStandingOrders,
  deactivateStandingOrder,
  STANDING_ORDER_KINDS,
  type StandingOrderKind,
} from "./services/autopilot/standingOrders";

export function registerAutopilotRoutes(app: Express): void {
  // ── GET the Trust Ledger ────────────────────────────────────────────────
  app.get(
    "/api/founder/autopilot/trust-ledger",
    isAuthenticated,
    requireFounder,
    async (_req: AuthenticatedRequest, res: Response) => {
      try {
        const ledger = await getTrustLedger();
        return res.json({ ledger });
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );

  // ── POST set a domain's autonomy level (founder sovereign override) ──────
  app.post(
    "/api/founder/autopilot/domains/:domain/level",
    isAuthenticated,
    requireFounder,
    async (req: AuthenticatedRequest, res: Response) => {
      const domain = req.params.domain as AutopilotDomain;
      const { level, reason } = (req.body ?? {}) as { level?: string; reason?: string };

      if (!AUTOPILOT_DOMAINS.includes(domain)) {
        return Errors.badRequest(res, `Unknown domain "${domain}"`, {
          allowed: AUTOPILOT_DOMAINS,
        });
      }
      if (!level || !DOMAIN_AUTONOMY_LEVELS.includes(level as DomainAutonomyLevel)) {
        return Errors.badRequest(res, `Invalid level`, { allowed: DOMAIN_AUTONOMY_LEVELS });
      }
      const trimmedReason = (reason ?? "").trim() || "founder override (no reason given)";

      try {
        const result = await setDomainLevel(domain, level as DomainAutonomyLevel, trimmedReason);
        logger.info("[autopilot] founder set domain level via API", { domain, level });
        return res.json({ ok: true, ...result });
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );

  // ── Standing orders + intents ("Your Voice") ────────────────────────────
  app.get(
    "/api/founder/autopilot/standing-orders",
    isAuthenticated,
    requireFounder,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const kind = req.query.kind as StandingOrderKind | undefined;
        const activeOnly = req.query.activeOnly === "true";
        const orders = await listStandingOrders({
          kind: kind && STANDING_ORDER_KINDS.includes(kind) ? kind : undefined,
          activeOnly,
        });
        return res.json({ orders });
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );

  app.post(
    "/api/founder/autopilot/standing-orders",
    isAuthenticated,
    requireFounder,
    async (req: AuthenticatedRequest, res: Response) => {
      const { kind, body } = (req.body ?? {}) as { kind?: string; body?: string };
      if (!kind || !STANDING_ORDER_KINDS.includes(kind as StandingOrderKind)) {
        return Errors.badRequest(res, "Invalid kind", { allowed: STANDING_ORDER_KINDS });
      }
      if (!body || body.trim().length === 0) {
        return Errors.badRequest(res, "body must be non-empty");
      }
      try {
        const created = await createStandingOrder({
          kind: kind as StandingOrderKind,
          body,
          createdBy: getUserId(req),
        });
        return res.json({ order: created });
      } catch (err) {
        if (err instanceof Error && /exceeds|non-empty|unknown kind/.test(err.message)) {
          return Errors.badRequest(res, err.message);
        }
        return Errors.internal(res, err);
      }
    },
  );

  app.delete(
    "/api/founder/autopilot/standing-orders/:id",
    isAuthenticated,
    requireFounder,
    async (req: AuthenticatedRequest, res: Response) => {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return Errors.badRequest(res, "Invalid id");
      }
      try {
        const { ok } = await deactivateStandingOrder(id);
        if (!ok) return Errors.notFound(res, "Standing order");
        return res.json({ ok: true });
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );
}
