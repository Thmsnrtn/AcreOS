/**
 * T272 — Bookkeeping Routes
 *
 * GET  /api/bookkeeping/annual-report         — annual interest income report
 * GET  /api/bookkeeping/1099                  — 1099-INT forms data
 * POST /api/bookkeeping/deal-pnl              — calculate deal P&L
 * GET  /api/bookkeeping/portfolio-summary     — portfolio P&L summary
 */

import { Router, type Request, type Response } from "express";
import {
  generateAnnualInterestReport,
  generate1099IntForms,
  calculateDealPnL,
  getPortfolioAnnualSummary,
  TaxIdentityError,
} from "./services/bookkeeping";

const router = Router();


router.get("/annual-report", async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const taxYear = parseInt((req.query.year as string) ?? String(new Date().getFullYear() - 1));
    if (isNaN(taxYear)) return res.status(400).json({ error: "Invalid tax year" });

    const report = await generateAnnualInterestReport(org.id, taxYear);
    res.json(report);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/1099", async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const taxYear = parseInt((req.query.year as string) ?? String(new Date().getFullYear() - 1));
    if (isNaN(taxYear)) return res.status(400).json({ error: "Invalid tax year" });

    const forms = await generate1099IntForms(org.id, taxYear);
    res.json({ taxYear, forms });
  } catch (err: any) {
    if (err instanceof TaxIdentityError) {
      // 422: caller can act on this — capture the missing TIN(s) and retry.
      return res.status(422).json({
        error: "tax_identity_missing",
        code: err.code,
        message: err.message,
        orgId: err.orgId,
        noteId: err.noteId,
      });
    }
    res.status(500).json({ error: err.message });
  }
});

router.post("/deal-pnl", (req: Request, res: Response) => {
  try {
    const {
      purchasePrice,
      sellingPrice,
      expenses = [],
      purchaseDate,
      saleDate,
      dealType = "flip",
      downPaymentReceived,
    } = req.body;

    if (purchasePrice == null || sellingPrice == null || !purchaseDate || !saleDate) {
      return res.status(400).json({ error: "purchasePrice, sellingPrice, purchaseDate, and saleDate are required" });
    }

    const pnl = calculateDealPnL(
      purchasePrice,
      sellingPrice,
      expenses,
      new Date(purchaseDate),
      new Date(saleDate),
      dealType,
      downPaymentReceived
    );
    res.json(pnl);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

router.get("/portfolio-summary", async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const taxYear = parseInt((req.query.year as string) ?? String(new Date().getFullYear() - 1));
    if (isNaN(taxYear)) return res.status(400).json({ error: "Invalid tax year" });

    const summary = await getPortfolioAnnualSummary(org.id, taxYear);
    res.json(summary);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
