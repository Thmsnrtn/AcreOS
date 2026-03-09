/**
 * T267 — Cohort Analysis Routes
 *
 * GET  /api/analytics/cohorts        — build cohort report
 * GET  /api/analytics/cohorts/segments — list available segments
 */

import { Router, type Request, type Response } from "express";
import { buildCohortReport, type CohortSegment } from "./services/cohortAnalysis";

const router = Router();

function getOrg(req: Request) { return (req as any).org; }

const VALID_SEGMENTS: CohortSegment[] = [
  "source",
  "state",
  "county",
  "campaign",
  "import_month",
  "import_quarter",
];

router.get("/", async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const segmentBy = (req.query.segmentBy as CohortSegment) ?? "source";

    if (!VALID_SEGMENTS.includes(segmentBy)) {
      return res.status(400).json({
        error: `Invalid segment. Must be one of: ${VALID_SEGMENTS.join(", ")}`,
      });
    }

    const fromDate = req.query.from ? new Date(req.query.from as string) : undefined;
    const toDate = req.query.to ? new Date(req.query.to as string) : undefined;

    if (fromDate && isNaN(fromDate.getTime())) {
      return res.status(400).json({ error: "Invalid from date" });
    }
    if (toDate && isNaN(toDate.getTime())) {
      return res.status(400).json({ error: "Invalid to date" });
    }

    const report = await buildCohortReport(org.id, segmentBy, fromDate, toDate);
    res.json(report);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/segments", (_req: Request, res: Response) => {
  res.json({ segments: VALID_SEGMENTS });
});

export default router;
