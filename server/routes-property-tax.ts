/**
 * T268 — Property Tax Service Routes
 *
 * POST /api/property-tax/escrow/setup    — calculate escrow setup for a note
 * GET  /api/property-tax/escrow/:noteId  — get escrow status for a note
 * POST /api/property-tax/escrow/:noteId/credit — credit monthly escrow
 * POST /api/property-tax/escrow/:noteId/pay    — record tax payment from escrow
 * GET  /api/property-tax/portal          — get county tax portal URL
 * GET  /api/property-tax/portfolio       — get portfolio tax summary
 */

import { Router, type Request, type Response } from "express";
import {
  calculateTaxEscrow,
  getCountyTaxPortalUrl,
  getNoteEscrowStatus,
  creditMonthlyTaxEscrow,
  recordTaxPaymentFromEscrow,
  getPortfolioTaxSummary,
  enableTaxEscrow,
} from "./services/propertyTaxService";
import { Errors } from "./utils/errors";

const router = Router();


router.post("/escrow/setup", async (req: Request, res: Response) => {
  try {
    const { noteId, annualPropertyTax, state, county } = req.body;
    if (!noteId || annualPropertyTax == null || !state) {
      return Errors.badRequest(res, "noteId, annualPropertyTax, and state are required");
    }

    const org = req.organization;
    const escrowSetup = calculateTaxEscrow(annualPropertyTax, 0, state, county);
    await enableTaxEscrow(org.id, noteId, annualPropertyTax, state, county);

    res.json({ noteId, ...escrowSetup });
  } catch (err) {
    Errors.internal(res, err);
  }
});

router.get("/escrow/:noteId", async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const noteId = parseInt(req.params.noteId);
    if (isNaN(noteId)) return Errors.badRequest(res, "Invalid note ID");

    const status = await getNoteEscrowStatus(noteId, org.id);
    if (!status) return Errors.notFound(res, "Note");
    res.json(status);
  } catch (err) {
    Errors.internal(res, err);
  }
});

router.post("/escrow/:noteId/credit", async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const noteId = parseInt(req.params.noteId);
    if (isNaN(noteId)) return Errors.badRequest(res, "Invalid note ID");

    await creditMonthlyTaxEscrow(noteId, org.id);
    res.json({ credited: true });
  } catch (err) {
    Errors.internal(res, err);
  }
});

router.post("/escrow/:noteId/pay", async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const noteId = parseInt(req.params.noteId);
    if (isNaN(noteId)) return Errors.badRequest(res, "Invalid note ID");

    const { amountCents, taxYear, notes } = req.body;
    if (!amountCents || !taxYear) {
      return Errors.badRequest(res, "amountCents and taxYear are required");
    }

    // recordTaxPaymentFromEscrow(orgId, RecordTaxPaymentInput). The input
    // carries noteId; amountPaid is in dollars (body sends amountCents).
    const result = await recordTaxPaymentFromEscrow(org.id, {
      noteId,
      taxYear,
      amountPaid: Number(amountCents) / 100,
      paymentDate: new Date(),
      notes,
    });
    res.json(result);
  } catch (err) {
    Errors.badRequest(res, err instanceof Error ? err.message : "Bad request");
  }
});

router.get("/portal", (req: Request, res: Response) => {
  const state = (req.query.state as string) ?? "";
  const county = req.query.county as string | undefined;
  if (!state) return Errors.badRequest(res, "state is required");
  res.json({ url: getCountyTaxPortalUrl(state, county) });
});

router.get("/portfolio", async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const summary = await getPortfolioTaxSummary(org.id);
    res.json(summary);
  } catch (err) {
    Errors.internal(res, err);
  }
});

export default router;
