/**
 * T193 — Skip Tracing Routes
 *
 * POST /api/skip-tracing/trace/:leadId — trace a single lead
 * POST /api/skip-tracing/batch         — queue batch trace for all untraced leads
 * GET  /api/skip-tracing/stats         — aggregate trace stats
 */

import { Router, type Response } from "express";
import { skipTracingService } from "./services/skipTracingService";
import { storage } from "./storage";
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

    // The service traces a SkipTraceInput (name/address), not a raw leadId —
    // load the lead and build the input from its fields.
    const lead = await storage.getLead(orgId, leadId);
    if (!lead) {
      if (traceDebit.debitedCents > 0) {
        await refundPoolDebit({
          organizationId: orgId,
          originalEventId: traceKey,
          amountCents: traceDebit.debitedCents,
          reason: "Skip trace: lead not found",
        });
      }
      return Errors.notFound(res, "Lead");
    }

    let result;
    try {
      result = await skipTracingService.trace({
        firstName: lead.firstName,
        lastName: lead.lastName,
        address: lead.address ?? undefined,
        city: lead.city ?? undefined,
        state: lead.state ?? undefined,
        zip: lead.zip ?? undefined,
      }, orgId);
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
      // No queueBatchTrace on the service — trace up to `capped` leads inline
      // via traceBatch and report how many were processed.
      const leads = (await storage.getLeads(orgId)).slice(0, capped);
      const inputs = leads.map((lead) => ({
        firstName: lead.firstName,
        lastName: lead.lastName,
        address: lead.address ?? undefined,
        city: lead.city ?? undefined,
        state: lead.state ?? undefined,
        zip: lead.zip ?? undefined,
      }));
      const results = await skipTracingService.traceBatch(inputs);
      queued = results.length;
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
    // TODO(tsc): skipTracingService exposes no getStats(); report whether the
    // provider is configured plus the org's lead total as a basic summary
    // until per-org trace stats are persisted.
    const totalLeads = (await storage.getLeads(orgId)).length;
    const stats = {
      configured: skipTracingService.isConfigured(),
      totalLeads,
    };
    res.json(stats);
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

export default router;
