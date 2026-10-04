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
 *   POST /api/parcels/:id/pricing-rules/lock    — freeze grid + write listPrice,
 *        then record the lock as a subdivider decision citing a
 *        `subdivision_lot_sale` scenario (the predicted sell-out), with the
 *        operator's own review date
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
  LOT_PRICING_ENGINE_VERSION,
} from "@shared/subdivision/lotPricing";
import type { AuthenticatedRequest } from "./types/request";
import { getOrganizationId, getUserId } from "./types/request";
import { isAuthenticated } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";
import { formatCents } from "@shared/finance/cents";
import { ScenarioEngineError, type ScenarioAssumption } from "@shared/economics/scenario";
import { lotPriceInputKey } from "@shared/calculators/subdivisionLotSale";
import { recordScenario } from "./services/economics/scenarioStore";
import { recordDecision } from "./services/decisions/decisionStore";
import { previewUnderwriting } from "./services/underwriting/verticalDecision";

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

/**
 * What a lock must carry besides the grid. The economics are the operator's
 * answers the `subdivision_lot_sale` engine needs to turn the locked prices into
 * a prediction; the engine itself refuses out-of-range values with its own
 * reason, so they are only typed here.
 *
 * `reviewDueAt` is REQUIRED, though nullable: null is the answer "no set date",
 * and a missing key is refused rather than read as "never review", which is how
 * a decision loop stops closing. A past date would be due the instant it was
 * recorded.
 */
const optionalAmount = z.number().finite().optional();
const lockSchema = z.object({
  // Operator overrides — { childParcelId: askingCents }.
  overrides: z.record(z.string().regex(/^\d+$/), z.number().int().nonnegative()).default({}),
  economics: z
    .object({
      sellingCostPct: z.number().finite(),
      monthsToSellOut: z.number().finite(),
      // Used only when the parent parcel has no recorded purchase price.
      parentBasisCents: optionalAmount,
      surveyCents: optionalAmount,
      platCents: optionalAmount,
      permitsCents: optionalAmount,
      improvementsCents: optionalAmount,
      monthlyCarryCents: optionalAmount,
    })
    .strict(),
  reviewDueAt: z
    .string()
    .datetime()
    .nullable()
    .refine((d) => d === null || new Date(d).getTime() > Date.now(), {
      message: "A review date must be in the future.",
    }),
});

/**
 * The parent parcel's recorded cost basis: its purchase price, in cents. Null
 * when the parcel is not this org's or no purchase price is recorded — never a
 * guessed figure. The same source the basis allocation and the pro-forma read
 * (server/routes-lot-basis.ts).
 */
async function loadRecordedParentBasisCents(orgId: number, parentId: number): Promise<number | null> {
  const [p] = await db
    .select({ purchasePrice: properties.purchasePrice })
    .from(properties)
    .where(and(eq(properties.id, parentId), eq(properties.organizationId, orgId)));
  if (!p || p.purchasePrice === null || p.purchasePrice === undefined) return null;
  const dollars = parseFloat(p.purchasePrice);
  return Number.isFinite(dollars) ? Math.round(dollars * 100) : null;
}

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

        // The lock asks for the parent's cost basis only when none is recorded,
        // so the page needs to know which case it is in.
        const parentBasisCents = await loadRecordedParentBasisCents(orgId, parentId);

        return res.json({ rules: r ?? null, parentBasisCents });
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

  // POST /lock — freeze the computed grid, push asking prices to listPrice, and
  // record the lock as a gradeable decision citing the sell-out it predicts.
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

        // Validated before anything is read or written: a lock without its
        // economics, or without an answer to "when will you know?", is refused.
        const parsed = lockSchema.safeParse(req.body);
        if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);
        const body = parsed.data;
        const overrides = body.overrides;

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

        // ── The parent's cost basis: recorded, typed at the lock, or unknown ──
        // A recorded purchase price is the basis. Only when none is recorded may
        // the operator type one here; a typed figure that disagrees with the
        // recorded one is refused rather than silently ignored. When neither
        // exists the lock is REFUSED (V2 audit, 2026-10-04): without a basis the
        // engine cannot compute total cost or profit, so the decision could never
        // be graded, while the evidence gate certifies subdivider as gradeable.
        // Asking is the honest answer; no basis is ever invented.
        const recordedBasisCents = await loadRecordedParentBasisCents(orgId, parentId);
        const typedBasisCents = body.economics.parentBasisCents;
        if (
          recordedBasisCents !== null &&
          typedBasisCents !== undefined &&
          typedBasisCents !== recordedBasisCents
        ) {
          return Errors.badRequest(
            res,
            `The parent parcel already records a purchase price of ${formatCents(recordedBasisCents)}, ` +
              `and the lock uses it. Change it on the parcel rather than typing a different basis here.`,
          );
        }
        const parentBasisCents = recordedBasisCents ?? typedBasisCents;
        if (parentBasisCents === undefined) {
          return Errors.badRequest(
            res,
            "No purchase price is recorded for the parent parcel. Enter what it cost so the lock " +
              "can predict total cost and profit; without them this decision could never be graded.",
          );
        }

        // What the lock FREEZES is what the scenario computes on: every locked
        // lot price (overrides included) plus the operator's own answers.
        const scenarioInputs: Record<string, number> = {
          sellingCostPct: body.economics.sellingCostPct,
          monthsToSellOut: body.economics.monthsToSellOut,
        };
        for (const row of lockedGrid) scenarioInputs[lotPriceInputKey(row.childParcelId)] = row.askingPriceCents;
        if (parentBasisCents !== undefined) scenarioInputs.parentBasisCents = parentBasisCents;
        for (const k of ["surveyCents", "platCents", "permitsCents", "improvementsCents", "monthlyCarryCents"] as const) {
          const v = body.economics[k];
          if (v !== undefined) scenarioInputs[k] = v;
        }
        const scenarioAssumptions: ScenarioAssumption[] =
          parentBasisCents === undefined
            ? []
            : [
                {
                  key: "parent_basis",
                  value: parentBasisCents,
                  unit: "cents",
                  origin: "user" as const,
                  basis:
                    recordedBasisCents !== null
                      ? `The purchase price recorded on the parent parcel: ${formatCents(parentBasisCents)}.`
                      : `Typed at the lock (${formatCents(parentBasisCents)}); no purchase price is recorded on the parent parcel.`,
                },
              ];

        // Dry run BEFORE the lock commits: inputs the engine refuses (no lots, a
        // selling cost over 100%, a negative cost) are a 400 with the engine's
        // reason, and no list price moves.
        try {
          previewUnderwriting("subdivision_lot_sale", scenarioInputs);
        } catch (err) {
          if (err instanceof ScenarioEngineError) return Errors.badRequest(res, err.message);
          throw err;
        }

        await db.transaction(async (tx) => {
          await tx.update(lotPricingRules).set({
            lockedGrid,
            lockedAt: new Date(),
            updatedAt: new Date(),
          }).where(and(
            eq(lotPricingRules.id, rules.id),
            eq(lotPricingRules.organizationId, orgId),
          ));

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

        // ── Canonical loop: this lock is a DECISION, and it cites a SCENARIO ──
        //
        // The transaction above wrote every child lot's listPrice. That is the
        // asking price the market sees — the moment these numbers stop being a
        // preview and become an act, which is the criterion for adoption.
        //
        // `lockedGrid` preserves the OUTPUT and none of the reasoning. `rules`
        // and `basePriceSource` sit in the SAME MUTABLE ROW this statement just
        // updated, so editing the rules tomorrow leaves the grid intact and
        // destroys the explanation for it; the derived base-per-acre and the
        // engine version were never stored anywhere. That is exactly the state
        // Decision Memory exists for.
        //
        // The scenario is the PREDICTION: the `subdivision_lot_sale` engine run
        // on the prices this lock froze — gross sell-out, net proceeds, and (when
        // the parent's basis is known) total cost and profit. Those last two are
        // what Today's outcome prompt measures when the operator reports the lots
        // sold, so with the operator's own review date the lock is gradeable.
        // Scenario first, then the decision that cites it; both under the
        // subdivider pack.
        //
        // Recorded AFTER the transaction, deliberately. Recording first would
        // let a failed lock leave behind an immutable snapshot asserting a
        // price change that never happened — and a decision record is not
        // rewritable. A lock with no snapshot is a gap; a snapshot with no lock
        // is a lie. Best-effort for the same reason the offer path is: the
        // operator's pricing must not fail because the reasoning could not be
        // written, and a null link says so honestly.
        let decisionSnapshotId: number | null = null;
        let scenarioId: number | null = null;
        let metrics: unknown[] | null = null;
        try {
          const overridden = lockedGrid.filter((r) => r.override);
          const totalAskingCents = lockedGrid.reduce((n, r) => n + r.askingPriceCents, 0);

          const scenario = await recordScenario(orgId, {
            subjectType: "property",
            subjectId: parentId,
            label: `Lot sell-out at locked prices — ${lockedGrid.length} lot(s)`,
            engineId: "subdivision_lot_sale",
            inputs: scenarioInputs,
            assumptions: scenarioAssumptions,
            strategyPackId: "subdivider",
            strategyPackVersion: null,
          });
          scenarioId = scenario.id;
          metrics = scenario.body.metrics;

          const decision = await recordDecision(
            orgId,
            {
              subjectType: "property",
              subjectId: parentId,
              // The closed DECISION_KINDS set already carries this: "price — set
              // or change an asking/offer price". No new kind invented.
              kind: "price",
              choice:
                `Lock asking prices on ${lockedGrid.length} lot(s) — ` +
                `${formatCents(totalAskingCents)} total`,
              rationale:
                `Base ${formatCents(basePerAcre)}/acre from ${rules.basePriceSource}, ` +
                `${(rules.rules ?? []).length} premium rule(s), ` +
                `${overridden.length} operator override(s). ` +
                `Each lot's listPrice was set from this grid.`,
              actorType: "user",
              actorRef: userId,
              // The real authority: this route is reachable only behind
              // isAuthenticated + getOrCreateOrg, and it prices the org's own
              // parcels. Naming a generic "system" here would be false (BI72).
              authority: "org_member:lot_pricing_lock",
              // Lot pricing is the subdivider surface — that is the rule set
              // that shaped this grid (BI91), and the pack its scenario was
              // computed under.
              strategyPackId: "subdivider",
              strategyPackVersion: null,
              assumptions: [
                {
                  key: "base_per_acre_cents",
                  value: basePerAcre,
                  unit: "cents",
                  // A fixed $/acre is the operator's own number; an AVM-derived
                  // one is the platform's. Flattening the two would let a
                  // platform figure read later as what the customer believed.
                  origin: rules.basePriceSource === "fixed_per_acre" ? "user" : "derived",
                  basis: `basePriceSource=${rules.basePriceSource}`,
                },
                {
                  key: "engine_version",
                  value: LOT_PRICING_ENGINE_VERSION,
                  origin: "platform-default",
                  basis: "shared/subdivision/lotPricing.ts",
                },
                // The rule set VERBATIM. It lives in a mutable column, so a copy
                // here is the only thing that survives the operator editing it.
                ...(rules.rules ?? []).map((r, i) => ({
                  key: `rule_${i}`,
                  value: `${r.attribute} ${r.operator} ${String(r.threshold ?? "")} → ${r.premiumPct}`,
                  origin: "user" as const,
                  basis: r.label ?? "operator premium rule",
                })),
              ],
              // An override IS the option not taken, and the rules-derived price
              // is genuinely available — which makes these real alternatives
              // rather than the empty list most decisions honestly carry.
              alternatives: overridden.map((r) => {
                const derived = computeLotPricingGrid(basePerAcre, facts, rules.rules ?? [])
                  .find((g) => g.childParcelId === r.childParcelId);
                return {
                  choice:
                    `Lot ${r.childParcelId} at the rules-derived ` +
                    `${formatCents(derived?.askingPriceCents ?? r.basePriceCents)}`,
                  reason: `Operator priced it at ${formatCents(r.askingPriceCents)} instead`,
                };
              }),
              // The operator's answer to "when will you know how this went?".
              // Null is the answer "no set date", never a default. When it
              // arrives, Today asks; "sold" asks what the project actually
              // made, which the scenario's `profit` predicted, and "still open"
              // is the honest answer while lots remain unsold.
              reviewDueAt: body.reviewDueAt ? new Date(body.reviewDueAt) : null,
            },
            new Date(),
            [scenario.id],
          );
          decisionSnapshotId = decision.id;

          await db
            .update(lotPricingRules)
            .set({ lockedDecisionSnapshotId: decision.id })
            .where(and(
              eq(lotPricingRules.id, rules.id),
              eq(lotPricingRules.organizationId, orgId),
            ));
        } catch (err) {
          logger.error(
            "[SD-5] pricing grid locked but its reasoning was NOT recorded",
            err instanceof Error ? err : undefined,
          );
        }

        logger.info("[SD-5] pricing grid locked", { orgId, userId, parentId, lotCount: lockedGrid.length });
        return res.json({
          lockedGrid,
          lockedAt: new Date().toISOString(),
          decisionSnapshotId,
          scenarioId,
          metrics,
        });
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );
}
