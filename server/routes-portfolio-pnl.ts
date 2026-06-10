/**
 * T144 — Portfolio P&L Routes
 *
 * GET /api/portfolio-pnl          — full P&L report for current year
 * GET /api/portfolio-pnl/:year    — P&L report for a specific year
 * GET /api/portfolio-pnl/periods  — list available reporting periods
 */

import { Router, type Request, type Response } from "express";
import { Errors } from "./utils/errors";
import { isAuthenticated } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import { getPortfolioPnl } from "./services/portfolioPnl";

const router = Router();


// Full P&L for current year
router.get("/", isAuthenticated, getOrCreateOrg, async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const year = new Date().getFullYear();
    const report = await getPortfolioPnl(org.id, new Date(year, 0, 1), new Date(year, 11, 31, 23, 59, 59));
    res.json({ report });
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

// P&L for a specific year
router.get("/:year", isAuthenticated, getOrCreateOrg, async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const year = parseInt(req.params.year);
    if (isNaN(year) || year < 2000 || year > 2100) {
      return res.status(400).json({ error: "Invalid year" });
    }
    const report = await getPortfolioPnl(org.id, new Date(year, 0, 1), new Date(year, 11, 31, 23, 59, 59));
    res.json({ report });
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

// List available reporting years (current year minus 5)
router.get("/periods", isAuthenticated, getOrCreateOrg, (req: Request, res: Response) => {
  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 6 }, (_, i) => currentYear - i);
  res.json({ years });
});

export default router;
