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
}
