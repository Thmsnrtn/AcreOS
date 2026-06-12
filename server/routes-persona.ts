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
// but the sidebar still detected "Fix & Flip" (2026-06-12). On every persona
// change we reconcile the org to a representative businessType + investorType
// so the whole app follows one source of truth. Mirrors (the inverse of)
// BUSINESS_TYPE_TO_PERSONA in client OnboardingWizard.tsx.
const PERSONA_TO_BUSINESS_TYPE: Record<string, string> = {
  land_investor: "land_flipper",
  note_investor: "note_investor",
  note_originator: "note_investor",
  note_servicer: "note_investor",
  tax_delinquent: "tax_lien_deed",
  wholesaler: "residential_wholesaler",
  subdivider: "subdivider",
  fix_flipper: "fix_and_flip",
  landlord: "buy_and_hold",
};

function personaToInvestorType(persona: string): "land" | "notes" {
  return persona === "note_investor" ||
    persona === "note_originator" ||
    persona === "note_servicer"
    ? "notes"
    : "land";
}

// Must stay in lockstep with the Persona union in shared/models/auth.ts and
// the client PERSONAS list (client/src/lib/personaVocabulary.ts). note_originator
// and note_servicer (Pillar K) were added to the union + client radio but
// omitted here, so selecting either 422'd on save — the "changing investor
// type throws an error" bug (Tom, 2026-06-12). Keep all nine in sync.
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
    await db
      .update(users)
      .set({ persona, updatedAt: new Date() })
      .where(eq(users.id, userId));

    // Reconcile the org's coarse type so the sidebar/detection follows the
    // user's explicit persona choice. Best-effort: a sync miss must not fail
    // the persona change itself (the primary, user-initiated action), so we
    // log and continue rather than 500.
    try {
      const orgId = getOrganizationId(req);
      const [org] = await db
        .select({ onboardingData: organizations.onboardingData })
        .from(organizations)
        .where(eq(organizations.id, orgId))
        .limit(1);
      const businessType = PERSONA_TO_BUSINESS_TYPE[persona] ?? "land_flipper";
      await db
        .update(organizations)
        .set({
          investorType: personaToInvestorType(persona),
          // Merge — never clobber the rest of the onboarding JSON.
          onboardingData: { ...(org?.onboardingData ?? {}), businessType: businessType as never },
        })
        .where(eq(organizations.id, orgId));
    } catch (syncErr) {
      logger.warn("Persona→org reconcile failed (persona still saved)", {
        userId,
        persona,
        error: syncErr instanceof Error ? syncErr.message : String(syncErr),
      });
    }

    logger.info("Persona updated", { userId, persona });
    res.json({ persona });
  } catch (error) {
    Errors.internal(res, error);
  }
});

export default router;
