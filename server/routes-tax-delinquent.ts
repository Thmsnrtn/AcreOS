/**
 * T226 — Tax Delinquent Pipeline Routes
 *
 * GET  /api/tax-delinquent           — list delinquent leads
 * POST /api/tax-delinquent/import    — REFUSED: no per-county scraper exists
 *                                      (import a county CSV via
 *                                      POST /api/leads/import/tax-delinquent)
 * GET  /api/tax-delinquent/:id       — get lead detail
 * POST /api/tax-delinquent/:id/contact — REFUSED: there is no outreach
 *                                      sequence to enroll in; it used to set
 *                                      the lead "contacted" with nothing sent
 */

import { Router, type Request, type Response } from "express";
import { Errors, sendError } from "./utils/errors";
import { taxDelinquentPipeline } from "./services/taxDelinquentPipeline";
import { routeParam } from "./utils/routeParams";

const router = Router();


router.get("/", async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const { state, risk, limit = "50", page = "1" } = req.query;

    const leads = await taxDelinquentPipeline.getLeads({
      organizationId: org.id,
      stateCode: state as string | undefined,
      risk: risk as string | undefined,
      limit: Math.min(parseInt(String(limit)), 200),
      page: parseInt(String(page)),
    });
    res.json(leads);
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

router.post("/import", async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const { stateCode, county, limit = 500 } = req.body;

    const result = await taxDelinquentPipeline.importFromCounty({
      organizationId: org.id,
      stateCode,
      county,
      limit: Math.min(limit, 1000),
    });
    if (!result.available) {
      return Errors.badRequest(res, result.message, { reason: "county_import_unavailable", imported: 0 });
    }
    res.json(result);
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

router.get("/:id", async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const id = parseInt(routeParam(req.params.id));
    if (isNaN(id)) return sendError(res, 400, "BAD_REQUEST", "Invalid ID");

    const lead = await taxDelinquentPipeline.getLead(org.id, id);
    if (!lead) return sendError(res, 404, "NOT_FOUND", "Lead not found");
    res.json({ lead });
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

router.post("/:id/contact", async (_req: Request, res: Response) => {
  // Nothing enrolls a lead in an outreach sequence from this list, so nothing
  // is written: the lead's status stays what it was, never "contacted".
  return Errors.badRequest(
    res,
    "This list does not enroll leads in an outreach sequence, and nothing was sent. Open the lead to contact the owner.",
    { reason: "outreach_enrollment_unavailable" },
  );
});

export default router;
