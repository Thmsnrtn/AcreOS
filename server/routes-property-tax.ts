// @ts-nocheck
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

const router = Router();

function getOrg(req: Request) { return (req as any).org; }

router.post("/escrow/setup", async (req: Request, res: Response) => {
  try {
    const { noteId, annualPropertyTax, state, county } = req.body;
    if (!noteId || annualPropertyTax == null || !state) {
      return res.status(400).json({ error: "noteId, annualPropertyTax, and state are required" });
    }

    const org = getOrg(req);
    const escrowSetup = calculateTaxEscrow(annualPropertyTax, 0, state, county);
    await enableTaxEscrow(org.id, noteId, annualPropertyTax, state, county);

    res.json({ noteId, ...escrowSetup });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/escrow/:noteId", async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const noteId = parseInt(req.params.noteId);
    if (isNaN(noteId)) return res.status(400).json({ error: "Invalid note ID" });

    const status = await getNoteEscrowStatus(noteId, org.id);
    if (!status) return res.status(404).json({ error: "Note not found or escrow not enabled" });
    res.json(status);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/escrow/:noteId/credit", async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const noteId = parseInt(req.params.noteId);
    if (isNaN(noteId)) return res.status(400).json({ error: "Invalid note ID" });

    await creditMonthlyTaxEscrow(noteId, org.id);
    res.json({ credited: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/escrow/:noteId/pay", async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const noteId = parseInt(req.params.noteId);
    if (isNaN(noteId)) return res.status(400).json({ error: "Invalid note ID" });

    const { amountCents, taxYear, notes } = req.body;
    if (!amountCents || !taxYear) {
      return res.status(400).json({ error: "amountCents and taxYear are required" });
    }

    const result = await recordTaxPaymentFromEscrow(noteId, org.id, { amountCents, taxYear, notes });
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

router.get("/portal", (req: Request, res: Response) => {
  const state = (req.query.state as string) ?? "";
  const county = req.query.county as string | undefined;
  if (!state) return res.status(400).json({ error: "state is required" });
  res.json({ url: getCountyTaxPortalUrl(state, county) });
});

router.get("/portfolio", async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const summary = await getPortfolioTaxSummary(org.id);
    res.json(summary);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
