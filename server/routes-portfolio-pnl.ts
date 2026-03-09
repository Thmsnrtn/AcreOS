/**
 * T144 — Portfolio P&L Routes
 *
 * GET /api/portfolio-pnl          — full P&L report for current year
 * GET /api/portfolio-pnl/:year    — P&L report for a specific year
 * GET /api/portfolio-pnl/periods  — list available reporting periods
 */

import { Router, type Request, type Response } from "express";
import { isAuthenticated } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import { getPortfolioPnl } from "./services/portfolioPnl";

const router = Router();

function getOrg(req: Request) {
  const org = (req as any).organization;
  if (!org) throw new Error("Organization not found");
  return org;
}

// Full P&L for current year
router.get("/", isAuthenticated, getOrCreateOrg, async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const year = new Date().getFullYear();
    const report = await getPortfolioPnl(org.id, year);
    res.json({ report });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// P&L for a specific year
router.get("/:year", isAuthenticated, getOrCreateOrg, async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const year = parseInt(req.params.year);
    if (isNaN(year) || year < 2000 || year > 2100) {
      return res.status(400).json({ error: "Invalid year" });
    }
    const report = await getPortfolioPnl(org.id, year);
    res.json({ report });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// List available reporting years (current year minus 5)
router.get("/periods", isAuthenticated, getOrCreateOrg, (req: Request, res: Response) => {
  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 6 }, (_, i) => currentYear - i);
  res.json({ years });
});

export default router;
