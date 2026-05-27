/**
 * T193 — Skip Tracing Routes
 *
 * POST /api/skip-tracing/trace/:leadId — trace a single lead
 * POST /api/skip-tracing/batch         — queue batch trace for all untraced leads
 * GET  /api/skip-tracing/stats         — aggregate trace stats
 */

import { Router, type Response } from "express";
import { skipTracingService } from "./services/skipTracingService";
import { poolDebit, refundPoolDebit } from "./services/creditPool";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";
import type { AuthenticatedRequest } from "./types/request";
import { getOrganizationId } from "./types/request";

const router = Router();

// POST /api/skip-tracing/trace/:leadId — trace a single lead
router.post("/trace/:leadId", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const orgId = getOrganizationId(req);
    const leadId = parseInt(req.params.leadId);
    if (isNaN(leadId)) return Errors.badRequest(res, "Invalid lead ID");

    // Lens 3 (Pricing Coherence) — debit ONE skip-trace credit before the
    // BatchData call. cache hits inside skipTracingService still pay (we
    // charge the customer for the lookup, even when our cache absorbed the
    // provider hit — that's how the BatchData unit-economics math works).
    const traceKey = `skip:trace:${orgId}:${leadId}:${Date.now()}`;
    const traceDebit = await poolDebit({
      organizationId: orgId,
      action: "skip_trace",
      units: 1,
      externalEventId: traceKey,
      notes: `Skip trace lead ${leadId}`,
      isFounder: req.isFounder,
    });

    let result;
    try {
      result = await skipTracingService.traceLead(leadId, orgId);
    } catch (err) {
      if (traceDebit.debitedCents > 0) {
        await refundPoolDebit({
          organizationId: orgId,
          originalEventId: traceKey,
          amountCents: traceDebit.debitedCents,
          reason: "Skip trace lookup failed",
        });
      }
      throw err;
    }

    res.json({
      ...result,
      creditPool: {
        debitedCents: traceDebit.debitedCents,
        remaining: traceDebit.remaining,
        poolMonthly: traceDebit.poolMonthly,
      },
    });
  } catch (err: any) {
    logger.error("Skip trace error", err);
    Errors.internal(res, err);
  }
});

// POST /api/skip-tracing/batch — queue batch trace
router.post("/batch", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const orgId = getOrganizationId(req);
    const { limit = 50 } = req.body;
    const capped = Math.min(limit, 100);

    // Pre-debit the pool for the full batch. If queueBatchTrace queues
    // FEWER than capped (e.g. only N untraced leads remain), refund the
    // unused units so the gauge stays honest.
    const batchKey = `skip:batch:${orgId}:${Date.now()}`;
    const batchDebit = await poolDebit({
      organizationId: orgId,
      action: "skip_trace",
      units: capped,
      externalEventId: batchKey,
      notes: `Skip trace batch (max ${capped})`,
      isFounder: req.isFounder,
    });

    let queued: number;
    try {
      queued = await skipTracingService.queueBatchTrace(orgId, capped);
    } catch (err) {
      if (batchDebit.debitedCents > 0) {
        await refundPoolDebit({
          organizationId: orgId,
          originalEventId: batchKey,
          amountCents: batchDebit.debitedCents,
          reason: "Skip trace batch queue failed",
        });
      }
      throw err;
    }

    if (queued < capped && batchDebit.debitedCents > 0) {
      // Refund the slack — we charged for `capped` but only queued `queued`.
      const slackUnits = capped - queued;
      const refundCents = Math.round((batchDebit.debitedCents * slackUnits) / capped);
      if (refundCents > 0) {
        await refundPoolDebit({
          organizationId: orgId,
          originalEventId: batchKey,
          amountCents: refundCents,
          reason: `Skip trace batch: only ${queued}/${capped} leads queued`,
        });
      }
    }

    res.json({
      queued,
      message: `Queued ${queued} leads for skip tracing`,
      creditPool: {
        debitedCents: batchDebit.debitedCents,
        remaining: batchDebit.remaining,
        poolMonthly: batchDebit.poolMonthly,
      },
    });
  } catch (err: any) {
    logger.error("Skip trace batch error", err);
    Errors.internal(res, err);
  }
});

// GET /api/skip-tracing/stats — aggregate stats
router.get("/stats", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const orgId = getOrganizationId(req);
    const stats = await skipTracingService.getStats(orgId);
    res.json(stats);
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

export default router;
