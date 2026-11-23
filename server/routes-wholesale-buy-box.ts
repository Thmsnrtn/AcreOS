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
import { desc, eq } from "drizzle-orm";
import { db } from "./db";
import { wholesaleBuyBoxes } from "@shared/schema";
import type { AuthenticatedRequest } from "./types/request";
import { getOrganizationId, getUserId } from "./types/request";
import { Errors, sendError } from "./utils/errors";
import { logger } from "./utils/logger";
import { clock } from "./utils/clock";
import { buyBoxCriteriaSchema } from "@shared/wholesale/buyBox";
import { buyBoxVersionsFor, triageForOrg } from "./services/wholesale/buyBoxTriage";

const router = Router();

const versionsFor = buyBoxVersionsFor;

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

router.get("/candidates/triage", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const read = await triageForOrg(getOrganizationId(req), clock.now());
    if (read.kind === "no_buy_box") return sendError(res, 409, "NO_BUY_BOX", "Save your buy box first — triage scores your candidates against it.");
    res.json({
      buyBoxVersion: read.buyBoxVersion,
      candidatesRead: read.candidatesRead,
      capped: read.capped,
      rows: read.rows,
    });
  } catch (err) {
    Errors.internal(res, err);
  }
});

export default router;
