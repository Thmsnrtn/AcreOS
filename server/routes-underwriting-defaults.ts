/**
 * /api/me/underwriting-defaults — org-scoped owner-finance defaults.
 *
 * Hank fix. blindOfferCalculator hardcoded 9% / 84 months. Texas land
 * standard (and the actual book of any operator writing notes today)
 * is 9.9% / 120 months / 20% down / no balloon. The hardcode meant
 * every blind-offer projection was ~30% off for the operators who
 * actually owner-finance their flips.
 *
 * The defaults live on `organizations.underwritingDefaults.ownerFinance`
 * (migration 0102). Null = legacy 9%/84mo behavior preserved.
 */

import type { Express } from "express";
import { z } from "zod";
import { isAuthenticated } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import {
  getOrganization,
  type AuthenticatedRequest,
} from "./types/request";
import { db } from "./storage";
import { organizations } from "@shared/schema";
import { eq } from "drizzle-orm";
import { logger } from "./utils/logger";
import { Errors } from "./utils/errors";

// Default surface read by the client when the org hasn't customised
// anything yet. Texas land standard, modelled after Hank's actual book.
const TEXAS_STANDARD_OWNER_FINANCE = {
  apr: 9.9,
  termMonths: 120,
  downPaymentPct: 20,
  balloon: false,
};

const ownerFinanceSchema = z.object({
  apr: z.number().min(0).max(36),
  termMonths: z.number().int().min(12).max(480),
  downPaymentPct: z.number().min(0).max(100),
  balloon: z.boolean(),
});

const patchSchema = z.object({
  ownerFinance: ownerFinanceSchema,
});

export function registerUnderwritingDefaultsRoutes(app: Express): void {
  app.get(
    "/api/me/underwriting-defaults",
    isAuthenticated,
    getOrCreateOrg,
    async (req, res) => {
      try {
        const org = getOrganization(req as AuthenticatedRequest);
        const current = (org as any).underwritingDefaults?.ownerFinance;
        // Surface the Texas standard as the suggestion when nothing is
        // saved yet — the client's labelled inputs prefill from this so
        // the operator sees a sensible default on first visit.
        res.json({
          ownerFinance: current ?? TEXAS_STANDARD_OWNER_FINANCE,
          isCustomised: !!current,
          suggested: TEXAS_STANDARD_OWNER_FINANCE,
        });
      } catch (err) {
        Errors.internal(res, err as Error);
      }
    },
  );

  app.patch(
    "/api/me/underwriting-defaults",
    isAuthenticated,
    getOrCreateOrg,
    async (req, res) => {
      try {
        const org = getOrganization(req as AuthenticatedRequest);
        const parsed = patchSchema.safeParse(req.body ?? {});
        if (!parsed.success) {
          return Errors.validationFailed(res, parsed.error.issues);
        }
        const next = {
          ...(((org as any).underwritingDefaults as Record<string, unknown>) ?? {}),
          ownerFinance: parsed.data.ownerFinance,
        };
        await db
          .update(organizations)
          .set({ underwritingDefaults: next as any, updatedAt: new Date() })
          .where(eq(organizations.id, org.id));
        logger.info("Updated org underwriting defaults", {
          orgId: org.id,
          ownerFinance: parsed.data.ownerFinance,
        });
        res.json({ ok: true, ownerFinance: parsed.data.ownerFinance });
      } catch (err) {
        Errors.internal(res, err as Error);
      }
    },
  );
}
