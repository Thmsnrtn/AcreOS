/**
 * Flip analyzer — the comps → ARV → MAO → offer chain.
 *
 * WHAT WAS BROKEN
 * ───────────────
 * `DealUnderwritingService.calculateFlipAnalysis` (the 70%-rule MAO) had ZERO
 * routes and ZERO client references, so a fix-and-flip customer could not
 * compute a Maximum Allowable Offer in-product — while Pax's wholesaler
 * persona prompt discusses MAO as if it shipped. Three more real-but-
 * disconnected islands sat next to it: the ARV calculator
 * (server/routes-arv.ts) required every comp to be TYPED BY HAND and its
 * `arvMidCents` fed nothing downstream; the org's underwriting defaults
 * (/settings/underwriting) were consumed by no calculator; and the ATTOM
 * residential-comps seam (server/services/residentialComps.ts) had no
 * flip-facing caller.
 *
 * WHAT THIS MOUNTS
 * ────────────────
 *   GET   /api/flip-analyzer/defaults          — the org's flip rules + provenance
 *   PATCH /api/flip-analyzer/defaults          — persist the org's flip rules
 *   POST  /api/flip-analyzer/comps             — ATTOM-routed residential comps
 *   POST  /api/flip-analyzer/mao               — 70%-rule MAO + net model
 *   POST  /api/flip-analyzer/rental            — buy-and-hold comparison
 *   POST  /api/flip-analyzer/offer             — draft offer carrying the MAO
 *   GET   /api/flip-analyzer/subject/:id       — subject snapshot (ARV, rehab, price)
 *
 * The ARV itself is still written by the EXISTING POST /api/parcels/:id/arv
 * (routes-arv.ts) — this module reads the current `arv_calculations` row
 * rather than re-implementing the comp-adjustment math.
 *
 * MONEY
 * ─────
 * Integer cents on every field of every request and response here, matching
 * the fix-and-flip tables. `properties` and `offers` store money as `numeric`
 * decimal-dollar strings; conversion happens ONLY in the two helpers at the
 * top of this file, never inline.
 *
 * HONESTY
 * ───────
 * - Comps come exclusively from the residential seam (ATTOM allowlist). When
 *   there is no ATTOM connection or no coverage, the response carries the
 *   seam's own message and `comps: []` — a land comp is never substituted, and
 *   manual entry stays open on the client.
 * - A comp's `conditionRating` is left undefined: ATTOM does not report
 *   post-rehab condition, so the ARV math must skip the condition adjustment
 *   rather than assume a rating.
 * - Every default that shapes a number is returned with its `source`
 *   ("org_rule" vs "platform_default"), and unset holding cost is excluded and
 *   named, not zero-filled.
 *
 * DOCTRINE
 * ────────
 * Calculation and a DRAFT document only. No payment is collected, quoted or
 * scheduled anywhere in this file (founder ruling #15 — AcreOS is never in a
 * customer-money path).
 */

import type { Express, Response } from "express";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { db } from "./db";
import { organizations, properties, offers } from "@shared/schema";
import { arvCalculations, rehabs } from "@shared/schema/fix-and-flip";
import type { AuthenticatedRequest } from "./types/request";
import { getOrganization, getOrganizationId, getUserId } from "./types/request";
import { isAuthenticated } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";
import {
  computeMao,
  computeRentalReturns,
  resolveFlipDefaults,
  stampAssumptionSources,
  PLATFORM_FLIP_DEFAULTS,
  type FlipDefaults,
} from "./services/flipUnderwriting";

// ── money boundary ─────────────────────────────────────────────────────────

/** `numeric` decimal-dollar string → integer cents. Null when unparseable. */
function decimalDollarsToCents(value: string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

/** Integer cents → the `numeric` decimal-dollar string Drizzle expects. */
function centsToDecimalDollars(cents: number): string {
  return (Math.round(cents) / 100).toFixed(2);
}

// ── schemas ────────────────────────────────────────────────────────────────

const flipDefaultsPatchSchema = z
  .object({
    maoRulePct: z.coerce.number().min(1).max(100),
    rehabContingencyPct: z.coerce.number().min(0).max(100),
    sellingCostPct: z.coerce.number().min(0).max(50),
    purchaseClosingPct: z.coerce.number().min(0).max(50),
    holdMonths: z.coerce.number().int().min(1).max(60),
    monthlyHoldingCostCents: z.coerce.number().int().min(0).max(100_000_00),
    targetProfitPct: z.coerce.number().min(0).max(100),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, {
    message: "Provide at least one rule to save",
  });

const maoSchema = z.object({
  propertyId: z.coerce.number().int().positive().optional(),
  /** Omit to use the property's current saved ARV calculation. */
  arvCents: z.coerce.number().int().positive().optional(),
  rehabEstimateCents: z.coerce.number().int().min(0).default(0),
  purchasePriceCents: z.coerce.number().int().min(0).optional(),
  feeCents: z.coerce.number().int().min(0).default(0),
});

const rentalSchema = z.object({
  purchasePriceCents: z.coerce.number().int().positive(),
  monthlyRentCents: z.coerce.number().int().min(0),
  monthlyExpensesCents: z.coerce.number().int().min(0).optional(),
});

const offerSchema = maoSchema.extend({
  propertyId: z.coerce.number().int().positive(),
  /**
   * The amount the operator accepted, integer cents. Must be at or below the
   * server-recomputed MAO — the server does not trust a client-supplied price.
   */
  offerCents: z.coerce.number().int().positive(),
});

const compsSchema = z.object({
  propertyId: z.coerce.number().int().positive(),
});

// ── org rules ──────────────────────────────────────────────────────────────

function readStoredFlip(req: AuthenticatedRequest): Partial<FlipDefaults> | null {
  const org = getOrganization(req);
  return org.underwritingDefaults?.flip ?? null;
}

// ── ARV / subject resolution ───────────────────────────────────────────────

interface SubjectArv {
  arvCents: number;
  source: "saved_arv";
  confidence: string | null;
  compCount: number;
  calculatedAt: string;
}

async function loadCurrentArv(orgId: number, propertyId: number): Promise<SubjectArv | null> {
  const [row] = await db
    .select({
      arvMidCents: arvCalculations.arvMidCents,
      confidence: arvCalculations.confidence,
      compsUsed: arvCalculations.compsUsed,
      createdAt: arvCalculations.createdAt,
    })
    .from(arvCalculations)
    .where(
      and(
        eq(arvCalculations.organizationId, orgId),
        eq(arvCalculations.propertyId, propertyId),
        eq(arvCalculations.isCurrent, true),
      ),
    )
    .orderBy(desc(arvCalculations.createdAt))
    .limit(1);

  if (!row) return null;
  return {
    arvCents: row.arvMidCents,
    source: "saved_arv",
    confidence: row.confidence,
    compCount: Array.isArray(row.compsUsed) ? row.compsUsed.length : 0,
    calculatedAt: row.createdAt.toISOString(),
  };
}

export function registerFlipAnalyzerRoutes(app: Express): void {
  // ── the org's own flip rules ─────────────────────────────────────────────

  app.get(
    "/api/flip-analyzer/defaults",
    isAuthenticated,
    getOrCreateOrg,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const resolved = resolveFlipDefaults(readStoredFlip(req));
        return res.json({
          values: resolved.values,
          sources: resolved.sources,
          isCustomised: resolved.isCustomised,
          platformDefaults: PLATFORM_FLIP_DEFAULTS,
        });
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );

  app.patch(
    "/api/flip-analyzer/defaults",
    isAuthenticated,
    getOrCreateOrg,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const parsed = flipDefaultsPatchSchema.safeParse(req.body ?? {});
        if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);

        const org = getOrganization(req);
        const current = org.underwritingDefaults ?? {};
        const next = {
          ...current,
          flip: { ...(current.flip ?? {}), ...parsed.data },
        };

        await db
          .update(organizations)
          .set({ underwritingDefaults: next, updatedAt: new Date() })
          .where(eq(organizations.id, orgId));

        logger.info("[flip-analyzer] org flip rules saved", {
          source: "routes-flip-analyzer",
          metadata: { organizationId: orgId, fields: Object.keys(parsed.data) },
        });

        const resolved = resolveFlipDefaults(next.flip);
        return res.json({
          values: resolved.values,
          sources: resolved.sources,
          isCustomised: resolved.isCustomised,
          platformDefaults: PLATFORM_FLIP_DEFAULTS,
        });
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );

  // ── comps auto-fill (ATTOM seam; never land comps) ───────────────────────

  app.post(
    "/api/flip-analyzer/comps",
    isAuthenticated,
    getOrCreateOrg,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const parsed = compsSchema.safeParse(req.body ?? {});
        if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);

        const [prop] = await db
          .select({
            id: properties.id,
            address: properties.address,
            city: properties.city,
            state: properties.state,
            zip: properties.zip,
            latitude: properties.latitude,
            longitude: properties.longitude,
            squareFeet: properties.squareFeet,
          })
          .from(properties)
          .where(and(eq(properties.id, parsed.data.propertyId), eq(properties.organizationId, orgId)));
        if (!prop) return Errors.notFound(res, "Property");

        const lat = prop.latitude !== null ? Number(prop.latitude) : NaN;
        const lng = prop.longitude !== null ? Number(prop.longitude) : NaN;
        const hasCoords = Number.isFinite(lat) && Number.isFinite(lng);
        const hasAddress = !!(prop.address && prop.city && prop.state && prop.zip);

        if (!hasCoords && !hasAddress) {
          // Refuse rather than guess a location: a comp set pulled for the
          // wrong subject is worse than no comp set.
          return res.json({
            status: "unavailable",
            reason: "subject_not_locatable",
            message:
              "This property has no coordinates and no complete street address, so comps cannot be pulled for it. Add the address (or geocode the parcel) — or enter comps by hand below.",
            comps: [],
            subjectSqft: prop.squareFeet,
          });
        }

        const { getResidentialComps, extractResidentialComps } = await import(
          "./services/residentialComps"
        );
        const outcome = await getResidentialComps(
          orgId,
          hasCoords
            ? { kind: "coordinates", latitude: lat, longitude: lng }
            : {
                kind: "address",
                street: prop.address as string,
                city: prop.city as string,
                state: prop.state,
                zip: prop.zip as string,
              },
        );

        if (outcome.status !== "ok") {
          // "unavailable" (no ATTOM key / no credits) and "no_data" both carry
          // a customer-facing message. Render it verbatim; substitute nothing.
          return res.json({
            status: outcome.status,
            reason: outcome.status === "unavailable" ? outcome.reason : "no_data",
            message: outcome.message,
            comps: [],
            subjectSqft: prop.squareFeet,
          });
        }

        const parsedComps = extractResidentialComps(outcome.result.data);
        // Only comps carrying BOTH a sale price and a sale date can be used in
        // an ARV; the rest are dropped rather than shown with blanks the
        // operator might read as zeroes.
        const usable = parsedComps
          .filter((c) => c.salePrice !== null && c.salePrice > 0)
          .map((c) => ({
            address: c.address,
            soldPriceCents: Math.round((c.salePrice as number) * 100),
            soldDate: c.saleDate,
            sqft: c.sqft,
            distanceMiles: c.distanceMiles,
            // Deliberately absent: ATTOM does not report post-rehab
            // condition, and the ARV math skips the adjustment when it is
            // undefined rather than assuming a rating.
            propertyType: c.propertyType,
          }));

        logger.info("[flip-analyzer] residential comps pulled", {
          source: "routes-flip-analyzer",
          metadata: {
            organizationId: orgId,
            propertyId: prop.id,
            returned: parsedComps.length,
            usable: usable.length,
            byok: outcome.byok,
          },
        });

        return res.json({
          status: "ok",
          comps: usable,
          droppedNoPrice: parsedComps.length - usable.length,
          subjectSqft: prop.squareFeet,
          credentialSource: outcome.byok ? "organization" : "platform",
          provenance:
            "Sold comparables from ATTOM Data via the residential seam. Post-rehab condition is not reported by ATTOM — set it per comp yourself.",
        });
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );

  // ── MAO ─────────────────────────────────────────────────────────────────

  app.post(
    "/api/flip-analyzer/mao",
    isAuthenticated,
    getOrCreateOrg,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const parsed = maoSchema.safeParse(req.body ?? {});
        if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);

        const resolved = resolveFlipDefaults(readStoredFlip(req));

        let arvCents = parsed.data.arvCents ?? null;
        let arvSource: "operator_input" | "saved_arv" = "operator_input";
        let savedArv: SubjectArv | null = null;

        if (arvCents === null && parsed.data.propertyId) {
          savedArv = await loadCurrentArv(orgId, parsed.data.propertyId);
          if (savedArv) {
            arvCents = savedArv.arvCents;
            arvSource = "saved_arv";
          }
        }

        if (arvCents === null || arvCents <= 0) {
          // Refuse rather than invent: there is no defensible placeholder ARV.
          return Errors.badRequest(
            res,
            "No ARV to work from. Compute an ARV from comps for this property first, or enter one — the MAO is a function of ARV and cannot be estimated without it.",
          );
        }

        const result = computeMao({
          arvCents,
          rehabEstimateCents: parsed.data.rehabEstimateCents,
          purchasePriceCents: parsed.data.purchasePriceCents ?? null,
          feeCents: parsed.data.feeCents,
          defaults: resolved.values,
        });

        return res.json({
          ...result,
          assumptions: stampAssumptionSources(result.assumptions, resolved.sources),
          arvSource,
          arvBasis: savedArv
            ? {
                confidence: savedArv.confidence,
                compCount: savedArv.compCount,
                calculatedAt: savedArv.calculatedAt,
              }
            : null,
          rulesAreCustomised: resolved.isCustomised,
        });
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );

  // ── buy-and-hold comparison ─────────────────────────────────────────────

  app.post(
    "/api/flip-analyzer/rental",
    isAuthenticated,
    getOrCreateOrg,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const parsed = rentalSchema.safeParse(req.body ?? {});
        if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);
        return res.json(
          computeRentalReturns({
            purchasePriceCents: parsed.data.purchasePriceCents,
            monthlyRentCents: parsed.data.monthlyRentCents,
            monthlyExpensesCents: parsed.data.monthlyExpensesCents ?? null,
          }),
        );
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );

  // ── MAO → draft offer ───────────────────────────────────────────────────

  app.post(
    "/api/flip-analyzer/offer",
    isAuthenticated,
    getOrCreateOrg,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const parsed = offerSchema.safeParse(req.body ?? {});
        if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);

        const [prop] = await db
          .select({ id: properties.id, sellerId: properties.sellerId })
          .from(properties)
          .where(and(eq(properties.id, parsed.data.propertyId), eq(properties.organizationId, orgId)));
        if (!prop) return Errors.notFound(res, "Property");

        // Recompute server-side from the same inputs. The offer amount written
        // to the row is therefore provably the operator's own rule applied to a
        // real ARV, not a number typed into a form.
        const resolved = resolveFlipDefaults(readStoredFlip(req));
        let arvCents = parsed.data.arvCents ?? null;
        if (arvCents === null) {
          const savedArv = await loadCurrentArv(orgId, parsed.data.propertyId);
          arvCents = savedArv?.arvCents ?? null;
        }
        if (arvCents === null || arvCents <= 0) {
          return Errors.badRequest(
            res,
            "No ARV to work from — compute an ARV for this property before starting an offer.",
          );
        }

        const mao = computeMao({
          arvCents,
          rehabEstimateCents: parsed.data.rehabEstimateCents,
          purchasePriceCents: parsed.data.offerCents,
          feeCents: parsed.data.feeCents,
          defaults: resolved.values,
        });

        if (parsed.data.offerCents > mao.maoCents) {
          return Errors.badRequest(
            res,
            `That amount is above your MAO of ${centsToDecimalDollars(mao.maoCents)} — raise the MAO rule under Your rules if you mean to pay more, so the offer still matches a rule you actually hold.`,
            { maoCents: mao.maoCents, offerCents: parsed.data.offerCents },
          );
        }

        const offerPct = ((parsed.data.offerCents / arvCents) * 100).toFixed(2);

        const [created] = await db
          .insert(offers)
          .values({
            organizationId: orgId,
            propertyId: prop.id,
            leadId: prop.sellerId,
            status: "draft",
            cashOffer: centsToDecimalDollars(parsed.data.offerCents),
            estimatedMarketValue: centsToDecimalDollars(arvCents),
            offerPercentage: offerPct,
          })
          .returning();

        logger.info("[flip-analyzer] draft offer created from MAO", {
          source: "routes-flip-analyzer",
          metadata: {
            organizationId: orgId,
            propertyId: prop.id,
            offerId: created.id,
            offerCents: parsed.data.offerCents,
            maoCents: mao.maoCents,
            arvCents,
          },
        });

        // ── Record WHY, not just what (canonical layers 4 and 5) ─────────
        //
        // This is the first customer surface to write into the canonical loop,
        // and drafting an offer is the right moment for it: the number stops
        // being exploratory and becomes a document. Recording on every MAO
        // recompute would fill the tables with keystrokes; recording here is
        // once per deliberate act.
        //
        // The scenario is COMPUTED by the registered engine rather than
        // assembled from `mao` above. That looks redundant — the same
        // `computeMao` runs twice — and it is the contract: `recordScenario`
        // takes inputs and computes, because a caller that hands over
        // pre-computed numbers can hand over any numbers at all, and the stored
        // `engine_version` would then be a claim rather than a fact. The extra
        // call is pure arithmetic on seven integers.
        //
        // BEST-EFFORT, IN ITS OWN TRY/CATCH. The offer already succeeded and
        // its row is written. Failing the request now would turn a bookkeeping
        // problem into a lost draft offer, so this can only ever add a record —
        // never remove one. Same posture as the evidence write in
        // propertyEnrichment.ts, and for the same reason.
        let decisionSnapshotId: number | null = null;
        try {
          const { recordScenario } = await import("./services/economics/scenarioStore");
          const { recordDecision } = await import("./services/decisions/decisionStore");

          const scenario = await recordScenario(orgId, {
            subjectType: "property",
            subjectId: prop.id,
            label: `Offer ${centsToDecimalDollars(parsed.data.offerCents)} on a ${centsToDecimalDollars(arvCents)} ARV`,
            engineId: "flip_mao",
            inputs: {
              arvCents,
              rehabEstimateCents: parsed.data.rehabEstimateCents,
              purchasePriceCents: parsed.data.offerCents,
              feeCents: parsed.data.feeCents ?? 0,
              maoRulePct: resolved.values.maoRulePct,
              rehabContingencyPct: resolved.values.rehabContingencyPct,
              sellingCostPct: resolved.values.sellingCostPct,
              purchaseClosingPct: resolved.values.purchaseClosingPct,
              holdMonths: resolved.values.holdMonths,
              monthlyHoldingCostCents: resolved.values.monthlyHoldingCostCents,
              targetProfitPct: resolved.values.targetProfitPct,
            },
            // The operator's flip rules ARE assumptions, and their `source`
            // already distinguishes a rule they set from a platform default.
            // That distinction is exactly what `origin` exists to carry, so it
            // is mapped rather than flattened — a platform default silently
            // reading later as "what the customer believed" is the failure the
            // field prevents.
            assumptions: stampAssumptionSources(mao.assumptions, resolved.sources).map(
              (a) => ({
                key: a.key,
                // `display` is the pre-formatted figure ("70% of ARV"), which is
                // what the operator actually saw. Storing the formatted string
                // rather than a bare number keeps the record readable and keeps
                // server and client wording identical.
                value: a.display,
                origin:
                  a.source === "org_rule"
                    ? ("user" as const)
                    : ("platform-default" as const),
                basis: a.label,
              }),
            ),
          });

          const decision = await recordDecision(
            orgId,
            {
              subjectType: "property",
              subjectId: prop.id,
              kind: "offer",
              choice: `Offer ${centsToDecimalDollars(parsed.data.offerCents)} (MAO ${centsToDecimalDollars(mao.maoCents)})`,
              rationale:
                `Drafted from the fix-and-flip analyzer: ARV ${centsToDecimalDollars(arvCents)}, ` +
                `rehab ${centsToDecimalDollars(parsed.data.rehabEstimateCents)} before contingency, ` +
                `offered ${offerPct}% of ARV under the operator's own MAO rule.`,
              actorType: "user",
              actorRef: getUserId(req),
              // The real authority: this route is reachable only behind
              // isAuthenticated + getOrCreateOrg, and the offer was refused
              // above if it exceeded the org's own MAO rule. Naming a generic
              // "autonomous" or "system" here would be false (BI72).
              authority: "org_member:flip_analyzer_offer",
              strategyPackId: null,
              strategyPackVersion: null,
              assumptions: [],
              alternatives: [],
              // NULL, deliberately. An offer's fate is usually known within
              // weeks, so a review date would be useful — but nothing in this
              // request carries one, and defaulting would manufacture a date the
              // operator never chose, which is exactly what the outcome prompt
              // refuses to do. The UI should ASK; until it does, null is the
              // honest record.
              reviewDueAt: null,
            },
            new Date(),
            [scenario.id],
          );
          decisionSnapshotId = decision.id;
        } catch (err) {
          logger.warn(
            "[flip-analyzer] offer saved but its reasoning was not recorded",
            err instanceof Error ? err : undefined,
          );
        }

        return res.json({
          offer: created,
          carried: {
            arvCents,
            rehabWithContingencyCents: mao.rehabWithContingencyCents,
            maoCents: mao.maoCents,
            offerCents: parsed.data.offerCents,
            offerPctOfArv: Number(offerPct),
            netProfitCents: mao.netProfitCents,
          },
          // Null when the reasoning could not be recorded. Reported rather than
          // omitted, so a caller can tell "not recorded" from "not asked for".
          decisionSnapshotId,
          note: "Draft offer saved. Nothing has been sent and no money has moved — open it under Deals to review and send.",
        });
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );

  // ── subject snapshot (registered after the literal paths) ────────────────

  app.get(
    "/api/flip-analyzer/subject/:propertyId",
    isAuthenticated,
    getOrCreateOrg,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const propertyId = Number.parseInt(req.params.propertyId, 10);
        if (!Number.isFinite(propertyId)) return Errors.badRequest(res, "Invalid property id");

        const [prop] = await db
          .select({
            id: properties.id,
            apn: properties.apn,
            address: properties.address,
            city: properties.city,
            state: properties.state,
            zip: properties.zip,
            squareFeet: properties.squareFeet,
            latitude: properties.latitude,
            longitude: properties.longitude,
            purchasePrice: properties.purchasePrice,
            listPrice: properties.listPrice,
            estimatedRepairCost: properties.estimatedRepairCost,
          })
          .from(properties)
          .where(and(eq(properties.id, propertyId), eq(properties.organizationId, orgId)));
        if (!prop) return Errors.notFound(res, "Property");

        const arv = await loadCurrentArv(orgId, propertyId);

        const [rehab] = await db
          .select({
            id: rehabs.id,
            budgetTotalCents: rehabs.budgetTotalCents,
            holdingCostMonthlyCents: rehabs.holdingCostMonthlyCents,
          })
          .from(rehabs)
          .where(and(eq(rehabs.organizationId, orgId), eq(rehabs.propertyId, propertyId)));

        // Each candidate carries where it came from so the client can badge it
        // and the operator can see WHY a field pre-filled.
        return res.json({
          property: {
            id: prop.id,
            apn: prop.apn,
            address: prop.address,
            city: prop.city,
            state: prop.state,
            zip: prop.zip,
            squareFeet: prop.squareFeet,
            locatable:
              (prop.latitude !== null && prop.longitude !== null) ||
              !!(prop.address && prop.city && prop.state && prop.zip),
          },
          arv,
          rehabEstimate:
            rehab?.budgetTotalCents != null
              ? { cents: rehab.budgetTotalCents, source: "rehab_budget", rehabId: rehab.id }
              : decimalDollarsToCents(prop.estimatedRepairCost) !== null
                ? {
                    cents: decimalDollarsToCents(prop.estimatedRepairCost) as number,
                    source: "property_field",
                    rehabId: null,
                  }
                : null,
          monthlyHoldingCostCents: rehab?.holdingCostMonthlyCents ?? null,
          priceCandidates: {
            purchasePriceCents: decimalDollarsToCents(prop.purchasePrice),
            listPriceCents: decimalDollarsToCents(prop.listPrice),
          },
        });
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );
}
