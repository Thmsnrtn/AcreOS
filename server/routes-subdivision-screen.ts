/**
 * Subdivision V1, Leg 1 — the buildability screen on a parent parcel the org
 * holds (package 2026-11-05 §3).
 *
 *   POST /api/parcels/:id/screen       — run the screen; APPEND one run record
 *   GET  /api/parcels/:id/screen-runs  — the parcel's run history, newest first,
 *                                        with the newest run's yield estimate
 *                                        beside the CURRENT drawn plans (§4.2)
 *
 * A run reads the facts AS THE OPERATOR RECORDS THEM on it (each with source
 * and as-of) plus the thresholds they state for it; computes the lot-yield
 * estimate and the seven trigger verdicts through the shared modules
 * (shared/subdivision/lotYield.ts, buildabilityScreen.ts); and INSERTS one
 * subdivision_screen_runs row. There is no update or delete route — a re-run
 * appends, so a verdict that changes keeps both runs (founder decision
 * 2026-11-05). The screen creates no plan, no lots and no pricing.
 *
 * No lookup of any kind: the parcel is the org's own row, and no statewide or
 * enrichment source is consulted (§7.3).
 */
import type { Express, Response } from "express";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { db } from "./db";
import { properties, subdivisionPlans, subdivisionScreenRuns } from "@shared/schema";
import type { AuthenticatedRequest } from "./types/request";
import { getOrganizationId, getUserId } from "./types/request";
import { isAuthenticated } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import { Errors } from "./utils/errors";
import { routeParam } from "./utils/routeParams";
import { estimateLotYield, reconcileWithDrawnPlans, type DrawnPlan, type LotYieldEstimate, type LotYieldInputs } from "@shared/subdivision/lotYield";

/** The history read returns at most this many runs, newest first, and says when there are more. */
const RUN_HISTORY_CAP = 50;
import { runBuildabilityScreen, type RecordedFact, type ScreenFacts } from "@shared/subdivision/buildabilityScreen";

const source = z.string().trim().min(1).max(200);
const asOf = z.string().max(40).nullable().optional();
const fact = <T extends z.ZodTypeAny>(value: T) => z.object({ value, source, asOf }).nullable().optional();
const acres = z.number().finite().nonnegative();

const screenBodySchema = z
  .object({
    facts: z
      .object({
        legalAccess: fact(z.enum(["recorded_access", "no_legal_access", "unrecorded_easement_only"])),
        grossAcres: fact(acres),
        floodwayAcres: fact(acres),
        floodplainAcres: fact(acres),
        percResult: fact(z.enum(["pass", "fail"])),
        sewerAvailable: fact(z.boolean()),
        waterAvailable: fact(z.boolean()),
        unresolvedEasementAcres: fact(acres),
        maxSlopePct: fact(z.number().finite().nonnegative()),
        // The perc-estimate slot is reserved for Amendment 2's calibrated model
        // and is never accepted in v1 (§3.4): only null may be sent.
        percEstimate: z.null().optional(),
      })
      .strict(),
    thresholds: z
      .object({
        floodplainShareMax: z.number().finite().min(0).max(1).nullable().optional(),
        maxBuildableSlopePct: z.number().finite().nonnegative().nullable().optional(),
      })
      .strict()
      .optional(),
    yield: z
      .object({
        easementAcres: fact(acres),
        unbuildableSlopeAcres: fact(acres),
        roadsRowFraction: z.number().finite().min(0).lt(1).nullable().optional(),
        minimumLot: z.object({ acres: z.number().finite().positive(), citation: source }).nullable().optional(),
        targetLotAcres: z.number().finite().positive().nullable().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

type FactIn<T> = { value: T; source: string; asOf?: string | null } | null | undefined;
const recorded = <T>(f: FactIn<T>): RecordedFact<T> | null => (f ? { value: f.value, source: f.source, asOf: f.asOf ?? null } : null);

export function registerSubdivisionScreenRoutes(app: Express): void {
  app.post(
    "/api/parcels/:id/screen",
    isAuthenticated,
    getOrCreateOrg,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const actorRef = getUserId(req);
        const rawId = routeParam(req.params.id);
        const parentId = /^\d+$/.test(rawId) ? Number(rawId) : NaN;
        if (!Number.isSafeInteger(parentId)) return Errors.badRequest(res, "Invalid parcel id");
        const parsed = screenBodySchema.safeParse(req.body ?? {});
        if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);

        const [parent] = await db
          .select({ id: properties.id, sizeAcres: properties.sizeAcres, parentParcelId: properties.parentParcelId })
          .from(properties)
          .where(and(eq(properties.id, parentId), eq(properties.organizationId, orgId)));
        if (!parent) return Errors.notFound(res, "Parcel");
        if (parent.parentParcelId !== null && parent.parentParcelId !== undefined) {
          return Errors.badRequest(res, "This parcel is a child lot — run the screen on its parent parcel");
        }

        const b = parsed.data;
        const recordAcres = parent.sizeAcres === null || parent.sizeAcres === undefined ? NaN : Number(parent.sizeAcres);
        const gross =
          recorded(b.facts.grossAcres) ??
          (Number.isFinite(recordAcres) && recordAcres > 0
            ? { value: recordAcres, source: "the parcel record's acreage (no source recorded on it)", asOf: null }
            : null);

        const facts: ScreenFacts = {
          legalAccess: recorded(b.facts.legalAccess),
          grossAcres: gross,
          floodwayAcres: recorded(b.facts.floodwayAcres),
          floodplainAcres: recorded(b.facts.floodplainAcres),
          percResult: recorded(b.facts.percResult),
          sewerAvailable: recorded(b.facts.sewerAvailable),
          waterAvailable: recorded(b.facts.waterAvailable),
          unresolvedEasementAcres: recorded(b.facts.unresolvedEasementAcres),
          maxSlopePct: recorded(b.facts.maxSlopePct),
          percEstimate: null,
        };
        const thresholds = {
          floodplainShareMax: b.thresholds?.floodplainShareMax ?? null,
          maxBuildableSlopePct: b.thresholds?.maxBuildableSlopePct ?? null,
        };
        // One acreage and one floodway figure feed both the screen and the yield.
        const yieldInputs: LotYieldInputs = {
          grossAcres: gross,
          floodwayAcres: facts.floodwayAcres,
          easementAcres: recorded(b.yield?.easementAcres),
          unbuildableSlopeAcres: recorded(b.yield?.unbuildableSlopeAcres),
          roadsRowFraction: b.yield?.roadsRowFraction ?? null,
          minimumLot: b.yield?.minimumLot ?? null,
          targetLotAcres: b.yield?.targetLotAcres ?? null,
        };
        const yieldEstimate = estimateLotYield(yieldInputs);
        const result = runBuildabilityScreen(facts, thresholds, yieldEstimate);
        // §4.2: the run cites the estimate AND the drawn counts as they stood at
        // the run — frozen here, so a later redraw cannot erase the disagreement.
        const drawnPlansAtRun = (
          await db
            .select({ id: subdivisionPlans.id, name: subdivisionPlans.name, lotCount: subdivisionPlans.lotCount })
            .from(subdivisionPlans)
            .where(and(eq(subdivisionPlans.organizationId, orgId), eq(subdivisionPlans.parentParcelId, parentId)))
            .orderBy(desc(subdivisionPlans.updatedAt))
        ).map((p) => ({ planId: p.id, name: p.name, lotCount: p.lotCount }));

        const [run] = await db
          .insert(subdivisionScreenRuns)
          .values({
            organizationId: orgId,
            parentParcelId: parentId,
            ruleVersion: result.version,
            inputs: { facts, thresholds, yieldInputs, drawnPlansAtRun } as unknown as Record<string, unknown>,
            yieldEstimate: yieldEstimate as unknown as Record<string, unknown>,
            result: result as unknown as Record<string, unknown>,
            triggeredCount: result.triggered.length,
            notDeterminableCount: result.notDeterminable.length,
            actorRef,
          })
          .returning();
        return res.json({ run });
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );

  app.get(
    "/api/parcels/:id/screen-runs",
    isAuthenticated,
    getOrCreateOrg,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const rawId = routeParam(req.params.id);
        const parentId = /^\d+$/.test(rawId) ? Number(rawId) : NaN;
        if (!Number.isSafeInteger(parentId)) return Errors.badRequest(res, "Invalid parcel id");
        const rows = await db
          .select()
          .from(subdivisionScreenRuns)
          .where(and(eq(subdivisionScreenRuns.organizationId, orgId), eq(subdivisionScreenRuns.parentParcelId, parentId)))
          .orderBy(desc(subdivisionScreenRuns.createdAt), desc(subdivisionScreenRuns.id))
          .limit(RUN_HISTORY_CAP + 1);
        const truncated = rows.length > RUN_HISTORY_CAP;
        const runs = rows.slice(0, RUN_HISTORY_CAP).map((r) => {
          const frozen = ((r.inputs as { drawnPlansAtRun?: DrawnPlan[] }).drawnPlansAtRun ?? []) as DrawnPlan[];
          // The disagreement AS IT STOOD at the run — reproducible from the record.
          return { ...r, reconciliationAtRun: reconcileWithDrawnPlans(r.yieldEstimate as unknown as LotYieldEstimate, frozen) };
        });
        // §4.2: the newest run's frozen estimate beside TODAY's drawn plans (each
        // run also carries its at-run reconciliation) — both numbers shown,
        // neither written. Plans are read org-scoped.
        let latestReconciliation: ReturnType<typeof reconcileWithDrawnPlans> = [];
        if (runs.length > 0) {
          const plans = await db
            .select({ id: subdivisionPlans.id, name: subdivisionPlans.name, lotCount: subdivisionPlans.lotCount })
            .from(subdivisionPlans)
            .where(and(eq(subdivisionPlans.organizationId, orgId), eq(subdivisionPlans.parentParcelId, parentId)))
            .orderBy(desc(subdivisionPlans.updatedAt));
          latestReconciliation = reconcileWithDrawnPlans(
            runs[0].yieldEstimate as unknown as LotYieldEstimate,
            plans.map((p) => ({ planId: p.id, name: p.name, lotCount: p.lotCount })),
          );
        }
        return res.json({ runs, latestReconciliation, truncated });
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );
}
