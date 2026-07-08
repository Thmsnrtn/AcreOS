/**
 * /api/me/persona — investor archetype getter/setter (product-call #9 + JC#7).
 *
 * Persona drives onboarding path, default surfaces, and vocabulary
 * substitutions per VERTICAL-EXPANSION-PLAN.md. The column is a plain
 * text field (migrations/0031) so adding new personas only requires a
 * registry update on the client; this endpoint validates against the
 * Persona union from shared/models/auth.ts.
 *
 * GET    /api/me/persona  → { persona }
 * PUT    /api/me/persona  → set persona; returns the new value
 */

import { Router, type Response } from "express";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "./db";
import { users } from "@shared/models/auth";
import { organizations } from "@shared/schema";
import {
  BUSINESS_TYPES,
  BUSINESS_TYPE_TO_PERSONA,
  BUSINESS_TYPE_TO_INVESTOR_TYPE,
  PERSONA_TO_BUSINESS_TYPE,
  type BusinessType,
} from "@shared/models/persona-mapping";
import type { AuthenticatedRequest } from "./types/request";
import { getUserId, getOrganizationId } from "./types/request";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";

const router = Router();

// Persona is the user's explicit choice (settings radio). The sidebar's
// "what kind of investor is this?" detection + businessTypeOnly module gating
// read the ORG's coarse fields (organizations.investorType +
// onboardingData.businessType), set during onboarding. Changing the persona
// without reconciling those left the two divergent — Tom set "Land Investor"
// but the sidebar still detected "Fix & Flip" (2026-06-12). The persona ↔
// businessType ↔ investorType mapping now lives in one shared module.
//
// `businessType` is OPTIONAL on the body: onboarding passes the user's EXACT
// 15-value selection so this write agrees with the parallel complete-step
// write (no race, no coarsening, correct "both" investorType). Settings sends
// only `persona`, and we reconcile the org with a representative businessType
// ONLY when the current one collapses to a different persona (non-clobbering).
const personaSchema = z.object({
  persona: z.enum([
    "land_investor",
    "note_investor",
    "note_originator",
    "note_servicer",
    "tax_delinquent",
    "wholesaler",
    "subdivider",
    "fix_flipper",
    "landlord",
  ]),
  businessType: z.enum(BUSINESS_TYPES as unknown as [BusinessType, ...BusinessType[]]).optional(),
});

router.get("/", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = getUserId(req);
    const [row] = await db
      .select({ persona: users.persona })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    res.json({ persona: row?.persona ?? "land_investor" });
  } catch (error) {
    Errors.internal(res, error);
  }
});

router.put("/", getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = getUserId(req);
    const parsed = personaSchema.safeParse(req.body);
    if (!parsed.success) {
      return Errors.validationFailed(res, parsed.error.issues);
    }
    const persona = parsed.data.persona;
    const explicitBusinessType = parsed.data.businessType;
    await db
      .update(users)
      .set({ persona, updatedAt: new Date() })
      .where(eq(users.id, userId));

    // Reconcile the org's coarse type so the sidebar/detection follows the
    // user's choice. Best-effort: a sync miss must not fail the persona change
    // itself (the primary, user-initiated action), so we log and continue.
    try {
      const orgId = getOrganizationId(req);
      const [org] = await db
        .select({ onboardingData: organizations.onboardingData })
        .from(organizations)
        .where(eq(organizations.id, orgId))
        .limit(1);
      const currentBusinessType = (org?.onboardingData as { businessType?: BusinessType } | null)?.businessType;

      // Choose the businessType + investorType to write:
      //  - onboarding passes the EXACT 15-value selection → write it verbatim
      //    (matches the parallel complete-step write; yields correct "both").
      //  - settings sends only the persona → keep the existing specific
      //    businessType if it already collapses to this persona (non-clobber);
      //    otherwise fall back to the representative one.
      let nextBusinessType: BusinessType;
      if (explicitBusinessType) {
        nextBusinessType = explicitBusinessType;
      } else if (currentBusinessType && BUSINESS_TYPE_TO_PERSONA[currentBusinessType] === persona) {
        nextBusinessType = currentBusinessType;
      } else {
        nextBusinessType = PERSONA_TO_BUSINESS_TYPE[persona];
      }
      const nextInvestorType = BUSINESS_TYPE_TO_INVESTOR_TYPE[nextBusinessType];

      await db
        .update(organizations)
        .set({
          investorType: nextInvestorType,
          // Merge — never clobber the rest of the onboarding JSON.
          onboardingData: { ...(org?.onboardingData ?? {}), businessType: nextBusinessType },
        })
        .where(eq(organizations.id, orgId));
    } catch (syncErr) {
      logger.warn("Persona→org reconcile failed (persona still saved)", {
        userId,
        persona,
        error: syncErr instanceof Error ? syncErr.message : String(syncErr),
      });
    }

    logger.info("Persona updated", { userId, persona, businessType: explicitBusinessType ?? "(derived)" });
    res.json({ persona });
  } catch (error) {
    Errors.internal(res, error);
  }
});

export default router;
