/**
 * Subdivider vertical SD-5 — lot-by-lot pricing rules editor.
 *
 * Brigid §5: "Lots are not interchangeable. A corner lot with 200 feet of
 * road frontage and a creek view sells for $85K. The interior lot two over
 * with no view sells for $52K. The lot at the end of the cul-de-sac with
 * the great trees sells for $95K. Pricing is per-lot and the premium logic
 * is rule-based — corner +10%, road frontage > 150ft +8%, water feature
 * +15%, etc."
 *
 * Server provides:
 *   GET  /api/parcels/:id/pricing-rules         — load rules for a parent
 *   PUT  /api/parcels/:id/pricing-rules         — upsert rules (single set/parent)
 *   POST /api/parcels/:id/pricing-rules/preview — compute proposed grid
 *   POST /api/parcels/:id/pricing-rules/lock    — freeze grid + write listPrice
 *
 * Per-child attributes the rules can match against come from the
 * subdivision_plan geojson (when available) and a small `pricing_facts`
 * jsonb stored in property.dueDiligenceData (operator-supplied because
 * we don't yet have a structured place for cul-de-sac / corner / view).
 */

import type { Express, Response } from "express";
import { z } from "zod";
import { and, eq, asc } from "drizzle-orm";
import { db } from "./db";
import { lotPricingRules, properties } from "@shared/schema";
import {
  deriveBasePerAcreCents as deriveBasePerAcreCentsPure,
  computeLotPricingGrid,
} from "@shared/subdivision/lotPricing";
import type { AuthenticatedRequest } from "./types/request";
import { getOrganizationId, getUserId } from "./types/request";
import { isAuthenticated } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";

const ruleSchema = z.object({
  attribute: z.string().min(1).max(64),
  operator: z.enum(["==", ">", "<", ">=", "<="]),
  threshold: z.union([z.number(), z.string(), z.boolean()]).optional(),
  premiumPct: z.number(),  // signed: 0.10 = +10%, -0.10 = -10%
  label: z.string().optional(),
});

const upsertSchema = z.object({
  name: z.string().min(1).max(120),
  basePriceSource: z.enum(["avm_per_acre", "fixed_per_acre"]).default("avm_per_acre"),
  fixedPerAcreCents: z.coerce.number().int().nonnegative().nullable().optional(),
  rules: z.array(ruleSchema).default([]),
});

interface ChildFacts {
  id: number;
  childLotNumber: string | null;
  sizeAcres: number;
  attributes: Record<string, number | string | boolean>;
}

/**
 * Pull child-lot rows + extract per-lot facts the rules engine evaluates.
 * Facts come from:
 *   - properties columns (sizeAcres → 'acres', zoning → 'zoning')
 *   - properties.dueDiligenceData.pricingFacts (operator-typed, jsonb):
 *       { corner?: bool, frontage?: number, water_feature?: bool,
 *         cul_de_sac?: bool, view?: string, wooded?: bool }
 */
async function loadChildFacts(orgId: number, parentId: number): Promise<ChildFacts[]> {
  const rows = await db
    .select({
      id: properties.id,
      childLotNumber: properties.childLotNumber,
      sizeAcres: properties.sizeAcres,
      zoning: properties.zoning,
      dd: properties.dueDiligenceData,
    })
    .from(properties)
    .where(and(
      eq(properties.organizationId, orgId),
      eq(properties.parentParcelId, parentId),
    ))
    .orderBy(asc(properties.childLotNumber));

  return rows.map((r) => {
    const acres = parseFloat(r.sizeAcres ?? "0") || 0;
    const dd = (r.dd as any) ?? {};
    const facts = (dd.pricingFacts as Record<string, any>) ?? {};
    return {
      id: r.id,
      childLotNumber: r.childLotNumber,
      sizeAcres: acres,
      attributes: {
        acres,
        zoning: r.zoning ?? "",
        ...facts,
      },
    };
  });
}

// evaluateRules + the premium-grid math + the base-per-acre derivation now live
// in the pure, behaviourally-tested engine (@shared/subdivision/lotPricing).
// This route DELEGATES to it; the DB loads stay here.

async function deriveBasePerAcreCents(
  orgId: number,
  parentId: number,
  rules: { basePriceSource: string; fixedPerAcreCents: number | null },
): Promise<number | null> {
  // Fixed-rate base needs no parent load — short-circuit before the DB hit.
  if (rules.basePriceSource === "fixed_per_acre" && rules.fixedPerAcreCents) {
    return rules.fixedPerAcreCents;
  }
  // Pull the parent and let the pure engine derive — or REFUSE — the base off the
  // parent's OWN market value / purchase price ÷ acreage. Never a residential comp.
  const [p] = await db
    .select({
      marketValue: properties.marketValue,
      purchasePrice: properties.purchasePrice,
      sizeAcres: properties.sizeAcres,
    })
    .from(properties)
    .where(and(eq(properties.id, parentId), eq(properties.organizationId, orgId)));
  if (!p) return null;

  return deriveBasePerAcreCentsPure({
    source: rules.basePriceSource,
    fixedPerAcreCents: rules.fixedPerAcreCents,
    marketValueCents: Math.round((parseFloat(p.marketValue ?? "0") || 0) * 100),
    purchasePriceCents: Math.round((parseFloat(p.purchasePrice ?? "0") || 0) * 100),
    acres: parseFloat(p.sizeAcres ?? "0") || 0,
  });
}

export function registerLotPricingRoutes(app: Express): void {
  // GET — load the (single, parent-scoped) ruleset.
  app.get(
    "/api/parcels/:id/pricing-rules",
    isAuthenticated,
    getOrCreateOrg,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const parentId = parseInt(req.params.id, 10);
        if (!Number.isFinite(parentId)) return Errors.badRequest(res, "Invalid parcel id");

        const [r] = await db
          .select()
          .from(lotPricingRules)
          .where(and(
            eq(lotPricingRules.organizationId, orgId),
            eq(lotPricingRules.parentParcelId, parentId),
          ));

        return res.json({ rules: r ?? null });
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );

  // PUT — upsert the parent's ruleset (one ruleset per parent for v1).
  app.put(
    "/api/parcels/:id/pricing-rules",
    isAuthenticated,
    getOrCreateOrg,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const userId = getUserId(req);
        const parentId = parseInt(req.params.id, 10);
        if (!Number.isFinite(parentId)) return Errors.badRequest(res, "Invalid parcel id");

        const parsed = upsertSchema.safeParse(req.body);
        if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);

        const [existing] = await db
          .select({ id: lotPricingRules.id })
          .from(lotPricingRules)
          .where(and(
            eq(lotPricingRules.organizationId, orgId),
            eq(lotPricingRules.parentParcelId, parentId),
          ));

        if (existing) {
          const [updated] = await db
            .update(lotPricingRules)
            .set({
              name: parsed.data.name,
              basePriceSource: parsed.data.basePriceSource,
              fixedPerAcreCents: parsed.data.fixedPerAcreCents ?? null,
              rules: parsed.data.rules,
              updatedAt: new Date(),
            })
            .where(eq(lotPricingRules.id, existing.id))
            .returning();
          return res.json({ rules: updated });
        }

        const [created] = await db
          .insert(lotPricingRules)
          .values({
            organizationId: orgId,
            parentParcelId: parentId,
            name: parsed.data.name,
            basePriceSource: parsed.data.basePriceSource,
            fixedPerAcreCents: parsed.data.fixedPerAcreCents ?? null,
            rules: parsed.data.rules,
          })
          .returning();

        logger.info("[SD-5] pricing rules created", { orgId, userId, parentId });
        return res.status(201).json({ rules: created });
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );

  // POST /preview — compute the proposed asking-price grid (no DB write).
  app.post(
    "/api/parcels/:id/pricing-rules/preview",
    isAuthenticated,
    getOrCreateOrg,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const parentId = parseInt(req.params.id, 10);
        if (!Number.isFinite(parentId)) return Errors.badRequest(res, "Invalid parcel id");

        const [rules] = await db
          .select()
          .from(lotPricingRules)
          .where(and(
            eq(lotPricingRules.organizationId, orgId),
            eq(lotPricingRules.parentParcelId, parentId),
          ));
        if (!rules) return Errors.notFound(res, "Pricing rules (PUT first)");

        const basePerAcre = await deriveBasePerAcreCents(orgId, parentId, rules);
        if (basePerAcre === null) {
          return Errors.badRequest(
            res,
            "Cannot derive base price: parent has no market value/purchase price/acreage. Set basePriceSource to fixed_per_acre + fixedPerAcreCents to override.",
          );
        }

        const facts = await loadChildFacts(orgId, parentId);
        const grid = computeLotPricingGrid(basePerAcre, facts, rules.rules ?? []);

        return res.json({
          basePerAcreCents: basePerAcre,
          basePriceSource: rules.basePriceSource,
          grid,
        });
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );

  // POST /lock — freeze the computed grid and push asking prices to listPrice.
  app.post(
    "/api/parcels/:id/pricing-rules/lock",
    isAuthenticated,
    getOrCreateOrg,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const userId = getUserId(req);
        const parentId = parseInt(req.params.id, 10);
        if (!Number.isFinite(parentId)) return Errors.badRequest(res, "Invalid parcel id");

        // Allow operator-supplied overrides — { childParcelId: askingCents }.
        const overrides = (req.body?.overrides ?? {}) as Record<string, number>;

        const [rules] = await db
          .select()
          .from(lotPricingRules)
          .where(and(
            eq(lotPricingRules.organizationId, orgId),
            eq(lotPricingRules.parentParcelId, parentId),
          ));
        if (!rules) return Errors.notFound(res, "Pricing rules");

        const basePerAcre = await deriveBasePerAcreCents(orgId, parentId, rules);
        if (basePerAcre === null) return Errors.badRequest(res, "Cannot derive base price");

        const facts = await loadChildFacts(orgId, parentId);
        const lockedGrid = computeLotPricingGrid(basePerAcre, facts, rules.rules ?? []).map((row) => {
          // The engine computes the rules-derived asking price; an operator override
          // (if supplied for this lot) wins at lock time.
          const override = overrides[String(row.childParcelId)];
          return {
            childParcelId: row.childParcelId,
            basePriceCents: row.basePriceCents,
            premiumPct: row.premiumPct,
            askingPriceCents: typeof override === "number" ? override : row.askingPriceCents,
            override: typeof override === "number",
          };
        });

        await db.transaction(async (tx) => {
          await tx.update(lotPricingRules).set({
            lockedGrid,
            lockedAt: new Date(),
            updatedAt: new Date(),
          }).where(eq(lotPricingRules.id, rules.id));

          for (const row of lockedGrid) {
            await tx.update(properties).set({
              listPrice: String(row.askingPriceCents / 100),
              updatedAt: new Date(),
            }).where(and(
              eq(properties.id, row.childParcelId),
              eq(properties.organizationId, orgId),
            ));
          }
        });

        logger.info("[SD-5] pricing grid locked", { orgId, userId, parentId, lotCount: lockedGrid.length });
        return res.json({ lockedGrid, lockedAt: new Date().toISOString() });
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );
}
