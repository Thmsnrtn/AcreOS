/**
 * The wholesaler's buy box and candidate triage (wholesale package, Leg 2).
 *
 * GET  /api/wholesale/buy-box             — the current version and its history
 * POST /api/wholesale/buy-box             — { criteria } → a NEW version (never an edit); 200
 * GET  /api/wholesale/candidates/triage   — the org's own candidates, fit-scored
 *                                           against the current buy box with
 *                                           named reasons; stale ones retired
 *
 * Reads only what the org already holds. Writes only the buy box itself:
 * triage changes no property, deal or decision. No sourcing, no skip-trace,
 * no list building, no sends.
 */
import { Router, type Response } from "express";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "./db";
import { decisionSnapshots, deals, properties, wholesaleBuyBoxes } from "@shared/schema";
import type { AuthenticatedRequest } from "./types/request";
import { getOrganizationId, getUserId } from "./types/request";
import { Errors, sendError } from "./utils/errors";
import { logger } from "./utils/logger";
import { clock } from "./utils/clock";
import {
  buyBoxCriteriaSchema,
  CANDIDATE_STATUSES,
  triageCandidates,
  type CandidateFacts,
} from "@shared/wholesale/buyBox";

const router = Router();

/** A buy box's history is short; the cap is a runaway-writer guard. */
const VERSION_READ_CAP = 100;
/** Triage reads at most this many candidates, newest first, and says so. */
const CANDIDATE_CAP = 500;

async function versionsFor(organizationId: number) {
  return db
    .select()
    .from(wholesaleBuyBoxes)
    .where(eq(wholesaleBuyBoxes.organizationId, organizationId))
    .orderBy(desc(wholesaleBuyBoxes.version))
    .limit(VERSION_READ_CAP);
}

router.get("/buy-box", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const versions = await versionsFor(getOrganizationId(req));
    res.json({ current: versions[0] ?? null, versions });
  } catch (err) {
    Errors.internal(res, err);
  }
});

router.post("/buy-box", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const organizationId = getOrganizationId(req);
    const userId = getUserId(req);
    const parsed = buyBoxCriteriaSchema.safeParse(req.body?.criteria);
    if (!parsed.success) return Errors.validationFailed(res, parsed.error);

    const [latest] = await db
      .select({ version: wholesaleBuyBoxes.version })
      .from(wholesaleBuyBoxes)
      .where(eq(wholesaleBuyBoxes.organizationId, organizationId))
      .orderBy(desc(wholesaleBuyBoxes.version))
      .limit(1);
    try {
      const [row] = await db
        .insert(wholesaleBuyBoxes)
        .values({ organizationId, version: (latest?.version ?? 0) + 1, criteria: parsed.data, createdBy: userId })
        .returning();
      res.json({ current: row });
    } catch (err) {
      // Two saves raced for the same next version: the unique constraint
      // refused the second, which is the append-only guarantee working.
      if ((err as { code?: string })?.code === "23505") {
        return sendError(res, 409, "CONFLICT", "Your buy box was saved from another tab at the same moment. Reload and save again.");
      }
      throw err;
    }
  } catch (err) {
    logger.error("wholesale.buyBox.save failed", err instanceof Error ? err : undefined);
    Errors.internal(res, err);
  }
});

const centsOf = (v: string | number | null | undefined): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
};
const later = (...ds: Array<Date | null | undefined>): Date | null =>
  ds.reduce<Date | null>((m, d) => (d && (!m || d > m) ? d : m), null);

router.get("/candidates/triage", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const organizationId = getOrganizationId(req);
    const [box] = await versionsFor(organizationId);
    if (!box) return sendError(res, 409, "NO_BUY_BOX", "Save your buy box first — triage scores your candidates against it.");
    const criteria = buyBoxCriteriaSchema.parse(box.criteria);

    const props = await db
      .select({ id: properties.id, address: properties.address, apn: properties.apn, state: properties.state, county: properties.county, zip: properties.zip, updatedAt: properties.updatedAt })
      .from(properties)
      .where(and(eq(properties.organizationId, organizationId), inArray(properties.status, [...CANDIDATE_STATUSES]), isNull(properties.deletedAt)))
      .orderBy(desc(properties.updatedAt), desc(properties.id))
      .limit(CANDIDATE_CAP);
    const ids = props.map((p) => p.id);

    const dealRows = ids.length
      ? await db
          .select({ propertyId: deals.propertyId, offerAmount: deals.offerAmount, acceptedAmount: deals.acceptedAmount, updatedAt: deals.updatedAt })
          .from(deals)
          .where(and(eq(deals.organizationId, organizationId), inArray(deals.propertyId, ids), eq(deals.type, "acquisition"), isNull(deals.deletedAt)))
          .orderBy(desc(deals.updatedAt))
      : [];
    const decisionRows = ids.length
      ? await db
          .select({ subjectId: decisionSnapshots.subjectId, scenarios: decisionSnapshots.scenarios, decidedAt: decisionSnapshots.decidedAt })
          .from(decisionSnapshots)
          .where(
            and(
              eq(decisionSnapshots.organizationId, organizationId),
              eq(decisionSnapshots.subjectType, "property"),
              inArray(decisionSnapshots.subjectId, ids),
              eq(decisionSnapshots.strategyPackId, "residential_wholesaler"),
            ),
          )
          .orderBy(desc(decisionSnapshots.decidedAt))
      : [];

    const candidates: CandidateFacts[] = props.map((p) => {
      const deal = dealRows.find((d) => d.propertyId === p.id); // newest first
      const decision = decisionRows.find((d) => d.subjectId === p.id); // newest first
      const fee = decision?.scenarios
        .flatMap((s) => s.predicted)
        .find((m) => m.id === "assignment_fee")?.value;
      return {
        propertyId: p.id,
        label: p.address || (p.apn ? `APN ${p.apn}` : `Property ${p.id}`),
        state: p.state,
        county: p.county,
        zip: p.zip,
        priceCents: centsOf(deal?.acceptedAmount) ?? centsOf(deal?.offerAmount),
        underwrittenFeeCents: typeof fee === "number" ? fee : null,
        lastActivityAt: later(p.updatedAt, deal?.updatedAt, decision?.decidedAt),
      };
    });

    res.json({
      buyBoxVersion: box.version,
      candidatesRead: props.length,
      capped: props.length === CANDIDATE_CAP,
      rows: triageCandidates(criteria, candidates, clock.now()),
    });
  } catch (err) {
    Errors.internal(res, err);
  }
});

export default router;
