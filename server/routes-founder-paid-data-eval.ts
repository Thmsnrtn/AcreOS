/**
 * /api/founder/paid-data-eval — the paid-data buy-decision surface (FOUNDER-ONLY).
 *
 * Iyari (Chief of Future) #6 + Lena (CFO/CIO) #3.
 *
 * Answers the question that stops us from spending the founder's money on data
 * that doesn't move outcomes: "If we ran Regrid/Zamplo/PropGrid against the
 * parcels our customers actually worked, which fields would diverge — and how
 * many DEAL DECISIONS would flip?" The buy is then surgical (buy the fields that
 * flip decisions, skip the ones free data already nails), not a blanket
 * subscription.
 *
 *   GET  /api/founder/paid-data-eval
 *     → corpus size + the most recent persisted eval run (field divergence +
 *       decision-flip report). Empty-state when the free corpus is empty.
 *
 *   POST /api/founder/paid-data-eval/run
 *     → runs the harness against the persisted free LIS corpus using the
 *       MockPaidProvider (no paid key, no spend — sample/dry-run mode), persists
 *       the result to paid_data_eval_runs, and returns it. The day Lena
 *       greenlights a trial, swap MockPaidProvider → RegridPaidProvider and pass
 *       mode "trial"; this surface needs zero changes.
 *
 * Pattern: isAuthenticated + getOrCreateOrg + requireFounder — same gate as
 * routes-founder-coverage.ts.
 */

import type { Express, Response } from "express";
import { z } from "zod";
import { isAuthenticated, requireFounder } from "./auth/clerkAuth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import type { AuthenticatedRequest } from "./types/request";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";
import {
  countCorpus,
  getLatestEvalRun,
  runPaidDataEval,
  saveEvalRun,
} from "./services/paidDataEvalHarness";
import { MockPaidProvider } from "./services/paidDataProviders";

const runRequestSchema = z.object({
  // Scope the corpus to one state (e.g. a trial window). Omit = whole corpus.
  state: z.string().trim().min(2).max(2).optional(),
  // Max parcels to compare (cost-capped server-side too).
  limit: z.number().int().min(1).max(2000).optional(),
  // Tuning knobs for the mock so the founder can sanity-check the math against
  // an assumed divergence profile before a real trial exists.
  flipPropensity: z.number().min(0).max(1).optional(),
  assessedDrift: z.number().min(0).max(5).optional(),
  // Estimated per-parcel cost (cents) to project trial spend (Regrid ~5–25¢).
  estCostCents: z.number().int().min(0).max(100).optional(),
});

export function registerFounderPaidDataEvalRoutes(app: Express) {
  // ── GET: latest run + corpus size ──────────────────────────────────────────
  app.get(
    "/api/founder/paid-data-eval",
    isAuthenticated,
    getOrCreateOrg,
    requireFounder,
    async (_req: AuthenticatedRequest, res: Response) => {
      try {
        // Global corpus (organizationId null) — the founder cares about the
        // whole customer base's counties, not one org.
        const [corpusSize, latest] = await Promise.all([
          countCorpus(null),
          getLatestEvalRun(null),
        ]);

        return res.json({
          asOf: new Date().toISOString(),
          corpusSize,
          latestRun: latest, // null until the first run
        });
      } catch (error) {
        return Errors.internal(res, error);
      }
    },
  );

  // ── POST: run a fresh sample eval (mock provider, no spend) + persist ───────
  app.post(
    "/api/founder/paid-data-eval/run",
    isAuthenticated,
    getOrCreateOrg,
    requireFounder,
    async (req: AuthenticatedRequest, res: Response) => {
      const parsed = runRequestSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return Errors.validationFailed(res, parsed.error.issues);
      }
      const { state, limit, flipPropensity, assessedDrift, estCostCents } = parsed.data;

      try {
        const corpusSize = await countCorpus(null);
        if (corpusSize === 0) {
          return Errors.badRequest(
            res,
            "No persisted Land Intelligence reports to evaluate yet. The corpus fills as customers run parcel lookups.",
          );
        }

        // SAMPLE / DRY-RUN: deterministic mock paid provider — no API key, no
        // network, no spend. The injection seam means this is the only line
        // that changes when a real trial is greenlit.
        const provider = new MockPaidProvider({
          flipPropensity,
          assessedDrift,
          estCostCents,
        });

        const result = await runPaidDataEval({
          provider,
          mode: "sample",
          organizationId: null,
          state: state?.toUpperCase(),
          limit,
        });

        // Persist the run (audit trail). Non-fatal: still return the result if
        // the write fails, so the founder always sees the analysis.
        let runId: number | null = null;
        try {
          runId = await saveEvalRun({
            organizationId: null,
            stateFilter: state?.toUpperCase() ?? null,
            result,
          });
        } catch (persistErr) {
          logger.warn("[founder-paid-data-eval] persist failed; returning unsaved result", {
            metadata: { error: persistErr instanceof Error ? persistErr.message : "unknown" },
          });
        }

        logger.info("[founder-paid-data-eval] sample run complete", {
          metadata: {
            corpusSize,
            parcelsCompared: result.parcelsCompared,
            decisionFlipCount: result.decisionFlipCount,
            decisionFlipRate: result.decisionFlipRate,
            runId,
          },
        });

        return res.json({ runId, result });
      } catch (error) {
        return Errors.internal(res, error);
      }
    },
  );
}
